# Project Research Summary

**Project:** PDF Compress
**Domain:** Browser-based client-side PDF compression
**Researched:** 2026-03-31
**Confidence:** MEDIUM

## Executive Summary

PDF Compress is a single-purpose browser tool that compresses PDFs entirely on the client side using Ghostscript compiled to WebAssembly. The recommended technical approach is to run the Ghostscript WASM module inside a Web Worker (to keep the UI thread responsive), use a binary search over DPI values (30-300) to find the highest quality that fits a user-specified size or percentage target, and package results for download using fflate for ZIP generation. The entire stack is Vanilla TypeScript + Vite 8, with no framework — this is a one-page tool and React/Svelte would add overhead without benefit. Deployment is zero-config on Vercel as a static site.

The competitive opportunity is clear: every server-side incumbent (iLovePDF, SmallPDF) uploads files to their servers. Every existing client-side tool either has friction (daily limits, email gates) or lacks batch support and goal-oriented compression. This tool's differentiation is the combination of zero-friction privacy (unlimited, no account, no upload), batch processing, and a target-based compression model that no competitor in the client-side space has implemented well. Users say "make it under 4MB" — not "set quality to medium." That framing is the product.

The primary risks are in the WASM layer. The `@jspawn/ghostscript-wasm` package is a year old and has no bundled TypeScript types; it is recommended over the newer `@okathira/ghostpdl-wasm` because multiple open-source browser PDF compressors have proven it works in practice. More operationally dangerous: the binary search approach means 5-9 Ghostscript invocations per file, each taking 2-5 seconds on desktop — a batch of 10 files can run 2-4 minutes. Emscripten's linear memory also accumulates across `callMain()` invocations with no shrink path, making WASM module state management a critical implementation concern that must be addressed in Phase 1, not retrofitted later.

## Key Findings

### Recommended Stack

The stack is deliberately minimal: no framework, no state management library, no UI component system. TypeScript 5.8 (not 6.0 — too new), Vite 8 with Rolldown, `@jspawn/ghostscript-wasm` for the compression engine, fflate for ZIP generation, and the browser's native Web Worker API with direct `postMessage`. Two Vite plugins are required companions: `vite-plugin-wasm` for WASM ESM integration, and `vite-plugin-top-level-await` for Firefox/Safari support. Note that Vite 8 is only 19 days old as of the research date — the Rolldown-powered build chain should be tested immediately in Phase 1 since it's the least validated part of the stack.

**Core technologies:**
- TypeScript 5.8: type-safe application code — battle-tested with Vite ecosystem (6.0 too new)
- Vite 8: build tool and dev server — Rolldown-powered, native WASM support, zero-config Vercel deploy
- @jspawn/ghostscript-wasm 0.0.2: Ghostscript PDF compression engine — only viable client-side option with proven real-world usage
- Web Workers (native): off-main-thread WASM execution — prevents UI freeze during CPU-intensive compression
- fflate 0.8.2: ZIP generation for batch download — 8KB, fastest pure-JS ZIP, built-in worker support

### Expected Features

Research identified 9 table-stakes features (missing any causes users to leave) and 7 differentiating features. The critical path is: WASM loading (D7) enables compression (D1), which enables progress display (T5), which enables results (T3), which enables download (T4/D4). Everything depends on the WASM engine working first.

**Must have (table stakes):**
- Drag-and-drop upload with click-to-browse fallback — users expect this
- Before/after size display with savings percentage — proof the tool worked
- Per-file progress feedback with iteration indication — prevents "is it frozen?" abandonment
- Individual file download — obvious exit point
- Batch / multi-file processing — single-file-only is a dealbreaker for power users
- No account required — friction kills adoption
- Privacy messaging ("files never leave your browser") — the privacy advantage is invisible without it
- Mobile-responsive layout — many compression tasks happen on phones

**Should have (competitive differentiators):**
- Target-based compression (size or % mode) — the core product differentiator; no client-side competitor does this well
- Smart skip for files already under target — quality preservation; surface as positive outcome not failure
- ZIP download for batch results — most client-side tools are single-file only
- PWA / offline support — natural fit once WASM is cached

**Defer (v2+):**
- PWA / service worker caching — Medium effort, niche use case; implement after core loop is stable
- Dark mode — not a differentiator; add after launch

**Never build (anti-features):**
- Server-side processing, user accounts, daily limits, paywalls, email capture, analytics/tracking, cloud storage integration, advanced compression knobs (DPI sliders etc.)

### Architecture Approach

The architecture is a clean two-thread split: a main thread containing a UI module (DOM, drag-drop, progress, results) and a Compression Controller (queue management, result aggregation), communicating via typed `postMessage` with Transferable ArrayBuffers to a single Web Worker that runs the Ghostscript WASM binary search engine. Files are processed sequentially — not in parallel — because each WASM instance maintains global virtual filesystem state. Two TypeScript configs are required: one for the main thread (DOM lib), one for the worker (WebWorker lib) to prevent accidental cross-thread imports.

**Major components:**
1. UI Module (main thread) — DOM rendering, drag-drop handling, progress display, download triggers
2. Compression Controller (main thread) — file queue, worker lifecycle, result aggregation, ZIP packaging
3. Worker Message Router (worker thread) — receives typed commands, dispatches to engine, relays progress
4. Compression Engine (worker thread) — binary search loop, Ghostscript argument construction, size evaluation
5. WASM Module wrapper (worker thread) — Ghostscript initialization, Emscripten virtual FS, callMain abstraction

The `compression/types.ts` file containing the typed `WorkerCommand` and `WorkerEvent` discriminated unions is the contract between threads. Nothing in `worker/` may import from `ui/` and vice versa.

### Critical Pitfalls

1. **WASM module state leaks between callMain() invocations** — Ghostscript's Emscripten module accumulates virtual FS state and linear memory across calls. For a 10-file batch at 8 iterations each = 80 `callMain()` invocations with no cleanup. Mitigation: always `FS.unlink()` input and output files after every call; consider re-instantiating the module between files as a safety valve. Must address in Phase 1 worker design.

2. **Mobile browser memory limits crash the tab** — iOS Safari kills tabs when WASM memory exceeds ~256-300MB. Ghostscript WASM initializes with large linear memory (Emscripten default is 2GB maximum, which iOS immediately rejects). Mitigation: verify `@jspawn/ghostscript-wasm`'s compiled memory configuration; enforce file size limits (50MB mobile, 200MB desktop); wrap WASM instantiation in try-catch to surface readable errors. Phase 1 requirement.

3. **Binary search is 5-8x slower than single-pass** — Each file requires 5-9 Ghostscript invocations. A 5-file batch can take 2-4 minutes on desktop. Without rich progress feedback, users assume the tool froze. Mitigation: per-file progress showing attempt number and current size estimate; educated first-guess DPI from input/target ratio to save 1-2 iterations; for percentage mode, consider single-pass approximation.

4. **WASM loading blocks first interaction** — The 10MB binary download takes time. If the user drops files before the worker is ready, the experience breaks. Mitigation: start WASM download immediately on page load via background fetch; show a non-intrusive "Preparing engine..." indicator; queue dropped files if WASM is not ready yet; serve WASM with `Cache-Control: immutable` so returning users get instant load.

5. **ZIP memory doubles total batch memory** — JSZip holds the entire ZIP in memory before generating the download. 10 files × 4MB = 40MB of PDFs plus ZIP output plus original Blobs. Mitigation: use fflate's `ZipPassThrough` mode (store without recompressing already-compressed PDFs) and stream the ZIP; revoke all Blob URLs on cleanup.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and WASM Engine

**Rationale:** The compression engine is the critical dependency for everything else. Features.md's critical path is explicit: D7 (WASM loading) must come before D1 (compression), which must come before all UI features. Two of the four critical pitfalls (WASM state leaks, mobile memory limits) require architectural decisions that cannot be retrofitted — they must be built correctly the first time. The Vite 8 + vite-plugin-wasm integration is also the highest-risk unknown and needs early validation.

**Delivers:** Working compression pipeline from file input to compressed output in a Web Worker, with typed message protocol, binary search over DPI, transferable ArrayBuffer data flow, FS cleanup, and basic memory guard rails.

**Addresses features:** D7 (lazy WASM load), D1 (target-based binary search compression), D2 (smart skip), T7 (no account required — architectural)

**Avoids pitfalls:** P1 (WASM state leaks), P2 (mobile memory limits), Debt 1 (WASM base64 inlining), Debt 2 (non-transferable buffers), Trap 2 (Emscripten FS double-copy), Trap 3 (WASM blocks first interaction)

### Phase 2: File Input and Progress UI

**Rationale:** Once the compression pipeline is verified end-to-end, build the user-facing input and feedback layer. Drag-and-drop has documented browser quirks (dragenter/dragleave child element flicker, mobile incompatibility) that are isolated concerns. Progress UI design is determined by the binary search iteration protocol established in Phase 1.

**Delivers:** Drop zone with drag-and-drop and click-to-browse fallback; per-file progress display showing attempt number and current size; queue visualization for batch uploads; privacy messaging badge.

**Addresses features:** T1 (drag-and-drop), T5 (progress), T6 (batch upload), T9 (privacy messaging), T8 (mobile file picker fallback)

**Avoids pitfalls:** UX Pitfall 1 (no binary search feedback), UX Pitfall 4 (drop zone event flicker), Security Mistake 1 (file validation — magic bytes check here), Anti-Pattern 1 (reading all files into memory upfront)

### Phase 3: Results, Download, and Error Handling

**Rationale:** Results display and download are the exit point of the user flow — they complete the core loop but depend on Phase 1 (compression results) and Phase 2 (file processing queue). This phase also hardens edge cases: compressions that make files larger, text-only PDFs, corrupt input files, and worker termination on restart.

**Delivers:** Results table with before/after sizes and savings percentage; individual file download buttons; "Download All" ZIP via fflate; "already fits" positive outcome display; output-larger-than-input fallback to original; Blob URL revocation; worker restart/termination flow.

**Addresses features:** T3 (before/after display), T4 (individual download), D4 (ZIP download), D2 (smart skip UX)

**Avoids pitfalls:** UX Pitfall 2 (already fits feels like failure), UX Pitfall 3 (compression makes file larger), Trap 1 (ZIP memory doubling), Security Mistake 2 (blob URL revocation), Debt 3 (no worker termination strategy)

### Phase 4: Polish, Mobile, and Deployment

**Rationale:** Cross-browser and mobile concerns are best addressed after the core loop is stable, because they involve test-and-fix cycles rather than net-new architecture. Vercel deployment and COOP/COEP header configuration are also final-step concerns, though SharedArrayBuffer headers must be validated before claiming the product is done.

**Delivers:** Mobile-responsive layout; verified iOS Safari WASM behavior with file size limits; Vercel deployment with correct WASM MIME type and immutable caching; COOP/COEP header assessment (needed only if SharedArrayBuffer required); cross-browser test pass (Chrome, Firefox, Safari).

**Addresses features:** T8 (mobile responsive), D6 (open source repo with README and license)

**Avoids pitfalls:** P3 (SharedArrayBuffer/cross-origin isolation), Phase warning (WASM MIME type on Vercel), Phase warning (cross-browser Firefox/Safari), P2 (mobile Safari memory — final validation)

### Phase 5: Progressive Enhancement (Post-Launch)

**Rationale:** PWA/offline support and dark mode are not essential for launch and have no upstream dependencies that would be affected by deferral. PWA requires the core WASM caching strategy (established in Phase 1) but adds a service worker layer cleanly on top.

**Delivers:** Service worker with WASM pre-caching for offline use; dark mode via CSS custom properties; any post-launch UX improvements based on user feedback.

**Addresses features:** D5 (PWA offline), dark mode

### Phase Ordering Rationale

- Architecture research is explicit that the WASM engine is the foundation — nothing else works without it, and two critical pitfalls require correct design from the start rather than refactoring.
- The build order from ARCHITECTURE.md (types -> worker core -> main thread core -> UI -> integration) directly maps to Phases 1-3.
- Sequential file processing (not parallel) is an architectural constraint from PITFALLS.md that makes Phase 2 and 3 simpler — no concurrency issues in the UI or results layer.
- Mobile and deployment concerns are isolated enough (Phase 4) that deferring them does not block the core loop, but they must be done before claiming a production-ready product.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 1:** Vite 8 + vite-plugin-wasm integration is the highest-risk unknown. Vite 8 (Rolldown) was released 19 days before research date. Plugin compatibility is LOW confidence. Needs immediate empirical validation in a scratch project before committing to the architecture. Also: verify `@jspawn/ghostscript-wasm` memory configuration (`MAXIMUM_MEMORY`) since this directly affects mobile viability.
- **Phase 4:** Vercel WASM serving and COOP/COEP header behavior need direct testing. Dev environment behavior diverges from production (documented pitfall). Test production build with `vite preview` and a real Vercel preview deploy before marking Phase 4 complete.

Phases with standard patterns (skip additional research-phase):

- **Phase 2:** Drag-and-drop and file input are well-documented Web APIs. The counter-based dragenter/dragleave pattern is standard. No additional research needed.
- **Phase 3:** fflate ZIP API is simple and well-documented. Results table is straightforward DOM manipulation. Standard patterns apply.
- **Phase 5:** Service worker caching patterns for PWA are mature and well-documented. No research needed if Phase 1 established correct WASM asset serving.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core choices (Vite, TypeScript, Web Workers, fflate) are HIGH confidence. @jspawn/ghostscript-wasm is MEDIUM — proven in practice but last updated 1 year ago; Vite 8 + vite-plugin-wasm compatibility is LOW — too new to have community validation. |
| Features | HIGH | Competitor landscape is well-documented. Table stakes are consistent across all tools. Differentiators are clearly identified. Anti-features are explicit. MVP scope is credible. |
| Architecture | HIGH | Patterns (single worker, sequential processing, Transferable ArrayBuffers, discriminated union message protocol, two tsconfig files) are well-reasoned and supported by reference implementations. Binary search DPI range and convergence math is sound. |
| Pitfalls | HIGH | Critical pitfalls are grounded in documented browser behavior (iOS Safari WASM memory, Emscripten linear memory growth, SharedArrayBuffer browser requirements). Performance pitfall (binary search speed) is empirically validated by the shell script prototype. |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Vite 8 / vite-plugin-wasm compatibility:** STACK.md explicitly flags this as LOW confidence. Validate in Phase 1 with a minimal integration test (load the WASM module in a Vite 8 worker build, verify it works in Chrome, Firefox, Safari). Have the fallback ready: Vite's native `.wasm?init` syntax if the plugin fails.
- **@jspawn/ghostscript-wasm memory configuration:** The package's compiled `MAXIMUM_MEMORY` is unknown. If it defaults to Emscripten's 2GB, iOS Safari will refuse to instantiate it. Must check the compiled binary or source before declaring mobile support viable.
- **Binary search performance on real PDFs:** PITFALLS.md notes each Ghostscript invocation takes 2-5 seconds. The exact time is highly file-dependent. Budget for a UX iteration after Phase 1 where real-world PDF timing may require revisiting the progress feedback design.
- **Ghostscript stderr capture:** PITFALLS.md notes `callMain()` can fail silently or return non-zero. The mechanism for capturing stderr (overriding Emscripten `print`/`printErr` at module init) needs to be implemented from the start, not added as an afterthought when debugging production issues.

## Sources

### Primary (HIGH confidence)
- [Ghostscript pdfwrite Vector Devices](https://ghostscript.com/docs/9.54.0/VectorDevices.htm) — dPDFSETTINGS, image resolution parameters
- [Ghostscript Optimizing PDFs](https://ghostscript.com/blog/optimizing-pdfs.html) — official compression guidance
- [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) — zero-copy ArrayBuffer transfer
- [MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) — COOP/COEP requirements
- [Emscripten File System Overview](https://emscripten.org/docs/porting/files/file_systems_overview.html) — MEMFS behavior and limitations

### Secondary (MEDIUM confidence)
- [@jspawn/ghostscript-wasm npm](https://www.npmjs.com/package/@jspawn/ghostscript-wasm) — package details and API
- [ghostscript-wasm DeepWiki](https://deepwiki.com/jsscheller/ghostscript-wasm/2.2-basic-usage) — Module init, FS, callMain patterns
- [laurentmmeyer/ghostscript-pdf-compress.wasm](https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm) — reference Web Worker implementation
- [krmanik/local-pdf-tools](https://github.com/krmanik/local-pdf-tools) — full-featured browser PDF tool using GS WASM
- [oaustegard gist: Client-Side PDF Compressor](https://gist.github.com/oaustegard/2bc7a7537626882aac03db985a0774d2) — single-file reference implementation
- [vite-plugin-wasm GitHub](https://github.com/Menci/vite-plugin-wasm) — plugin supporting Vite 2-8
- [Vite 8.0 announcement](https://vite.dev/blog/announcing-vite8) — Rolldown integration
- [fflate GitHub](https://github.com/101arrowz/fflate) — compression library
- [iOS Safari WASM memory issues](https://github.com/emscripten-core/emscripten/issues/19374) — mobile memory limits
- [iLovePDF](https://www.ilovepdf.com/compress_pdf), [SmallPDF](https://smallpdf.com/compress-pdf), [PDF24](https://tools.pdf24.org/en/compress-pdf), [SaferPDF](https://www.saferpdf.com/), [DownsizePDF](https://downsizepdf.com/) — competitive landscape

### Tertiary (LOW confidence)
- [@okathira/ghostpdl-wasm npm](https://www.npmjs.com/package/@okathira/ghostpdl-wasm) — alternative GS WASM package; zero community validation; listed as fallback option only
- Vite 8 + vite-plugin-wasm compatibility — inferred from plugin changelog; needs empirical validation

---
*Research completed: 2026-03-31*
*Ready for roadmap: yes*
