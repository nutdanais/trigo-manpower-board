#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$repo_root" ]] || fail 'Run this from inside the trigo-manpower-board repository.'
cd "$repo_root"

mapfile_supported=0
if help mapfile >/dev/null 2>&1; then mapfile_supported=1; fi

worktrees=()
branches=()
current_worktree=''
current_branch=''
while IFS= read -r line; do
  case "$line" in
    worktree\ *)
      if [[ -n "$current_worktree" && "$current_branch" == agent/* ]]; then
        worktrees+=("$current_worktree")
        branches+=("$current_branch")
      fi
      current_worktree="${line#worktree }"
      current_branch=''
      ;;
    branch\ refs/heads/*)
      current_branch="${line#branch refs/heads/}"
      ;;
  esac
done < <(git worktree list --porcelain)
if [[ -n "$current_worktree" && "$current_branch" == agent/* ]]; then
  worktrees+=("$current_worktree")
  branches+=("$current_branch")
fi

[[ ${#branches[@]} -gt 0 ]] || { printf 'No agent workspaces found.\n'; exit 0; }

printf 'Agent workspaces:\n'
for ((i=0; i<${#branches[@]}; i++)); do
  printf '[%d] %s\n    %s\n' "$((i+1))" "${branches[$i]}" "${worktrees[$i]}"
done
read -r -p 'Which workspace should be cleaned up? Enter number: ' selection
[[ "$selection" =~ ^[0-9]+$ ]] || fail 'Please enter a valid number.'
index=$((selection-1))
(( index >= 0 && index < ${#branches[@]} )) || fail 'Selection is out of range.'
branch="${branches[$index]}"
worktree="${worktrees[$index]}"

[[ -z "$(git -C "$worktree" status --porcelain)" ]] || fail 'This workspace has uncommitted changes. Ask the agent to commit/push them before cleanup.'

repo_name="$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
verified_merged=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  merged_url="$(gh pr list --repo "$repo_name" --head "$branch" --state merged --json number,url --jq '.[0].url // ""' 2>/dev/null || true)"
  if [[ -n "$merged_url" ]]; then
    printf 'Merged PR found: %s\n' "$merged_url"
    verified_merged=1
  fi
fi

if [[ "$verified_merged" != "1" ]]; then
  printf '\nI could not automatically verify that this branch has a merged PR.\n'
  read -r -p 'Only continue if you already merged/closed the work. Type CLEAN to continue: ' confirm
  [[ "$confirm" == 'CLEAN' ]] || exit 0
fi

git worktree remove "$worktree"
git branch -D "$branch"
printf 'Cleanup complete. The remote PR/branch is left to GitHub settings.\n'
