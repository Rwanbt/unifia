param(
  [Parameter(Mandatory = $true)][string]$Apk,
  [Parameter(Mandatory = $true)][string]$Output,
  [string]$SigningDirectory = (Join-Path $env:LOCALAPPDATA 'OpenCodeRemote\signing'),
  [string]$AndroidSdk = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' })
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$inputApk = [IO.Path]::GetFullPath($Apk)
$outputApk = [IO.Path]::GetFullPath($Output)
if (!(Test-Path -LiteralPath $inputApk -PathType Leaf)) { throw 'Input APK not found' }
if (Test-Path -LiteralPath $outputApk) { throw 'Refusing to overwrite an existing signed APK' }
if ($inputApk -eq $outputApk) { throw 'Input and output must differ' }

$keystore = Join-Path $SigningDirectory 'remote-development.p12'
$sealed = Join-Path $SigningDirectory 'password.dpapi'
$entropy = [Text.Encoding]::UTF8.GetBytes('OpenCodeRemoteLocalSigning-v1')
$password = $null

try {
  New-Item -ItemType Directory -Path $SigningDirectory -Force | Out-Null
  if ((Test-Path -LiteralPath $keystore) -xor (Test-Path -LiteralPath $sealed)) {
    throw 'Partial signing identity found. Refusing to rotate or replace it.'
  }

  if (!(Test-Path -LiteralPath $keystore)) {
    $random = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
    $password = [Convert]::ToBase64String($random)
    [Array]::Clear($random, 0, $random.Length)
    $env:OC_REMOTE_SIGNPASS = $password
    & keytool -genkeypair -noprompt -alias opencode-remote -keyalg RSA -keysize 3072 -validity 3650 -storetype PKCS12 -keystore $keystore -storepass:env OC_REMOTE_SIGNPASS -keypass:env OC_REMOTE_SIGNPASS -dname 'CN=OpenCode Remote Local Development,O=Personal Testing,C=FR'
    if ($LASTEXITCODE -ne 0) { throw 'Local signing keystore generation failed' }
    $protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($password), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes($sealed, $protected)
  } else {
    $unsealed = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($sealed), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $password = [Text.Encoding]::UTF8.GetString($unsealed)
    [Array]::Clear($unsealed, 0, $unsealed.Length)
  }

  $env:OC_REMOTE_SIGNPASS = $password
  $tools = Join-Path $AndroidSdk 'build-tools'
  $signer = Get-ChildItem -LiteralPath $tools -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'apksigner.bat' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (!$signer) { throw 'Android apksigner not found' }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($outputApk)) -Force | Out-Null
  & $signer sign --ks $keystore --ks-key-alias opencode-remote --ks-pass env:OC_REMOTE_SIGNPASS --key-pass env:OC_REMOTE_SIGNPASS --out $outputApk $inputApk
  if ($LASTEXITCODE -ne 0) { throw 'APK signing failed' }
  & $signer verify --print-certs $outputApk | Select-String 'certificate SHA-256 digest'
  if ($LASTEXITCODE -ne 0) { throw 'Signed APK verification failed' }
  Write-Output ('SIGNED_APK=' + $outputApk)
  Write-Output ('SHA256=' + (Get-FileHash -Algorithm SHA256 $outputApk).Hash)
} finally {
  Remove-Item Env:OC_REMOTE_SIGNPASS -ErrorAction SilentlyContinue
  $password = $null
}
