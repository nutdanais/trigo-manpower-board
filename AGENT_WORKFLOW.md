# Codex + Claude workflow (non-coder guide)

You do **not** need to create GitHub Issues, branches, or worktrees by hand for normal tasks.

The launcher does that bookkeeping for you.

## Normal Windows workflow

From the main `trigo-manpower-board` folder:

- Double-click `START-CODEX.cmd` to give a task to Codex.
- Double-click `START-CLAUDE.cmd` to give a different task to Claude.

The launcher asks only:

1. a short task name;
2. a short description of the result you want.

By default it then automatically:

1. creates a GitHub Issue;
2. updates its view of `main`;
3. creates a separate agent branch;
4. creates a separate Git worktree/folder;
5. copies the local, git-ignored `config.js` into that isolated folder when available;
6. starts the selected CLI with instructions to read `AGENTS.md`, work on the Issue, validate the change, push its branch, and open a PR;
7. tells the agent **not to merge the PR**.

If the selected agent CLI is not installed, the launcher opens the isolated folder and prints the prompt to use instead.

### Example

Double-click `START-CODEX.cmd` and enter:

- Task: `Improve settings modal on mobile`
- Result: `Make the settings modal easier to use on phone screens without changing permissions or settings behavior.`

Later, double-click `START-CLAUDE.cmd` and give Claude a different task. Each gets its own branch and folder.

## Do I need a GitHub Issue every time?

No manual Issue creation is required.

For normal agent work, **keep automatic Issue creation on**. The Issue is useful because it gives Codex, Claude, GitHub, and future-you one durable task record.

For a tiny throwaway/local task, the launcher can continue without an Issue when automatic Issue creation is unavailable. Do not use that shortcut for parallel work, Supabase/schema/auth changes, production-impacting work, or anything you expect to merge later.

## One-time GitHub CLI setup

Automatic Issue creation uses GitHub CLI (`gh`). This is a one-time setup per computer.

### Windows

```powershell
winget install --id GitHub.cli
gh auth login
```

### macOS

With Homebrew:

```bash
brew install gh
gh auth login
```

After that, the launchers create Issues automatically.

## macOS workflow

From Terminal in the main repo folder:

```bash
bash tools/agent/start-agent.sh codex
```

or:

```bash
bash tools/agent/start-agent.sh claude
```

The behavior is the same as Windows: Issue, branch, worktree, local config copy, and agent startup are automated.

## When the task is finished

Do not manually delete the agent folder immediately.

First make sure the PR is merged (or deliberately closed) and the agent has pushed everything.

On Windows, double-click:

`FINISH-AGENT.cmd`

It shows the agent workspaces and lets you select one to clean up. It refuses to delete a workspace with uncommitted changes and tries to verify that a PR was merged first.

On macOS:

```bash
bash tools/agent/finish-agent.sh
```

## What you still decide

Automation handles Git mechanics, but you remain the approval gate.

Your normal decisions are:

1. What do I want changed?
2. Should Codex or Claude own this task?
3. Is another agent already changing the same area?
4. Does the PR result look correct?
5. Should I merge it?

For two tasks that touch the same core data model, auth/permissions, Supabase migration, or the same large area of `app.js`, run them sequentially rather than at the same time.
