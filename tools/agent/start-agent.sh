#!/usr/bin/env bash
set -euo pipefail

agent="${1:-}"
title="${2:-}"
description="${3:-}"
no_issue="${NO_ISSUE:-0}"

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-42
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$repo_root" ]] || fail 'Run this launcher from inside the trigo-manpower-board repository.'
cd "$repo_root"

remote_url="$(git remote get-url origin)"
repo_name="$(printf '%s' "$remote_url" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
[[ "$repo_name" == */* ]] || fail "Could not determine the GitHub repository from origin: $remote_url"

while [[ "$agent" != "codex" && "$agent" != "claude" ]]; do
  read -r -p 'Agent (codex / claude): ' agent
  agent="$(printf '%s' "$agent" | tr '[:upper:]' '[:lower:]')"
done

if [[ -z "$title" ]]; then
  read -r -p 'What do you want the agent to do? (short task name): ' title
fi
[[ -n "$title" ]] || fail 'Task name cannot be empty.'

if [[ -z "$description" ]]; then
  read -r -p 'Short description / desired result (press Enter to reuse the task name): ' description
  description="${description:-$title}"
fi

issue_number=""
issue_url=""

if [[ "$no_issue" != "1" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    printf '\nGitHub CLI (gh) is not installed, so automatic Issue creation is unavailable on this device.\n'
    printf 'One-time macOS setup with Homebrew:  brew install gh\n'
    printf 'Then run:                          gh auth login\n'
    read -r -p 'Continue this task WITHOUT a GitHub Issue? (y/N): ' answer
    [[ "${answer,,}" == "y" ]] || exit 0
    no_issue="1"
  elif ! gh auth status >/dev/null 2>&1; then
    printf '\nGitHub CLI needs a one-time sign-in on this device.\n'
    printf 'Run: gh auth login\n'
    read -r -p 'Continue this task WITHOUT a GitHub Issue? (y/N): ' answer
    [[ "${answer,,}" == "y" ]] || exit 0
    no_issue="1"
  fi
fi

if [[ "$no_issue" != "1" ]]; then
  body=$(cat <<EOF
## Owner
$agent

## Goal
$description

## Acceptance criteria
- [ ] The requested outcome is implemented.
- [ ] Existing related behavior is preserved unless this task explicitly changes it.
- [ ] Validation required by AGENTS.md is completed.
- [ ] No secrets, production-data operations, or deployment changes are made unless explicitly required and approved.

## Notes
Created automatically by tools/agent/start-agent.sh.
EOF
)
  printf '\nCreating GitHub Issue...\n'
  issue_url="$(gh issue create --repo "$repo_name" --title "[Task] $title" --body "$body")"
  issue_number="$(printf '%s' "$issue_url" | sed -nE 's#^.*/issues/([0-9]+)$#\1#p')"
  [[ -n "$issue_number" ]] || fail "Issue was created but its number could not be read: $issue_url"
  printf 'Created Issue #%s: %s\n' "$issue_number" "$issue_url"
fi

slug="$(slugify "$title")"
[[ -n "$slug" ]] || slug='task'
if [[ -n "$issue_number" ]]; then
  task_id="$issue_number"
else
  task_id="$(date '+%Y%m%d-%H%M')"
fi

branch="agent/$agent/$task_id-$slug"
repo_leaf="$(basename "$repo_root")"
parent="$(dirname "$repo_root")"
worktree="$parent/$repo_leaf-$agent-$task_id-$slug"

printf '\nRefreshing main...\n'
git fetch origin main

if [[ -d "$worktree" ]]; then
  printf 'Workspace already exists: %s\n' "$worktree"
else
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add "$worktree" "$branch"
  else
    git worktree add "$worktree" -b "$branch" origin/main
  fi
fi

if [[ -f "$repo_root/config.js" && ! -f "$worktree/config.js" ]]; then
  cp "$repo_root/config.js" "$worktree/config.js"
  printf 'Copied local config.js into the isolated workspace (it remains git-ignored).\n'
fi

if [[ -n "$issue_number" ]]; then
  task_reference="GitHub issue #$issue_number"
else
  task_reference="task '$title'"
fi

prompt="Read AGENTS.md and the relevant repository documentation. Work only on $task_reference. First inspect the existing implementation and state your plan, then implement the smallest complete solution. Run the required validation, review your diff, commit and push the branch, and open a pull request. Do not merge it."

printf '\nWorkspace ready.\n'
printf 'Agent:      %s\n' "$agent"
printf 'Branch:     %s\n' "$branch"
printf 'Folder:     %s\n' "$worktree"
[[ -n "$issue_url" ]] && printf 'Issue:      %s\n' "$issue_url"
printf '\n'

cd "$worktree"
if [[ "$agent" == "codex" ]] && command -v codex >/dev/null 2>&1; then
  printf 'Starting Codex...\n'
  exec codex "$prompt"
elif [[ "$agent" == "claude" ]] && command -v claude >/dev/null 2>&1; then
  printf 'Starting Claude Code...\n'
  exec claude "$prompt"
else
  printf '%s CLI was not found on this device.\n' "$agent"
  printf 'Opening the workspace folder. Open this folder in your agent and paste this prompt:\n\n%s\n' "$prompt"
  open "$worktree"
fi
