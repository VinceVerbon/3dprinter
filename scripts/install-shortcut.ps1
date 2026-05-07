<#
.SYNOPSIS
  One-time installer: creates a "3D Printer Supplies" shortcut on the Desktop
  that runs scripts\start.ps1.

.DESCRIPTION
  Run this once after cloning the repo. The shortcut targets PowerShell with
  `-ExecutionPolicy Bypass -WindowStyle Hidden -File <repo>\scripts\start.ps1`
  and uses the icon at scripts\icon.ico (if present, otherwise PowerShell's).

  You can also pin the shortcut to the taskbar manually after it's created.
#>
[CmdletBinding()]
param(
  [string]$Name = '3D Printer Supplies'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $repoRoot 'scripts\start.ps1'
$iconPath = Join-Path $repoRoot 'scripts\icon.ico'

if (-not (Test-Path $startScript)) {
  Write-Error "start.ps1 not found: $startScript"
  exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "$Name.lnk"

$pwsh = (Get-Command powershell.exe).Source
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($shortcutPath)
$lnk.TargetPath = $pwsh
$lnk.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$lnk.WorkingDirectory = $repoRoot
$lnk.Description = 'Bambu P2S supplies database'
if (Test-Path $iconPath) {
  $lnk.IconLocation = $iconPath
}
$lnk.Save()

Write-Host "Shortcut created: $shortcutPath"
Write-Host "Right-click the shortcut and choose 'Pin to taskbar' to make it always available."
