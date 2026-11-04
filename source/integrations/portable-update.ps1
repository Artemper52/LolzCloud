param([int]$ParentId, [string]$TargetDirectory, [string]$StageDirectory, [string]$UpdateId)
$ErrorActionPreference = 'Stop'
$updateTarget = [System.IO.Path]::GetFullPath($TargetDirectory).TrimEnd('\')
$updateStage = [System.IO.Path]::GetFullPath($StageDirectory).TrimEnd('\')
if ($UpdateId -notmatch '^[a-f0-9]{32}$') { exit 1 }
if ($updateTarget -eq [System.IO.Path]::GetPathRoot($updateTarget).TrimEnd('\')) { exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $updateTarget 'LolzCloud.exe')) -or -not (Test-Path -LiteralPath (Join-Path $updateStage 'resources\app.asar'))) { exit 1 }
if ((Split-Path -Leaf (Split-Path -Parent $updateStage)) -ne "LolzCloud-update-$UpdateId") { exit 1 }
$updateMarker = [System.IO.File]::ReadAllText((Join-Path $updateStage 'lolzcloud-portable.json'))
if ($updateMarker -notmatch '"appId"\s*:\s*"app.lolzcloud.desktop"') { exit 1 }
foreach ($updateReserved in @([Environment]::GetFolderPath('UserProfile'), [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'), [Environment]::GetFolderPath('ApplicationData'))) { if ($updateReserved -and $updateTarget -eq [System.IO.Path]::GetFullPath($updateReserved).TrimEnd('\')) { exit 1 } }
$updateParent = Split-Path -Parent $updateTarget
$updateBackup = [System.IO.Path]::GetFullPath((Join-Path $updateParent ('.LolzCloud-before-update-' + $UpdateId)))
if ((Split-Path -Parent $updateBackup) -ne $updateParent -or (Test-Path -LiteralPath $updateBackup)) { exit 1 }
$updateLog = Join-Path (Split-Path -Parent $updateStage) 'result.txt'
try {
  for ($updateWait = 0; $updateWait -lt 120 -and (Get-Process -Id $ParentId -ErrorAction SilentlyContinue); $updateWait++) { Start-Sleep -Milliseconds 500 }
  if (Get-Process -Id $ParentId -ErrorAction SilentlyContinue) { throw 'The previous application did not exit.' }
  $updateMoved = $false
  for ($updateAttempt = 0; $updateAttempt -lt 30; $updateAttempt++) {
    try { Move-Item -LiteralPath $updateTarget -Destination $updateBackup; $updateMoved = $true; break } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $updateMoved) { throw 'Application files are still in use.' }
  try { Copy-Item -LiteralPath $updateStage -Destination $updateTarget -Recurse -ErrorAction Stop }
  catch { if (Test-Path -LiteralPath $updateTarget) { $updateFailed = [System.IO.Path]::GetFullPath((Join-Path $updateParent ('.LolzCloud-failed-update-' + $UpdateId))); if ((Split-Path -Parent $updateFailed) -ne $updateParent) { throw 'Invalid rollback path.' }; Move-Item -LiteralPath $updateTarget -Destination $updateFailed }; Move-Item -LiteralPath $updateBackup -Destination $updateTarget; throw }
  'updated' | Set-Content -LiteralPath $updateLog -Encoding UTF8
  Start-Process -FilePath (Join-Path $updateTarget 'LolzCloud.exe') -WorkingDirectory $updateTarget -WindowStyle Hidden
} catch {
  'update-failed; previous files retained' | Set-Content -LiteralPath $updateLog -Encoding UTF8
  if (Test-Path -LiteralPath (Join-Path $updateTarget 'LolzCloud.exe')) { Start-Process -FilePath (Join-Path $updateTarget 'LolzCloud.exe') -WorkingDirectory $updateTarget -WindowStyle Hidden }
}
