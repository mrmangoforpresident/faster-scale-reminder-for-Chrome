# Removes the FASTER check-in task, service and shortcuts.
# Your check-in data in %USERPROFILE%\FasterScale\data is KEPT unless you pass -RemoveData.
#
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-RemoveData]
param([switch]$RemoveData)

$Dest = Join-Path $env:USERPROFILE 'FasterScale'
Unregister-ScheduledTask -TaskName 'FASTER Scale Check-in' -Confirm:$false -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 47321 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Remove-Item -Recurse -Force (Join-Path ([Environment]::GetFolderPath('Programs')) 'FASTER Check-in') -ErrorAction SilentlyContinue
foreach ($d in 'app', 'extension') { Remove-Item -Recurse -Force (Join-Path $Dest $d) -ErrorAction SilentlyContinue }
if ($RemoveData) {
    Remove-Item -Recurse -Force $Dest -ErrorAction SilentlyContinue
    Write-Host 'Removed program and data.'
} else {
    Write-Host "Removed program. Your data is still in $Dest\data"
}
Write-Host 'Remove the "FASTER Check-in Gate" extension from chrome://extensions (and edge://extensions) yourself.'
