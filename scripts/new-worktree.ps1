<#
.SYNOPSIS
  Create a git worktree for the 3dprinter repo under worktrees/3dprinter\<branch>.

.DESCRIPTION
  Run from the main checkout (<repo-dir>) or anywhere inside it.
  Creates the parent dir if missing.
  By default creates a NEW branch from current HEAD; use -Existing to attach to an
  existing local or remote branch.

.PARAMETER Branch
  Branch name (also used as the worktree directory name).

.PARAMETER Existing
  Attach to an existing branch instead of creating a new one.

.EXAMPLE
  .\scripts\new-worktree.ps1 calibration
  # creates branch "calibration" from HEAD and worktree at worktrees/3dprinter\calibration

.EXAMPLE
  .\scripts\new-worktree.ps1 main -Existing
  # attaches to existing "main" branch (read-only-ish — useful for a clean reference checkout)
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Branch,

  [switch]$Existing
)

$ErrorActionPreference = 'Stop'

$repoRoot = (git rev-parse --show-toplevel) 2>$null
if (-not $repoRoot) {
  Write-Error "Not inside a git repo. cd to <repo-dir> first."
  exit 1
}

$parent = 'worktrees/3dprinter'
if (-not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}

$target = Join-Path $parent $Branch
if (Test-Path $target) {
  Write-Error "Worktree path already exists: $target"
  exit 1
}

Push-Location $repoRoot
try {
  if ($Existing) {
    git worktree add $target $Branch
  } else {
    git worktree add $target -b $Branch
  }
} finally {
  Pop-Location
}

Write-Output ""
Write-Output "Worktree ready: $target"
Write-Output "  cd '$target'"
