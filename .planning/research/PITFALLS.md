# Domain Pitfalls

**Domain:** Client-side PDF compression (Ghostscript WASM in browser)
**Researched:** 2026-03-31

---

## Critical Pitfalls

Mistakes that cause rewrites, crashes, or fundamentally broken user experiences.

### Pitfall 1: WASM Module State Leaks Between callMain Invocations

**What goes wrong:** Ghostscript WASM is initialized once, then `callMain()` is called repeatedly for each file (and multiple times per file during binary search). Ghostscript maintains internal state between calls -- leftover virtual filesystem files, internal caches, and residual memory allocations accumulate. After processing several files, the module may produce corrupted output, crash with cryptic Emscripten errors, or silently consume all available memory.

**Why it happens:** Native Ghostscript is designed as a CLI tool invoked fresh per execution. The WASM port wraps this as a persistent module, but `callMain()` does not reset internal C state. Emscripten's linear memory cannot shrink -- once allocated, memory stays allocated even after the "process" completes.

**Consequences:** Memory grows monotonically across files. Binary search (5-8 iterations per file) times multi-file batches means dozens of `callMain()` invocations on the same module instance. For a batch of 10 PDFs at ~8 iterations each, that is 80 invocations with no cleanup.

**Warning signs:** Second or third file in a batch compresses differently than if processed alone. Memory usage climbs in DevTools even between files. Occasional "out of memory" errors on larger batches that work fine with fewer files.

**Prevention:**
- Clean up the virtual filesystem between every `callMain()` call: delete input and output files from Emscripten FS after reading results.
- For batch processing, consider re-instantiating the WASM module between files (not between binary search iterations -- too slow). The cost is ~1-2 seconds per re-initialization, but it guarantees clean state.
- If re-instantiation is too slow, at minimum: (1) always delete all FS files after each `callMain`, (2) monitor `performance.memory` (Chrome) to detect leaks during development, (3) set a "files processed" counter and force re-initialization every N files as a safety valve.

**Detection:** Write a test that compresses the same file 20 times in sequence and compares output sizes and memory usage. Divergence indicates state leakage.

**Phase:** Phase 1 (core compression). Must be addressed in initial Web Worker design.

**Confidence:** MEDIUM -- based on Emscripten memory behavior (documented) and WASM module lifecycle patterns. Exact Ghostscript state behavior needs empirical validation.

---

### Pitfall 2: Mobile Browser Memory Limits Crash the Tab

**What goes wrong:** The Ghostscript WASM binary itself requires significant memory to initialize (~50-100MB). Processing a PDF requires loading the entire file into the virtual filesystem (in-memory), plus Ghostscript's working memory during rendering. On mobile Safari (iOS), tabs are aggressively killed when WASM memory exceeds ~256-300MB. On Android Chrome, allocating more than ~300MB is unreliable.

**Why it happens:** WASM linear memory must be declared at instantiation with a maximum size. Emscripten defaults to a 2GB maximum, which iOS Safari immediately rejects as too large. Even with a lower maximum, the actual allocation pattern matters -- growing memory in small increments is less reliable than pre-allocating a larger initial block.

**Consequences:** App works perfectly on desktop, crashes immediately or mid-compression on phones and tablets. Users on mobile (a common use case for "quick PDF compression before uploading") get a blank tab with no error message.

**Warning signs:** "RangeError: Out of memory" in console on iOS Safari. Tab silently reloads on mobile. Works fine on desktop.

**Prevention:**
- Set `MAXIMUM_MEMORY` to 256MB or 512MB (not the default 2GB) when building or configuring the WASM module. If using a pre-built package, verify its memory configuration.
- Detect available memory heuristically: check `navigator.deviceMemory` (Chrome) and `navigator.userAgent` for mobile indicators. Set file size limits accordingly (e.g., 50MB max on mobile, 200MB on desktop).
- Show a clear warning before processing if the file is likely to exceed memory limits.
- Wrap WASM instantiation in a try-catch -- `WebAssembly.instantiate` throws on memory allocation failure. Surface a human-readable error, not a blank page.

**Detection:** Test on real iOS devices (simulator memory behavior differs). Test with a 30MB+ PDF on an iPhone.

**Phase:** Phase 1 (WASM loading). Memory configuration must be set during initial integration.

**Confidence:** HIGH -- documented iOS Safari and Android Chrome WASM memory limits from multiple Emscripten issues and WebKit bug tracker.

---

### Pitfall 3: SharedArrayBuffer / Cross-Origin Isolation Headers Missing

**What goes wrong:** Some Ghostscript WASM builds (especially those compiled with pthread support) require `SharedArrayBuffer`, which modern browsers gate behind cross-origin isolation headers. Without the correct `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response headers, `SharedArrayBuffer` is undefined and the WASM module fails to load.

**Why it happens:** Post-Spectre browser security changes require these headers for any page using shared memory. Vercel static sites don't set these headers by default.

**Consequences:** App works in local dev (Vite dev server can be configured) but fails silently in production on Vercel. Or works in Chrome but fails in Firefox/Safari due to different enforcement timelines.

**Warning signs:** `SharedArrayBuffer is not defined` in console. WASM module initialization promise rejects. Works in dev, breaks in production.

**Prevention:**
- First choice: use a Ghostscript WASM build that does NOT require pthreads/SharedArrayBuffer. The `@jspawn/ghostscript-wasm` package appears to be single-threaded. Verify this before committing to the package.
- If SharedArrayBuffer is needed, add to `vercel.json`:
  ```json
  {
    "headers": [
      {
        "source": "/(.*)",
        "headers": [
          { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
          { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
        ]
      }
    ]
  }
  ```
- Note: these headers break any third-party embeds (analytics scripts, external fonts loaded via `<link>`, iframes). For a self-contained tool with no third-party resources, this is acceptable. But if you add analytics later, they will break.
- Test in Firefox and Safari explicitly -- they enforced these requirements earlier and more strictly than Chrome.

**Detection:** Check browser console immediately after deploy. Automated: add a health check that verifies `typeof SharedArrayBuffer !== 'undefined'` if required.

**Phase:** Phase 1 (deployment setup). Must be validated before first Vercel deploy.

**Confidence:** HIGH -- well-documented browser requirement, confirmed Vercel configuration pattern.

---

### Pitfall 4: Binary Search Compression is Slow (5-8x Single-Pass)

**What goes wrong:** The binary search approach (try a DPI, check output size, adjust, repeat) means each file is processed 5-8 times through Ghostscript. Each pass is a full PDF re-render. A file that takes 3 seconds to compress once now takes 15-24 seconds. Multiply by a batch of 10 files and users wait 2-4 minutes with no clear indication of why.

**Why it happens:** There is no Ghostscript API to say "compress to exactly N bytes." The only way to hit a target size is iterative trial-and-error. Each trial is a complete PDF processing pipeline.

**Consequences:** Users drop files, click compress, and assume the tool is broken after 30 seconds. They close the tab. Or they see "Compressing 1/10..." stuck for 20 seconds and think it hung.

**Warning signs:** Compression feels subjectively "stuck." Users refresh mid-compression. Support complaints about speed.

**Prevention:**
- Show per-file progress with iteration count: "Compressing file.pdf (attempt 3/7, narrowing quality...)" -- this converts confusion into understanding.
- Start binary search with an educated first guess: use the ratio of (current size / target size) to estimate initial DPI rather than always starting at the midpoint. This can save 1-2 iterations.
- For "reduce by %" mode, a single pass at a calculated DPI may be sufficient -- skip binary search entirely and accept approximate results.
- Process files sequentially but show the queue. Parallel processing of multiple files would multiply memory pressure.
- Consider caching: if the first binary search pass already produces a file under target, stop immediately (don't search for "maximum quality under target" unless the user explicitly opts in).

**Detection:** Time the compression of a 5MB PDF with target 1MB. If it exceeds 15 seconds on a modern desktop, the UX needs more progress feedback.

**Phase:** Phase 2 (compression logic). The algorithm design directly impacts UX design.

**Confidence:** HIGH -- inherent to the binary search approach, validated by the shell script prototype.

---

## Technical Debt Patterns

### Debt 1: Vite Inlines Small WASM Files as Base64

**What goes wrong:** Vite's default behavior inlines static assets smaller than `assetsInlineLimit` (default 4KB) as base64 strings. While the main Ghostscript WASM binary (~15MB) won't be inlined, auxiliary WASM files or data files might be. Base64 encoding increases size by ~33% and bypasses streaming compilation.

**Prevention:** Set `build.assetsInlineLimit: 0` in `vite.config.ts` or use `vite-plugin-wasm` for proper WASM handling. Serve WASM files as static assets with the correct `application/wasm` MIME type, which enables streaming compilation (`WebAssembly.instantiateStreaming`).

**Phase:** Phase 1 (project setup).

### Debt 2: Not Using Transferable Objects for Worker Communication

**What goes wrong:** Sending PDF ArrayBuffers between the main thread and Web Worker via `postMessage` without the `transfer` option causes a full copy. For a 50MB PDF, this means 50MB copied to the worker, then 50MB of compressed output copied back -- plus the time to serialize/deserialize. A 32MB ArrayBuffer takes ~302ms to clone vs ~6.6ms to transfer.

**Prevention:** Always use `worker.postMessage(data, [data.buffer])` with the transferable array. Remember: the transferred buffer becomes neutered (zero-length) in the sending context. Design the API so the main thread doesn't need the original buffer after sending it to the worker.

**Phase:** Phase 1 (Web Worker implementation).

### Debt 3: No Worker Termination Strategy

**What goes wrong:** If a user clicks "Restart" or navigates away mid-compression, the Web Worker continues processing in the background, consuming CPU and memory. Ghostscript's `callMain()` is synchronous within the worker -- there is no way to cancel it mid-execution.

**Prevention:** Design the worker to be terminable: `worker.terminate()` kills the worker thread immediately. After termination, create a fresh worker for the next batch. Accept that in-progress WASM work cannot be gracefully cancelled -- termination is the only option. Ensure the UI state machine handles the "terminated" state correctly (clear progress, re-enable upload).

**Phase:** Phase 2 (UX polish and restart flow).

---

## Performance Traps

### Trap 1: ZIP Generation Doubles Memory Usage

**What goes wrong:** JSZip holds the entire ZIP in memory before generating the download. If a user compresses 10 files averaging 4MB each, that is 40MB of compressed PDFs held in JSZip's buffers, plus the original files still in the results table, plus the ZIP output blob. Total memory: potentially 120MB+ just for the download step.

**Prevention:**
- Use `client-zip` (streaming ZIP library, ~3KB) instead of JSZip for "Download All." It generates the ZIP as a stream without holding all files in memory simultaneously.
- Alternatively, use per-file downloads with `<a download>` links as the primary UX, with ZIP as optional.
- If using JSZip, use `type: "blob"` output (not "uint8array") and call `URL.revokeObjectURL()` after download to free the blob.

**Phase:** Phase 2 (download implementation).

**Confidence:** HIGH -- JSZip memory limitations are well-documented in their own docs and GitHub issues.

### Trap 2: Emscripten Virtual FS Copies Data Twice

**What goes wrong:** To process a PDF, you must: (1) read the File into an ArrayBuffer (main thread), (2) transfer it to the Worker, (3) write it to Emscripten's MEMFS via `FS.writeFile()` (another copy into WASM linear memory). After compression: (4) read the output via `FS.readFile()` (copy out of WASM memory), (5) transfer back to main thread. A 50MB PDF exists in 2-3 copies simultaneously in the Worker's memory.

**Prevention:**
- Clean up aggressively: `FS.unlink()` input files immediately after `callMain()` returns, before reading the output. This won't reclaim WASM linear memory (it can't shrink), but it frees the Emscripten FS metadata.
- Set a practical file size limit in the UI (e.g., 100MB per file) with a clear explanation. This is not a limitation -- it is honest UX for a browser tool.
- For binary search, reuse the same input filename so `FS.writeFile()` overwrites rather than creating additional files.

**Phase:** Phase 1 (core compression pipeline).

### Trap 3: WASM Loading Blocks First Interaction

**What goes wrong:** The WASM binary is ~10MB over the wire. If the user drops a file before WASM is ready, either (a) nothing happens (broken feeling), or (b) compression starts but hangs waiting for WASM (confusing). The project plan calls for lazy-loading with background download, but the implementation details matter.

**Prevention:**
- Start WASM download immediately on page load using `fetch()` with caching headers, but don't block any UI rendering.
- Track loading state: show a small, non-intrusive "Preparing compression engine..." indicator.
- If user drops files before WASM is ready, queue the files and show "Engine loading... will start automatically."
- Cache the WASM binary aggressively: `Cache-Control: public, max-age=31536000, immutable` on Vercel. After first visit, WASM loads from browser cache instantly.
- Use `WebAssembly.instantiateStreaming()` (not `instantiate()` with ArrayBuffer) -- streaming compilation is 2-5x faster because it compiles while downloading.

**Phase:** Phase 1 (WASM loading strategy).

---

## Security Mistakes

### Mistake 1: Trusting File Extensions for PDF Validation

**What goes wrong:** User drops a file named "document.pdf" that is actually a ZIP bomb, a malformed binary, or a 2GB file with a .pdf extension. Ghostscript attempts to parse it and either crashes, hangs, or consumes all memory.

**Prevention:**
- Validate the PDF magic bytes (`%PDF-` at offset 0) before sending to Ghostscript.
- Enforce a maximum file size (100MB is generous for a browser tool).
- Wrap `callMain()` in a timeout -- if Ghostscript hasn't returned in 60 seconds per file, terminate the worker and report an error.
- Show clear errors for non-PDF files: "This file doesn't appear to be a valid PDF."

**Phase:** Phase 1 (file input handling).

### Mistake 2: Not Revoking Object URLs

**What goes wrong:** Each compressed file creates a Blob URL via `URL.createObjectURL()` for download. These hold references to the blob data in memory. Without explicit `URL.revokeObjectURL()`, the memory is never freed -- even after the user downloads the file. Processing 20 files creates 20 zombie blob references.

**Prevention:** Revoke URLs after download completes, or when the user clicks "Restart." Track all created URLs in an array and revoke them all on cleanup.

**Phase:** Phase 2 (download implementation).

---

## UX Pitfalls

### UX Pitfall 1: No Feedback During Binary Search Iterations

**What goes wrong:** The user sees "Compressing..." for 20+ seconds with no indication of progress. They cannot distinguish between "working" and "frozen." Binary search is invisible -- the user doesn't know the tool is iterating to find optimal quality.

**Prevention:**
- Show iteration progress: "Finding optimal quality for file.pdf (attempt 4/7)..."
- Show intermediate results if possible: "Last attempt: 5.2MB (target: 4MB), trying lower quality..."
- Animate something -- even a simple spinner or progress bar that ticks per iteration gives confidence the tool is alive.

**Phase:** Phase 2 (progress UI).

### UX Pitfall 2: "Already Fits" Files Feel Like the Tool Did Nothing

**What goes wrong:** User drops 5 files, 3 are already under 4MB. The results show "already fits" for 3 files. The user interprets this as "the tool didn't work on those files" or "something went wrong." Especially bad when ALL files already fit -- user sees zero compression results.

**Prevention:**
- Show "already fits" as a positive outcome with a checkmark icon, not a neutral/gray state.
- Display the file size alongside: "already under 4MB (2.1MB) -- no compression needed."
- If ALL files already fit, show a prominent message: "All files are already under your target size. No compression needed."
- Consider still allowing the user to force-compress "already fits" files for further reduction.

**Phase:** Phase 2 (results table UI).

### UX Pitfall 3: Compression Makes the PDF Larger

**What goes wrong:** Some PDFs -- especially those already optimized, or text-heavy PDFs with minimal images -- can actually grow in size after Ghostscript processing. The tool reports a negative compression ratio. User loses trust.

**Why it happens:** Ghostscript re-encodes the entire PDF. If the original was already well-optimized, re-encoding adds overhead. Text-only PDFs gain no benefit from image DPI reduction but incur Ghostscript's re-serialization overhead.

**Prevention:**
- After compression, compare output size to input size. If output >= input, discard the output and return the original file with a note: "Original file is already optimally compressed."
- This check should happen inside the binary search loop too -- if even the lowest quality produces a larger file, stop early.

**Phase:** Phase 2 (compression logic).

### UX Pitfall 4: Drop Zone Doesn't Work as Expected

**What goes wrong:** Drag-and-drop is visually intuitive but has browser quirks. The `dragenter`/`dragleave` events fire on child elements, causing the drop zone highlight to flicker. On some mobile browsers, drag-and-drop doesn't work at all. File input fallback may be missing.

**Prevention:**
- Use a counter-based approach for dragenter/dragleave (increment on enter, decrement on leave, show highlight when counter > 0) to prevent flicker.
- Always include a "click to browse" fallback alongside drag-and-drop.
- Prevent default on `dragover` (required for drop to work -- easy to forget).
- Test on mobile: provide a prominent "Select files" button since drag-and-drop is desktop-only.

**Phase:** Phase 1 (file upload UI).

---

## "Looks Done But Isn't" Checklist

| Feature | Looks Done When... | Actually Done When... |
|---------|--------------------|-----------------------|
| WASM loading | Module initializes in dev | Works on first visit with cold cache on slow 3G; handles load failure gracefully; shows loading state to user |
| Web Worker | Compression runs off main thread | Transferable objects used for data; worker can be terminated; errors propagate to UI; worker survives module re-init |
| Binary search | Finds a DPI that fits target | Handles edge cases: file already fits, file can't be compressed enough, output larger than input, text-only PDFs |
| Multi-file batch | All files compress sequentially | Memory cleaned between files; progress shows queue position; one file's failure doesn't abort the batch; restart kills in-progress work |
| Download All | ZIP generates and downloads | Memory doesn't spike to 2x total; blob URLs are revoked; works on Safari (which handles downloads differently); fallback for large ZIPs |
| Mobile support | Page loads on phone | WASM doesn't crash on iOS Safari; file picker works (no drag-and-drop); 50MB PDF doesn't kill the tab; virtual keyboard doesn't break layout for size input |
| Vercel deploy | Site loads at URL | WASM served with correct MIME type; COOP/COEP headers set if needed; WASM cached immutably; no 4MB function size limit issues (static site, not serverless) |
| Error handling | Try-catch around callMain | Ghostscript stderr captured and parsed for user-friendly messages; corrupt PDFs show helpful errors; timeout for hung processes; graceful degradation on unsupported browsers |

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Project setup (Vite + WASM) | WASM inlined as base64 or served with wrong MIME type | Configure `assetsInlineLimit: 0`, verify `application/wasm` content type, use `vite-plugin-wasm` if needed |
| WASM integration | Module works in dev but fails in production due to different file resolution paths | Test production build locally (`vite preview`) before deploying. WASM file URL may differ between dev and build. |
| Web Worker setup | Worker can't import WASM module due to module scope | Use `new Worker(url, { type: 'module' })` for ES module workers. Verify browser support (Safari 15+). Fall back to classic worker with importScripts if needed. |
| Ghostscript compression | `callMain()` fails silently or returns non-zero exit code | Always check return value. Capture stderr by overriding Emscripten's `print`/`printErr` functions at module init. |
| Binary search algorithm | Infinite loop when target is unreachable | Set max iterations (8-10). Add floor/ceiling guards. If best result after max iterations exceeds target, return best attempt with a warning. |
| Results and download | Safari blocks programmatic downloads | Use `<a>` element click simulation, not `window.open()`. Safari requires user gesture for downloads. Test on real Safari. |
| Vercel deployment | 10MB+ WASM file triggers edge function limits | Ensure WASM is served as a static asset (in `public/`), not processed as a serverless function. Vercel's static file size limit is generous (individual files up to 500MB on Pro). |
| Cross-browser testing | Works in Chrome, fails in Firefox/Safari | Firefox has stricter MIME type checking for WASM. Safari has unique Web Worker and memory constraints. Test in all three during every phase. |

---

## Sources

- [Emscripten File System Overview](https://emscripten.org/docs/porting/files/file_systems_overview.html)
- [WASM Memory Design Issues (GitHub)](https://github.com/WebAssembly/design/issues/1397)
- [Chrome Transferable Objects](https://developer.chrome.com/blog/transferable-objects-lightning-fast)
- [MDN: Transferable Objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [iOS Safari WASM Memory Issues (Emscripten)](https://github.com/emscripten-core/emscripten/issues/19374)
- [iOS Safari WASM Memory Bug (WebKit)](https://bugs.webkit.org/show_bug.cgi?id=221530)
- [SharedArrayBuffer Browser Requirements (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [SharedArrayBuffer Issues in ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/106)
- [JSZip Limitations](https://stuk.github.io/jszip/documentation/limitations.html)
- [client-zip Streaming Alternative](https://github.com/Touffy/client-zip)
- [Vercel WASM MIME Type Issue](https://github.com/vercel/serve/issues/668)
- [Vercel Limits](https://vercel.com/docs/limits)
- [Vite WASM Features](https://vite.dev/guide/features)
- [vite-plugin-wasm](https://www.npmjs.com/package/vite-plugin-wasm)
- [ghostscript-pdf-compress.wasm Reference Project](https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm)
- [@jspawn/ghostscript-wasm (npm)](https://www.npmjs.com/package/@jspawn/ghostscript-wasm)
- [Ghostscript WASM DeepWiki](https://deepwiki.com/jsscheller/ghostscript-wasm/2.2-basic-usage)
- [WebAssembly Limitations (2025)](https://qouteall.fun/qouteall-blog/2025/WebAsembly%20Limitations)
- [Ghostscript Optimizing PDFs](https://ghostscript.com/blog/optimizing-pdfs.html)
