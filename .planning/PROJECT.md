# PDF Compress

## What This Is

A browser-based PDF compression tool that runs entirely client-side. Users drop multiple PDFs, set a target file size or percentage reduction, and download compressed files — no server uploads, no accounts, no friction. Built for anyone who needs to shrink PDFs for upload limits.

## Core Value

Files never leave the browser — private, fast, zero-trust compression with maximum quality preserved.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Client-side PDF compression via Ghostscript WASM
- [ ] Drag-and-drop multi-file upload
- [ ] Two target modes: max file size (default 4MB) and % reduction (default 50%)
- [ ] Binary search on DPI/quality to find highest quality that fits target
- [ ] Files already under target skipped and marked "already fits"
- [ ] Results table showing before/after sizes per file
- [ ] Download All as ZIP (per-file fallback if ZIP not feasible)
- [ ] Restart button to clear and start over
- [ ] Per-file progress feedback during compression
- [ ] WASM lazy-loaded in Web Worker with background download on page load
- [ ] Deployable as static site to Vercel

### Out of Scope

- Server-side processing — contradicts core privacy value
- User accounts / settings persistence — tool is stateless by design
- Multi-page app / routing — single page, no navigation
- Advanced compression options — minimal config only
- Custom Ghostscript WASM build — optimize later if needed

## Context

- Validated the compression approach with a local Ghostscript shell script that binary-searches on DPI to find the highest quality fitting under a target size
- Ghostscript WASM (`@jspawn/ghostscript-wasm` or `@okathira/ghostpdl-wasm`) provides the same engine in the browser
- WASM binary is ~15MB raw, ~10MB over the wire with Brotli — mitigated by lazy-loading + immutable caching
- A custom minimal build (stripping CJK fonts, unused devices) could reduce to ~4-5MB Brotli — future optimization
- AGPL-3.0 license from Ghostscript requires open-sourcing the project

## Constraints

- **License**: AGPL-3.0 — project must be open-source (Ghostscript WASM dependency)
- **Privacy**: Zero server involvement — all processing client-side (F2)
- **Tech stack**: Vanilla TypeScript + Vite — no framework (single page, no complexity to justify one)
- **Deployment**: Vercel static site
- **Bundle**: ~10MB WASM over the wire — must lazy-load, not block initial render

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Ghostscript WASM as engine | Battle-tested, handles real-world PDFs, binary search on DPI works | — Pending |
| Web Worker for compression | CPU-intensive WASM would freeze UI | — Pending |
| Vanilla TS + Vite | No framework overhead for single-page tool | — Pending |
| AGPL open-source | Required by Ghostscript license, user OK with it | — Pending |
| Lazy-load WASM | 10MB binary can't block render; download in background, cache immutably | — Pending |
| ZIP download | Batch download for multi-file; per-file fallback | — Pending |
| Two target modes | Max size and % reduction are both natural mental models | — Pending |
| Clean minimal UI | Functional dev-tool aesthetic, no branding flair | — Pending |

---
*Last updated: 2026-03-31 after initialization*
