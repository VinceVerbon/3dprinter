# build-prod.ps1 — produce the production build AND bundle the user documentation.
#
# This is the single entry point for a release/production build. It:
#   1. builds the Vue app to app/dist (vue-tsc + vite build), and
#   2. runs scripts/build-docs.mjs to assemble docs/user-guide/*.md into
#      app/dist/docs/ (Haspel-User-Guide.html + .pdf + a copy of the source).
#
# IMPORTANT — keep the docs honest. Before running a production build, re-read
# docs/user-guide/*.md and update anything that changed this release. The docs
# are part of the shipped artifact, not an afterthought. (See the
# "Production build — documentation" section in CLAUDE.md.)
#
# Usage:
#   .\scripts\build-prod.ps1            # build app, then bundle docs (HTML + PDF)
#   .\scripts\build-prod.ps1 -DocsOnly  # skip the app build, just (re)build docs
#   .\scripts\build-prod.ps1 -SkipDocs  # just the app build, no docs
#   .\scripts\build-prod.ps1 -NoPdf     # build docs HTML only (skip the Edge PDF step)

[CmdletBinding()]
param(
  [switch]$DocsOnly,
  [switch]$SkipDocs,
  [switch]$NoPdf
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  if (-not $DocsOnly) {
    Write-Host '== Building app (vite) ==' -ForegroundColor Cyan
    npm --prefix app run build
    if ($LASTEXITCODE -ne 0) { throw "app build failed (exit $LASTEXITCODE)" }
  }

  if (-not $SkipDocs) {
    Write-Host '== Bundling documentation ==' -ForegroundColor Cyan
    $docArgs = @('scripts/build-docs.mjs')
    if ($NoPdf) { $docArgs += '--no-pdf' }
    node @docArgs
    if ($LASTEXITCODE -ne 0) { throw "doc build failed (exit $LASTEXITCODE)" }
  }

  Write-Host ''
  Write-Host 'Production build ready in app\dist (docs under app\dist\docs).' -ForegroundColor Green
}
finally {
  Pop-Location
}
