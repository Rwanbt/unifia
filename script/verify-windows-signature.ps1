param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

$ErrorActionPreference = "Stop"

# WHY: a signing step can exit 0 and still leave the artifact unsigned, or signed by a certificate that does not
# verify. A release checks the signature it ships, not the exit code of the step that made it. Only a status of
# Valid counts: Get-AuthenticodeSignature reports untrusted or tampered signatures under other statuses.
$signingMode = if ($env:UNIFIA_WINDOWS_SIGNING) { $env:UNIFIA_WINDOWS_SIGNING } else { "optional" }
if ($signingMode -notin @("optional", "required")) {
  throw "UNIFIA_WINDOWS_SIGNING must be 'optional' or 'required', got '$signingMode'"
}

if (-not $Path -or $Path.Count -eq 0) {
  throw "At least one path is required"
}

$problems = @()
foreach ($file in $Path) {
  $signature = Get-AuthenticodeSignature -FilePath $file
  if ($signature.Status -eq "Valid") {
    Write-Host "signature valid: $file (signed by $($signature.SignerCertificate.Subject))"
    continue
  }
  $problem = "not validly signed: $file (status: $($signature.Status))"
  if ($signingMode -eq "required") {
    $problems += $problem
  }
  else {
    # A development or recette build is unsigned by design: say so on the run, and do not present it as signed.
    Write-Host "::warning title=Unsigned Windows binary::unsigned development build, $problem"
    Write-Warning "unsigned development build, $problem"
  }
}

if ($problems.Count -gt 0) {
  throw ("Windows signature verification failed:`n" + ($problems -join "`n"))
}
