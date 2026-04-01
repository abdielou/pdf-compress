# Roadmap: PDF Compress

## Overview

PDF Compress delivers a browser-based, fully client-side PDF compression tool in four phases. Phase 1 builds the WASM compression engine in a Web Worker with binary search optimization — the critical foundation everything else depends on. Phase 2 layers on the user-facing file input and real-time progress feedback. Phase 3 completes the user flow with results display, downloads (individual and ZIP), and privacy/trust signals. Phase 4 hardens for production with Vercel deployment, correct WASM serving, and cross-browser validation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Compression Engine** - WASM-powered compression pipeline running in a Web Worker with binary search quality optimization
- [ ] **Phase 2: File Input and Progress UI** - Drag-and-drop multi-file upload with target mode selection and per-file progress feedback
- [ ] **Phase 3: Results and Download** - Results table, ZIP download, restart flow, and privacy/trust messaging
- [ ] **Phase 4: Deployment and Cross-Browser** - Vercel static deployment with correct WASM serving and cross-browser validation

## Phase Details

### Phase 1: Compression Engine
**Goal**: Users have a working compression pipeline that takes PDF bytes in and produces optimally compressed PDF bytes out, entirely in-browser
**Depends on**: Nothing (first phase)
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07
**Success Criteria** (what must be TRUE):
  1. WASM binary loads inside a Web Worker without freezing the main thread or blocking page render
  2. Binary search finds the highest DPI that produces output under a target file size (e.g., 4MB)
  3. Binary search finds the highest DPI that achieves a target percentage reduction (e.g., 50%)
  4. Files already under the target size are detected and skipped without recompression
  5. Multiple files can be processed sequentially without state leaking between them (Emscripten FS cleaned)
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Scaffold Vite 8 project, validate WASM-in-Worker, establish typed message protocol
- [x] 01-02-PLAN.md — Implement binary search compression engine with mocked-GS tests and worker wiring
- [x] 01-03-PLAN.md — Build main-thread controller, wire end-to-end pipeline, browser verification

### Phase 2: File Input and Progress UI
**Goal**: Users can drop or select PDF files, configure compression targets, and see live feedback as each file is processed
**Depends on**: Phase 1
**Requirements**: INP-01, INP-02, INP-03, INP-04, INP-05, INP-06, PRG-01, PRG-02, PRG-03, PRG-04
**Success Criteria** (what must be TRUE):
  1. User can drag-and-drop one or more PDFs onto the page and see them accepted (non-PDFs rejected with message)
  2. User can click to browse and select files as a fallback to drag-and-drop
  3. User can set a max file size target or a percentage reduction target and toggle between them
  4. During compression, user sees per-file progress indicating which file is being processed and how far along it is
  5. If WASM is still loading when user initiates compression, a loading state is shown instead of an error
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — Drop zone, file validation, target config UI with test infrastructure
- [ ] 02-02-PLAN.md — Progress UI, app orchestrator, controller ready state, browser verification

### Phase 3: Results and Download
**Goal**: Users see compression results for every file, can download individually or as ZIP, can restart, and trust that files stayed private
**Depends on**: Phase 2
**Requirements**: RES-01, RES-02, RES-03, RES-04, RES-05, PRV-01, PRV-02, PRV-03
**Success Criteria** (what must be TRUE):
  1. Results table shows each file with original size, compressed size, and percentage savings
  2. Skipped files ("already fits") are visually distinct in the results table
  3. User can download all compressed files as a single ZIP, or download individual files one at a time
  4. Restart button clears all state and returns to the initial drop zone view
  5. Privacy message ("Files never leave your browser") is visible near the drop zone, and no analytics or tracking scripts are present
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Deployment and Cross-Browser
**Goal**: The tool is deployed to Vercel as a static site and works reliably across all major browsers
**Depends on**: Phase 3
**Requirements**: DEP-01, DEP-02, DEP-03
**Success Criteria** (what must be TRUE):
  1. Site is deployed to Vercel and accessible via a public URL
  2. WASM binary is served with correct MIME type and immutable cache headers for instant return-visit loads
  3. Full compression flow (drop files, compress, download) works on Chrome, Firefox, Safari, and Edge (latest versions)
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Compression Engine | 3/3 | Complete | 2026-04-01 |
| 2. File Input and Progress UI | 1/2 | In Progress|  |
| 3. Results and Download | 0/0 | Not started | - |
| 4. Deployment and Cross-Browser | 0/0 | Not started | - |
