param(
  [string]$Branch
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

$RepoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if (-not $RepoRoot) { Fail 'Run this from inside the trigo-manpower-board repository.' }
Set-Location $RepoRoot

$raw = & git worktree list --porcelain
$entries = @()
$current = @{}
foreach ($line in $raw) {
  if ($line -like 'worktree *') {
    if ($current.worktree) { $entries += [pscustomobject]$current }
    $current = @{ worktree = $line.Substring(9); branch = '' }
  } elseif ($line -like 'branch *') {
    $current.branch = $line.Substring(7) -replace '^refs/heads/',''
  }
}
if ($current.worktree) { $entries += [pscustomobject]$current }

$agentEntries = @($entries | Where-Object { $_.branch -like 'agent/*' })
if (-not $agentEntries) {
  Write-Host 'No agent workspaces found.'
  exit 0
}

if (-not $Branch) {
  Write-Host 'Agent workspaces:'
  for ($i = 0; $i -lt $agentEntries.Count; $i++) {
    Write-Host "[$($i + 1)] $($agentEntries[$i].branch)"
    Write-Host "    $($agentEntries[$i].worktree)"
  }
  $selection = Read-Host 'Which workspace should be cleaned up? Enter number'
  $index = 0
  if (-not [int]::TryParse($selection, [ref]$index)) { Fail 'Please enter a valid number.' }
  if ($index -lt 1 -or $index -gt $agentEntries.Count) { Fail 'Selection is out of range.' }
  $entry = $agentEntries[$index - 1]
} else {
  $entry = $agentEntries | Where-Object { $_.branch -eq $Branch } | Select-Object -First 1
  if (-not $entry) { Fail "No worktree found for branch $Branch" }
}

$changes = (& git -C $entry.worktree status --porcelain | Out-String).Trim()
if ($changes) {
  Fail 'This workspace has uncommitted changes. Ask the agent to commit/push them before cleanup.'
}

$RepoName = (& git remote get-url origin).Trim() -replace '^.*github\.com[:/]','' -replace '\.git$',''
$verifiedMerged = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
  & gh auth status *> $null
  if ($LASTEXITCODE -eq 0) {
    $merged = (& gh pr list --repo $RepoName --head $entry.branch --state merged --json number,url --jq '.[0].url // ""' 2>$null | Out-String).Trim()
    if ($merged) {
      Write-Host "Merged PR found: $merged" -ForegroundColor Green
      $verifiedMerged = $true
    }
  }
}

if (-not $verifiedMerged) {
  Write-Host ''
  Write-Host 'I could not automatically verify that this branch has a merged PR.' -ForegroundColor Yellow
  $confirm = (Read-Host 'Only continue if you already merged/closed the work. Type CLEAN to continue').Trim()
  if ($confirm -ne 'CLEAN') { exit 0 }
}

Write-Host "Removing workspace: $($entry.worktree)"
& git worktree remove $entry.worktree
if ($LASTEXITCODE -ne 0) { Fail 'Could not remove the worktree.' }

& git branch -D $entry.branch
if ($LASTEXITCODE -ne 0) { Fail 'Worktree was removed, but the local branch could not be deleted.' }

Write-Host 'Cleanup complete. The remote PR/branch is left to GitHub settings.' -ForegroundColor Green
