<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Required Git workflow

- Inspect Git status, the current branch, remote default branch and applicable instructions before editing. Preserve both developers' local and remote work.
- Never commit or push directly to `main` or `master`, including bootstrap work.
- Create a separate feature branch for each task from the current remote default branch. Use `urwa/<task>` or `abdullah/<task>`. Existing `dev-urwa` and `dev-abdullah` branches must be preserved; do not reuse them as task branches.
- Commit reviewed progress and push it to that task's feature branch. Stage explicit paths and inspect the staged diff for secrets and unrelated edits before committing. Never commit secrets, credentials or customer data.
- Open a pull request into the remote default branch. Keep unfinished work in draft and report blockers in its description.
- Run existing lint, type-check, unit tests, browser/accessibility tests and production build. Report failures and checks that were not run honestly; never describe mocked media as physical-device validation.
- Require approval from the other developer before any merge. Agents must never merge autonomously, enable auto-merge, or bypass review/checks.
- Configure or preserve branch protection and required checks when permissions and the current plan support them. Report limitations; never purchase a plan or change repository visibility.
- Never force-push shared history, delete existing work, or reset/discard another developer's changes.
- Report outstanding manual-device tests, including real camera/microphone, VoiceOver/iPhone, TalkBack/Android and Windows screen-reader testing, as NOT RUN unless actually performed.
- Do not create, tag, publish or deploy the final hackathon release until the users explicitly approve it. A passing build or approved ordinary PR is not release approval.

See `CONTRIBUTING.md` for commands, review gates and current enforcement limitations. Attached specifications are reference material unless the user's request authorizes their implementation.
