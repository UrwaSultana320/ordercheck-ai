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

## Create an order with your voice

Choose **Tell OrderCheck what I ordered**. Allow browser-provider speech recognition, then choose **Start order recording**. Speak naturally and pause when finished, or say **Stop recording**. Listening ends after 4.5 seconds without a new recognition result, a browser end event, or a 60-second maximum. Cancel and Start again remain available. Unsupported browsers or denied permissions retain the labelled typed-transcript fallback. No audio is retained by this application; browser-vendor recognition can use a network service.

OrderCheck reads back a draft after dictation, then opens a bounded 15-second confirmation window. Say **Confirm**, **Change**, **Change size for product 2** (or another named field), **Start again**, or **Cancel**. Change asks a short question about one field; the answer updates that field and triggers another readback. Equivalent buttons and a field selector support keyboard/screen-reader use. Typed review respects the existing spoken-guidance preference; explicit recording/readback opts into speech for this workflow. Backgrounding, Escape, Stop, cancellation and navigation release recognition; there is no background listening loop.

Extraction is deterministic, conservative English support, separate from the receipt parser. Stated quantities, numeric sizes, explicit attribute labels, and clear clothing-colour/food-flavour phrases are supported. Unlabelled brand/variant descriptions stay intact in the product name; no catalog completion is attempted. Complex grammar, spoken number phrases and ambiguous product boundaries need review or targeted editing. Missing quantities and uncertain values block saving; optional missing fields remain omitted. Corrections that are still uncertain do not clear the confirmation gate. Only explicit confirmation creates a canonical order in My Orders. Raw transcripts stay in unsaved component memory and are excluded from saved orders. Typed transcripts use the manual source; dictated orders use voice.

The canonical Order/Item schemas now include optional platform and extensible attributes, while loading existing saved orders unchanged. New attributes are retained and displayed; this phase does not extend the existing name/brand/variant/size verification rules. Incomplete identification remains unable to verify. No API key, external AI integration, new dependency or mobile framework is added. A future approved transcription provider can implement TranscriptionProvider; stronger natural-language extraction would also need a separately approved integration or parser expansion.

## Secondary receipt/manual import and verification demonstration

Open My orders → Other ways to add an order → Import an order. Import this explicit demonstration line, review the fields, and save:

```text
Oat drink | Everyday | Original | 1 L | 2
```

Choose Scan a delivery and enter `DEMO-OAT-ORIGINAL-1L` to exercise the noncamera demonstration path. Each sufficiently supported match counts one unit. For another identical package, choose Next item, check again, and explicitly confirm **Yes, another unit**. A repeated barcode cannot distinguish physical units. Retry replaces the current checking attempt; Undo reverses a specific checking event. These demonstration codes are **not real manufacturer barcodes**. Real barcode coverage requires authoritative retailer catalog entries.

The English receipt parser combines explicit pipe-separated fields, item/price/quantity/size patterns, item-column context and wrapped descriptions. Merchant/date/order/address/payment/tax/fee/total/footer lines are separated from products where recognizable. Source text, page/line, uncertainty and available prices remain reviewable. Unknown quantities stay `null`, not one. Ambiguous product candidates remain drafts; a product name containing “Tax” is not automatically excluded. This is not a universal retailer parser: unusual layouts, unmarked merchant names, currencies, OCR mistakes and non-English receipts require review/correction. Files are limited to 10 MB; PDFs to 20 pages; decoded images/rendered pages to 12 megapixels; text to 100,000 characters. Empty, corrupt and unsupported files produce recovery guidance. Image-only PDFs use OCR.

Select whether the reference is an original purchase, your manual account of the original purchase, or a packing slip. Packing slips cannot independently establish what was ordered and cannot yield an order match. An order number alone does not retrieve purchases. No retailer/email integration has been added. Missing fields can be corrected individually; saving a corrected reference explicitly resets that order's checking history.

## Matching and architecture

- `src/lib/spoken-order.ts`: platform-independent candidate extraction, uncertainty, field correction, readback and confirmation gate.
- `src/lib/order-transcription.ts`: replaceable transcription-provider interface and bounded browser recognition/lifecycle adapter.
- `src/lib/order-storage.ts`: browser preference/session storage boundary, replaceable for native storage.
- `src/components/voice-order.tsx`: accessible recording, transcript review and targeted corrections.
- `src/lib/engine.ts`: deterministic comparison, provenance schemas, draft extraction, idempotent quantity-event ledger, Retry/Undo and counters.
- `src/data/catalog.v1.json`: versioned illustrative catalog. Replace with authoritative retailer identifiers before real deliveries.
- `src/lib/media.ts`: bounded reusable OCR worker and cancellable image/PDF/text extraction. PDF worker is copied locally at installation.
- `src/lib/session.ts`: explicit session states, exact command parsing and presentation suppression.
- `src/lib/voice.ts`: opted-in final speech commands, bounded listening windows and one priority-aware speech controller.
- `src/lib/use-assistant.ts`: camera lifecycle, stable snapshots, cancellation, association/identical-unit confirmation and optional session storage.
- `src/app/page.tsx`: assistant-first screen, accessible navigation, order review, noncamera controls and accessibility settings.
- `tests/`: evidence, uncertainty, variant, conflict and quantity tests.
- `e2e/`: desktop/mobile Chromium workflows and automated axe accessibility checks.

User-facing statuses are `match`, `mismatch`, `unable_to_verify`. Internal `MATCH` / `MISMATCH` are retained; both `CONFLICT` and `INCOMPLETE` map to `unable_to_verify` with reasons. Important reasons include `COMPLETE_LABEL`, `DEMO_CATALOG_IDENTITY`, `CONTRARY_LABEL`, `DIFFERENT_PRODUCT`, `UNKNOWN_BARCODE`, `LOW_CONFIDENCE`, `MISSING_FIELDS`, `MISSING_REFERENCE_FIELDS`, `UNKNOWN_QUANTITY`, `DEPENDENT_REFERENCE`, `EVIDENCE_CONFLICT`, `AMBIGUOUS_ORDER`, and `EXCESS_QUANTITY`.

Match requires sufficient consistent name/brand/variant/size evidence for one line. Equivalent explicit units are supported (1 L = 1000 ml; weight and volume differ). Negated variants do not match by substring. Multiple eligible lines require user allocation. Known contrary identity/size produces mismatch; incomplete or conflicting evidence remains unable to verify. Catalog-only results are explicitly qualified as demonstration identity; contents, authenticity and safety are not checked. OCR's 85 confidence threshold is a heuristic, not a probability/guarantee. Manually entered label text is user-observed evidence, labelled separately from OCR. Do not use this prototype for allergen, medicine or other safety-critical decisions.

No LLM or autonomous AI verdict service is used. Barcode and OCR observations carry capture/session/presentation IDs. They are combined only when decoded from the same snapshot; contradictory same-frame evidence can replace a catalog-only attempt from that presentation and retract its match. Expected fields are never supplied to OCR as observations. Camera sampling uses a 16×16 difference/stability heuristic before one OCR job, with a snapshot up to 1600 pixels on its longest side. It rejects results from cancelled sessions and detected package movement during OCR. Different product identities can advance automatically. Frame changes do not establish another identical physical unit; repeated identities require user confirmation even after a presentation change. The heuristic needs physical-package validation; it cannot prove physical uniqueness or detect every rapid swap. No validated unique-serialization counting is implemented. Unreadably small label text requires retry/repositioning or manual evidence. The UI reports actual elapsed OCR-job time; real-device speed has not been benchmarked.

Each attempt stores unique capture/session/event IDs, observed text/code and source, result/reason, explicit distinct-unit confirmation and Undo state. Duplicate event/capture IDs cannot add counts. Retry replaces one attempt and can remove a previous matching count if new evidence is insufficient. Undo reverses its event only. Records are bounded to 10,000 attempts per tab session.

Metrics use expected physical units with known quantities. `Items checked` includes allocated match/mismatch/unable-to-verify attempts, while only matches contribute to matching units. `Items left to check` excludes completed allocated attempts. Unknown-quantity lines and unassigned scans are shown separately; unassigned scans never reduce ordered quantities. `Orders waiting to be checked` counts orders with unattempted units or unknown-quantity lines. Checking complete reports the outcome breakdown and keeps unresolved issues visible; it is not successful fulfillment.

## Privacy and accessibility

Order data and observations stay in memory by default. Optional validated `sessionStorage` (`ordercheck.v2`) keeps orders/checking events for the current tab session; existing v1 order sessions load compatibly. Clear orders explicitly removes both versions. Invalid stored data is preserved with a warning, not silently deleted. Storage failures leave the current visit functional. Only nonsensitive accessibility preferences use `localStorage`. Images are transient; OCR worker/language assets come from Tesseract's public CDNs. System fonts replace external font downloads. No analytics or server-side order storage is added. Browser/OS speech services may process speech/audio remotely; voice recognition is not promised offline or on-device. Consent is separate and the microphone is requested only by an explicit listening/recording action (including the confirmation/correction windows within that requested voice flow). Client processing is not encryption; use a trusted device.

Screen-reader mode is the default: semantic content plus restrained polite updates, without automatic app TTS. App spoken guidance is opt-in, with Repeat, Stop speaking and speech rate controls. No screen-reader detection is attempted. Start listening opens one explicit window up to 15 seconds, ending after a final command, silence or service failure; no endless restart loop. Commands: Start, Stop, Repeat, Next, Help, Retry, Read my orders, Read the result again, Go back, Stop speaking. Identical-unit clarification also accepts Yes another unit / No retry this unit. Arbitrary imported text is not executable. Recognition is paused during app speech and resumes only within a still-requested active listening window. Voice interruption during that pause is unavailable: use the Stop speaking/Stop controls or Escape to stop the session. Stop cancels scanning/listening/pending work and preserves confirmed results. Backgrounding/page loss releases camera, recognition and OCR resources; there is no locked-phone/background operation.

Normal/large/extra-large text, high contrast, scalable system typography, visible focus, a skip link, labelled forms and 44px minimum controls are included. The mobile navigation uses an expandable Menu. Text targets AAA contrast; measured default pairs (WCAG relative-luminance formula): body `#263D36` on ivory `#FAF8F2` **10.97:1**, body on sage `#EAF1E3` **10.09:1**, ink `#123D32` on white **12.07:1**, white on primary `#0D4935` **10.39:1**, ink on warning `#F6E7C7` **9.87:1**, danger `#752B22` on white **9.88:1**. Focus `#75431B` on white **8.16:1** / warning **6.67:1**; control border `#6B7B70` on white **4.48:1** / ivory **4.21:1** (nontext target ≥3:1). Disabled controls are exempt from applicable text/nontext contrast thresholds. These measurements and automated axe checks do not establish full WCAG AAA conformance or certification.

## Collaboration and deployment

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/roadmap.md](docs/roadmap.md). Both developers use separate clones of one private repository. Create a separate `urwa/<task>` or `abdullah/<task>` feature branch for every task, commit and push progress there, and open a PR into the remote default branch (`main` currently). Keep unfinished work in draft. Never commit or push directly to main/master. Require the other developer's approval and passing existing checks; agents never merge autonomously. Preserve existing developer branches and all local/remote work. No force-pushing shared history, secrets or customer files in Git. The final hackathon release requires explicit user approval before creation, tagging, publication or deployment.

Vercel-compatible: import the same GitHub repo in Vercel, choose Next.js, use Node 24, and deploy. No environment variables are required. This task prepares deployment but does not provision an unrelated hosting repository. CI includes build, lint, type checking, Vitest, Playwright and axe. Branch protection requires repository permissions and a GitHub plan supporting protection for private repositories; see setup-status.json for the actual outcome.

## Remaining integrations

Authoritative retailer catalogs, email forwarding, retailer APIs, retailer-specific parser coverage, multilingual OCR and optional authenticated AI extraction remain outside this upgrade. Speech recognition availability and runtime permissions depend on the browser; unsupported, denied or failed services have readable/nonvoice fallbacks. See [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) for browser-service limits and [Tesseract worker performance](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md) for worker reuse guidance.

## Upgrade progress and validation

- [x] Inspect/preserve baseline; keep the existing Next.js stack and lockfile.
- [x] Add parser/provenance, verdict adapters and duplicate-safe event/metrics contracts.
- [x] Add assistant layout, settings, speech coordination and permission fallbacks.
- [x] Add bounded automatic snapshots, safe cancellation and explicit identical-unit confirmation.
- [x] Expand unit, browser, keyboard, permission, speech-cancellation and accessibility regression coverage.
- [ ] Complete physical-device and independent user validation (NOT RUN; checklist below).

Baseline on 2026-10-30: existing lint, typecheck, 14 unit tests, production build and 4 Playwright tests passed. Updated local checks passed on 2026-10-30: lint (no warnings), typecheck, 40 unit tests, production build and 18 Playwright tests. Desktop/mobile screenshots were visually inspected. PR #13 records hosted CI separately. Speech/OCR service fixtures and late-camera-permission tests use mocks; desktop/mobile Chromium emulation does not validate physical iOS/Android. Reflow is tested at 320 CSS pixels (equivalent layout width to 1280 at 400% zoom), text-spacing overrides, large text preferences, and 200% root text sizing. Actual browser/OS zoom, OS magnification and physical touch targets still need manual verification.

Voice-created order workflow validation on 2026-10-31: baseline 40 unit tests and 18 browser tests passed. Final lint (no warnings), typecheck, npm test (68 tests), production build, npm run test (68 tests), and test:e2e (32 desktop/mobile Chromium tests, including axe) passed. New review screenshots were inspected at desktop/mobile emulation sizes. The initial sandbox-only Vitest spawn EPERM was resolved by running with worker-process permission; no application baseline test failure remained. Speech recognition, permission denial and readback fixtures are mocked. Scanning, OCR, barcodes and verification rules were preserved; receipt/manual import moved to a secondary area, with no old infrastructure removed. Guided-camera positioning and delivery-verification redesign were not started.

Manual-device status: **NOT RUN** for real iPhone/VoiceOver, Android/TalkBack, Windows screen reader, microphone recognition/TTS overlap, actual camera/OCR/barcodes, physical duplicate units/rapid swaps, independent blind-user setup and recovery. No blind-user validation or WCAG certification is claimed.

Manual checklist: independently position the phone and import a purchase reference; start with both permission approval and denial; scan a real supported identity then an unknown/unreadable label; recover using Retry and nonvoice controls; check two identical packages with explicit confirmation and Undo; verify excess units and conflicting evidence never silently match; background/stop during camera permission and OCR; check camera/mic indicators and track release; use VoiceOver/TalkBack/Windows screen reader through the whole journey, 200% text, 400% browser zoom and text-spacing overrides; check Stop speaking/Escape while the app speaks; test recognition failure/offline first-load OCR assets. Record actual devices/browser versions and observed results before release.
