# Stack Research

**Domain:** Browser-based PDF compression (client-side WASM)
**Researched:** 2026-03-31
**Confidence:** MEDIUM (Ghostscript WASM packages have limited adoption data; core tooling is well-established)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | ~5.8 | Type-safe application code | TS 6.0 just shipped (2026-03-23) but is brand new; 5.8 is battle-tested. Upgrade to 6.0 once Vite 8 confirms full compatibility. |
| Vite | ^8.0.3 | Build tool, dev server, WASM bundling | Latest stable. Rolldown-powered (10-30x faster builds). Native `.wasm?init` support. Deploys to Vercel with zero config. |
| @jspawn/ghostscript-wasm | ^0.0.2 | Ghostscript PDF compression engine (WASM) | See comparison below. Only viable choice for this project. |
| Web Workers (native) | N/A | Off-main-thread WASM execution | Built-in browser API. No library needed. Prevents UI freezing during CPU-intensive compression. |
| fflate | ^0.8.2 | ZIP generation for batch download | 8 kB, fastest pure-JS compression, built-in ZIP support, worker-friendly. Replaces JSZip. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vite-plugin-wasm | ^3.4 | WASM ESM integration for Vite | Required for importing WASM modules as ES modules in both main thread and workers. |
| vite-plugin-top-level-await | ^1.6.0 | Top-level await polyfill for non-esnext targets | Required companion to vite-plugin-wasm for Firefox/Safari support. Without it, must set `build.target: "esnext"` which drops older browsers. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vite dev server | Local development with HMR | Built into Vite. Handles WASM MIME types automatically. |
| TypeScript (via Vite) | Type checking | Vite transpiles TS but does not type-check; run `tsc --noEmit` separately. |
| Vercel CLI | Deployment | `vercel --prod` for static site deployment. Zero config for Vite projects. |

## Ghostscript WASM: @jspawn/ghostscript-wasm vs @okathira/ghostpdl-wasm

**Recommendation: Use `@jspawn/ghostscript-wasm`** -- but evaluate `@okathira/ghostpdl-wasm` if you hit issues.

| Criterion | @jspawn/ghostscript-wasm | @okathira/ghostpdl-wasm |
|-----------|--------------------------|-------------------------|
| **Version** | 0.0.2 | 1.1.0 |
| **Last published** | ~1 year ago | ~1 month ago (as of 2026-03) |
| **TypeScript types** | No bundled types (Emscripten Module pattern) | Yes -- bundled declarations extending EmscriptenModule |
| **API** | `Module()` factory, `callMain(args)`, `FS` virtual filesystem | Same API surface: `callMain`, `Module.FS`, typed `GhostscriptModule` |
| **GS version** | Unknown (git submodule of ghostpdl) | Unknown (built from GhostPDL source) |
| **WASM size** | ~8-10 MB raw | Unknown (likely similar) |
| **Provenance** | No npm provenance | npm Package Provenance (cryptographic link to source) |
| **Real-world usage** | Multiple reference projects (laurentmmeyer, oaustegard gist, sf73, krmanik/local-pdf-tools) | No known dependents |
| **Confidence** | MEDIUM -- proven in multiple browser PDF compressors | LOW -- newer, better typed, but zero community validation |

### Why @jspawn despite being older

1. **Proven pattern.** Multiple open-source browser PDF compressors use it successfully: [ghostscript-pdf-compress.wasm](https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm), [local-pdf-tools](https://github.com/krmanik/local-pdf-tools), [gs-wasm](https://sf73.github.io/gs-wasm/). These are working reference implementations we can study.
2. **Known API surface.** The `Module()` / `callMain()` / `FS` pattern is well-documented through DeepWiki and usage examples.
3. **Risk mitigation.** Zero dependents on @okathira means zero bug reports, zero edge-case discovery. For a WASM binary that processes arbitrary user PDFs, community validation matters.

### When to switch to @okathira

- If @jspawn stops working with modern Vite/Rolldown (stale package risk).
- If TypeScript types become a significant pain point (writing custom `.d.ts` for @jspawn is straightforward but tedious).
- If @okathira gains community adoption and we can verify it handles real-world PDFs.

### WASM Loading Strategy

The WASM binary (~10 MB over the wire with Brotli) must be handled carefully:

1. **Lazy-load in Web Worker.** Start downloading WASM when page loads (background `fetch`), but do not block initial render.
2. **Immutable caching.** Serve with `Cache-Control: public, max-age=31536000, immutable`. After first visit, WASM loads from disk cache.
3. **Vercel asset handling.** Place `.wasm` in public directory or configure Vite to emit it as a static asset (not inlined). Vercel serves static assets with Brotli compression automatically.

## ZIP Generation: fflate over JSZip

**Recommendation: Use fflate.** Confidence: HIGH.

| Criterion | fflate 0.8.2 | JSZip 3.10.1 |
|-----------|--------------|--------------|
| **Size** | ~8 kB (with ZIP support) | ~45 kB |
| **Speed** | Fastest pure-JS (de)compression | Slower; blocks main thread |
| **Worker support** | Built-in async with worker threads | No native worker support |
| **Weekly downloads** | ~32M | ~26M |
| **Last update** | 2 years ago (stable, feature-complete) | 4 years ago |
| **ZIP creation API** | `zipSync()` for simple use, streaming `Zip` class for large files | `generateAsync()` |
| **TypeScript** | Bundled types | @types/jszip needed |

For this project, compressed PDFs are already deflated -- fflate's `ZipPassThrough` mode (store without recompression) is ideal. No point double-compressing already-compressed PDF data.

## Vite Configuration

### Key config for WASM + Web Workers

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
  },
  optimizeDeps: {
    exclude: ["@jspawn/ghostscript-wasm"],
  },
  build: {
    target: "es2022",
  },
});
```

### Critical notes

- **`worker.plugins`** must include wasm + top-level-await for WASM imports inside Web Workers.
- **`optimizeDeps.exclude`** prevents Vite from trying to pre-bundle the WASM package (causes ESBuild errors).
- **Do NOT use ES workers for Firefox.** Keep default `worker.format` (not `"es"`).
- **Vite 8 with Rolldown** maintains plugin API compatibility, so vite-plugin-wasm should work. Flag: this is LOW confidence -- Vite 8 is 19 days old. Test early.

## Installation

```bash
# Core
npm install @jspawn/ghostscript-wasm fflate

# Dev dependencies
npm install -D typescript vite vite-plugin-wasm vite-plugin-top-level-await
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Compression engine | @jspawn/ghostscript-wasm | @okathira/ghostpdl-wasm | Zero community validation; newer TypeScript types are nice but not worth the unknown risk for processing arbitrary PDFs |
| Compression engine | @jspawn/ghostscript-wasm | MuPDF WASM | Unclear JavaScript API for quality/DPI control needed by binary search algorithm |
| Compression engine | @jspawn/ghostscript-wasm | lopdf + mozjpeg (Rust WASM) | Too much custom work, edge-case risk with real-world PDFs; Ghostscript is battle-tested |
| ZIP library | fflate | JSZip | Larger, slower, no worker support, less maintained |
| ZIP library | fflate | client-zip | Streaming-only API; we have all files in memory already, simpler to use fflate's sync API |
| Build tool | Vite 8 | Webpack | Slower, more config, worse DX for this scale of project |
| Framework | Vanilla TS | React/Svelte | One page, no routing, no shared state -- framework adds complexity without benefit |
| TypeScript | 5.8 | 6.0 | TS 6.0 is 8 days old; 5.8 is proven stable with Vite ecosystem |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **React / Next.js** | Massive overhead for a single-page tool with no routing or state management | Vanilla TypeScript with DOM APIs |
| **JSZip** | Larger, slower, blocks main thread, 4 years without updates | fflate (8 kB, faster, worker-aware) |
| **pdf-lib / pdf.js** | Cannot recompress embedded images (the primary compression lever); only manipulate PDF structure | Ghostscript WASM (full re-render at target DPI) |
| **Server-side compression** | Violates core privacy value (F2); adds infrastructure cost and latency | Client-side WASM |
| **Comlink** | Adds abstraction over postMessage that is unnecessary for a single worker with a simple message protocol | Direct `postMessage` / `onmessage` pattern |
| **vite-plugin-wasm-pack** | Designed for Rust wasm-pack output, not Emscripten WASM modules | vite-plugin-wasm (generic WASM ESM support) |
| **ES Worker format** | Breaks Firefox support when combined with WASM imports | Default worker format (classic/IIFE) |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| vite-plugin-wasm incompatible with Vite 8 / Rolldown | LOW-MEDIUM | HIGH (blocks build) | Test immediately in phase 1. Fallback: use Vite's native `.wasm?init` with manual loading. |
| @jspawn/ghostscript-wasm abandoned (last update 1 year ago) | MEDIUM | MEDIUM | @okathira/ghostpdl-wasm as drop-in replacement (same callMain/FS API). |
| WASM binary too large for acceptable UX | LOW | MEDIUM | Lazy-load + immutable caching. Future: custom minimal GS build (~4-5 MB Brotli). |
| Firefox WASM + Worker issues | MEDIUM | MEDIUM | Use vite-plugin-top-level-await >= 1.4.0; avoid ES worker format; test Firefox in CI. |

## Sources

- [@jspawn/ghostscript-wasm npm](https://www.npmjs.com/package/@jspawn/ghostscript-wasm) -- package details
- [jsscheller/ghostscript-wasm GitHub](https://github.com/jsscheller/ghostscript-wasm) -- source repository
- [DeepWiki: ghostscript-wasm](https://deepwiki.com/jsscheller/ghostscript-wasm) -- API documentation and usage patterns
- [@okathira/ghostpdl-wasm npm](https://www.npmjs.com/package/@okathira/ghostpdl-wasm) -- alternative package
- [laurentmmeyer/ghostscript-pdf-compress.wasm](https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm) -- reference implementation with Web Worker
- [oaustegard gist: Client-Side PDF Compressor](https://gist.github.com/oaustegard/2bc7a7537626882aac03db985a0774d2) -- single-file reference implementation
- [krmanik/local-pdf-tools](https://github.com/krmanik/local-pdf-tools) -- full-featured browser PDF tool using GS WASM
- [vite-plugin-wasm GitHub](https://github.com/Menci/vite-plugin-wasm) -- WASM plugin for Vite, supports Vite 2-8
- [Vite 8.0 announcement](https://vite.dev/blog/announcing-vite8) -- Rolldown integration, WASM SSR support
- [fflate GitHub](https://github.com/101arrowz/fflate) -- compression library with ZIP support
- [fflate vs jszip npm trends](https://npmtrends.com/fflate-vs-jszip-vs-pako) -- download comparison
- [TypeScript 6.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) -- latest TS release
