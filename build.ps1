# Build script pour MediaCLI - force le re-embarquement du front
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

# Clé minisign pour signer le build (utilisée par tauri build + signer sign)
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = Join-Path $env:USERPROFILE ".tauri\mediacli.key"
$passFile = Join-Path $env:USERPROFILE ".tauri\mediacli.key.pass"
if (Test-Path $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw $env:TAURI_SIGNING_PRIVATE_KEY_PATH).Trim()
  if (Test-Path $passFile) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Raw $passFile).Trim()
  } else {
    Write-Output "ATTENTION: fichier mot de passe absent ($passFile) - le build ne pourra pas signer"
  }
}

Write-Output "[1/5] Nettoyage caches (vite + tauri build)..."
Remove-Item -Recurse -Force "node_modules\.vite" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "src-tauri\target\release\build" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "src-tauri\target\release\deps" -ErrorAction SilentlyContinue

Write-Output "[2/5] Build front (vite)..."
npm run build
if ($LASTEXITCODE -ne 0) { Write-Output "ECHEC build front"; Pop-Location; exit 1 }

Write-Output "[3/5] Build tauri (release, clean)..."
# supprimer target/release entier pour forcer re-embarquement du dist a jour
Remove-Item -Recurse -Force "src-tauri\target\release" -ErrorAction SilentlyContinue
npm run tauri build
if ($LASTEXITCODE -ne 0) { Write-Output "ECHEC build tauri"; Pop-Location; exit 1 }

Write-Output "[3b/5] Rebuild Android lib (arm64) + copie jniLibs + vérification du frontend embarqué..."
$jniDir = Join-Path $root "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a"
if (!(Test-Path $jniDir)) { New-Item -ItemType Directory -Force -Path $jniDir | Out-Null }
$srcLib = Join-Path $root "src-tauri\target\aarch64-linux-android\release\libmedia_cli_lib.so"
$dstLib = Join-Path $jniDir "libmedia_cli_lib.so"

# 1) Recompiler le .so Android APRÈS le build front (sinon il embarque l'ancien dist)
$cargoExe = Get-Command cargo -ErrorAction SilentlyContinue
$sdkRoot = $env:ANDROID_HOME; if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) { $sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$ndkRoot = $null
if (Test-Path $sdkRoot) {
  $ndk = Get-ChildItem (Join-Path $sdkRoot "ndk") -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($ndk) { $ndkRoot = $ndk.FullName }
}
$toolchainBin = Join-Path $ndkRoot "toolchains\llvm\prebuilt\windows-x86_64\bin"
$clang = Get-ChildItem $toolchainBin -Filter "aarch64-linux-android*-clang.cmd" -ErrorAction SilentlyContinue |
  Sort-Object { [int]([regex]::Match($_.Name,'android(\d+)-clang').Groups[1].Value) } -Descending | Select-Object -First 1

if ($clang -and $cargoExe) {
  $env:CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER = $clang.FullName
  $env:CC_aarch64_linux_android = $clang.FullName
  $ar = Join-Path $toolchainBin "llvm-ar.exe"
  if (Test-Path $ar) { $env:AR_aarch64_linux_android = $ar }
  Write-Output "  -> cargo build --release --target aarch64-linux-android (embarque le dist de [2/5])..."
  Push-Location (Join-Path $root "src-tauri")
  cargo build --release --target aarch64-linux-android
  $cargoOk = ($LASTEXITCODE -eq 0)
  Pop-Location
  if (-not $cargoOk) {
    Write-Output "ERREUR: build Rust Android en echec (voir sortie cargo ci-dessus)."
    Write-Output "        Verifier: rustup target add aarch64-linux-android"
    Pop-Location; exit 1
  }
} else {
  Write-Output "ATTENTION: NDK ($ndkRoot) ou cargo introuvable - .so Android NON recompile, copie existante verifiee."
}

# 2) Copie dans jniLibs + vérification que le frontend embarqué correspond au dist actuel
if (Test-Path $srcLib) {
  Copy-Item -Force $srcLib $dstLib
  Write-Output "  -> .so copie vers jniLibs\arm64-v8a"
  $bundle = Get-ChildItem (Join-Path $root "dist\assets") -Filter "index-*.js" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^index-[A-Za-z0-9_-]+\.js$' } | Select-Object -First 1
  if ($bundle) {
    $txt = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($dstLib))
    $needle = $bundle.Name
    $needleNoExt = [System.IO.Path]::GetFileNameWithoutExtension($bundle.Name)
    if ($txt.Contains($needle) -or $txt.Contains($needleNoExt)) {
      Write-Output "  -> VERIF OK: le .so embarque $needle"
    } else {
      Write-Output "ERREUR FATALE: le .so n'embarque PAS $needle - frontend obsolète."
      Write-Output "               Corriger l'outillage NDK/cargo avant de generer l'APK."
      Pop-Location; exit 1
    }
  } else {
    Write-Output "ATTENTION: aucun bundle index-*.js dans dist\assets - verification impossible"
  }
} else {
  Write-Output "ATTENTION: bibliothèque native introuvable à $srcLib"
}

Write-Output "[4/6] Sync portable..."
$releaseDir = Join-Path $root "src-tauri\target\release"
$exe = Get-ChildItem -LiteralPath $releaseDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*CLI.exe" -and -not $_.PSIsContainer } | Select-Object -First 1
if ($exe) {
  $dest = Join-Path $env:USERPROFILE "Desktop\mediaCLI\Portable\MediaCLI.exe"
  # IMPORTANT: Copy-Item PowerShell echoue silencieusement avec le nom accentue "MédiaCLI.exe".
  # On passe par cmd /c copy qui gere l'encodage correctement.
  & cmd /c "copy /Y `"$($exe.FullName)`" `"$dest`" > NUL 2>&1"
  Start-Sleep -Seconds 1
  $copied = Get-Item -LiteralPath $dest -ErrorAction SilentlyContinue
  if ($copied -and $copied.LastWriteTime -eq $exe.LastWriteTime) {
    Write-Output "Copie portable OK (heure: $($copied.LastWriteTime))"
  } else {
    Write-Output "ERREUR: la copie portable a echoue (heure dest: $($copied.LastWriteTime), source: $($exe.LastWriteTime))"
  }
} else {
  Write-Output "ERREUR: EXE introuvable dans $releaseDir"
}

Write-Output "[5/6] Signature minisign de l'installeur NSIS..."
$nsisDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem -LiteralPath $nsisDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*setup.exe" } | Select-Object -First 1
$version = (Get-Content -Raw (Join-Path $root "src-tauri\tauri.conf.json") | ConvertFrom-Json).version
if (-not $setup) {
  Write-Output "ERREUR: installeur NSIS introuvable dans $nsisDir"
  Pop-Location; exit 1
}
$keyPath = Join-Path $env:USERPROFILE ".tauri\mediacli.key"
$passFile = Join-Path $env:USERPROFILE ".tauri\mediacli.key.pass"
if ((Test-Path $keyPath) -and (Test-Path $passFile)) {
  $pass = (Get-Content -Raw $passFile).Trim()
  # le signer lit TAURI_SIGNING_PRIVATE_KEY depuis l'env sinon; on l'efface pour eviter le conflit avec --private-key-path
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  npx --no-install @tauri-apps/cli signer sign --private-key-path $keyPath --password $pass "$($setup.FullName)"
  if ($LASTEXITCODE -ne 0) { Write-Output "ECHEC signature"; Pop-Location; exit 1 }
} else {
  Write-Output "ATTENTION: clé minisign absente ($keyPath) - latest.json ne sera PAS signé"
}
$sigFile = "$($setup.FullName).sig"
$sigField = ""
if (Test-Path $sigFile) {
  $sigText = (Get-Content -Raw $sigFile).Trim()
  $sigField = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sigText))
}
$tag = "v$version"
$releaseBase = "https://github.com/John-Sheer/MediaCLI/releases/download/$tag"
$latestJson = @{
  version = $version
  notes   = "Mises à jour depuis l'application (Windows + Android), stabilité et correctifs."
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{
    "android-arm64" = @{
      url       = "$releaseBase/MediaCLI.apk"
      signature = ""
    }
    "windows-x86_64" = @{
      url       = "$releaseBase/MediaCLI-Setup.exe"
      signature = $sigField
    }
  }
}
$latestPath = Join-Path $root "hosting\updates\latest.json"
($latestJson | ConvertTo-Json -Depth 6) | Set-Content -Encoding UTF8 -Path $latestPath
Write-Output "latest.json écrit: $latestPath"

Write-Output "[6/6] Copie de l'installeur signé pour l'upload..."
$exeDir = Join-Path (Split-Path -Parent $root) "EXE"
if (Test-Path $exeDir) {
  $copyTarget = Join-Path $exeDir "MediaCLI-Setup.exe"
  Copy-Item -Force $setup.FullName $copyTarget
  if (Test-Path $sigFile) { Copy-Item -Force $sigFile (Join-Path $exeDir "MediaCLI-Setup.exe.sig") }
  Write-Output "Copie OK: $copyTarget"
}

Write-Output "[OK] Terminé. Prochaines étapes:"
Write-Output "  1. Uploader $exeDir\MediaCLI-Setup.exe sur la release GitHub $tag"
Write-Output "  2. Uploader l'APK (release $tag) si ce n'est pas fait"
Write-Output "  3. Déployer le site: cd hosting && firebase deploy --only hosting"
Pop-Location
