# Phase 2: File Input and Progress UI - Research

**Researched:** 2026-04-01
**Domain:** Vanilla TypeScript UI -- drag-and-drop file input, compression target configuration, real-time progress feedback
**Confidence:** HIGH

## Summary

Phase 2 builds the user-facing UI that connects to the Phase 1 compression engine. The scope is: (1) a drag-and-drop zone with click-to-browse fallback for PDF file input, (2) file type validation rejecting non-PDFs, (3) a toggle between max-file-size and percentage-reduction target modes, and (4) live per-file progress during compression with a WASM-loading state.

Since this is vanilla TypeScript (no framework), all DOM manipulation is direct. The key technical challenges are: handling drag-and-drop browser quirks (child-element flicker), validating files by magic bytes (not just extension), wiring the existing `compressFiles()` API to a progress UI, and managing the WASM-not-ready state gracefully.

**Primary recommendation:** Build three modules -- `src/ui/drop-zone.ts` (file input + validation), `src/ui/target-config.ts` (size/percentage toggle), and `src/ui/progress.ts` (per-file progress rendering) -- then wire them to the existing `compressFiles()` API in a new `src/ui/app.ts` orchestrator that replaces the current minimal `index.html`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INP-01 | Drag and drop one or more PDF files onto a drop zone | Drag-and-drop API patterns with counter-based flicker fix; `dataTransfer.items` for file access |
| INP-02 | Click to browse and select PDF files as fallback | Hidden `<input type="file" accept=".pdf,application/pdf" multiple>` triggered by click on drop zone |
| INP-03 | Non-PDF files rejected with clear message | PDF magic bytes validation (`%PDF-` in first 5 bytes) + MIME type check; per-file rejection messages |
| INP-04 | Set target as max file size (default 4MB) | Numeric input with unit display; maps to `{ mode: 'size', maxBytes }` CompressionTarget |
| INP-05 | Set target as % reduction (default 50%) | Numeric input with % display; maps to `{ mode: 'percentage', reductionPct }` CompressionTarget |
| INP-06 | Toggle between size and % target modes | Two-state toggle switch; persists selection while preserving both values |
| PRG-01 | Per-file status "Compressing X/N... filename.pdf" | Status text element updated via onProgress callback from compressFiles() |
| PRG-02 | Progress bar updates per file during compression | CSS width transition on inner bar element; iteration/estimated-total ratio for percentage |
| PRG-03 | Loading state shown if WASM not ready when user clicks compress | Track worker ready state; show "Preparing compression engine..." overlay until ready |
| PRG-04 | Errors displayed per-file, not as crash | CompressionResult with compressedSize===0 treated as error; per-file error message in file list |
</phase_requirements>

## Standard Stack

### Core (already installed from Phase 1)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~6.0.2 | Type-safe DOM manipulation | Already in project |
| Vite | ^8.0.3 | Dev server with HMR for UI development | Already in project |

### Supporting (no new dependencies needed)
| API | Purpose | Notes |
|-----|---------|-------|
| HTML Drag and Drop API | File drag-and-drop | Native browser API, no library needed |
| File API | File reading, type checking | Native; `file.slice(0, 5)` for magic bytes |
| DataTransfer API | Access dropped files | `e.dataTransfer.items` with `kind === 'file'` filter |

### No New Dependencies

Phase 2 requires zero new npm packages. All functionality uses native browser APIs:
- Drag and drop: `dragenter`, `dragover`, `dragleave`, `drop` events
- File selection: `<input type="file">` with `accept` and `multiple`
- Progress: CSS transitions on width property
- State management: Simple TypeScript module-level state

**Installation:** None required. Project dependencies are already complete.

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)
```
src/
  ui/
    drop-zone.ts         # Drag-drop zone + click-to-browse + file validation
    target-config.ts     # Size/percentage toggle and input fields
    progress.ts          # Per-file progress bar and status text
    app.ts               # Orchestrator: wires UI to compressFiles() API
  styles/
    main.css             # All styles (single file, minimal)
```

### Pattern 1: Counter-Based Drag Flicker Prevention
**What:** Use an integer counter incremented on `dragenter` and decremented on `dragleave` to determine when the user is actually over the drop zone. Only remove the "drag-over" visual class when counter reaches 0. Reset counter on `drop`.
**When to use:** Always, for any drag-and-drop zone with child elements.
**Why:** The browser fires `dragleave` when entering a child element, causing visual flicker. The counter approach is the standard fix used by Dropzone.js and recommended by multiple sources.
**Example:**
```typescript
// Source: https://www.codemzy.com/blog/drag-and-drop-bug-fixes
let dragCounter = 0;

dropZone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  dragCounter--;
  if (dragCounter === 0) {
    dropZone.classList.remove('drag-over');
  }
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropZone.classList.remove('drag-over');
  // Handle files from e.dataTransfer
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault(); // REQUIRED for drop to work
  e.dataTransfer!.dropEffect = 'copy';
});
```

### Pattern 2: PDF Magic Bytes Validation
**What:** Read the first 5 bytes of each file and check for the `%PDF-` signature before accepting the file.
**When to use:** For INP-03 (non-PDF rejection). MIME type alone is unreliable.
**Why:** File extensions can be faked. MIME types are OS-dependent (some systems report `application/octet-stream` for PDFs). Magic bytes are the definitive check.
**Example:**
```typescript
async function isPdf(file: File): Promise<boolean> {
  // Quick check: MIME type (fast but unreliable)
  if (file.type === 'application/pdf') return true;

  // Definitive check: magic bytes
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  // %PDF- = [0x25, 0x50, 0x44, 0x46, 0x2D]
  return (
    header[0] === 0x25 &&
    header[1] === 0x50 &&
    header[2] === 0x44 &&
    header[3] === 0x46 &&
    header[4] === 0x2D
  );
}
```

### Pattern 3: Hidden File Input for Click-to-Browse
**What:** Create a hidden `<input type="file">` and programmatically click it when the user clicks the drop zone.
**When to use:** INP-02 fallback to drag-and-drop.
**Example:**
```typescript
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.pdf,application/pdf';
fileInput.multiple = true;
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) {
    handleFiles(Array.from(fileInput.files));
    fileInput.value = ''; // Reset for re-selection of same files
  }
});
```

### Pattern 4: CSS Transition Progress Bar
**What:** Use a `<div>` inside a container, animating `width` via CSS `transition`. Update width via `style.width = percentage + '%'`.
**Why:** CSS transitions are GPU-accelerated and don't block the main thread. No animation library needed.
**Example:**
```typescript
// HTML structure created in JS:
// <div class="progress-bar"><div class="progress-fill"></div></div>
const fill = document.querySelector('.progress-fill') as HTMLElement;
fill.style.transition = 'width 0.3s ease-out';

function updateProgress(iteration: number, totalEstimated: number): void {
  const pct = Math.min(100, Math.round((iteration / totalEstimated) * 100));
  fill.style.width = `${pct}%`;
}
```

### Pattern 5: WASM Ready State Tracking
**What:** Expose a `isReady()` method or observable from the CompressionController that the UI can check before starting compression.
**Why:** PRG-03 requires showing a loading state if WASM is not ready when user clicks compress.
**Example:**
```typescript
// In app.ts orchestrator:
async function onCompressClick(): Promise<void> {
  if (!controller.isReady) {
    showLoadingState('Preparing compression engine...');
    await controller.waitUntilReady();
    hideLoadingState();
  }
  // Proceed with compression
}
```

**Note:** The current `CompressionController` already has a `ready` promise (private). The planner should expose it publicly or add an `isReady` boolean + `waitUntilReady()` method.

### Pattern 6: Window-Level Drop Prevention
**What:** Add `dragover` and `drop` listeners on `window` to prevent the browser from opening dropped files outside the drop zone.
**Why:** Without this, dropping a PDF anywhere on the page navigates the browser to the file.
**Example:**
```typescript
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
```

### Anti-Patterns to Avoid
- **Reading all files into ArrayBuffer upfront:** The current `compressFiles()` in `main.ts` does `Promise.all(files.map(f => f.arrayBuffer()))` which loads ALL files into memory before processing. For Phase 2, accept this for now (typical batch is 1-5 files) but note it should be refactored for large batches in the future.
- **Using `file.type` alone for PDF validation:** Some OS/browser combinations return empty string or `application/octet-stream` for PDFs. Always check magic bytes.
- **Inline styles for everything:** Use a CSS file with classes. Inline styles are harder to maintain and don't support pseudo-elements (`:hover`, `::before` for drag states).
- **Removing and re-adding event listeners on state change:** Use CSS classes and conditional logic in event handlers instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-drop flicker | Custom relatedTarget checking | Counter-based approach (increment dragenter, decrement dragleave) | relatedTarget is null for file drags from OS; counter is proven reliable |
| File type validation | Extension-only checking | Magic bytes (`%PDF-` header) + MIME type | Extensions are unreliable; magic bytes are definitive |
| Number formatting | Custom byte formatter | `Intl.NumberFormat` or simple helper (`(bytes / 1024 / 1024).toFixed(1) + ' MB'`) | Already available in browser |
| Progress animation | requestAnimationFrame loop | CSS `transition: width 0.3s ease-out` | GPU-accelerated, zero JS overhead |

## Common Pitfalls

### Pitfall 1: Forgetting preventDefault on dragover
**What goes wrong:** Drop event never fires. Files dropped on the zone open in the browser instead.
**Why it happens:** The browser's default `dragover` behavior prevents the `drop` event from firing. This is easy to forget because `dragover` seems like a passive/visual event.
**How to avoid:** Always call `e.preventDefault()` in the `dragover` handler. Add it first when setting up the drop zone.
**Warning signs:** Drop zone highlights on drag but nothing happens on drop.

### Pitfall 2: Progress Estimation Inaccuracy
**What goes wrong:** The progress bar jumps or goes backward because the estimated total iterations is wrong.
**Why it happens:** The Phase 1 controller uses parallel probes then interpolation. The number of iterations varies per file (2-5 typically). Estimating "total" upfront is unreliable.
**How to avoid:** Use an indeterminate-style progress for per-file progress (pulsing bar or iteration counter text like "Attempt 3..."). Use determinate progress only for the file-level queue (file 2 of 5).
**Warning signs:** Progress bar goes from 80% back to 50%, or jumps from 20% to 100%.

### Pitfall 3: Drop Zone Not Accessible on Mobile
**What goes wrong:** Mobile users cannot drag-and-drop files. If the click-to-browse button is too small or poorly placed, mobile UX is broken.
**Why it happens:** Mobile browsers do not support drag-and-drop from the file system. The drop zone visual cue is irrelevant on mobile.
**How to avoid:** Make the entire drop zone clickable (not just a small button). The click triggers the hidden file input. On mobile, the drop zone text should say "Tap to select files" (detect via `'ontouchstart' in window` or media query).
**Warning signs:** Drop zone works on desktop but is useless on mobile.

### Pitfall 4: fileInput.value Not Reset After Selection
**What goes wrong:** User selects files, processes them, then tries to select the same files again. The `change` event doesn't fire because the value hasn't changed.
**Why it happens:** Browser optimization: `change` only fires when the value actually changes.
**How to avoid:** Set `fileInput.value = ''` after processing files from the `change` event.
**Warning signs:** "Nothing happens" when re-selecting the same files.

### Pitfall 5: Target Input Accepting Invalid Values
**What goes wrong:** User enters "0" for max size, negative numbers, or non-numeric text. Compression runs with nonsensical targets.
**Why it happens:** `<input type="number">` still allows empty values and doesn't enforce min/max on paste.
**How to avoid:** Validate on both `input` event and before compression starts. Clamp values: size mode min 0.1MB, percentage mode 1-99%. Show validation error inline.
**Warning signs:** Compression runs but produces unexpected results or errors.

## Code Examples

### Complete Drop Zone Setup
```typescript
// Source: MDN File drag and drop + counter flicker fix
export function createDropZone(
  container: HTMLElement,
  onFiles: (files: File[]) => void
): void {
  const dropZone = document.createElement('div');
  dropZone.className = 'drop-zone';
  dropZone.innerHTML = `
    <p class="drop-zone__prompt">
      Drop PDF files here or <button type="button" class="drop-zone__browse">browse</button>
    </p>
  `;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,application/pdf';
  fileInput.multiple = true;
  fileInput.hidden = true;
  dropZone.appendChild(fileInput);

  let dragCounter = 0;

  // Prevent browser from opening files dropped outside zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter === 0) {
      dropZone.classList.remove('drag-over');
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer?.files ?? []);
    onFiles(files);
  });

  dropZone.querySelector('.drop-zone__browse')!
    .addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger drop zone click
      fileInput.click();
    });

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) {
      onFiles(Array.from(fileInput.files));
      fileInput.value = '';
    }
  });

  container.appendChild(dropZone);
}
```

### File Validation with User Feedback
```typescript
interface ValidationResult {
  valid: File[];
  rejected: Array<{ file: File; reason: string }>;
}

async function validateFiles(files: File[]): Promise<ValidationResult> {
  const valid: File[] = [];
  const rejected: Array<{ file: File; reason: string }> = [];

  for (const file of files) {
    if (!(await isPdf(file))) {
      rejected.push({
        file,
        reason: `"${file.name}" is not a PDF file`,
      });
    } else {
      valid.push(file);
    }
  }

  return { valid, rejected };
}
```

### Target Configuration Toggle
```typescript
type TargetMode = 'size' | 'percentage';

interface TargetConfig {
  mode: TargetMode;
  sizeValueMB: number;    // Preserved when toggling
  percentValue: number;   // Preserved when toggling
}

function createTargetConfig(container: HTMLElement): {
  getTarget: () => CompressionTarget;
} {
  let config: TargetConfig = {
    mode: 'size',
    sizeValueMB: 4,
    percentValue: 50,
  };

  // Toggle between modes, preserving both values
  // Returns CompressionTarget for the compression API
  function getTarget(): CompressionTarget {
    if (config.mode === 'size') {
      return { mode: 'size', maxBytes: config.sizeValueMB * 1024 * 1024 };
    }
    return { mode: 'percentage', reductionPct: config.percentValue };
  }

  return { getTarget };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `e.dataTransfer.files` in drop handler | `e.dataTransfer.items` with `kind === 'file'` check | Longstanding | Items API allows filtering file vs non-file drags |
| Extension-only validation | Magic bytes + MIME type | Longstanding | More reliable, prevents non-PDF processing |
| jQuery UI sortable for drag-drop | Native HTML5 Drag and Drop API | ~2015+ | No dependency needed for simple file drops |
| JS-driven progress animation | CSS transition on width | ~2018+ | GPU-accelerated, smoother, less JS |

## Existing Code Integration Points

### compressFiles() API (src/main.ts)
```typescript
// Current signature -- Phase 2 UI calls this directly
export async function compressFiles(
  files: File[],
  target: CompressionTarget,
  onProgress?: (fileIndex: number, iteration: number, dpi: number, size: number) => void
): Promise<CompressionResult[]>
```

**Key observations for the planner:**
1. `onProgress` provides `(fileIndex, iteration, dpi, size)` -- iteration count is available but total is not. The UI must estimate total or use indeterminate progress per file.
2. The function reads ALL files into memory upfront (`Promise.all` of `arrayBuffer()`). Acceptable for typical 1-5 file batches, but the UI should warn or limit for very large batches.
3. `CompressionResult` has `skipped: boolean` and `compressedSize: 0` for errors. The UI must handle both states distinctly.

### CompressionController (src/compression/controller.ts)
- `ready` is a private `Promise<void>`. Phase 2 needs a public `isReady` flag or `waitUntilReady()` method for PRG-03.
- Worker pool size is dynamic (2-N based on `hardwareConcurrency`). Not relevant to UI but good for progress estimation.
- Per-file iteration count: typically 2-5 (parallel probes + 1-2 refinements). Use ~5 as estimated total for progress bar.

### CompressionTarget (src/compression/types.ts)
```typescript
export type CompressionTarget =
  | { mode: 'size'; maxBytes: number }
  | { mode: 'percentage'; reductionPct: number }
```
The UI toggle maps directly to this discriminated union. No adapter needed.

## Open Questions

1. **Progress total estimation**
   - What we know: The controller does 2 parallel probes + 1-2 refinements = 3-5 iterations per file. No `totalEstimated` in the progress callback.
   - What's unclear: Whether to estimate total (risk of going backward) or use indeterminate per-file progress.
   - Recommendation: Use determinate progress for file queue (file 2 of 5) and iteration counter text per-file ("Attempt 3..."). Avoid a per-file progress bar percentage that might go backward.

2. **Controller ready state exposure**
   - What we know: `this.ready` is private in `CompressionController`.
   - What's unclear: Whether to add a public API or check via a different mechanism.
   - Recommendation: Add `public isReady: boolean` flag and `public waitUntilReady(): Promise<void>` to the controller. Small change, high value for PRG-03.

3. **Restart / re-compression flow**
   - What we know: Phase 2 requirements don't include restart (that's RES-05 in Phase 3).
   - What's unclear: Whether to design the UI state machine with restart in mind now.
   - Recommendation: Design UI states (idle -> files-selected -> compressing -> done) as a simple state machine. Phase 3 adds the "done -> idle" transition.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INP-01 | Drag-drop fires onFiles callback with File[] | unit | `npx vitest run tests/drop-zone.test.ts -t "drag and drop"` | Wave 0 |
| INP-02 | Click triggers file input, change fires onFiles | unit | `npx vitest run tests/drop-zone.test.ts -t "click to browse"` | Wave 0 |
| INP-03 | Non-PDF rejected, PDF accepted (magic bytes) | unit | `npx vitest run tests/file-validation.test.ts` | Wave 0 |
| INP-04 | Size target returns correct CompressionTarget | unit | `npx vitest run tests/target-config.test.ts -t "size mode"` | Wave 0 |
| INP-05 | Percentage target returns correct CompressionTarget | unit | `npx vitest run tests/target-config.test.ts -t "percentage mode"` | Wave 0 |
| INP-06 | Toggle switches mode, preserves values | unit | `npx vitest run tests/target-config.test.ts -t "toggle"` | Wave 0 |
| PRG-01 | Status text updates with file count and name | unit | `npx vitest run tests/progress.test.ts -t "status text"` | Wave 0 |
| PRG-02 | Progress bar width updates on iteration | unit | `npx vitest run tests/progress.test.ts -t "progress bar"` | Wave 0 |
| PRG-03 | Loading state shown when WASM not ready | unit | `npx vitest run tests/app.test.ts -t "wasm loading"` | Wave 0 |
| PRG-04 | Error displayed per-file | unit | `npx vitest run tests/progress.test.ts -t "error"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/drop-zone.test.ts` -- covers INP-01, INP-02
- [ ] `tests/file-validation.test.ts` -- covers INP-03
- [ ] `tests/target-config.test.ts` -- covers INP-04, INP-05, INP-06
- [ ] `tests/progress.test.ts` -- covers PRG-01, PRG-02, PRG-04
- [ ] `tests/app.test.ts` -- covers PRG-03 (WASM loading state)

**Note on DOM testing:** These tests will need `jsdom` or `happy-dom` environment for DOM manipulation. Vitest supports this via `// @vitest-environment jsdom` comment or config. The project does not currently have a DOM test environment configured -- this is a Wave 0 gap.

- [ ] Install `jsdom` or `happy-dom` as dev dependency for DOM-based unit tests
- [ ] Configure vitest environment for UI test files

## Sources

### Primary (HIGH confidence)
- [MDN: File drag and drop](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop) -- complete drag-drop API reference
- [MDN: input type="file"](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file) -- accept, multiple attributes, change event
- [MDN: HTMLElement dragleave event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dragleave_event) -- dragleave behavior with child elements
- Phase 1 source code: `src/compression/controller.ts`, `src/compression/types.ts`, `src/main.ts` -- direct inspection of existing API

### Secondary (MEDIUM confidence)
- [Codemzy: 7 drag-and-drop gotchas](https://www.codemzy.com/blog/drag-and-drop-bug-fixes) -- counter-based flicker fix, verified against MDN
- [Smashing Magazine: Drag-and-Drop File Uploader](https://www.smashingmagazine.com/2018/01/drag-drop-file-uploader-vanilla-js/) -- vanilla JS implementation patterns
- [IDR Solutions: Check if PDF is valid using HTML5 File API](https://blog.idrsolutions.com/check-if-a-pdf-is-valid-using-html5-file-api/) -- magic bytes validation approach
- [Copy Programming: PDF Magic Numbers guide](https://copyprogramming.com/howto/pdf-and-docx-magic-numbers) -- %PDF- header specification

### Tertiary (LOW confidence)
- None -- all findings verified against MDN or direct code inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all native browser APIs
- Architecture: HIGH -- patterns well-established for vanilla JS file upload UIs
- Pitfalls: HIGH -- drag-drop quirks and file validation gotchas are extensively documented
- Integration with Phase 1: HIGH -- direct source code inspection of existing API

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable domain, browser APIs don't change frequently)
