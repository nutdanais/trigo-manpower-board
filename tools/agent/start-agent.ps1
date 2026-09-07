param(
  [ValidateSet('codex','claude')]
  [string]$Agent,
  [string]$Title,
  [string]$Description,
  [switch]$NoIssue
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Get-Slug([string]$Text) {
  $slug = $Text.ToLowerInvariant() -replace '[^a-z0-9]+','-'
  $slug = $slug.Trim('-')
  if ($slug.Length -gt 42) { $slug = $slug.Substring(0,42).Trim('-') }
  if (-not $slug) { $slug = 'task' }
  return $slug
}

function Get-RepoName([string]$RemoteUrl) {
  if ($RemoteUrl -match 'github\.com[:/](?<repo>[^/]+/[^/]+?)(?:\.git)?$') {
    return $Matches.repo
  }
  return $null
}

try {
  $RepoRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
} catch {
  Fail 'Run this launcher from inside the trigo-manpower-board repository.'
}
if (-not $RepoRoot) { Fail 'Could not locate the Git repository.' }

Set-Location $RepoRoot
$RemoteUrl = (& git remote get-url origin).Trim()
$RepoName = Get-RepoName $RemoteUrl
if (-not $RepoName) { Fail "Could not determine the GitHub repository from origin: $RemoteUrl" }

if (-not $Agent) {
  do { $Agent = (Read-Host 'Agent (codex / claude)').Trim().ToLowerInvariant() } while ($Agent -notin @('codex','claude'))
}
if (-not $Title) { $Title = (Read-Host 'What do you want the agent to do? (short task name)').Trim() }
if (-not $Title) { Fail 'Task name cannot be empty.' }
if (-not $Description) {
  $Description = (Read-Host 'Short description / desired result (press Enter to reuse the task name)').Trim()
  if (-not $Description) { $Description = $Title }
}

$IssueNumber = $null
$IssueUrl = $null

if (-not $NoIssue) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host 'GitHub CLI (gh) is not installed, so automatic Issue creation is unavailable on this device.' -ForegroundColor Yellow
    Write-Host 'One-time Windows setup:  winget install --id GitHub.cli'
    Write-Host 'Then run:                gh auth login'
    $answer = (Read-Host 'Continue this task WITHOUT a GitHub Issue? (y/N)').Trim().ToLowerInvariant()
    if ($answer -ne 'y') { exit 0 }
    $NoIssue = $true
  } else {
    & gh auth status *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host ''
      Write-Host 'GitHub CLI needs a one-time sign-in on this device.' -ForegroundColor Yellow
      Write-Host 'Run: gh auth login'
      $answer = (Read-Host 'Continue this task WITHOUT a GitHub Issue? (y/N)').Trim().ToLowerInvariant()
      if ($answer -ne 'y') { exit 0 }
      $NoIssue = $true
    }
  }
}

if (-not $NoIssue) {
  $body = @"
## Owner
$Agent

## Goal
$Description

## Acceptance criteria
- [ ] The requested outcome is implemented.
- [ ] Existing related behavior is preserved unless this task explicitly changes it.
- [ ] Validation required by AGENTS.md is completed.
- [ ] No secrets, production-data operations, or deployment changes are made unless explicitly required and approved.

## Notes
Created automatically by tools/agent/start-agent.ps1.
"@
  Write-Host ''
  Write-Host 'Creating GitHub Issue...'
  $issueOutput = (& gh issue create --repo $RepoName --title "[Task] $Title" --body $body 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { Fail "GitHub Issue creation failed: $issueOutput" }
  $IssueUrl = ($issueOutput -split "`r?`n" | Where-Object { $_ -match 'https://github\.com/.+/issues/\d+' } | Select-Object -Last 1).Trim()
  if ($IssueUrl -notmatch '/issues/(?<number>\d+)') { Fail "Issue was created but its number could not be read. Output: $issueOutput" }
  $IssueNumber = $Matches.number
  Write-Host "Created Issue #$IssueNumber: $IssueUrl" -ForegroundColor Green
}

$Slug = Get-Slug $Title
$TaskId = if ($IssueNumber) { $IssueNumber } else { Get-Date -Format 'yyyyMMdd-HHmm' }
$Branch = "agent/$Agent/$TaskId-$Slug"
$RepoLeaf = Split-Path $RepoRoot -Leaf
$Parent = Split-Path $RepoRoot -Parent
$Worktree = Join-Path $Parent "$RepoLeaf-$Agent-$TaskId-$Slug"

Write-Host ''
Write-Host 'Refreshing main...'
& git fetch origin main
if ($LASTEXITCODE -ne 0) { Fail 'git fetch origin main failed.' }

if (Test-Path $Worktree) {
  Write-Host "Workspace already exists: $Worktree" -ForegroundColor Yellow
} else {
  & git show-ref --verify --quiet "refs/heads/$Branch"
  if ($LASTEXITCODE -eq 0) {
    & git worktree add $Worktree $Branch
  } else {
    & git worktree add $Worktree -b $Branch origin/main
  }
  if ($LASTEXITCODE -ne 0) { Fail 'Could not create the agent worktree.' }
}

$LocalConfig = Join-Path $RepoRoot 'config.js'
$WorktreeConfig = Join-Path $Worktree 'config.js'
if ((Test-Path $LocalConfig) -and -not (Test-Path $WorktreeConfig)) {
  Copy-Item $LocalConfig $WorktreeConfig
  Write-Host 'Copied local config.js into the isolated workspace (it remains git-ignored).'
}

$TaskReference = if ($IssueNumber) { "GitHub issue #$IssueNumber" } else { "task '$Title'" }
$Prompt = "Read AGENTS.md and the relevant repository documentation. Work only on $TaskReference. First inspect the existing implementation and state your plan, then implement the smallest complete solution. Run the required validation, review your diff, commit and push the branch, and open a pull request. Do not merge it."

Write-Host ''
Write-Host 'Workspace ready.' -ForegroundColor Green
Write-Host "Agent:      $Agent"
Write-Host "Branch:     $Branch"
Write-Host "Folder:     $Worktree"
if ($IssueUrl) { Write-Host "Issue:      $IssueUrl" }
Write-Host ''

Set-Location $Worktree

if ($Agent -eq 'codex' -and (Get-Command codex -ErrorAction SilentlyContinue)) {
  Write-Host 'Starting Codex...' -ForegroundColor Cyan
  & codex $Prompt
} elseif ($Agent -eq 'claude' -and (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host 'Starting Claude Code...' -ForegroundColor Cyan
  & claude $Prompt
} else {
  Write-Host "$Agent CLI was not found on this device." -ForegroundColor Yellow
  Write-Host 'Opening the workspace folder. Open this folder in your agent and paste the prompt below:'
  Write-Host ''
  Write-Host $Prompt -ForegroundColor Cyan
  Start-Process explorer.exe $Worktree
}
