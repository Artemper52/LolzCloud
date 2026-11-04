$ErrorActionPreference = 'Stop'
$lolzRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$lolzItems = @('.gitattributes','.gitignore','.github','package.json','package-lock.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','source','tests','tools','config','docs','licenses','server') | ForEach-Object { Join-Path $lolzRoot $_ }
$lolzOutput = Join-Path $lolzRoot 'dist'
New-Item -ItemType Directory -Path $lolzOutput -Force | Out-Null
$lolzZip = Join-Path $lolzOutput 'LolzCloud-source.zip'
Compress-Archive -LiteralPath $lolzItems -DestinationPath $lolzZip -Force
Write-Output "Source archive: $lolzZip"
