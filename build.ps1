# Build script pour MediaCLI - force le re-embarquement du front
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root

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

Write-Output "[4/5] Sync portable..."
$releaseDir = Join-Path $root "src-tauri\target\release"
$exe = Get-ChildItem -LiteralPath $releaseDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*diaCLI.exe" -and -not $_.PSIsContainer } | Select-Object -First 1
if ($exe) {
  $dest = Join-Path $env:USERPROFILE "Desktop\MediaCLI_Portable\MédiaCLI.exe"
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

Write-Output "[5/5] Terminé. Lance MediaCLI_Portable\MédiaCLI.exe (ou le raccourci bureau)."
Pop-Location
