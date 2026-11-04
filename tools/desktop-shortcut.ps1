$ErrorActionPreference = 'Stop'
$lolzRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lolzExecutable = Join-Path $lolzRoot 'dist\LolzCloud-win32-x64\LolzCloud.exe'
if (-not (Test-Path -LiteralPath $lolzExecutable)) { throw 'Build LolzCloud for Windows x64 first: npm run build' }
$lolzDesktop = [Environment]::GetFolderPath('Desktop')
$lolzShortcutPath = Join-Path $lolzDesktop 'LolzCloud.lnk'
$lolzShell = New-Object -ComObject WScript.Shell
$lolzShortcut = $lolzShell.CreateShortcut($lolzShortcutPath)
$lolzShortcut.TargetPath = $lolzExecutable
$lolzShortcut.WorkingDirectory = Split-Path -Parent $lolzExecutable
$lolzShortcut.IconLocation = "$lolzExecutable,0"
$lolzShortcut.Description = 'LolzCloud - SoundCloud, Lolzteam, music studio'
$lolzShortcut.Save()
Write-Output "Created: $lolzShortcutPath"
