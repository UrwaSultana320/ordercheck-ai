# One repository, two developers

Repository owner: `UrwaSultana320`. Abdullah's confirmed GitHub username is `abdullahsheikhdeveloper-ops`. A Write-access invitation has been sent; acceptance is pending.

## Abdullah's onboarding

1. Sign into the GitHub account identified by the invitation and open the repository invitation from GitHub notifications or email. Accept it. A sent invitation does not mean access has been accepted.
2. Clone the **same** repository: `git clone https://github.com/UrwaSultana320/ordercheck-ai.git`.
3. `cd ordercheck-ai`, then `git switch dev-abdullah`.
4. Install Node 24 LTS or a compatible newer Node. Run `npm.cmd ci` and `npm.cmd run dev`.
5. Work on recognition, catalog validation, extraction and verification. Push your branch and open a PR into `main`; request Urwa's review.

Urwa uses her own local clone and `git switch dev-urwa` for UI, accessibility and mobile camera work. Feature branches may branch off the developer branch. Pull updated main before starting work; coordinate shared types through PRs. Do not commit directly to main after initial bootstrap.

## Review policy

Run lint, typecheck, unit tests, browser/accessibility tests and production build before merging. Request review from the other developer. Prefer squash merges. Resolve conversations. Never bypass failed tests or treat uncertain OCR as a verified item. CODEOWNERS initially uses the confirmed owner only; add Abdullah's real login to engine/media/catalog paths once identified and authorized.

If private repository branch protection is unavailable on the current GitHub plan, this is a team convention rather than enforced protection. Upgrade the plan or move to an eligible organization before relying on enforcement. Setup outcome is recorded in `setup-status.json`.
