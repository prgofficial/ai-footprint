# AI Footprint - start here (Windows).
#
# All the real logic lives in scripts/init.mjs so it is testable and identical on every
# platform. This wrapper only checks that Node is present and hands over.
#
#   .\init.ps1            native mode
#   .\init.ps1 --docker   Docker Swarm mode

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host ''
    Write-Host '  AI Footprint needs Node.js 20 or newer.'
    Write-Host ''
    Write-Host '    Install it from https://nodejs.org/en/download'
    Write-Host '    then run this command again:  .\init.ps1'
    Write-Host ''
    exit 1
}

$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) {
    $version = & node -v
    Write-Host ''
    Write-Host "  AI Footprint needs Node.js 20 or newer (found $version)."
    Write-Host ''
    Write-Host '    Install a supported version from https://nodejs.org/en/download'
    Write-Host ''
    exit 1
}

& node (Join-Path $root 'scripts/init.mjs') @args
exit $LASTEXITCODE
