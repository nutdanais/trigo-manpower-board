# TRIGO user manuals — release 2026-10-13x

Two separate PDFs, matching direction B (navy step rail and real app screenshots), updated 14 October 2026:

- [English PDF](./TRIGO-User-Manual-EN.pdf)
- [Thai PDF](./TRIGO-User-Manual-TH.pdf)
- [Preview](./manual-preview.png)
- [Validation results](./pdf-validation.json)

Each language contains 43 slides. The app is pinned to production commit `98250982f3f04813478d70c3fb969ce4fe252e6d`.
Screenshots are captured from the real repository application using synthetic demonstration records and the existing fake-database test harness. Mobile screens are captured in a touch-enabled 390 × 844 emulated viewport. Browser installation flows are explicitly labeled diagrams; they are not fabricated screenshots.

## Updated coverage

Desktop module navigation and Board dropdown; status, date and avatar menu; light interface; leave tabs and counts; current name language choices (Thai / English); record side panels; Hide/Unhide suggestions and previews; phone header, summary, overflow, bottom navigation, Me and people drawer → Place; mobile list details; app icon and installation; revised Overview board scoping, History and workload; current Capacity grid, Available details, row controls and phone day steppers; Org Chart filters and editable PowerPoint export; full-page Settings, drafts, Save changes, Discard, leave guards and Retry; administrators' staged permissions; employee dates, historical counts, missing-data repair and .xlsx-only bulk edit.

## Rebuild

From the repository root, with Node, Playwright/Chromium, Python, Thai fonts and dependencies installed:

```sh
node docs/user-manual-src/build.cjs
python docs/user-manual-src/verify.py
```

The dedicated GitHub Actions workflow builds on the documentation branch and commits validated outputs there. It is scoped to this branch and does not require production credentials. Update the version, pinned app commit and translated instructions in `docs/user-manual-src/content.json` before documenting another release.

PDF checks cover slide counts, text, Thai presence, version labels, contents links, clickable app URLs, QR decoding from both rendered PDFs, and layout overlaps.
