param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

$ErrorActionPreference = "Stop"

# WHY: Tauri reads exit 0 as "signed". A skip that exits 0 ships an unsigned
# binary with nothing to show for it, so every skip says so on the run, and a
# caller that must ship signed binaries sets UNIFIA_WINDOWS_SIGNING=required,
# which turns a skip into a failure.
$signingMode = if ($env:UNIFIA_WINDOWS_SIGNING) { $env:UNIFIA_WINDOWS_SIGNING } else { "optional" }
if ($signingMode -notin @("optional", "required")) {
  throw "UNIFIA_WINDOWS_SIGNING must be 'optional' or 'required', got '$signingMode'"
}

if (-not $Path -or $Path.Count -eq 0) {
  throw "At least one path is required"
}

function Skip-Signing([string] $Reason) {
  if ($signingMode -eq "required") {
    throw "Windows signing is required but was skipped: $Reason"
  }
  $message = "Windows signing skipped, the binaries stay unsigned: $Reason"
  if ($env:GITHUB_ACTIONS -eq "true") {
    Write-Host "::warning title=Windows signing skipped::$message"
  }
  Write-Warning $message
  exit 0
}

if ($env:GITHUB_ACTIONS -ne "true") {
  Skip-Signing "not running on GitHub Actions"
}

$vars = @{
  endpoint = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
  account = $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
  profile = $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
}

if ($vars.Values | Where-Object { -not $_ }) {
  Skip-Signing "Azure Artifact Signing is not configured"
}

$moduleVersion = "0.5.8"
$module = Get-Module -ListAvailable -Name TrustedSigning | Where-Object { $_.Version -eq [version] $moduleVersion }

if (-not $module) {
  try {
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
  }
  catch {
    Write-Host "NuGet package provider install skipped: $($_.Exception.Message)"
  }

  Install-Module -Name TrustedSigning -RequiredVersion $moduleVersion -Force -Repository PSGallery -Scope CurrentUser
}

Import-Module TrustedSigning -RequiredVersion $moduleVersion -Force

$files = @($Path | ForEach-Object { Resolve-Path $_ -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty Path -Unique)

if (-not $files -or $files.Count -eq 0) {
  throw "No files matched the requested paths"
}

$params = @{
  Endpoint                         = $vars.endpoint
  CodeSigningAccountName           = $vars.account
  CertificateProfileName           = $vars.profile
  Files                            = ($files -join ",")
  FileDigest                       = "SHA256"
  TimestampDigest                  = "SHA256"
  TimestampRfc3161                 = "http://timestamp.acs.microsoft.com"
  ExcludeEnvironmentCredential     = $true
  ExcludeWorkloadIdentityCredential = $true
  ExcludeManagedIdentityCredential = $true
  ExcludeSharedTokenCacheCredential = $true
  ExcludeVisualStudioCredential    = $true
  ExcludeVisualStudioCodeCredential = $true
  ExcludeAzureCliCredential        = $false
  ExcludeAzurePowerShellCredential = $true
  ExcludeAzureDeveloperCliCredential = $true
  ExcludeInteractiveBrowserCredential = $true
}

Invoke-TrustedSigning @params
