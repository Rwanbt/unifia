param(
    [string]$RunId = (Get-Date -Format 'yyyyMMdd-HHmmss-fff'),
    [string]$UvArchive
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $repo 'packages\voice-host'
$bootstrap = Get-Content -LiteralPath (Join-Path $repo 'packages\desktop\src-tauri\src\voice_runtime\bootstrap.rs') -Raw
$versionMatch = [regex]::Match($bootstrap, 'const UV_VERSION: &str = "(?<version>[^"]+)";')
$assetMatch = [regex]::Match(
    $bootstrap,
    '(?s)\("windows",\s*"x86_64"\)\s*=>\s*Ok\(\(\s*"(?<asset>[^"]+)",\s*"(?<sha>[0-9a-f]{64})"'
)
if (-not $versionMatch.Success -or -not $assetMatch.Success) {
    throw 'Could not read the pinned Windows uv version and checksum from the runtime bootstrap.'
}

$run = Join-Path $repo ".build-temp\voice-gate-$RunId"
$project = Join-Path $run 'voice-host'
$runtime = Join-Path $run 'runtime'
$pythonInstall = Join-Path $runtime 'python'
$uvCache = Join-Path $runtime 'uv-cache'
$modelCache = Join-Path $runtime 'huggingface'
if (Test-Path -LiteralPath $run) {
    throw "Qualification path already exists; choose a new RunId: $run"
}

New-Item -ItemType Directory -Path $project, $runtime, $pythonInstall, $uvCache, $modelCache -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'pyproject.toml') -Destination $project
Copy-Item -LiteralPath (Join-Path $source 'uv.lock') -Destination $project
New-Item -ItemType Directory -Path (Join-Path $project 'voice_host') | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'voice_host\__init__.py') -Destination (Join-Path $project 'voice_host')
Copy-Item -LiteralPath (Join-Path $source 'voice_host\worker.py') -Destination (Join-Path $project 'voice_host')
Copy-Item -LiteralPath (Join-Path $source 'voice_host\voice_state.py') -Destination (Join-Path $project 'voice_host')

$asset = $assetMatch.Groups['asset'].Value
$expectedHash = $assetMatch.Groups['sha'].Value
$archivePath = Join-Path $runtime $asset
$uv = Join-Path $runtime 'uv.exe'
$url = "https://github.com/astral-sh/uv/releases/download/$($versionMatch.Groups['version'].Value)/$asset"
Write-Host "Preparing pinned uv $($versionMatch.Groups['version'].Value) in isolated run $RunId"
if ($UvArchive) {
    Copy-Item -LiteralPath (Resolve-Path -LiteralPath $UvArchive).Path -Destination $archivePath
} else {
    Invoke-WebRequest -Uri $url -OutFile $archivePath
}
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "uv archive SHA-256 mismatch: expected $expectedHash, received $actualHash"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'uv.exe' } | Select-Object -First 1
    if ($null -eq $entry) { throw 'Pinned uv archive does not contain uv.exe.' }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $uv, $false)
} finally {
    $zip.Dispose()
}

$uvVersion = (& $uv --version | Out-String).Trim()
if ($uvVersion -notmatch "^uv $([regex]::Escape($versionMatch.Groups['version'].Value))( |$)") {
    throw "Unexpected managed uv version: $uvVersion"
}

$env:UV_PYTHON_INSTALL_DIR = $pythonInstall
$env:UV_PYTHON_PREFERENCE = 'only-managed'
$env:UV_CACHE_DIR = $uvCache
$env:UV_NO_CONFIG = '1'
$env:UV_PROJECT_ENVIRONMENT = Join-Path $project '.venv'
$env:HF_HOME = $modelCache
$env:HUGGINGFACE_HUB_CACHE = Join-Path $modelCache 'hub'
$env:CUDA_VISIBLE_DEVICES = ''
$env:OMP_NUM_THREADS = '2'
$env:MKL_NUM_THREADS = '2'
$env:OPENBLAS_NUM_THREADS = '2'

Write-Host 'Installing isolated managed Python 3.12 (no global Python preference)...'
$pythonInstallStarted = [DateTimeOffset]::UtcNow
& $uv python install 3.12 2>&1 | Tee-Object -FilePath (Join-Path $run 'python-install.log')
if ($LASTEXITCODE -ne 0) { throw "Managed Python installation failed with exit code $LASTEXITCODE." }
$pythonInstallSeconds = ([DateTimeOffset]::UtcNow - $pythonInstallStarted).TotalSeconds

Write-Host 'Installing the locked CPU-only Pocket environment into the isolated run...'
$syncStarted = [DateTimeOffset]::UtcNow
& $uv sync --locked --project $project 2>&1 | Tee-Object -FilePath (Join-Path $run 'uv-sync.log')
if ($LASTEXITCODE -ne 0) { throw "Locked environment installation failed with exit code $LASTEXITCODE." }
$dependencyInstallSeconds = ([DateTimeOffset]::UtcNow - $syncStarted).TotalSeconds

$probe = @'
import importlib.metadata as metadata, json, platform, sys, torch
packages = sorted((item.metadata["Name"].lower(), item.version) for item in metadata.distributions())
print(json.dumps({"python": platform.python_version(), "executable": sys.executable, "torch": torch.__version__, "cudaAvailable": torch.cuda.is_available(), "cudaPackages": [name for name, _ in packages if name.startswith(("nvidia-", "cuda-")) or "cu12" in name or "cu13" in name]}, separators=(",", ":")))
'@
Write-Host 'Verifying managed Python, CPU PyTorch, and the locked package set...'
$probeStarted = [DateTimeOffset]::UtcNow
$probe | & $uv run --locked --project $project python - 2>&1 | Tee-Object -FilePath (Join-Path $run 'runtime-probe.json')
if ($LASTEXITCODE -ne 0) { throw "Managed runtime verification failed with exit code $LASTEXITCODE." }
$runtimeBootstrapSeconds = ([DateTimeOffset]::UtcNow - $probeStarted).TotalSeconds

$summary = [ordered]@{
    runId = $RunId
    managedUv = $uvVersion
    uvArchiveSha256 = $actualHash
    project = $project
    uvPythonInstallDir = $pythonInstall
    uvCacheDir = $uvCache
    isolatedModelCache = $modelCache
    modelCacheInitiallyEmpty = $true
    managedPythonInstallSeconds = [math]::Round($pythonInstallSeconds, 3)
    lockedDependencyInstallSeconds = [math]::Round($dependencyInstallSeconds, 3)
    runtimeBootstrapSeconds = [math]::Round(($pythonInstallSeconds + $dependencyInstallSeconds + $runtimeBootstrapSeconds), 3)
    status = 'managed runtime provisioned; model qualification pending'
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $run 'qualification.json') -Encoding utf8
Write-Host 'Starting the real managed worker qualification. First model downloads have no short timeout...'
$python = Join-Path $project '.venv\Scripts\python.exe'
$harness = Join-Path $repo 'scripts\voice\qualify-pocket-worker.py'
& $python $harness --project $project --output (Join-Path $run 'gate-d-worker.json') --cold-cache-initially-empty
if ($LASTEXITCODE -ne 0) { throw "Managed Pocket worker qualification failed with exit code $LASTEXITCODE." }
$summary.status = 'cold managed install and multilingual worker qualification completed'
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $run 'qualification.json') -Encoding utf8
Write-Host "Cold managed environment and worker qualification completed. Evidence: $run"
