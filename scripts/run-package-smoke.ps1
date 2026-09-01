param(
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$BundleRoot,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$SourceSha,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = "Stop"
if ($Target -notmatch '^(aarch64|x86_64)-pc-windows-msvc$') { throw "Unsupported Windows target: $Target" }
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$') { throw "Invalid version" }
if ($SourceSha -cnotmatch '^[0-9a-f]{40}$') { throw "Invalid source SHA" }
if (-not (Test-Path -LiteralPath $BundleRoot -PathType Container)) { throw "Bundle root missing" }
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { throw "RUNNER_TEMP missing" }

$installers = @(Get-ChildItem -LiteralPath (Join-Path $BundleRoot "nsis") -Filter "*-setup.exe" -File)
if ($installers.Count -ne 1) { throw "Expected exactly one NSIS installer, found $($installers.Count)" }
$installer = $installers[0]

$installRoot = Join-Path $env:RUNNER_TEMP "scai-install-$Target"
if ($installRoot -match '\s') { throw "NSIS smoke install path must not contain whitespace" }
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS installer failed with exit $($install.ExitCode)" }

$binaries = @(Get-ChildItem -LiteralPath $installRoot -Recurse -Filter "subunit-scai.exe" -File)
if ($binaries.Count -ne 1) { throw "Expected exactly one installed subunit-scai.exe, found $($binaries.Count)" }

$proofPath = Join-Path $env:RUNNER_TEMP "runtime-installed-$Target.json"
$env:SCAI_RELEASE_SMOKE_EVIDENCE = $proofPath
$env:SCAI_EXPECTED_VERSION = $Version
$env:SCAI_EXPECTED_SOURCE_SHA = $SourceSha
$runtime = Start-Process -FilePath $binaries[0].FullName -ArgumentList @('--release-smoke') -Wait -PassThru
if ($runtime.ExitCode -ne 0) { throw "Installed SCAI smoke failed with exit $($runtime.ExitCode)" }
if (-not (Test-Path -LiteralPath $proofPath -PathType Leaf)) { throw "Runtime evidence missing" }

$proof = Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json
$artifactHash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$package = {
  param([string]$Role)
  [ordered]@{
    role = $Role
    artifact_basename = $installer.Name
    artifact_sha256 = $artifactHash
    evidence = $proof
  }
}
$report = [ordered]@{
  schema_version = "1.0"
  status = "pass"
  target = $Target
  version = $Version
  source_sha = $SourceSha
  packages = @((& $package "installer"), (& $package "updater"))
}
$parent = Split-Path -Parent $Output
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding utf8NoBOM

Write-Output "PASS packaged runtime ${Target}: NSIS installer/updater payload started"
