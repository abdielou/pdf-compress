---
phase: 01-compression-engine
plan: 01
subsystem: engine
tags: [vite8, wasm, web-worker, ghostscript, typescript, vitest]

# Dependency graph
requires: []
provides:
  - Vite 8 project scaffold with WASM-in-Worker support
  - Typed WorkerCommand/WorkerEvent discriminated union message protocol
  - Worker-client with createCompressionWorker and sendCommand
  - Ghostscript WASM initialization with print/printErr capture
  - Integration test proving init->ready round-trip works
affects: [01-02-PLAN, 01-03-PLAN]

# Tech tracking
tech-stack:
  added: [vite@8.0.3, vite-plugin-wasm@3.6.0, typescript@6.0.2, vitest@4.1.2, "@vitest/web-worker@4.1.2", "@jspawn/ghostscript-wasm@0.0.2", "@types/node"]
  patterns: [discriminated-union-messages, transferable-arraybuffer, eager-worker-start, instantiateWasm-node-workaround]

key-files:
  created:
    - package.json
    - vite.config.ts
    - vitest.config.ts
    - tsconfig.json
    - tsconfig.worker.json
    - index.html
    - src/main.ts
    - src/compression/types.ts
    - src/compression/worker-client.ts
    - src/worker/compression.worker.ts
    - src/worker/ghostscript.ts
    - src/types/ghostscript-wasm.d.ts
    - tests/worker-init.test.ts
  modified: []

key-decisions:
  - "Removed vite-plugin-top-level-await: incompatible with Vite 8 Rolldown internals (requires rollup module). Native top-level await in ES2022 target is sufficient."
  - "Custom instantiateWasm for Node/test: Emscripten WASM loader broken in Node 24 (fetch tries local paths, path.normalize mangles file:// URLs). Bypass with direct fs.readFileSync + WebAssembly.instantiate."
  - "Transferable test uses postMessage spy instead of real detachment: @vitest/web-worker simulates workers in same thread, does not implement real Transferable semantics."

patterns-established:
  - "Discriminated union message protocol: All worker messages typed via WorkerCommand/WorkerEvent unions narrowed on type field"
  - "Eager worker start: Worker spawned immediately on module load to begin WASM download in background"
  - "instantiateWasm workaround: Node test environments use custom WASM loader to bypass Emscripten path resolution bugs"

requirements-completed: [ENG-01, ENG-02, ENG-07]

# Metrics
duration: 9min
completed: 2026-04-01
---

# Phase 1 Plan 01: Vite 8 + WASM Worker Scaffold Summary

**Vite 8.0.3 project with Ghostscript WASM loading in Web Worker, typed discriminated union message protocol, and 4 passing integration tests**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-01T13:53:48Z
- **Completed:** 2026-04-01T14:03:10Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- Validated Vite 8 + vite-plugin-wasm compatibility (critical risk from research -- CONFIRMED WORKING)
- Ghostscript WASM (16MB) loads inside Web Worker and posts 'ready' event in under 100ms (test environment)
- Typed WorkerCommand/WorkerEvent protocol with compile-time message validation
- Transferable ArrayBuffer pattern wired through sendCommand API

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Vite 8 project with WASM plugin** - `6783997` (feat)
2. **Task 2 RED: Failing tests for protocol and worker init** - `a954ab5` (test)
3. **Task 2 GREEN: Implementation passing all tests** - `942077d` (feat)

## Files Created/Modified
- `package.json` - Project dependencies and scripts (vite, vitest, ghostscript-wasm)
- `vite.config.ts` - Vite 8 config with vite-plugin-wasm for main and worker plugins
- `vitest.config.ts` - Vitest config with WASM plugin support and 60s timeout
- `tsconfig.json` - Main thread TypeScript config (ES2022, DOM)
- `tsconfig.worker.json` - Worker TypeScript config (ES2022, WebWorker)
- `index.html` - Minimal Vite entry point
- `src/main.ts` - Entry: eager worker spawn, init command, ready listener
- `src/compression/types.ts` - WorkerCommand, WorkerEvent, CompressionTarget, CompressionResult
- `src/compression/worker-client.ts` - createCompressionWorker, sendCommand with Transferable
- `src/worker/compression.worker.ts` - Worker entry: handles init and compress commands
- `src/worker/ghostscript.ts` - WASM init with print/printErr capture and Node workaround
- `src/types/ghostscript-wasm.d.ts` - Type declarations for @jspawn/ghostscript-wasm
- `tests/worker-init.test.ts` - 4 integration tests (creation, init->ready, types, transferable)

## Decisions Made
- **Removed vite-plugin-top-level-await:** Plugin requires `rollup` as a dependency, but Vite 8 uses Rolldown internally and does not ship rollup. ES2022 build target provides native top-level await support in all modern browsers, making the plugin unnecessary.
- **Custom instantiateWasm for Node environments:** Emscripten's built-in WASM loader has two broken paths in Node 24: (1) `path.normalize()` mangles `file://` URLs, and (2) bare filesystem paths trigger `fetch()` which fails on local files. Solution: detect Node via `globalThis.process.versions.node` and provide `instantiateWasm` callback that uses `fs.readFileSync` + `WebAssembly.instantiate` directly.
- **Spy-based Transferable test:** `@vitest/web-worker` runs workers in the same thread without real `postMessage` transfer semantics. Test verifies the API contract (transfer list passed to postMessage) rather than actual buffer detachment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vite-plugin-top-level-await incompatible with Vite 8**
- **Found during:** Task 1 (Vite build validation)
- **Issue:** Plugin requires `rollup` module which Vite 8 does not include (uses Rolldown)
- **Fix:** Removed plugin from vite.config.ts and vitest.config.ts. ES2022 target provides native top-level await.
- **Files modified:** vite.config.ts, vitest.config.ts
- **Verification:** `npx vite build` succeeds
- **Committed in:** 6783997

**2. [Rule 3 - Blocking] Missing type declarations for @jspawn/ghostscript-wasm**
- **Found during:** Task 1 (TypeScript check)
- **Issue:** Package has no .d.ts files, causing TS7016
- **Fix:** Created src/types/ghostscript-wasm.d.ts with GsModule interface
- **Files modified:** src/types/ghostscript-wasm.d.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 6783997

**3. [Rule 1 - Bug] Emscripten WASM loader broken in Node 24 test environment**
- **Found during:** Task 2 (integration test)
- **Issue:** Emscripten's internal WASM loading tries fetch() on local paths in Node 24 (which has global fetch), failing with "fetch failed"
- **Fix:** Provide custom `instantiateWasm` callback in Node environments that reads WASM via fs.readFileSync
- **Files modified:** src/worker/ghostscript.ts
- **Verification:** Worker init test passes, WASM loads in <100ms
- **Committed in:** 942077d

**4. [Rule 3 - Blocking] @types/node needed for dynamic fs/url imports**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** Dynamic `import('fs')` and `import('url')` fail TypeScript without Node type definitions
- **Fix:** Installed @types/node, added "node" to tsconfig types
- **Files modified:** package.json, tsconfig.json
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 942077d

---

**Total deviations:** 4 auto-fixed (1 bug, 3 blocking)
**Impact on plan:** All fixes necessary for correctness. The vite-plugin-top-level-await removal and Emscripten Node workaround were anticipated risks from research. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Vite 8 + WASM-in-Worker foundation is solid and validated
- Typed message protocol ready for Plan 02 to add compression commands
- Worker shell has placeholder compress handler ready to be replaced with binary search engine
- Blocker resolved: Vite 8 + vite-plugin-wasm confirmed compatible (research LOW confidence now HIGH)

---
*Phase: 01-compression-engine*
*Completed: 2026-04-01*
