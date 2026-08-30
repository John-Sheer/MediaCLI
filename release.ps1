# Release orchestrator MediaCLI - pipeline complete et idempotente.
# Garantit un TAG TOUJOURS FRAIS (garde-fou anti-cache CDN GitHub) et derive
# latest.json + index.html depuis les assets reellement publies (jamais hardcode).
# Usage:  powershell -ExecutionPolicy Bypass -File release.ps1
#         powershell -ExecutionPolicy Bypass -File release.ps1 -Version 0.1.16
#         powershell -ExecutionPolicy Bypass -File release.ps1 -SkipBuild
param(
  [string]$Version = "",
  [switch]$SkipBuild
)
$ErrorActionPreference = "Continue"
Set-StrictMode -Version 2.0
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

function Read-CurrentVersion {
  $pkg = Get-Content -Raw "package.json" | ConvertFrom-Json
  return $pkg.version
}

function Bump-Patch {
  param([string]$v)
  $m = [regex]::Match($v, '^(\d+)\.(\d+)\.(\d+)$')
  if (-not $m.Success) { throw "Version invalide: $v" }
  return "$($m.Groups[1].Value).$($m.Groups[2].Value).$([int]$m.Groups[3].Value + 1)"
}

function Set-FileVersion {
  param([string]$Path, [string]$Find, [string]$Replace)
  $txt = [System.IO.File]::ReadAllText($Path)
  if (-not $txt.Contains($Find)) { throw "Pattern introuvable '$Find' dans $Path" }
  $txt = $txt.Replace($Find, $Replace)
  [System.IO.File]::WriteAllText($Path, $txt, [System.Text.UTF8Encoding]::new($false))
  Write-Output "  version -> $Path"
}

function Get-ReleaseUrl {
  param([string]$tag, [string]$name)
  $rel = gh api "repos/John-Sheer/MediaCLI/releases/tags/$tag" 2>$null | ConvertFrom-Json
  $a = $rel.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $a) { throw "Asset '$name' introuvable sur la release $tag" }
  return $a.browser_download_url
}

# ---------------------------------------------------------------- version
$cur = Read-CurrentVersion
if ($Version -eq "") { $Version = Bump-Patch $cur }
if ($Version -eq $cur) { throw "Version identique ($cur) - releaser une version FRAICHE obligatoire." }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version invalide: $Version (attendu x.y.z)" }
$tag = "v$Version"

Write-Output "=== Release MediaCLI $cur -> $Version (tag $tag) ==="

Write-Output "[0/9] Garde-fous..."
& cmd /c "gh release view $tag --repo John-Sheer/MediaCLI >NUL 2>&1"
$releaseExists = ($LASTEXITCODE -eq 0)
if ($releaseExists) { throw "La release $tag existe DEJA sur GitHub - jamais reutiliser un tag existant (anti-cache CDN)." }
if (git tag -l $tag) { throw "Le tag local $tag existe deja - supprimez-le ou utilisez -Version." }
Write-Output "  OK: tag $tag libre (aucune URL reutilisee)."

Write-Output "[1/9] Bump version dans package.json, tauri.conf.json, Cargo.toml, Cargo.lock, tauri.properties..."
Set-FileVersion "package.json" "`"version`": `"$cur`"" "`"version`": `"$Version`""
Set-FileVersion "src-tauri\tauri.conf.json" "`"version`": `"$cur`"" "`"version`": `"$Version`""
Set-FileVersion "src-tauri\Cargo.toml" "version = `"$cur`"" "version = `"$Version`""
Set-FileVersion "src-tauri\Cargo.lock" "version = `"$cur`"" "version = `"$Version`""
$props = "src-tauri\gen\android\app\tauri.properties"
$ptxt = Get-Content -Raw $props
$oldCode = [int]([regex]::Match($ptxt, 'versionCode=(\d+)').Groups[1].Value)
$newCode = $oldCode + 1
Set-FileVersion $props "tauri.android.versionName=$cur" "tauri.android.versionName=$Version"
Set-FileVersion $props "tauri.android.versionCode=$oldCode" "tauri.android.versionCode=$newCode"
Write-Output "  versionCode Android: $oldCode -> $newCode"

# ---------------------------------------------------------------- build
if (-not $SkipBuild) {
  Write-Output "[2/9] Build complet (front + windows + android .so + portable + signatures)..."
  powershell -ExecutionPolicy Bypass -File "build.ps1"
  if ($LASTEXITCODE -ne 0) { throw "build.ps1 a echoue" }
} else {
  Write-Output "[2/9] Build SAUTE (-SkipBuild)."
}

$exeDir = "C:\Users\LENOVO\Desktop\mediaCLI\EXE"
$setup = Join-Path $exeDir "MediaCLI-Setup.exe"
$sigFile = Join-Path $exeDir "MediaCLI-Setup.exe.sig"
if (-not (Test-Path $setup)) { throw "Installeur introuvable: $setup" }
if (-not (Test-Path $sigFile)) { throw "Signature introuvable: $sigFile" }

# ---------------------------------------------------------------- android apk
if (-not $SkipBuild) {
  Write-Output "[3/9] Build APK Android (gradle) + signature apksigner..."
  Push-Location "src-tauri\gen\android"
  & ".\gradlew.bat" assembleUniversalRelease --offline
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Echec gradle assembleUniversalRelease" }
  Pop-Location

  $unsigned = "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
  $outApk = "C:\Users\LENOVO\Desktop\mediaCLI\APK\app-universal-release-signed.apk"
  $apksigner = "C:\Users\LENOVO\AppData\Local\Android\Sdk\build-tools\35.0.0\apksigner.bat"
  $pass = "3MFQhAiqBukg9LmXb8GxtlaS"
  $argLine = "sign --ks `"C:\Users\LENOVO\Desktop\mediaCLI\APK\keystore\mediacli-release.keystore`" --ks-key-alias mediacli --ks-pass pass:$pass --out `"$outApk`" `"$unsigned`""
  & cmd /c "`"$apksigner`" $argLine"
  if ($LASTEXITCODE -ne 0) { throw "Echec apksigner sign" }
  Write-Output "  APK signe: $outApk"

  # verification embed du frontend courant
  $tmp = Join-Path $env:TEMP "opencode\apkcheck-release"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($outApk)
  $entry = $zip.Entries | Where-Object { $_.FullName -eq "lib/arm64-v8a/libmedia_cli_lib.so" }
  $soOut = Join-Path $tmp "lib.so"
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $soOut, $true)
  $zip.Dispose()
  $soTxt = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($soOut))
  $bundle = Get-ChildItem "dist\assets" -Filter "index-*.js" | Where-Object { $_.Name -match '^index-[A-Za-z0-9_-]+\.js$' } | Select-Object -First 1
  $needle = $bundle.Name
  if (-not ($soTxt.Contains($needle) -or $soTxt.Contains([System.IO.Path]::GetFileNameWithoutExtension($needle)))) {
    throw "FATAL: l'APK n'embarque pas $needle - frontend obsoleted, abandon."
  }
  Write-Output "  VERIF OK: APK embarque $needle"
} else {
  Write-Output "[3/9] APK non reconstruit (-SkipBuild)."
}

# ---------------------------------------------------------------- portable zip
Write-Output "[4/9] Zip portable..."
$zipPath = "C:\Users\LENOVO\Desktop\mediaCLI\Portable\MediaCLI-Portable.zip"
$stage = Join-Path $env:TEMP "opencode\portable-stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -Force "C:\Users\LENOVO\Desktop\mediaCLI\Portable\MediaCLI.exe" (Join-Path $stage "MediaCLI.exe")
Copy-Item -Recurse -Force "C:\Users\LENOVO\Desktop\mediaCLI\Portable\resources" (Join-Path $stage "resources")
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath)
Write-Output "  Zip portable: $((Get-Item $zipPath).Length) octets"

# ---------------------------------------------------------------- git + github
Write-Output "[5/9] Commit + tag + push..."
git add -A
git commit -m "release: $tag - publication automatisee (release.ps1)" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Output "  (aucun changement a commiter - tag sur le HEAD existant)" }
git tag $tag
git push origin main 2>&1 | Out-Null
git push origin $tag 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Echec git push du tag $tag" }
Write-Output "  Tag $tag pousse."

Write-Output "[6/9] Creation de la release GitHub (URLs fraiches)..."
$notes = "MediaCLI $Version - build automatise. Nouvelles URLs (aucun cache CDN)."
& cmd /c "gh release create $tag --repo John-Sheer/MediaCLI --title $tag --notes `"$notes`" >NUL 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Echec gh release create" }

Write-Output "[7/9] Upload des assets..."
$apkFile = "C:\Users\LENOVO\Desktop\mediaCLI\APK\app-universal-release-signed.apk"
& cmd /c "gh release upload $tag --repo John-Sheer/MediaCLI --clobber `"$setup`" `"$sigFile`" `"$zipPath`" `"$apkFile`" >NUL 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Echec gh release upload" }
Write-Output "  Asssets uploades (setup, sig, portable, apk)."

# ---------------------------------------------------------------- latest.json + site
Write-Output "[8/9] latest.json + index.html depuis les URLs reelles GitHub..."
$apkName = [System.IO.Path]::GetFileName($apkFile)
$urlApk    = Get-ReleaseUrl $tag $apkName
$urlSetup  = Get-ReleaseUrl $tag "MediaCLI-Setup.exe"
$urlPort   = Get-ReleaseUrl $tag "MediaCLI-Portable.zip"
$sigText = (Get-Content -Raw $sigFile).Trim()
$sigField = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sigText))

$latest = [ordered]@{
  version  = $Version
  notes    = "Mise a jour MediaCLI $Version (Windows + Android)."
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "android-arm64" = [ordered]@{ url = $urlApk; signature = "" }
    "windows-x86_64" = [ordered]@{ url = $urlSetup; signature = $sigField }
  }
}
$latestPath = "hosting\updates\latest.json"
[System.IO.File]::WriteAllText((Join-Path $root $latestPath), ($latest | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
Write-Output "  latest.json -> $latestPath"

# mise a jour des liens de telechargement dans index.html
$htmlPath = "hosting\index.html"
$html = [System.IO.File]::ReadAllText((Join-Path $root $htmlPath))
foreach ($id in @("dlWindows","dlPortable","dlAndroid")) {
  $m = [regex]::Match($html, "(id=`"$id`"[^>]*href=`")([^`"]+)(`")")
  if (-not $m.Success) { throw "Lien $id introuvable dans index.html" }
  $u = if ($id -eq "dlWindows") { $urlSetup } elseif ($id -eq "dlPortable") { $urlPort } else { $urlApk }
  $html = $html.Substring(0, $m.Index) + $m.Groups[1].Value + $u + $m.Groups[3].Value + $html.Substring($m.Index + $m.Length)
}
# insere l'entree de changelog en tete
$entry = "<div class=`"cl-item`">`n      <div class=`"cl-date`">v$Version — Août 2026</div>`n      <div class=`"cl-notes`">Version $Version - publication automatisee (URLs fraiches, APK a jour).</div>`n    </div>`n    "
$anchor = '<div class="cl-item">'
$html = $html.Replace($anchor, $entry + $anchor)
[System.IO.File]::WriteAllText((Join-Path $root $htmlPath), $html, [System.Text.UTF8Encoding]::new($false))
Write-Output "  index.html -> liens + changelog $tag"

# ---------------------------------------------------------------- deploy
Write-Output "[9/9] Deploiement Firebase..."
firebase deploy --only hosting 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { throw "Echec firebase deploy" }

Write-Output ""
Write-Output "=== PUBLICATION TERMINE : $tag ==="
Write-Output "  APK     : $urlApk"
Write-Output "  Windows : $urlSetup"
Write-Output "  Portable: $urlPort"
Pop-Location