param(
    [Parameter(Mandatory = $true)]
    [string]$Executable
)

$ErrorActionPreference = 'Stop'
$qualificationRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '..\.build-temp\profile-gate-d'
$qualificationRoot = [System.IO.Path]::GetFullPath($qualificationRoot)
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$reportPath = Join-Path $qualificationRoot "qualification-report-$runId.json"
$stdoutPath = Join-Path $qualificationRoot "qualification-stdout-$runId.log"
$stderrPath = Join-Path $qualificationRoot "qualification-stderr-$runId.log"
$profileHome = Join-Path $qualificationRoot 'home'
$tempPath = Join-Path $qualificationRoot 'temp'
$executablePath = (Resolve-Path -LiteralPath $Executable).Path

foreach ($directory in @(
    $qualificationRoot,
    $profileHome,
    $tempPath,
    (Join-Path $qualificationRoot 'app-data'),
    (Join-Path $qualificationRoot 'app-cache'),
    (Join-Path $qualificationRoot 'logs'),
    (Join-Path $qualificationRoot 'Roaming'),
    (Join-Path $qualificationRoot 'Local'),
    (Join-Path $qualificationRoot 'Cache'),
    (Join-Path $qualificationRoot 'Config'),
    (Join-Path $qualificationRoot 'XDG\data'),
    (Join-Path $qualificationRoot 'State')
)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$protectedFiles = @(
    'C:\Users\barat\.local\share\unifia\unifia-voice.db',
    'C:\Users\barat\.local\share\unifia\workbench-audit.jsonl'
)
$protectedBefore = @{}
foreach ($path in $protectedFiles) {
    if (Test-Path -LiteralPath $path) {
        $protectedBefore[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    } else {
        $protectedBefore[$path] = $null
    }
}

$baselineWorkerPids = @(
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'voice_host\.worker' } |
        ForEach-Object { [uint32]$_.ProcessId }
)
$env:UNIFIA_VOICE_QUALIFICATION_ROOT = $qualificationRoot
$env:UNIFIA_VOICE_QUALIFICATION_DATA_DIR = Join-Path $qualificationRoot 'app-data'
$env:UNIFIA_VOICE_QUALIFICATION_CACHE_DIR = Join-Path $qualificationRoot 'app-cache'
$env:UNIFIA_VOICE_QUALIFICATION_LOG_DIR = Join-Path $qualificationRoot 'logs'
$env:USERPROFILE = $profileHome
$env:HOME = $profileHome
$env:APPDATA = Join-Path $qualificationRoot 'Roaming'
$env:LOCALAPPDATA = Join-Path $qualificationRoot 'Local'
$env:TEMP = $tempPath
$env:TMP = $tempPath
$env:XDG_CACHE_HOME = Join-Path $qualificationRoot 'Cache'
$env:XDG_CONFIG_HOME = Join-Path $qualificationRoot 'Config'
$env:XDG_DATA_HOME = Join-Path $qualificationRoot 'XDG\data'
$env:XDG_STATE_HOME = Join-Path $qualificationRoot 'State'

$quotedReportPath = '"' + $reportPath + '"'
$application = Start-Process -FilePath $executablePath `
    -ArgumentList @('--internal-voice-qualification', $quotedReportPath) `
    -WorkingDirectory (Split-Path -Parent $executablePath) `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden -PassThru -Wait

$report = $null
if (Test-Path -LiteralPath $reportPath) {
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
}
$orphanPids = @()
$orphanPids += @(
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'voice_host\.worker' -and $baselineWorkerPids -notcontains [uint32]$_.ProcessId } |
        ForEach-Object { [uint32]$_.ProcessId }
)
if ($report -and $report.workers) {
    foreach ($worker in $report.workers) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($worker.pid)" -ErrorAction SilentlyContinue
        if ($process) { $orphanPids += [uint32]$worker.pid }
    }
}
$profileChanges = @()
foreach ($path in $protectedFiles) {
    $after = if (Test-Path -LiteralPath $path) {
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    } else {
        $null
    }
    if ($after -ne $protectedBefore[$path]) { $profileChanges += $path }
}

$verification = [ordered]@{
    packagedExecutable = $executablePath
    applicationExitCode = $application.ExitCode
    isolatedRoot = $qualificationRoot
    orphanWorkerPids = @($orphanPids | Select-Object -Unique)
    protectedProfileFilesUnchanged = ($profileChanges.Count -eq 0)
    protectedProfileChanges = $profileChanges
}
($verification | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath (Join-Path $qualificationRoot 'external-verification.json') -Encoding utf8

if ($null -eq $report) {
    $stdout = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
    $stderr = Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
    throw "Packaged application did not write its qualification report (exit $($application.ExitCode)). stdout=$stdout stderr=$stderr"
}
if ($application.ExitCode -ne 0 -or $report.status -ne 'pass' -or $orphanPids.Count -gt 0 -or $profileChanges.Count -gt 0) {
    $report.status = 'fail'
    $report | Add-Member -NotePropertyName externalVerification -NotePropertyValue $verification -Force
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
    throw "Packaged voice qualification failed; details: $reportPath"
}
$report | Add-Member -NotePropertyName externalVerification -NotePropertyValue $verification -Force
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Output (Get-Content -LiteralPath $reportPath -Raw)
