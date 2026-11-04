param([switch]$Once, [int]$ParentId = 0, [string]$ExcludeName = 'LolzCloud')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$meters = $null
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'audio-sessions.cs')
    $meters = New-Object LolzCloud.Audio.SessionMeters($ExcludeName, [uint32]$ParentId)
    $parent = if ($ParentId -gt 0) { [System.Diagnostics.Process]::GetProcessById($ParentId) } else { $null }
    do {
        if ($parent -and $parent.HasExited) { break }
        $sample = $meters.Read()
        [Console]::Out.WriteLine((ConvertTo-Json -InputObject $sample -Depth 4 -Compress))
        [Console]::Out.Flush()
        if (-not $Once) { Start-Sleep -Milliseconds 120 }
    } while (-not $Once)
} catch {
    [Console]::Out.WriteLine('{"available":false,"sessions":[],"error":"core-audio-unavailable"}')
    exit 2
} finally {
    if ($meters) { $meters.Dispose() }
    if ($parent) { $parent.Dispose() }
}
