<#
.SYNOPSIS
  Create a git worktree for this repo under <repo-parent>\worktrees\<repo-name>\<branch>.

.DESCRIPTION
  Run from the main checkout or anywhere inside it. The worktree parent dir is
  derived from the repo location (sibling "worktrees" folder), so there are no
  hardcoded machine paths.
  Creates the parent dir if missing.
  By default creates a NEW branch from current HEAD; use -Existing to attach to an
  existing local or remote branch.

.PARAMETER Branch
  Branch name (also used as the worktree directory name).

.PARAMETER Existing
  Attach to an existing branch instead of creating a new one.

.EXAMPLE
  .\scripts\new-worktree.ps1 calibration
  # creates branch "calibration" from HEAD and a worktree named "calibration"
  # under the sibling worktrees\<repo-name> directory

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
  Write-Error "Not inside a git repo. cd into the repo first."
  exit 1
}

# Worktrees live in a "worktrees\<repo-name>" folder beside the repo, e.g. a repo
# at <X>\<repo> gets worktrees under <X>\worktrees\<repo>. No hardcoded paths.
$repoParent = Split-Path -Parent $repoRoot
$repoName   = Split-Path -Leaf  $repoRoot
$parent     = Join-Path (Join-Path $repoParent 'worktrees') $repoName
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
