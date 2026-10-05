param(
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$BundleRoot,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$SourceSha,
  [Parameter(Mandatory = $true)][string]$Output,
  # Presence S3: Der Claude-Code-Hook-Helfer muss neben subunit-scai.exe liegen
  # und auf diesem Ziel nativ starten (statische CRT, keine Runtime nötig).
  [switch]$AgentHook
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

if ($AgentHook) {
  $helper = Join-Path (Split-Path -Parent $binaries[0].FullName) "scai-agent-hook.exe"
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw "scai-agent-hook.exe missing next to subunit-scai.exe" }
  $helperCount = @(Get-ChildItem -LiteralPath $installRoot -Recurse -Filter "scai-agent-hook.exe" -File).Count
  if ($helperCount -ne 1) { throw "Expected exactly one installed scai-agent-hook.exe, found $helperCount" }
  $versionOut = & $helper --version
  if ($LASTEXITCODE -ne 0 -or "$versionOut" -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw "scai-agent-hook --version failed" }
  # Ohne laufendes SCAI gibt es keine Pipe: der Helfer muss das sauber melden
  # (Exit 1, fester Code) statt abzustürzen.
  $pingOut = & $helper --ping
  if ($LASTEXITCODE -ne 1 -or "$pingOut" -ne "no_pipe") { throw "scai-agent-hook --ping without SCAI did not report no_pipe" }
  Write-Output "PASS agent hook helper ${Target}: present, starts natively, reports no_pipe without SCAI"
}

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
