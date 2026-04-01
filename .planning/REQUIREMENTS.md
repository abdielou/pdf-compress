# Requirements: PDF Compress

**Defined:** 2026-03-31
**Core Value:** Files never leave the browser — private, fast, zero-trust compression with maximum quality preserved.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Compression Engine

- [x] **ENG-01**: WASM binary loads in a Web Worker without blocking UI render
- [x] **ENG-02**: WASM binary begins downloading immediately on page load (background preload)
- [ ] **ENG-03**: Binary search on DPI (30-300) finds highest quality that fits under target size
- [ ] **ENG-04**: Binary search on DPI finds highest quality that achieves target % reduction
- [ ] **ENG-05**: Files already under target size are skipped (not recompressed)
- [ ] **ENG-06**: Emscripten virtual filesystem is cleaned between files to prevent state leaks
- [x] **ENG-07**: PDF bytes are transferred to/from worker using Transferable objects (zero-copy)

### File Input

- [ ] **INP-01**: User can drag and drop one or more PDF files onto a drop zone
- [ ] **INP-02**: User can click to browse and select PDF files as fallback
- [ ] **INP-03**: Non-PDF files are rejected with a clear message
- [ ] **INP-04**: User can set target as max file size (default 4MB)
- [ ] **INP-05**: User can set target as % reduction (default 50%)
- [ ] **INP-06**: User can toggle between size and % target modes

### Progress & Feedback

- [ ] **PRG-01**: Per-file status shows "Compressing X/N... filename.pdf" during batch processing
- [ ] **PRG-02**: Progress bar updates per file during compression
- [ ] **PRG-03**: If user clicks compress before WASM is ready, a loading state is shown
- [ ] **PRG-04**: Errors during compression are displayed per-file (not as a crash)

### Results & Download

- [ ] **RES-01**: Results table shows each file with original size, compressed size, and % savings
- [ ] **RES-02**: Files that were skipped ("already fits") are marked distinctly in results
- [ ] **RES-03**: "Download All" button downloads all compressed files as a ZIP
- [ ] **RES-04**: Individual download button per file as fallback
- [ ] **RES-05**: Restart button clears all state and returns to the initial drop zone

### Privacy & Trust

- [ ] **PRV-01**: Privacy message ("Files never leave your browser") visible near the drop zone
- [ ] **PRV-02**: No analytics, tracking scripts, or telemetry of any kind
- [ ] **PRV-03**: AGPL-3.0 license applied, source code linked from the page

### Deployment

- [ ] **DEP-01**: Deploys to Vercel as a static site
- [ ] **DEP-02**: WASM binary served with correct MIME type and immutable cache headers
- [ ] **DEP-03**: Site works on Chrome, Firefox, Safari, and Edge (latest versions)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Progressive Enhancement

- **PWA-01**: App installable as PWA and works offline after first load
- **PWA-02**: Dark mode support

### Optimization

- **OPT-01**: Custom minimal Ghostscript WASM build (~4-5MB Brotli vs ~10MB)
- **OPT-02**: Mobile-optimized memory limits for iOS Safari/Android

## Out of Scope

| Feature | Reason |
|---------|--------|
| Server-side processing | Contradicts core privacy value (F2) |
| User accounts / login | Stateless tool — no persistence needed |
| Daily limits / paywalls | Anti-user; monetize via donations if ever |
| PDF editing suite (merge, split, convert) | Single-purpose tool — compression only |
| Advanced compression knobs (DPI slider, JPEG quality) | Users set goals, not parameters (F4) |
| Cloud storage integration (Drive, Dropbox) | Muddies "files stay local" story |
| Analytics / tracking | Privacy tool that tracks users is hypocritical |
| Email capture / newsletter | User-hostile in a tool context |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENG-01 | Phase 1 | Complete |
| ENG-02 | Phase 1 | Complete |
| ENG-03 | Phase 1 | Pending |
| ENG-04 | Phase 1 | Pending |
| ENG-05 | Phase 1 | Pending |
| ENG-06 | Phase 1 | Pending |
| ENG-07 | Phase 1 | Complete |
| INP-01 | Phase 2 | Pending |
| INP-02 | Phase 2 | Pending |
| INP-03 | Phase 2 | Pending |
| INP-04 | Phase 2 | Pending |
| INP-05 | Phase 2 | Pending |
| INP-06 | Phase 2 | Pending |
| PRG-01 | Phase 2 | Pending |
| PRG-02 | Phase 2 | Pending |
| PRG-03 | Phase 2 | Pending |
| PRG-04 | Phase 2 | Pending |
| RES-01 | Phase 3 | Pending |
| RES-02 | Phase 3 | Pending |
| RES-03 | Phase 3 | Pending |
| RES-04 | Phase 3 | Pending |
| RES-05 | Phase 3 | Pending |
| PRV-01 | Phase 3 | Pending |
| PRV-02 | Phase 3 | Pending |
| PRV-03 | Phase 3 | Pending |
| DEP-01 | Phase 4 | Pending |
| DEP-02 | Phase 4 | Pending |
| DEP-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 after initial definition*
