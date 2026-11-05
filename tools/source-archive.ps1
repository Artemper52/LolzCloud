$ErrorActionPreference = 'Stop'
node (Join-Path $PSScriptRoot 'source-archive.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
