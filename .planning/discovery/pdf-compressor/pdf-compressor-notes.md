# Browser PDF Compressor — Discovery Notes

## Status: In progress
## Session: 2026-03-31

---

## Design Intent

A browser-only PDF compressor that runs entirely client-side (no uploads, no server). Users drop multiple PDFs, specify a target size or % reduction, and get compressed files back — maximum quality preserved, minimum interaction required. Built for personal use but designed so anyone can use it.

## Checkpoint (latest)

Core design is solid. Engine: Ghostscript WASM in Web Worker, lazy-loaded, open-source (AGPL), Vercel deploy. UX flow fully defined: drag-drop → toggle target mode (max size default 4MB / reduce % default 50%) → compress → results table with before/after sizes → Download All (ZIP). Files under target skipped and marked "already fits." Remaining: frontend tech stack, visual design direction, progress/feedback during compression, naming/branding.

## Checkpoint Archive

### CP1 — Engine & architecture — 2026-03-31
Engine decided: Ghostscript WASM in a Web Worker, lazy-loaded. Open-source (AGPL). Deployed to Vercel. Single-page UX with drag-drop, target config, compress, download.

---

## Scope

**In:** Core compression tool — upload, configure target, compress, download
**Out:** Multi-page app, user accounts, server-side processing, settings/preferences

---

## Decisions

- **D1** [ux] Single page app — drag/drop area, target config (size or %), compress button, download results, restart button
  Why: Aligns with F4 — minimum friction, no navigation
  Rejected: Multi-step wizard, separate upload/config/results pages
  Confidence: firm

- **D2** [ux] Two target modes: absolute size (e.g. 4MB) and % reduction — user picks one
  Why: Both are natural ways to think about compression depending on context
  Rejected: Single mode only
  Confidence: firm

- **D3** [deployment] Deploy to Vercel as a static site
  Why: Explorer already has a Vercel account; static site fits perfectly since there's no server component (F2)
  Rejected: Self-hosted, other platforms
  Confidence: firm

- **D4** [tech] Use Ghostscript WASM (`@jspawn/ghostscript-wasm`) as the compression engine
  Why: Battle-tested, handles real-world PDFs, same approach we validated in the shell script, binary search on DPI/quality is straightforward (F1, F3)
  Rejected: DIY lopdf+mozjpeg (too much work, edge case risk), MuPDF (unclear JS API for quality control), PDFium (not designed for compression)
  Confidence: firm

- **D5** [tech] Open-source the project (AGPL-compatible)
  Why: Ghostscript WASM is AGPL-3.0 — open-sourcing satisfies the license. Explorer is fine with this.
  Rejected: Commercial license, closed-source
  Confidence: firm

- **D6** [tech] Run WASM compression in a Web Worker
  Why: CPU-intensive work would freeze the UI otherwise. Proven pattern with Ghostscript WASM.
  Rejected: Main thread execution
  Confidence: firm

- **D7** [ux] Lazy-load WASM binary — show UI immediately, download WASM in background, show progress if user acts before ready
  Why: ~8-10MB WASM binary (~3-4MB with Brotli). Acceptable for a tool app but shouldn't block initial render.
  Rejected: Blocking load, code splitting into smaller chunks
  Confidence: firm

- **D8** [ux] Target input: toggle between "Max file size" (default 4MB) and "Reduce by %" (default 50%). User can change both values.
  Why: Two natural mental models for compression. Sensible defaults reduce friction (F4).
  Rejected: Single mode, advanced config
  Confidence: firm

- **D9** [ux] After compression: show results table with before/after sizes, "Download All" button (ZIP if feasible, otherwise per-file download buttons)
  Why: User needs to see it worked before downloading. Batch download respects F4.
  Rejected: Auto-download without preview
  Confidence: firm

- **D10** [ux] Files already under target are skipped (not recompressed) and marked in the UI as "already fits"
  Why: No point degrading quality on a file that already meets the target (F3). Still shown so user knows nothing was lost.
  Rejected: Compress anyway, hide from results
  Confidence: firm

- **D11** [tech] Vanilla TypeScript + Vite as the frontend stack
  Why: Single page, no routing, no state management complexity. Vite gives fast dev server, TypeScript for type safety with the WASM bindings, and the output is a static site that deploys to Vercel with zero config. No framework overhead for a tool this simple.
  Rejected: React/Next.js (overkill — one page, no shared state worth managing), Svelte (nice but adds a compile step and learning curve for contributors without meaningful benefit here), plain HTML/JS (loses TypeScript safety and Vite's dev experience)
  Confidence: firm

- **D12** [ux] Progress feedback: per-file status line showing "Compressing 2/5... filename.pdf" with a simple progress bar per file
  Why: Binary search means each file takes multiple iterations — user needs to know it's alive. Per-file granularity is enough; per-iteration would be noisy. Keeps the UI simple (F4) while providing trust.
  Rejected: Per-iteration progress (too noisy), spinner only (not enough info for multi-file batches)
  Confidence: firm

## Assumptions

- **A1** [compression] Rust PDF parsing libraries (lopdf or similar) can compile to WASM and handle real-world PDFs reliably
  Status: unverified
  Impact if wrong: Need to evaluate alternative approaches (emscripten port of C library, or JS-only solution)

- **A2** [compression] Image recompression in WASM can run fast enough for multi-MB PDFs without freezing the browser
  Status: unverified
  Impact if wrong: May need Web Workers, streaming, or a different compression strategy

- **A3** [deployment] Vercel can serve a WASM-based static site without issues (correct MIME types, bundle size limits)
  Status: unverified
  Impact if wrong: Minor — just configuration, or use another static host

- **A4** [performance] ~~Ghostscript WASM binary (~8-10MB) compresses to ~3-4MB over the wire with Brotli~~
  Status: invalidated — actual Brotli size is ~10MB due to embedded font data that doesn't compress well
  Impact: Mitigated by lazy-loading + immutable caching. Custom minimal build could reach ~4-5MB Brotli.

---

## Fundamentals

- **F1** [compression] PDF size is dominated by embedded images — recompressing images is the primary (often only) lever
  Derived from: "why are PDFs large?" → embedded images at high DPI/quality
  Decisions anchored: (none yet)

- **F2** [privacy] Files must never leave the browser — this is the entire reason to build rather than use existing tools
  Derived from: "why not use existing tools?" → they upload to servers → privacy risk
  Decisions anchored: (none yet)

- **F3** [quality] Compression should be the minimum needed to hit the target — preserve maximum quality per file
  Derived from: "why not just crush everything to 72 DPI?" → quality matters, each file needs only as much compression as necessary
  Decisions anchored: (none yet)

- **F4** [ux] The interaction model is: drop files → set target → get results. Any additional step is friction that undermines adoption
  Derived from: "what makes a tool people actually use?" → minimal config, batch-friendly, no accounts
  Decisions anchored: (none yet)

---
