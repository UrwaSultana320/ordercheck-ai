# One repository, two developers

Repository owner: `UrwaSultana320`. Abdullah's confirmed GitHub username is `abdullahsheikhdeveloper-ops`. GitHub's collaborator-permission API confirmed Write access on 2026-10-29.

## Abdullah's onboarding

1. Sign into the GitHub account identified by the invitation and open the repository invitation from GitHub notifications or email. Accept it. A sent invitation does not mean access has been accepted.
2. Clone the **same** repository: `git clone https://github.com/UrwaSultana320/ordercheck-ai.git`.
3. `cd ordercheck-ai`, then fetch the remote and create a new task branch: `git fetch origin` followed by `git switch -c abdullah/<task> origin/main` (replace `<task>` with a short task name).
4. Install Node 24 LTS or a compatible newer Node. Run `npm.cmd ci` and `npm.cmd run dev`.
5. Work on recognition, catalog validation, extraction and verification. Commit progress to your task branch, push it with `git push -u origin HEAD`, and open a PR into `main`; keep unfinished work in draft and request Urwa's review.

Urwa uses her own local clone and a new `urwa/<task>` branch for each task. Start from the fetched remote default branch (`main` currently); verify it before starting. Preserve existing `dev-urwa` and `dev-abdullah` history and unfinished work. If a task depends on unmerged work, document that dependency in its PR rather than rewriting shared history. Coordinate shared types through PRs. Never commit or push directly to `main` or `master`, including bootstrap work.

Inspect `git status`, branch/upstream and the diff before editing. Preserve unrelated local changes. Stage explicit paths, inspect `git diff --cached`, and check for secrets before every commit. Never force-push shared history, delete existing work, or commit secrets, credentials, receipts or customer files. Push progress only to the task's feature branch.

## Review policy

Run the existing checks from the repository root (Windows commands):

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Open a PR into the remote default branch; keep unfinished work in draft. Request and obtain approval from the other developer before merging. Urwa requests `abdullahsheikhdeveloper-ops`; Abdullah requests `UrwaSultana320`. If the teammate cannot review yet, the PR waits. Prefer squash merges and resolve conversations. Agents must not merge autonomously or enable auto-merge. Never bypass failed tests or treat uncertain OCR as a verified item. CODEOWNERS currently lists Urwa; this does not replace teammate approval on Urwa's own PRs.

Record actual command results, baseline failures and blocked/not-run checks in the PR. Browser tests with simulated inputs are not physical-device validation. Report real iPhone/VoiceOver, Android/TalkBack, Windows screen-reader, camera/microphone, physical-package and identical-unit tests as NOT RUN unless performed; include outstanding cases in the handoff.

CI runs the existing lint, type-check, unit tests, production build and Playwright/axe checks on task-branch pushes and PRs into `main`. The `quality` check is the intended required check. When available, protect `main` and any `master` branch: require a PR, at least one teammate approval, dismiss stale approvals, require the quality check and resolved review conversations, apply rules to administrators, and disallow force pushes and deletion. Preserve stronger existing rules.

If private repository branch protection is unavailable on the current GitHub plan or credentials lack administration scope, these are documented team rules rather than verified server enforcement. Report the limitation without buying a plan, changing visibility or altering collaborator permissions. Setup outcome is recorded in `setup-status.json`.

## Release approval

Do not create, tag, publish or deploy the final hackathon release until the users explicitly approve it. Successful checks and routine PR review do not authorize a release. Keep outstanding physical-device and assistive-technology validation visible in the release handoff.
