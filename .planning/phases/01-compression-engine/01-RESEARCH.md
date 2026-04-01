# Phase 1: Compression Engine - Research

**Researched:** 2026-04-01
**Domain:** Browser-based PDF compression via Ghostscript WASM in Web Worker
**Confidence:** MEDIUM

## Summary

Phase 1 delivers the core compression pipeline: Ghostscript WASM running inside a Web Worker, a binary search algorithm over DPI values to find optimal quality for a target size or percentage, Transferable ArrayBuffer communication, and Emscripten FS cleanup between operations. This is a greenfield project -- no source code exists yet, only a working shell script prototype (`compress.sh`) that validates the binary search approach with native Ghostscript.

The primary technical risk is Vite 8 + vite-plugin-wasm compatibility. Vite 8 shipped 2026-03-12 and uses Rolldown internally. The plugin claims Vite 2-8 support but this has minimal community validation. This must be validated in the first task before building anything else. The secondary risk is `@jspawn/ghostscript-wasm`'s memory configuration -- the compiled `MAXIMUM_MEMORY` is unknown, which affects iOS Safari viability (tabs crash above ~256MB WASM memory).

The existing shell script proves the algorithm works: binary search on DPI 50-300 with a convergence threshold of 5 DPI. The WASM port must replicate this logic, adding Transferable ArrayBuffer transfer, typed message protocol, and FS cleanup that the shell script handles implicitly via process isolation.

**Primary recommendation:** Start with Vite 8 + WASM plugin validation in a minimal scratch setup, then build the worker-side compression engine (Ghostscript wrapper + binary search), then wire up the main-thread controller with typed messages.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENG-01 | WASM binary loads in a Web Worker without blocking UI render | WASM Loading Strategy section; Worker creation pattern via `new Worker(new URL(...))` with `{ type: 'module' }` |
| ENG-02 | WASM binary begins downloading immediately on page load (background preload) | Architecture Pattern 4 (Lazy WASM with Eager Start); worker spawned on page load, sends `init` command |
| ENG-03 | Binary search on DPI (30-300) finds highest quality under target size | Binary Search Algorithm section; validated by compress.sh prototype; ~9 iterations for convergence |
| ENG-04 | Binary search on DPI finds highest quality for target % reduction | Same algorithm with `targetBytes = originalSize * (1 - pct/100)` transform |
| ENG-05 | Files already under target size are skipped (not recompressed) | Pre-check before sending to worker; `file-skipped` message type in protocol |
| ENG-06 | Emscripten virtual filesystem cleaned between files | FS Cleanup Strategy section; `FS.unlink()` after every `callMain()`; optional module re-init between files |
| ENG-07 | PDF bytes transferred to/from worker using Transferable objects (zero-copy) | Transfer Pattern section; `postMessage(data, [buffer])` syntax |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~5.8 | Type-safe application code | Battle-tested with Vite; TS 6.0 too new (8 days old at research time) |
| Vite | ^8.0.3 | Build tool, dev server, WASM bundling | Rolldown-powered, native `.wasm?init` support, zero-config Vercel deploy |
| @jspawn/ghostscript-wasm | ^0.0.2 | Ghostscript PDF compression engine (WASM) | Only viable client-side option; proven in multiple browser PDF compressors |
| Web Workers (native) | N/A | Off-main-thread WASM execution | Built-in browser API; prevents UI freezing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vite-plugin-wasm | ^3.4 | WASM ESM integration for Vite | Required for importing WASM modules as ES modules in workers |
| vite-plugin-top-level-await | ^1.6.0 | Top-level await polyfill | Required companion to vite-plugin-wasm for Firefox/Safari support |
| vitest | ^3.x | Unit testing | Testing compression logic, binary search, message protocol |
| @vitest/web-worker | ^3.x | Web Worker simulation in tests | Simulates workers in same thread for unit tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @jspawn/ghostscript-wasm | @okathira/ghostpdl-wasm | Better TypeScript types but zero community validation; fallback if @jspawn breaks |
| vite-plugin-wasm | Vite native `.wasm?init` | Manual loading required; use as fallback if plugin breaks on Vite 8 |
| vitest | jest | Vitest is Vite-native, faster, shares config; jest has poor WASM support |

**Installation:**
```bash
# Core
npm install @jspawn/ghostscript-wasm

# Dev dependencies
npm install -D typescript vite vite-plugin-wasm vite-plugin-top-level-await vitest @vitest/web-worker
```

## Architecture Patterns

### Project Structure (Phase 1 scope)
```
pdf-compress/
  index.html                    # Minimal entry point (Vite serves from root)
  vite.config.ts                # Vite config with WASM + worker plugins
  tsconfig.json                 # Main thread config (lib: ["ES2022", "DOM"])
  tsconfig.worker.json          # Worker config (lib: ["ES2022", "WebWorker"])
  package.json
  src/
    main.ts                     # Entry: spawn worker, expose compress API
    compression/
      controller.ts             # Orchestrates: queue files, talk to worker, collect results
      worker-client.ts          # Typed postMessage wrapper (main-thread side)
      types.ts                  # Shared WorkerCommand/WorkerEvent discriminated unions
    worker/
      compression.worker.ts     # Worker entry: message router
      engine.ts                 # Binary search loop, GS argument builder
      ghostscript.ts            # WASM init, FS operations, callMain wrapper
    types/
      index.ts                  # App-wide types (CompressionTarget, CompressionResult)
  tests/
    engine.test.ts              # Binary search logic tests (mocked GS)
    ghostscript.test.ts         # WASM integration tests
    controller.test.ts          # Controller logic tests
    worker-protocol.test.ts     # Message protocol tests
```

### Pattern 1: Typed Discriminated Union Message Protocol
**What:** All worker messages use TypeScript discriminated unions narrowed on `type` field.
**When to use:** Every `postMessage` between main thread and worker.
**Example:**
```typescript
// compression/types.ts
export type CompressionTarget =
  | { mode: 'size'; maxBytes: number }
  | { mode: 'percentage'; reductionPct: number }

// Main --> Worker
export type WorkerCommand =
  | { type: 'init' }
  | { type: 'compress'; fileIndex: number; fileName: string;
      buffer: ArrayBuffer; target: CompressionTarget }

// Worker --> Main
export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'progress'; fileIndex: number; iteration: number;
      totalEstimated: number; currentDpi: number; currentSize: number }
  | { type: 'file-done'; fileIndex: number; compressedSize: number;
      buffer: ArrayBuffer }
  | { type: 'file-skipped'; fileIndex: number; reason: 'already-fits' }
  | { type: 'file-error'; fileIndex: number; error: string }
```

### Pattern 2: Transfer, Don't Clone
**What:** Always pass ArrayBuffers in the transfer list of `postMessage`.
**When to use:** Every file data transfer between main thread and worker.
**Example:**
```typescript
// Sending TO worker (main thread)
worker.postMessage(command, [command.buffer])

// Sending FROM worker (worker thread)
self.postMessage(event, [event.buffer])
```
The source buffer becomes detached (zero-length) after transfer. This is intentional -- the sender no longer needs it.

### Pattern 3: Emscripten print/printErr Capture
**What:** Override Emscripten's `print` and `printErr` callbacks during Module init to capture Ghostscript stdout/stderr.
**When to use:** Module initialization in `worker/ghostscript.ts`.
**Example:**
```typescript
// worker/ghostscript.ts
const stderrLines: string[] = []

const gs = await Module({
  print: (text: string) => { /* optional: capture stdout */ },
  printErr: (text: string) => { stderrLines.push(text) },
  locateFile: (file: string) => {
    return new URL(
      `../node_modules/@jspawn/ghostscript-wasm/${file}`,
      import.meta.url
    ).href
  }
})
```
This captures Ghostscript errors that would otherwise be lost. Check `stderrLines` after `callMain()` returns non-zero.

### Pattern 4: Lazy WASM with Eager Worker Start
**What:** Spawn the worker immediately on page load. Worker downloads and compiles WASM in background.
**When to use:** App initialization in `main.ts`.
**Why:** The ~10MB WASM download is hidden behind user interaction time (reading UI, selecting files).

### Pattern 5: Binary Search with Early Exit
**What:** Before entering binary search, try 300 DPI first. If it fits, skip search entirely. This mirrors the shell script's optimization.
**When to use:** Every compression operation in `engine.ts`.
**Why:** Many files fit at max quality. The 300 DPI check avoids 8 unnecessary iterations.

### Anti-Patterns to Avoid
- **Using `dPDFSETTINGS` presets for search:** Only 4 levels vs. 270 DPI values. Far too coarse.
- **Reading all files into memory upfront:** Read one at a time via `file.arrayBuffer()` just before sending to worker.
- **Parallel worker instances:** Each loads ~10MB WASM. Single worker, sequential files.
- **`SharedArrayBuffer` for file transfer:** Requires COOP/COEP headers that complicate deployment. Transferable is sufficient.
- **`worker.format: "es"` in Vite config:** Breaks Firefox. Use default worker format.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF compression | Custom image extraction + recompression | Ghostscript WASM `callMain()` | Ghostscript handles hundreds of PDF edge cases (fonts, color spaces, encryption) |
| WASM ESM loading | Manual `fetch` + `WebAssembly.instantiate` | vite-plugin-wasm | Handles dev/build differences, worker contexts, content types |
| Worker message typing | String-based message parsing | Discriminated union types | Compiler catches unhandled messages; auto-narrows in switch |
| Top-level await compat | Manual async IIFE wrappers | vite-plugin-top-level-await | Handles Firefox/Safari without forcing `target: esnext` |

## Common Pitfalls

### Pitfall 1: Emscripten FS State Leaks Between callMain() Invocations
**What goes wrong:** Ghostscript maintains internal state across `callMain()` calls. Leftover files in Emscripten virtual FS consume WASM heap memory (which cannot shrink). After 80+ invocations (10 files x 8 iterations), the module may crash or produce corrupted output.
**Why it happens:** Native Ghostscript expects fresh process per invocation. WASM port persists everything.
**How to avoid:** `FS.unlink()` input AND output files after every `callMain()` in a `finally` block. Consider module re-instantiation between files (not between search iterations).
**Warning signs:** Second file in batch compresses differently than when processed alone. Memory climbs steadily in DevTools.

### Pitfall 2: Vite 8 + vite-plugin-wasm Compatibility Unknown
**What goes wrong:** Vite 8 replaced its internal bundler with Rolldown (19 days old at research date). Plugin API may have subtle differences. WASM loading in workers could break silently in production builds.
**Why it happens:** New toolchain with minimal community validation.
**How to avoid:** First task of Phase 1 must be a minimal Vite 8 project that loads WASM in a worker. Test both dev and production build (`vite build && vite preview`). Have fallback ready: Vite native `.wasm?init` syntax.
**Warning signs:** Dev works fine, `vite build` fails or produces broken output.

### Pitfall 3: callMain() Fails Silently
**What goes wrong:** Ghostscript returns non-zero exit code but no exception is thrown. Output file may not be created. Code reads undefined bytes from FS.
**Why it happens:** `callMain()` returns an exit status number, not a thrown error. Emscripten does not throw on non-zero exit.
**How to avoid:** Always check the return value of `callMain()`. Override `printErr` to capture stderr. Verify output file exists with `FS.stat()` before `FS.readFile()`.
**Warning signs:** Zero-byte output files. "Compressed" file is actually empty or corrupted.

### Pitfall 4: locateFile Path Differs Between Dev and Production
**What goes wrong:** In dev, Vite serves WASM from `node_modules`. In production, the file is hashed and placed in `dist/assets/`. The `locateFile` callback receives just the filename (e.g., `gs.wasm`), and if it returns a wrong path, WASM fails to load.
**Why it happens:** Vite's asset pipeline moves and renames files during build.
**How to avoid:** Use `vite-plugin-wasm` which handles this automatically. If using manual loading, test with `vite preview` (production build) not just `vite dev`.

### Pitfall 5: Binary Search Infinite Loop on Unreachable Target
**What goes wrong:** If even 30 DPI produces output larger than target, the binary search never finds a valid result. Or if the file is text-only and DPI has no effect on size.
**Why it happens:** Not all PDFs respond to DPI reduction. Text-heavy PDFs have minimal image content.
**How to avoid:** Set max iterations (10). If `lo > hi` with no valid result, return the best attempt with a warning. Check if output is larger than input even at minimum DPI -- if so, return original.

### Pitfall 6: WASM Inlined as Base64 by Vite
**What goes wrong:** Vite's default `assetsInlineLimit` (4KB) won't affect the main WASM binary (~15MB), but auxiliary data files might be inlined, increasing bundle size by 33%.
**How to avoid:** Set `build.assetsInlineLimit: 0` in vite.config.ts. Use `vite-plugin-wasm` for proper WASM handling.

## Code Examples

### Vite Configuration (Verified: vite-plugin-wasm GitHub)
```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
  },
  optimizeDeps: {
    exclude: ['@jspawn/ghostscript-wasm'],
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
})
```

### WASM Module Initialization (Verified: DeepWiki + oaustegard gist)
```typescript
// worker/ghostscript.ts
import Module from '@jspawn/ghostscript-wasm'

let gs: Awaited<ReturnType<typeof Module>> | null = null
const stderrBuffer: string[] = []

export async function initGhostscript(): Promise<void> {
  stderrBuffer.length = 0
  gs = await Module({
    print: () => {},
    printErr: (text: string) => stderrBuffer.push(text),
    locateFile: (file: string) =>
      new URL(`../node_modules/@jspawn/ghostscript-wasm/${file}`, import.meta.url).href,
  })
}

export function getGs() {
  if (!gs) throw new Error('Ghostscript not initialized')
  return gs
}

export function getStderr(): string {
  return stderrBuffer.join('\n')
}
```

### Ghostscript Compression Call (Verified: compress.sh prototype + DeepWiki API)
```typescript
// worker/engine.ts - single compression pass at given DPI
function compressAtDpi(gs: GsModule, dpi: number): { bytes: Uint8Array; size: number } | null {
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-dNOPAUSE', '-dBATCH', '-dQUIET',
    '-dAutoRotatePages=/None',
    '-dDownsampleColorImages=true',
    '-dDownsampleGrayImages=true',
    '-dDownsampleMonoImages=true',
    '-dColorImageDownsampleType=/Bicubic',
    `-dColorImageResolution=${dpi}`,
    '-dColorImageDownsampleThreshold=1.0',
    '-dGrayImageDownsampleType=/Bicubic',
    `-dGrayImageResolution=${dpi}`,
    '-dGrayImageDownsampleThreshold=1.0',
    '-dMonoImageDownsampleType=/Bicubic',
    `-dMonoImageResolution=${dpi}`,
    '-dMonoImageDownsampleThreshold=1.0',
    '-sOutputFile=/output.pdf',
    '/input.pdf',
  ]

  const exitCode = gs.callMain(args)
  if (exitCode !== 0) return null

  try {
    const output = gs.FS.readFile('/output.pdf')
    return { bytes: output, size: output.length }
  } finally {
    try { gs.FS.unlink('/output.pdf') } catch {}
  }
}
```

### Binary Search Loop (Derived from compress.sh + architecture research)
```typescript
// worker/engine.ts
export function binarySearchCompress(
  gs: GsModule,
  inputBytes: Uint8Array,
  targetBytes: number,
  onProgress: (iteration: number, dpi: number, size: number) => void,
): Uint8Array | null {
  gs.FS.writeFile('/input.pdf', inputBytes)

  try {
    // Early exit: try max quality first (mirrors compress.sh optimization)
    const maxResult = compressAtDpi(gs, 300)
    onProgress(1, 300, maxResult?.size ?? 0)
    if (maxResult && maxResult.size <= targetBytes) {
      return maxResult.bytes
    }

    let lo = 30
    let hi = 300
    let bestResult: Uint8Array | null = null
    let iteration = 2

    while (lo <= hi && iteration <= 10) {
      const mid = Math.floor((lo + hi) / 2)
      const result = compressAtDpi(gs, mid)
      const size = result?.size ?? Infinity

      onProgress(iteration, mid, size)
      iteration++

      if (size <= targetBytes) {
        bestResult = result!.bytes
        lo = mid + 1  // Try higher quality
      } else {
        hi = mid - 1  // Try lower quality
      }
    }

    return bestResult
  } finally {
    try { gs.FS.unlink('/input.pdf') } catch {}
  }
}
```

### Worker Entry Point (Derived from architecture research)
```typescript
// worker/compression.worker.ts
import type { WorkerCommand, WorkerEvent } from '../compression/types'
import { initGhostscript, getGs } from './ghostscript'
import { binarySearchCompress } from './engine'

function post(event: WorkerEvent, transfer?: Transferable[]) {
  self.postMessage(event, { transfer })
}

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data

  switch (cmd.type) {
    case 'init': {
      await initGhostscript()
      post({ type: 'ready' })
      break
    }
    case 'compress': {
      const input = new Uint8Array(cmd.buffer)
      const targetBytes = cmd.target.mode === 'size'
        ? cmd.target.maxBytes
        : Math.floor(input.length * (1 - cmd.target.reductionPct / 100))

      const result = binarySearchCompress(getGs(), input, targetBytes,
        (iteration, dpi, size) => {
          post({
            type: 'progress', fileIndex: cmd.fileIndex,
            iteration, totalEstimated: 10, currentDpi: dpi, currentSize: size,
          })
        })

      if (result) {
        const buffer = result.buffer as ArrayBuffer
        post({
          type: 'file-done', fileIndex: cmd.fileIndex,
          compressedSize: result.length, buffer,
        }, [buffer])
      } else {
        post({
          type: 'file-error', fileIndex: cmd.fileIndex,
          error: 'Could not compress to target size',
        })
      }
      break
    }
  }
}
```

### Worker Creation (Main Thread)
```typescript
// compression/worker-client.ts
import type { WorkerCommand, WorkerEvent } from './types'

export function createCompressionWorker(): Worker {
  return new Worker(
    new URL('../worker/compression.worker.ts', import.meta.url),
    { type: 'module' }
  )
}

export function sendCommand(worker: Worker, cmd: WorkerCommand, transfer?: Transferable[]) {
  worker.postMessage(cmd, { transfer })
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dPDFSETTINGS` presets (/screen, /ebook, /printer) | Explicit DPI binary search (30-300) | Project design | 270 quality levels vs 4; much finer control |
| JSZip for ZIP generation | fflate with ZipPassThrough | 2022+ | 8KB vs 45KB; no double-compression of already-compressed PDFs |
| Comlink for worker communication | Direct typed postMessage | Current best practice | Removes unnecessary abstraction for single-worker setup |
| Vite 7 with esbuild | Vite 8 with Rolldown | 2026-03-12 | 10-30x faster builds; but LOW confidence on plugin compat |

## Open Questions

1. **@jspawn/ghostscript-wasm compiled MAXIMUM_MEMORY**
   - What we know: Emscripten default is 2GB. iOS Safari crashes above ~256MB.
   - What's unclear: What maximum the pre-built WASM binary was compiled with.
   - Recommendation: Inspect the WASM binary headers or test on iOS Safari early. If it crashes, `@okathira/ghostpdl-wasm` or a custom build may be needed.

2. **Module re-instantiation cost**
   - What we know: Re-creating the Module between files guarantees clean state. Emscripten linear memory cannot shrink.
   - What's unclear: How long re-instantiation takes (the WASM binary is already cached, but compilation cost may still be 1-2s).
   - Recommendation: Implement FS cleanup first. Add re-instantiation as a safety valve if state leaks are observed. Benchmark both approaches.

3. **callMain() synchronous behavior in worker**
   - What we know: `callMain()` blocks the worker thread. The DeepWiki docs show it returns a number (exit status).
   - What's unclear: Whether it's truly synchronous or returns a Promise. The DeepWiki docs use `await mod.callMain()`.
   - Recommendation: Test empirically. If async, the binary search loop needs `await` on each iteration.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | vitest.config.ts (needs creation -- Wave 0) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENG-01 | WASM loads in Worker without blocking main thread | integration | `npx vitest run tests/worker-init.test.ts -x` | No -- Wave 0 |
| ENG-02 | WASM begins downloading on page load | smoke | Manual -- verify worker spawns in main.ts | N/A (manual) |
| ENG-03 | Binary search finds highest DPI under target size | unit | `npx vitest run tests/engine.test.ts -x` | No -- Wave 0 |
| ENG-04 | Binary search finds highest DPI for % reduction | unit | `npx vitest run tests/engine.test.ts -x` | No -- Wave 0 |
| ENG-05 | Files under target skipped | unit | `npx vitest run tests/controller.test.ts -x` | No -- Wave 0 |
| ENG-06 | Emscripten FS cleaned between files | integration | `npx vitest run tests/ghostscript.test.ts -x` | No -- Wave 0 |
| ENG-07 | Transferable objects used for postMessage | unit | `npx vitest run tests/worker-protocol.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- Vitest config with vite-plugin-wasm, worker support
- [ ] `tests/engine.test.ts` -- binary search logic with mocked GS module
- [ ] `tests/controller.test.ts` -- controller skip logic, queue management
- [ ] `tests/worker-protocol.test.ts` -- message type validation, transferable usage
- [ ] `tests/ghostscript.test.ts` -- WASM integration (requires actual module)
- [ ] `tests/worker-init.test.ts` -- worker spawns and reports ready
- [ ] Framework install: `npm install -D vitest @vitest/web-worker`

**Note:** WASM integration tests (ENG-01, ENG-06) require the actual `@jspawn/ghostscript-wasm` binary. These are heavier tests that may need a longer timeout (30-60s). Unit tests for binary search logic (ENG-03, ENG-04) can use a mocked Ghostscript module that returns predictable sizes for given DPI values.

## Sources

### Primary (HIGH confidence)
- [DeepWiki: ghostscript-wasm Basic Usage](https://deepwiki.com/jsscheller/ghostscript-wasm/2.2-basic-usage) -- Module init, callMain, FS API
- [vite-plugin-wasm GitHub](https://github.com/Menci/vite-plugin-wasm) -- Confirmed Vite 2-8 support, worker.plugins config
- [Ghostscript pdfwrite Vector Devices](https://ghostscript.com/docs/9.54.0/VectorDevices.htm) -- DPI parameters, downsampling options
- [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) -- Zero-copy transfer
- [Emscripten File System Overview](https://emscripten.org/docs/porting/files/file_systems_overview.html) -- MEMFS behavior
- compress.sh (local prototype) -- Validates binary search on DPI 50-300 with convergence threshold

### Secondary (MEDIUM confidence)
- [oaustegard gist: Client-Side PDF Compressor](https://gist.github.com/oaustegard/2bc7a7537626882aac03db985a0774d2) -- Module init with locateFile via jsDelivr CDN
- [laurentmmeyer: Playing around with WASM and Ghostscript](https://meyer-laurent.com/playing-around-webassembly-and-ghostscript) -- print/printErr capture pattern, preRun/postRun hooks
- [Emscripten wasmMemory cleanup issue #15813](https://github.com/emscripten-core/emscripten/issues/15813) -- WASM memory cannot be freed without module recreation
- [Vitest WASM discussion #4283](https://github.com/vitest-dev/vitest/discussions/4283) -- Known WASM testing challenges in Vitest
- [@vitest/web-worker npm](https://www.npmjs.com/package/@vitest/web-worker) -- Worker simulation for tests

### Tertiary (LOW confidence)
- Vite 8 + vite-plugin-wasm actual compatibility -- plugin claims support but Vite 8 is 19 days old; needs empirical validation
- @jspawn/ghostscript-wasm compiled MAXIMUM_MEMORY -- unknown; affects mobile viability
- callMain() sync vs async behavior -- DeepWiki shows `await` but may be returning a sync number wrapped in a resolved Promise

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM -- core tools are HIGH confidence; Vite 8 plugin compat is LOW
- Architecture: HIGH -- patterns validated by multiple reference implementations and working shell script
- Pitfalls: HIGH -- grounded in documented Emscripten behavior and browser WASM limits
- Binary search algorithm: HIGH -- validated by compress.sh prototype with real PDFs
- Testing: MEDIUM -- vitest + WASM has known friction points; may need workarounds

**Research date:** 2026-04-01
**Valid until:** 2026-04-15 (Vite 8 ecosystem is fast-moving; re-check plugin compatibility)
