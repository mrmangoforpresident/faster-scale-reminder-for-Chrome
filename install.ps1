# Installs the FASTER Scale daily check-in for the current Windows user into %USERPROFILE%\FasterScale.
# No admin rights needed. Re-run any time to update; your data is never touched.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'
$Src      = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest     = Join-Path $env:USERPROFILE 'FasterScale'
$TaskName = 'FASTER Scale Check-in'
$Port     = 47321

# Files from a downloaded ZIP carry a "from the internet" mark; clear it so Windows doesn't block them.
Get-ChildItem -Path $Src -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

# --- find Python 3.8+ (pythonw.exe runs without a console window)
function Find-Python {
    $candidates = @()
    foreach ($cmd in 'python.exe', 'py.exe') {
        $c = Get-Command $cmd -ErrorAction SilentlyContinue
        # skip the WindowsApps "python" stub that just opens the Microsoft Store
        if ($c -and $c.Source -notlike '*\WindowsApps\*') { $candidates += $c.Source }
    }
    $candidates += Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe", "$env:ProgramFiles\Python3*\python.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | ForEach-Object FullName
    foreach ($c in $candidates) {
        $pyArgs = if ($c -like '*\py.exe') { @('-3') } else { @() }
        try {
            $exe = & $c @pyArgs -c "import sys; assert sys.version_info >= (3, 8); print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) { return $exe.Trim() }
        } catch {}
    }
    return $null
}
$py = Find-Python
if (-not $py) {
    Write-Host 'Python 3 is not installed. Installing it now (about a minute)...' -ForegroundColor Cyan
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw 'Python 3 is needed. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run Install again.'
    }
    winget install --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host
    $py = Find-Python
    if (-not $py) { throw 'Python install did not finish. Install it from https://www.python.org/downloads/, then run Install again.' }
}
$pyw = Join-Path (Split-Path $py) 'pythonw.exe'
if (-not (Test-Path $pyw)) { $pyw = $py }
Write-Host "Python: $pyw"

# --- stop a running copy so files can be replaced
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# --- copy program files (data lives in $Dest\data and is left alone)
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
foreach ($d in 'app', 'extension') {
    robocopy (Join-Path $Src $d) (Join-Path $Dest $d) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $d failed (robocopy exit $LASTEXITCODE)" }
}
foreach ($f in 'install.ps1', 'uninstall.ps1', 'Install.cmd', 'Uninstall.cmd', 'README.md') {
    if (Test-Path (Join-Path $Src $f)) { Copy-Item (Join-Path $Src $f) $Dest -Force }
}
$launcher = Join-Path $Dest 'app\launcher.py'
Write-Host "Installed to $Dest"

# --- scheduled task: logon, unlock, wake from sleep (S3 + modern standby), and a 5-minute watchdog
$user  = "$env:USERDOMAIN\$env:USERNAME"
$start = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
function XmlEscape([string]$s) { [System.Security.SecurityElement]::Escape($s) }
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Shows the daily FASTER Scale check-in on first use of the day, and keeps the local check-in service running.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$(XmlEscape $user)</UserId></LogonTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled><StateChange>SessionUnlock</StateChange><UserId>$(XmlEscape $user)</UserId></SessionStateChangeTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled><StateChange>ConsoleConnect</StateChange><UserId>$(XmlEscape $user)</UserId></SessionStateChangeTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="System"&gt;&lt;Select Path="System"&gt;*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT5S</Delay>
    </EventTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="System"&gt;&lt;Select Path="System"&gt;*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=507]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT5S</Delay>
    </EventTrigger>
    <TimeTrigger>
      <Enabled>true</Enabled>
      <StartBoundary>$start</StartBoundary>
      <Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(XmlEscape $user)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(XmlEscape $pyw)</Command>
      <Arguments>"$(XmlEscape $launcher)"</Arguments>
      <WorkingDirectory>$(XmlEscape (Join-Path $Dest 'app'))</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
Write-Host "Scheduled task '$TaskName' registered (logon, unlock, wake, every 5 min)."

# --- Start menu shortcuts
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'FASTER Check-in'
New-Item -ItemType Directory -Force -Path $menu | Out-Null
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $menu 'Start FASTER Check-in.lnk'))
$lnk.TargetPath = $pyw
$lnk.Arguments = "`"$launcher`""
$lnk.WorkingDirectory = Join-Path $Dest 'app'
$lnk.Description = 'Start the FASTER check-in service'
$lnk.Save()
Set-Content -Path (Join-Path $menu 'FASTER Dashboard.url') -Encoding ASCII -Value "[InternetShortcut]`r`nURL=http://127.0.0.1:$Port/dashboard`r`n"
Set-Content -Path (Join-Path $menu 'FASTER Check-in now.url') -Encoding ASCII -Value "[InternetShortcut]`r`nURL=http://127.0.0.1:$Port/checkin`r`n"
Write-Host "Start menu shortcuts created in '$menu'."

# --- start it now
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
try {
    $s = Invoke-RestMethod "http://127.0.0.1:$Port/api/status" -TimeoutSec 5
    Write-Host "Service is running. Today ($($s.today)) checked in: $($s.checkedIn)"
} catch {
    Write-Warning "The service didn't respond yet. Check $Dest\data\faster.log"
}

$ext = Join-Path $Dest 'extension'
Set-Clipboard -Value $ext
Write-Host ''
Write-Host '=== Last step: add the Chrome extension (it blocks websites until you check in) ===' -ForegroundColor Cyan
Write-Host "  Chrome's extensions page is opening now."
Write-Host "  1. Turn on 'Developer mode' (top-right switch)"
Write-Host "  2. Click 'Load unpacked', paste this folder path (already copied) and click 'Select Folder':"
Write-Host "       $ext" -ForegroundColor Yellow
Write-Host "  3. Click 'Details' on 'FASTER Check-in Gate' and turn on 'Allow in Incognito'"
Write-Host "  Using Edge too? Do the same at edge://extensions."

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome 'chrome://extensions' } else { Write-Warning 'Chrome not found; open your browser''s extensions page manually.' }
