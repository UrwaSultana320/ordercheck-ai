# OrderCheck AI

Mobile-first delivery verification for blind and low-vision shoppers. Built with Next.js, React, TypeScript, ZXing, Tesseract.js, PDF.js and Zod. No AI service or API key required.

## Run on Windows

```powershell
cd ~/source/repos/ordercheck-ai
npm.cmd ci
npm.cmd run dev
```

Open http://localhost:3000. Camera access needs localhost or HTTPS. Tested locally with Node 26.6.0; CI uses Node 24 LTS. Next 16 requires Node >=20.9; dependencies are pinned in package-lock.json. Python is not required.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

## First delivery

Import this explicit demonstration line, review the fields, and save:

```text
Oat drink | Everyday | Original | 1 L | 2
```

Choose Scan delivery and enter `DEMO-OAT-ORIGINAL-1L`. Each match counts one unit. Move the item away and choose Next item before scanning another unit. Undo reverses the most recent match. These demonstration codes are **not real manufacturer barcodes**. Real scanning requires retailer-verified catalog entries.

Free-form confirmation text is conservatively split into draft lines; unknown fields remain blank, quantities default to 1 for human review, and headers may need removal. This is not a general retailer parser. PDFs up to 20 pages and files up to 10 MB are supported, including image-only PDFs through OCR. Always review extracted details; import does not verify products.

## Matching and architecture

- `src/lib/engine.ts`: pure deterministic engine, schemas, draft extraction and quantity application.
- `src/data/catalog.v1.json`: versioned illustrative catalog. Replace with authoritative retailer identifiers before real deliveries.
- `src/lib/media.ts`: client-only image OCR and PDF extraction. PDF worker is copied locally at installation.
- `src/app/page.tsx`: accessible navigation, order review, scanner lifecycle, guidance, undo and optional session storage.
- `tests/`: evidence, uncertainty, variant, conflict and quantity tests.
- `e2e/`: desktop/mobile Chromium workflows and automated axe accessibility checks.

MATCH requires an exact known barcode identity or high-confidence OCR containing all user-confirmed identifying fields. Name-only, unknown barcode and low-confidence results are INCOMPLETE. Multiple eligible order lines or contradictory label evidence are CONFLICT. MISMATCH never increments counts. Match application is bounded by the ordered quantity. Confidence threshold (85) is a conservative heuristic, not a calibrated probability or guarantee; OCR can misread labels. Do not use this prototype for allergen, medicine or other safety-critical decisions.

No autonomous AI verdicts. A future protected server route may extract structured order fields with Zod validation and provenance; it must never invent missing details or replace the verification engine. Automatic progression pauses after a match because identical products cannot be distinguished across camera frames.

## Privacy and accessibility

Order data stays in component memory by default. Optional validated `sessionStorage` keeps it only for the current browser tab session. Clear orders removes drafts, results and stored orders. Images are processed transiently in the browser. OCR assets are fetched by Tesseract from its public CDNs on first use. Google Fonts are requested for typography, with system fallbacks. Device speech services may use network processing according to OS/browser configuration. No analytics or server-side order storage. Client processing is not encryption; use a trusted device.

Controls have visible labels, keyboard focus, large touch areas, semantic headings and polite live status. Built-in speech can be disabled for screen readers. Camera instructions and failure recovery are available as text and spoken guidance. Manual VoiceOver/TalkBack testing on real phones remains required; automated axe checks cannot establish complete accessibility.

## Collaboration and deployment

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/roadmap.md](docs/roadmap.md). Both developers use separate clones of one private repository. Create a separate `urwa/<task>` or `abdullah/<task>` feature branch for every task, commit and push progress there, and open a PR into the remote default branch (`main` currently). Keep unfinished work in draft. Never commit or push directly to main/master. Require the other developer's approval and passing existing checks; agents never merge autonomously. Preserve existing developer branches and all local/remote work. No force-pushing shared history, secrets or customer files in Git. The final hackathon release requires explicit user approval before creation, tagging, publication or deployment.

Vercel-compatible: import the same GitHub repo in Vercel, choose Next.js, use Node 24, and deploy. No environment variables are required. This task prepares deployment but does not provision an unrelated hosting repository. CI includes build, lint, type checking, Vitest, Playwright and axe. Branch protection requires repository permissions and a GitHub plan supporting protection for private repositories; see setup-status.json for the actual outcome.

## Remaining integrations

Authoritative retailer catalogs, email forwarding, retailer APIs, robust retailer-specific parsing, optional authenticated AI extraction, multilingual OCR and voice commands require further scope or credentials. Voice-first currently means spoken guidance and results, not speech-command recognition. Test real camera focus, performance, duplicate-frame behavior, OCR asset loading, permissions and assistive technology on physical iOS and Android devices before release.
