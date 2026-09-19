# AGENTS.md

Shared repository instructions for coding agents (Codex, Claude Code, and other automated contributors).

## Project context

TRIGO Manpower Management Board is a static browser application backed by Supabase.

Key files:
- `index.html` — application shell, markup, styles, script loading, and cache-busting query strings.
- `app.js` — main UI and board behavior.
- `cloud.js` — Supabase-backed persistence/auth/realtime behavior.
- `charts.js` — overview/dashboard chart behavior.
- `config.sample.js` — safe example configuration. Real `config.js` is local/generated and must never be committed.
- `SUPABASE_SETUP.md` — database/auth setup and migrations.
- `DEPLOY.md` — Netlify deployment notes.
- `README.md` — product behavior and current operating rules.

There is no npm-based application build in this repository. Do not introduce a package manager, framework, bundler, or large dependency unless the assigned issue explicitly requires it and the PR explains why.

## Source of truth

Before making changes:
1. Read the assigned GitHub issue completely.
2. Read this file.
3. Read the relevant sections of `README.md` and any related setup/deployment docs.
4. Inspect the current branch and recent changes before editing.

If repository behavior and an issue conflict, stop and call out the conflict in the PR rather than silently changing unrelated behavior.

## Multi-agent Git workflow

The repository is designed for Codex and Claude to work in parallel.

Rules:
- Never work directly on `main`.
- One issue = one owner agent = one branch = one worktree = one PR.
- Codex and Claude must not edit the same working directory at the same time.
- Preferred branch names:
  - `agent/codex/<issue>-<short-slug>`
  - `agent/claude/<issue>-<short-slug>`
- Keep each branch scoped to one issue.
- Do not mix opportunistic refactors into a feature/fix PR.
- If another PR merges into `main` and affects your area, update/rebase before continuing substantial work and rerun validation.
- Do not force-push `main` or rewrite shared branch history.

When two tasks are likely to touch the same state model, Supabase schema, auth flow, shared CSS/markup, or the same large section of `app.js`, prefer sequential work rather than parallel work.

## Implementation constraints

### Preserve existing product behavior

This board is operational software. Treat behavior documented in `README.md` as intentional unless the issue explicitly changes it.

Pay particular attention to:
- past-date/read-only behavior;
- explicit carry-over/reset semantics;
- board locking;
- employee active/inactive history semantics;
- host rename/merge/history behavior;
- role and permission checks;
- realtime/cloud persistence;
- export/PDF behavior;
- working-day, leave, on-call, and utilization calculations.

Avoid silent data rewrites or automatic mutations. If a change can alter historical records or shared planning state, make that consequence explicit in the implementation and PR description.

### Supabase and data safety

- Never commit `config.js`, credentials, access tokens, service-role keys, passwords, or other secrets.
- Never expose privileged Supabase credentials to browser code.
- Do not modify production data as part of development/testing.
- Do not run destructive SQL or migrations against production unless the issue explicitly calls for it and a human has approved the operation.
- Schema changes require a migration committed under the existing Supabase migration structure and must include rollback/recovery considerations in the PR.
- Preserve Row Level Security assumptions; do not work around RLS in client code.

### Deployment safety

The Netlify site is connected to GitHub. Agents must not:
- change the production deployment branch;
- change Netlify environment variables;
- trigger or describe a production deployment as completed;
- modify deployment configuration;

unless the assigned issue explicitly requests deployment work.

When changing one of the cache-busted browser scripts (`app.js`, `cloud.js`, `charts.js`), review the corresponding `?v=` query string in `index.html`. If the change is intended to ship to users, update the relevant cache-busting value as part of that release change.

## Coding approach

- Prefer the smallest change that fully solves the issue.
- Match the existing architecture and style before introducing new abstractions.
- Reuse existing helpers and UI patterns.
- Keep browser compatibility in mind; this app is consumed directly as static files.
- Keep accessibility behavior intact when changing interactive UI.
- Treat touch/mobile behavior as first-class because the board is used on tablets/phones as well as desktops.
- Add comments only where they explain non-obvious constraints or business rules.

## Validation

At minimum, before declaring a task complete:

```bash
node --check app.js
node --check cloud.js
node --check charts.js
```

Also run `node --check` on any other changed JavaScript file.

Then perform a focused browser smoke test for the behavior you changed. A local static server is preferred over opening files directly when practical, for example:

```bash
python3 -m http.server 8000
```

On Windows, `py -m http.server 8000` may be used instead.

If the change touches Supabase-backed behavior, validate with a non-production development/test configuration. Do not fabricate a successful cloud test when credentials or a safe environment are unavailable; state what was and was not tested.

For UI changes, test the affected flow at desktop and narrow/mobile widths and check keyboard/focus behavior where relevant.

## Definition of done

Before opening or updating the PR:
1. Review your own diff for accidental unrelated changes.
2. Run the required syntax checks.
3. Run focused manual/browser validation where possible.
4. Verify no secrets or generated `config.js` were added.
5. Update documentation if product behavior changed.
6. Update cache-busting query strings when the change is intended for release and the affected script requires it.
7. Write the PR using the repository PR template.
8. State clearly any validation that could not be performed.

## Review protocol

For cross-agent review:
- If Codex implemented the PR, Claude should be preferred as the first independent agent reviewer when available.
- If Claude implemented the PR, Codex should be preferred as the first independent agent reviewer when available.
- Reviewing agents should review before editing. Focus on correctness, regression risk, security, data integrity, permissions, concurrency/realtime behavior, edge cases, and missing validation.
- Cosmetic/style comments are secondary unless they materially affect maintainability or usability.
- The implementing agent should address review findings on the same branch.

Human approval remains the final gate for merging changes that affect production behavior, data, permissions, schema, or deployment.
