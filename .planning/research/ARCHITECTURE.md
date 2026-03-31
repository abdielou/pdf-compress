# Architecture Patterns

**Domain:** Client-side PDF compression tool (WASM in browser)
**Researched:** 2026-03-31

## System Overview

```
+----------------------------------------------------------+
|  Browser Main Thread                                      |
|                                                           |
|  +------------------+    +----------------------------+   |
|  |   UI Module      |    |   Compression Controller   |   |
|  |  (DOM, events,   |<-->|   (orchestrates files,     |   |
|  |   drag-drop,     |    |    dispatches to worker,   |   |
|  |   progress bars) |    |    collects results)       |   |
|  +------------------+    +----------------------------+   |
|                                |                          |
|                          postMessage                      |
|                      (Transferable ArrayBuffer)           |
|                                |                          |
+--------------------------------|--------------------------+
                                 |
+--------------------------------|--------------------------+
|  Web Worker Thread             v                          |
|                                                           |
|  +----------------------------+   +--------------------+  |
|  |   Worker Message Router    |   |   WASM Module      |  |
|  |   (receives commands,      |-->|   (Ghostscript     |  |
|  |    dispatches operations,  |   |    via Emscripten  |  |
|  |    reports progress)       |   |    virtual FS)     |  |
|  +----------------------------+   +--------------------+  |
|                                                           |
|  +----------------------------+                           |
|  |   Compression Engine       |                           |
|  |   (binary search loop,     |                           |
|  |    GS argument builder,    |                           |
|  |    size evaluation)        |                           |
|  +----------------------------+                           |
|                                                           |
+-----------------------------------------------------------+
```

## Component Responsibilities

| Component | Responsibility | Communicates With | Thread |
|-----------|---------------|-------------------|--------|
| **UI Module** | DOM rendering, drag-drop handling, progress display, download triggers | Compression Controller | Main |
| **Compression Controller** | File queue management, worker lifecycle, result aggregation, ZIP packaging | UI Module, Worker | Main |
| **Worker Message Router** | Receives commands via `postMessage`, dispatches to engine, relays progress | Controller (via postMessage) | Worker |
| **WASM Module** | Ghostscript initialization, virtual FS, `callMain()` execution | Compression Engine | Worker |
| **Compression Engine** | Binary search loop, GS argument construction, output size evaluation | Worker Router, WASM Module | Worker |

## Recommended Project Structure

```
pdf-compress/
  index.html                    # Entry point (Vite serves from root)
  vite.config.ts                # Vite config (worker format, WASM handling)
  tsconfig.json                 # Main thread TypeScript config
  tsconfig.worker.json          # Worker TypeScript config (lib: ["webworker"])
  package.json
  public/
    # Static assets (favicon, etc.)
    # NOTE: WASM binary NOT here - loaded from CDN or node_modules
  src/
    main.ts                     # App entry: init UI, preload worker
    ui/
      dom.ts                    # DOM creation, element references
      drag-drop.ts              # File input via drag-drop and file picker
      progress.ts               # Progress bar rendering, status text
      results.ts                # Results table (before/after sizes)
      download.ts               # Download All (ZIP) and per-file download
    compression/
      controller.ts             # Orchestrates: queue files, talk to worker, collect results
      worker-client.ts          # Typed postMessage wrapper (main-thread side)
      types.ts                  # Shared message types (WorkerCommand, WorkerEvent)
    worker/
      compression.worker.ts     # Worker entry point, message router
      engine.ts                 # Binary search loop, GS argument builder
      ghostscript.ts            # WASM init, FS operations, callMain wrapper
    lib/
      file-utils.ts             # File/Blob/ArrayBuffer helpers, size formatting
      zip.ts                    # JSZip wrapper for Download All
    types/
      index.ts                  # App-wide types (FileItem, CompressionResult, TargetMode)
```

### Key Structural Decisions

**Two tsconfig files.** The worker thread has no DOM access; a separate `tsconfig.worker.json` with `lib: ["ES2022", "WebWorker"]` prevents accidental `document` references in worker code. The main config uses `lib: ["ES2022", "DOM", "DOM.Iterable"]`.

**`compression/` vs `worker/` split.** The `compression/` directory contains main-thread orchestration code. The `worker/` directory contains code that runs in the worker thread. This boundary is the postMessage wall -- nothing in `worker/` imports from `ui/` or vice versa. The shared contract lives in `compression/types.ts`.

**No `components/` folder.** This is vanilla TypeScript, not a component framework. Functions create and mutate DOM elements directly. The `ui/` folder organizes by concern (drag-drop, progress, results), not by component hierarchy.

## Data Flow

### 1. WASM Preloading (on page load)

```
main.ts
  --> new Worker(new URL('./worker/compression.worker.ts', import.meta.url), { type: 'module' })
  --> worker receives 'init' command
  --> worker imports @jspawn/ghostscript-wasm
  --> Module({ locateFile: (file) => CDN_URL + file })
  --> WASM binary fetched (~10MB, cached immutably)
  --> worker posts { type: 'ready' } back to main
  --> UI shows "Ready" indicator (or hides loading state)
```

**Why preload on page load:** The WASM binary is ~10MB over the wire. Starting the download immediately (while the user reads the UI / drags files) hides latency. If the user clicks Compress before WASM is ready, show a "Loading engine..." state with the download progress.

### 2. File Upload

```
User drags files onto drop zone (or uses file picker)
  --> drag-drop.ts reads File objects from DataTransfer / input.files
  --> Each File stored as FileItem { file: File, name, size }
  --> UI renders file list with sizes
  --> No ArrayBuffer read yet (deferred to compression time)
```

**Why defer ArrayBuffer read:** Reading files into memory early wastes RAM if the user changes their mind. Read on demand, one file at a time.

### 3. Compression (per file)

```
User clicks "Compress"
  --> controller.ts iterates FileItem queue sequentially
  --> For each file:
      1. file.arrayBuffer() --> ArrayBuffer
      2. Check: if file.size <= targetSize, mark "already fits", skip
      3. postMessage({ type: 'compress', payload: { buffer, fileName, target }},
                     [buffer])   // <-- Transfer, not copy
      4. Worker receives command:
         a. gs.FS.writeFile('/input.pdf', new Uint8Array(buffer))
         b. Binary search loop (see below)
         c. gs.FS.readFile('/output.pdf') --> Uint8Array
         d. postMessage({ type: 'result', payload: { buffer: output.buffer, ... }},
                        [output.buffer])  // <-- Transfer back
      5. Controller receives result, stores compressed Blob
      6. UI updates results table row
```

**Transferable ArrayBuffer:** Critical for performance. `postMessage(data, [buffer])` transfers ownership of the ArrayBuffer to the worker thread with zero-copy. The source buffer becomes detached (zero bytes). On return, the compressed buffer is transferred back the same way. For a 20MB PDF, this avoids a 20MB structured clone in each direction.

### 4. Binary Search Compression Loop (inside worker)

```
function binarySearchCompress(inputBytes, targetSize):
    lo = 30       // minimum DPI (aggressive compression)
    hi = 300      // maximum DPI (near-original quality)
    bestResult = null

    while (lo <= hi):
        mid = Math.floor((lo + hi) / 2)

        // Run Ghostscript with this DPI
        gs.callMain([
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            '-dNOPAUSE', '-dBATCH', '-dQUIET',
            '-dDownsampleColorImages=true',
            '-dDownsampleGrayImages=true',
            '-dColorImageResolution=' + mid,
            '-dGrayImageResolution=' + mid,
            '-dColorImageDownsampleType=/Bicubic',
            '-dGrayImageDownsampleType=/Bicubic',
            '-sOutputFile=/output.pdf',
            '/input.pdf'
        ])

        outputBytes = gs.FS.readFile('/output.pdf')
        outputSize = outputBytes.length

        postMessage({ type: 'progress', iteration: { dpi: mid, size: outputSize }})

        if (outputSize <= targetSize):
            bestResult = outputBytes  // Fits! Try higher quality
            lo = mid + 1
        else:
            hi = mid - 1             // Too big, reduce quality

        // Cleanup for next iteration
        gs.FS.unlink('/output.pdf')

    return bestResult  // Highest quality that fits target
```

**Why DPI as the search variable:** Ghostscript's `dColorImageResolution` directly controls image downsampling, which is the primary lever for PDF size reduction (F1 from discovery). Unlike JPEG quality (`/QFactor`), DPI has a roughly monotonic relationship with output size, making binary search reliable. The `/QFactor` parameter in pdfwrite is controlled indirectly via `dPDFSETTINGS` presets and `ColorImageDict`, which is less granular.

**DPI range 30-300:** 300 DPI is print quality (effectively no downsampling for most documents). 30 DPI is aggressive but readable for text-with-images. Binary search over this range converges in ~9 iterations (log2(270) ~= 8.1), meaning ~9 Ghostscript invocations per file.

**Percentage reduction mode:** For "reduce by X%", calculate `targetSize = originalSize * (1 - percentage / 100)` before entering the same binary search.

### 5. Results and Download

```
All files compressed
  --> controller.ts has array of CompressionResult { name, originalSize, compressedSize, blob }
  --> results.ts renders table: filename | before | after | reduction %
  --> "Download All" button:
      a. If 1 file: direct Blob download via createObjectURL
      b. If 2+ files: JSZip bundles all Blobs into ZIP
         --> zip.generateAsync({ type: 'blob' }) --> Blob
         --> createObjectURL(zipBlob) --> trigger download
         --> revokeObjectURL after download starts
```

### 6. Progress Reporting

```
Worker --> Main thread messages during compression:

{ type: 'file-start', fileIndex: 0, fileName: 'report.pdf' }
{ type: 'progress', fileIndex: 0, iteration: 1, totalEstimated: 9, currentDpi: 165, currentSize: 5242880 }
{ type: 'progress', fileIndex: 0, iteration: 2, totalEstimated: 9, currentDpi: 232, currentSize: 3145728 }
...
{ type: 'file-done', fileIndex: 0, compressedSize: 3900000, buffer: ArrayBuffer }
{ type: 'file-start', fileIndex: 1, fileName: 'invoice.pdf' }
...
{ type: 'all-done' }
```

The UI shows: "Compressing 1/5... report.pdf" with a progress bar based on `iteration / totalEstimated`. Per-iteration detail (DPI, current size) is available but displayed minimally per D12 ("per-iteration would be noisy").

## Message Protocol (Typed)

```typescript
// compression/types.ts -- shared between main thread and worker

// Main --> Worker
type WorkerCommand =
  | { type: 'init' }
  | { type: 'compress'; fileIndex: number; fileName: string;
      buffer: ArrayBuffer; targetBytes: number }
  | { type: 'abort' }

// Worker --> Main
type WorkerEvent =
  | { type: 'ready' }
  | { type: 'init-progress'; loaded: number; total: number }
  | { type: 'file-start'; fileIndex: number; fileName: string }
  | { type: 'progress'; fileIndex: number; iteration: number;
      totalEstimated: number; currentDpi: number; currentSize: number }
  | { type: 'file-done'; fileIndex: number; compressedSize: number;
      buffer: ArrayBuffer }
  | { type: 'file-skipped'; fileIndex: number; reason: 'already-fits' }
  | { type: 'file-error'; fileIndex: number; error: string }
  | { type: 'all-done' }
```

This discriminated union pattern ensures all message handling is exhaustive. TypeScript's narrowing on `event.type` gives full type safety in switch statements.

## WASM Loading Strategy

### Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  worker: {
    format: 'es'   // Workers use ES modules
  },
  build: {
    target: 'es2022'  // Modern browsers only (WASM support implied)
  },
  optimizeDeps: {
    exclude: ['@jspawn/ghostscript-wasm']  // Don't pre-bundle WASM package
  }
})
```

### Worker-Side WASM Initialization

```typescript
// worker/ghostscript.ts
import Module from '@jspawn/ghostscript-wasm'

let gs: Awaited<ReturnType<typeof Module>> | null = null

export async function initGhostscript(
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  gs = await Module({
    locateFile: (file: string) => {
      // In production: serve from CDN with immutable cache headers
      // In dev: Vite serves from node_modules
      return new URL(
        `../node_modules/@jspawn/ghostscript-wasm/${file}`,
        import.meta.url
      ).href
    }
  })
}

export function getGs() {
  if (!gs) throw new Error('Ghostscript not initialized')
  return gs
}
```

**CDN vs local serving:** For production, serve the WASM binary from a CDN (jsDelivr or self-hosted on Vercel) with `Cache-Control: public, max-age=31536000, immutable`. The ~10MB download happens once per user. For development, let Vite serve from node_modules.

### Worker Creation (Main Thread Side)

```typescript
// compression/worker-client.ts
export function createCompressionWorker(): Worker {
  return new Worker(
    new URL('../worker/compression.worker.ts', import.meta.url),
    { type: 'module' }
  )
}
```

Vite recognizes this `new Worker(new URL(...))` pattern and bundles the worker as a separate chunk automatically.

## Patterns to Follow

### Pattern 1: Sequential File Processing (Not Parallel)

**What:** Process files one at a time through the single worker, not in parallel.

**Why:** Ghostscript WASM maintains global state in Emscripten's virtual filesystem. Running multiple compressions concurrently in the same WASM instance would cause filesystem conflicts (`/input.pdf` and `/output.pdf` collisions). Spawning multiple workers would multiply the ~10MB WASM memory footprint.

**Implementation:** The controller maintains a queue and sends the next file to the worker only after receiving `file-done` for the current one.

### Pattern 2: Transfer, Don't Clone

**What:** Always pass ArrayBuffers as Transferable objects in postMessage.

**Why:** A 20MB PDF would take ~29ms to transfer via Transferable vs hundreds of ms to structured-clone. The source buffer becomes detached after transfer, which is correct -- the main thread doesn't need it while the worker is processing.

```typescript
// Sending TO worker
worker.postMessage(
  { type: 'compress', buffer, fileName, fileIndex, targetBytes },
  [buffer]  // Transfer list
)

// Receiving FROM worker (inside worker)
self.postMessage(
  { type: 'file-done', fileIndex, compressedSize, buffer: output.buffer },
  [output.buffer]  // Transfer list
)
```

### Pattern 3: Discriminated Union Messages

**What:** Use TypeScript discriminated unions for all worker messages (see Message Protocol above).

**Why:** Enables exhaustive switch handling. The compiler catches unhandled message types. No stringly-typed message parsing.

### Pattern 4: Lazy WASM with Eager Start

**What:** Don't import WASM at the top level. Start the worker on page load and send an `init` command. The WASM downloads in the background while the user interacts with the UI.

**Why:** The WASM binary is ~10MB. Blocking the main thread or delaying UI render for this is unacceptable. Starting early hides latency behind user interaction time (reading the UI, dragging files, configuring target).

### Pattern 5: Emscripten FS Cleanup Between Iterations

**What:** After each Ghostscript invocation in the binary search, explicitly `unlink` output files from the virtual filesystem.

**Why:** Emscripten's virtual FS persists across `callMain()` calls. Leftover files consume memory (the WASM heap) and could cause stale reads if Ghostscript fails silently on a subsequent iteration.

```typescript
try {
  gs.callMain(args)
  const output = gs.FS.readFile('/output.pdf')
  // ... use output
} finally {
  try { gs.FS.unlink('/output.pdf') } catch {}
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Reading All Files Into Memory Upfront

**What:** Calling `.arrayBuffer()` on all dropped Files immediately.

**Why bad:** If a user drops 10 x 20MB PDFs, that is 200MB of ArrayBuffers in memory before compression even starts. Combined with WASM heap and compressed outputs, this can crash the tab.

**Instead:** Read one file at a time, just before sending it to the worker. The File API holds references without loading bytes until `.arrayBuffer()` is called.

### Anti-Pattern 2: SharedArrayBuffer for File Transfer

**What:** Using SharedArrayBuffer to share PDF data between main thread and worker.

**Why bad:** SharedArrayBuffer requires `Cross-Origin-Isolation` headers (`Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Opener-Policy: same-origin`). These headers break third-party script loading (analytics, error tracking) and complicate CDN setup. Transferable ArrayBuffers achieve zero-copy transfer without these restrictions.

**Instead:** Use standard `postMessage` with Transferable ArrayBuffer transfer. The zero-copy semantics are the same for the transfer direction.

### Anti-Pattern 3: Parallel Worker Instances

**What:** Spawning multiple Web Workers to compress files in parallel.

**Why bad:** Each worker loads its own WASM instance (~10MB+ memory per instance). Ghostscript's Emscripten compilation is not designed for concurrent instances sharing state. Memory pressure scales linearly with worker count.

**Instead:** Single worker, sequential file processing. The binary search loop is CPU-bound anyway -- parallelism doesn't help if there is one CPU core doing WASM work.

### Anti-Pattern 4: Using dPDFSETTINGS Presets for Binary Search

**What:** Iterating through `/screen`, `/ebook`, `/printer`, `/prepress` presets to find the best fit.

**Why bad:** Only 4 discrete quality levels -- far too coarse. A file might fit at `/ebook` (150 DPI) but the user deserves the highest quality that fits, which might be 210 DPI.

**Instead:** Use explicit `-dColorImageResolution=N` with integer DPI values. Binary search over the continuous 30-300 DPI range gives much finer control (~270 quality levels instead of 4).

### Anti-Pattern 5: Blocking Main Thread During WASM Init

**What:** `await Module()` on the main thread, or synchronously loading WASM before showing any UI.

**Why bad:** 10MB download + compilation time = seconds of blank screen on first visit.

**Instead:** All WASM operations happen inside the Web Worker. The main thread never imports `@jspawn/ghostscript-wasm`. UI renders instantly from `main.ts`, worker initializes in parallel.

## Build Order (Dependency Graph)

Components should be built in this order based on dependencies:

```
Phase 1: Foundation
  types/index.ts              (no dependencies)
  compression/types.ts        (no dependencies)
  lib/file-utils.ts           (no dependencies)

Phase 2: Worker Core
  worker/ghostscript.ts       (depends on: @jspawn/ghostscript-wasm)
  worker/engine.ts            (depends on: ghostscript.ts, compression/types.ts)
  worker/compression.worker.ts (depends on: engine.ts, ghostscript.ts, types)

Phase 3: Main Thread Core
  compression/worker-client.ts (depends on: compression/types.ts)
  compression/controller.ts    (depends on: worker-client.ts, types)

Phase 4: UI
  ui/dom.ts                    (depends on: types)
  ui/drag-drop.ts              (depends on: types, dom.ts)
  ui/progress.ts               (depends on: types, dom.ts)
  ui/results.ts                (depends on: types, dom.ts)

Phase 5: Integration
  ui/download.ts               (depends on: types, lib/zip.ts)
  lib/zip.ts                   (depends on: jszip)
  main.ts                      (wires everything together)
```

**Rationale:** Types first (zero dependencies, everything needs them). Worker core second (can be tested independently with hardcoded inputs). Controller third (can be tested with a mock worker). UI fourth (can be tested with mock data). Integration last (wires real worker to real UI).

## Scalability Considerations

| Concern | Current Scale (1-5 files) | Future Scale (50+ files) |
|---------|---------------------------|--------------------------|
| Memory | Read one file at a time, transfer buffers | Same pattern scales; GC reclaims between files |
| Processing time | ~9 GS iterations/file x ~2-5s each = 20-45s/file | Queue is sequential; could add "cancel" for long batches |
| WASM init | One-time ~10MB download, cached | Already optimal with immutable caching |
| ZIP generation | JSZip handles in-memory | May need streaming ZIP for very large batches (future) |

## Sources

- [ghostscript-wasm GitHub](https://github.com/jsscheller/ghostscript-wasm) -- WASM package source and API
- [ghostscript-wasm DeepWiki - Basic Usage](https://deepwiki.com/jsscheller/ghostscript-wasm/2.2-basic-usage) -- Module init, FS, callMain patterns
- [ghostscript-pdf-compress.wasm](https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm) -- Reference implementation with Web Worker pattern
- [Ghostscript pdfwrite Vector Devices](https://ghostscript.com/docs/9.54.0/VectorDevices.htm) -- dPDFSETTINGS, image resolution, downsampling parameters
- [Ghostscript Optimizing PDFs](https://ghostscript.com/blog/optimizing-pdfs.html) -- Official compression guidance
- [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) -- Zero-copy ArrayBuffer transfer
- [MDN: Worker.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage) -- Transfer list parameter
- [Vite Web Workers](https://v3.vitejs.dev/guide/features) -- `new Worker(new URL(...))` pattern
- [Vite Static Asset Handling](https://vite.dev/guide/assets) -- WASM file serving
- [SitePen: Using WebAssembly with Web Workers](https://www.sitepen.com/blog/using-webassembly-with-web-workers) -- WASM + Worker architecture pattern
