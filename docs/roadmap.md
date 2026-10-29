# 14-day delivery roadmap

Day 1 — Foundation. Urwa: accessible shell and navigation. Abdullah: shared Zod contracts. Acceptance: build and keyboard navigation pass.

Day 2 — Foundation. Urwa: responsive design and focus. Abdullah: versioned catalog and evidence types. Acceptance: mobile layout and schema validation pass.

Day 3 — Order Import. Urwa: pasted-text import and review UI. Abdullah: conservative draft extraction. Acceptance: omitted fields stay unknown; review is required.

Day 4 — Order Import. Urwa: correction and file errors. Abdullah: PDF/image processing. Acceptance: text and image-only PDFs work; limits and failure recovery tested.

Day 5 — Scanning and OCR. Urwa: camera permissions and audio positioning. Abdullah: ZXing pipeline. Acceptance: real rear-camera code recognized and camera released on exit.

Day 6 — Scanning and OCR. Urwa: OCR feedback and retry. Abdullah: label recognition and asset loading. Acceptance: representative labels read on both mobile platforms; weak results never count.

Day 7 — Verification Engine. Urwa: verdict display and announcements. Abdullah: exact field/catalog matching. Acceptance: variants, sizes, unknown codes and duplicate-order cases pass tests.

Day 8 — Verification Engine. Urwa: next-item guidance and undo. Abdullah: quantity bounds and conflict recovery. Acceptance: repeated frames cannot double count; completed quantities reject extras.

Day 9 — Accessibility. Urwa: VoiceOver and TalkBack test sessions. Abdullah: error explanations. Acceptance: complete import-to-verification journey works without seeing the screen.

Day 10 — Accessibility. Urwa: zoom, contrast and touch targets. Abdullah: privacy and schema hardening. Acceptance: axe checks pass, 200% zoom works and no order data leaves the browser.

Day 11 — Testing and Deployment. Urwa: browser workflows. Abdullah: engine regressions and catalog provenance checks. Acceptance: desktop and mobile Chromium plus meaningful unit tests pass.

Day 12 — Testing and Deployment. Urwa: iOS Safari and Android Chrome camera testing. Abdullah: OCR/network and corrupt-file recovery. Acceptance: camera, orientation, permission-denial and offline-asset cases documented.

Day 13 — Testing and Deployment. Urwa: assisted user feedback and fixes. Abdullah: CI, branch rules and deployment. Acceptance: PR gates and Vercel preview pass; plan limitations recorded.

Day 14 — Testing and Deployment. Both: regression, documentation and release review. Acceptance: known limitations acknowledged, trusted catalog integration scoped, both developers approve the release.

The initial implementation covers the software foundation and demonstrable P0 workflow. Real catalog coverage, user research and physical-device acceptance remain release gates. Ownership assignments in GitHub require Abdullah's confirmed account and collaborator access.
