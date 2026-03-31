# Feature Landscape

**Domain:** Browser-based PDF compression tool (client-side, privacy-focused)
**Researched:** 2026-03-31
**Overall confidence:** HIGH

## Competitor Landscape Summary

Competitors fall into two tiers:

**Server-side incumbents** (iLovePDF, SmallPDF, PDF24, Compress2Go): Full-featured, polished, but upload files to servers. They dominate search rankings and have suite ecosystems (merge, split, convert, etc.). Compression is one tool among 20+.

**Client-side privacy tools** (SaferPDF, DownsizePDF, LocalPDF, laurentmmeyer/ghostscript-pdf-compress.wasm): Newer, smaller, privacy-first. Most use Ghostscript WASM under the hood. Varying quality -- some are polished (SaferPDF), others are bare demos (laurentmmeyer). Several have monetization friction (email gates, daily limits, paid tiers).

**Adjacent inspiration** (Squoosh by Google Chrome Labs): Gold standard for client-side compression UX in the image domain. Key lessons: real-time comparison UI, WASM-powered codecs, offline PWA, open source, zero monetization friction.

---

## Table Stakes

Features users expect from any PDF compression tool. Missing any of these and users bounce.

| # | Feature | Why Expected | Complexity | Notes |
|---|---------|--------------|------------|-------|
| T1 | **Drag-and-drop file upload** | Every competitor has it. Users expect to drop files, not navigate a file picker. | Low | Also support click-to-browse as fallback. |
| T2 | **Compression quality presets** | iLovePDF (3 levels), PDF24 (normal/lossless), DownsizePDF (4 levels), SmallPDF (basic/strong). Users expect some control. | Low | Project uses two target modes (max size / % reduction) instead -- this is a *better* approach than presets because it's goal-oriented. Satisfies this need differently. |
| T3 | **Before/after size display** | Every tool shows original size, compressed size, and % savings. Users need proof it worked. | Low | Per-file rows in results table. |
| T4 | **Download compressed file(s)** | Obvious. Every tool has individual download buttons. | Low | Single file = direct download. Multi-file = ZIP. |
| T5 | **Progress indication** | Compression takes seconds to minutes. Without feedback users think it's frozen. | Medium | Per-file status ("Compressing 2/5... filename.pdf") with progress bar. Binary search means multiple iterations per file. |
| T6 | **Multi-file / batch upload** | iLovePDF, PDF24, pdfcompressor.com all support batch. Single-file-only is a dealbreaker for power users. | Medium | Already in project scope. Batch is core to the value prop. |
| T7 | **No account required** | PDF24 and iLovePDF free tiers require no login. Friction kills tool adoption. | None | Architecture decision -- no auth system to build. |
| T8 | **Mobile-responsive layout** | Many users compress PDFs on phones (iLovePDF and SmallPDF both have mobile apps). Web tool must at minimum work on mobile browsers. | Low | Single-page layout naturally responsive. Touch-friendly drop zone. |
| T9 | **Clear privacy messaging** | Client-side tools all prominently display "files never leave your browser." Without this, the privacy advantage is invisible. | Low | Banner or badge near the drop zone. Not buried in a footer. |

---

## Differentiators

Features that set this tool apart. Not expected, but valued -- these create competitive advantage.

| # | Feature | Value Proposition | Complexity | Notes |
|---|---------|-------------------|------------|-------|
| D1 | **Target-based compression (size or %)** | Most competitors offer vague "quality levels." This tool lets users say "make it under 4MB" or "reduce by 50%" -- goal-oriented, not knob-twiddling. Binary search finds highest quality that fits. | High | Core algorithm. This IS the product differentiator. No competitor in the client-side space does this well. |
| D2 | **Smart skip ("already fits")** | Files already under target are not recompressed. Preserves quality, saves time, shows respect for the user's content. No competitor explicitly surfaces this. | Low | Simple size check before compression. Display "Already fits" badge in results. |
| D3 | **100% client-side processing** | SaferPDF and DownsizePDF also claim this, but SaferPDF has daily limits (10/day free) and DownsizePDF has an email gate before download. This tool: no limits, no gates, no friction. | None (architectural) | The privacy story is only a differentiator vs. server-side tools. vs. other client-side tools, the differentiator is *zero friction*. |
| D4 | **ZIP download for batch results** | Some server-side tools offer this but most client-side tools process one file at a time (DownsizePDF explicitly says "one file at a time"). Batch + ZIP is a real workflow advantage. | Medium | JSZip library or similar. Per-file fallback if ZIP fails. |
| D5 | **Offline capability (PWA)** | SaferPDF claims "works offline after first compression." Squoosh is a full PWA. Once WASM is cached, this tool could work on airplanes. | Medium | Service worker + cache manifest. WASM binary is the key asset to cache. Natural fit given static architecture. |
| D6 | **Open source (AGPL)** | Required by Ghostscript license, but also a trust signal. SaferPDF links to source code. Most server-side competitors are closed source. | None (already decided) | Link to GitHub repo prominently. "Verify our privacy claims yourself." |
| D7 | **Instant start (lazy WASM load)** | UI renders immediately, WASM downloads in background. If user acts before WASM is ready, show loading state. Most WASM tools block on load. | Medium | Already in project scope. Web Worker + background fetch on page load. |

---

## Anti-Features

Features to explicitly NOT build. These are tempting but wrong for this project.

| # | Anti-Feature | Why Avoid | What to Do Instead |
|---|--------------|-----------|-------------------|
| AF1 | **Server-side processing / hybrid mode** | Contradicts the core privacy value proposition. "Files never leave your browser" must be absolute, not "usually." | Client-side only. Period. If a PDF is too large for WASM, say so honestly rather than falling back to a server. |
| AF2 | **User accounts / login** | Adds friction, requires a backend, creates data liability. Tool apps that require login lose 80%+ of casual users. | Stateless by design. No persistence, no profiles, no history. |
| AF3 | **Daily compression limits / paywalls** | SaferPDF limits to 10/day free. DownsizePDF gates downloads behind email verification. These are monetization patterns that undermine trust. | Unlimited, free, no gates. Monetization (if ever) through optional donations or sponsorship, never through feature restriction. |
| AF4 | **Full PDF editing suite** | iLovePDF/SmallPDF have 20+ tools (merge, split, convert, sign, OCR). Scope creep destroys focus. This is a compressor, not a suite. | Single-purpose tool. Do compression extremely well. Link to other tools if users need them. |
| AF5 | **Advanced compression knobs** | DPI sliders, JPEG quality numbers, color space options, font subsetting toggles. Power-user options that confuse 95% of users and undermine the "just works" value. | Two modes: target size and target %. The algorithm finds the best quality. Users set goals, not parameters. |
| AF6 | **Cloud storage integration** | Google Drive, Dropbox import/export. Adds OAuth complexity, third-party dependencies, and muddies the "files stay local" story. | File input from device only. Users can save results to wherever they want via standard download. |
| AF7 | **Analytics / tracking scripts** | Privacy tool that tracks users is hypocritical. Even "anonymous" analytics erodes trust. | No Google Analytics, no tracking pixels, no telemetry. If metrics are needed, use privacy-respecting server logs (page views only) or nothing. |
| AF8 | **Email capture / newsletter** | DownsizePDF requires email before download. This is user-hostile in a tool context. | No email collection. No popups. No "sign up for updates." |

---

## Feature Dependencies

```
T1 (Drag-and-drop) ──────┐
                          ├──> T5 (Progress) ──> T3 (Before/after) ──> T4 (Download)
T6 (Batch upload) ────────┘                                              │
                                                                         ├──> D4 (ZIP download)
                                                                         │
D1 (Target-based compression) ──> D2 (Smart skip)                       │
                                                                         │
D7 (Lazy WASM load) ──> [All compression features]                      │
                                                                         │
D5 (PWA/Offline) ──> requires D7 (cached WASM)                          │

Independent:
  T7 (No account) -- architectural, no dependency
  T8 (Mobile responsive) -- CSS only
  T9 (Privacy messaging) -- copy only
  D3 (Client-side) -- architectural
  D6 (Open source) -- repo setup only
```

**Critical path:** D7 (WASM loading) -> D1 (compression algorithm) -> T5 (progress) -> T3 (results) -> T4/D4 (download)

Everything flows from the WASM engine working. Build the compression pipeline first, then wrap UI around it.

---

## MVP Recommendation

### Must ship (Phase 1 -- core loop)

1. **T1** Drag-and-drop upload (single + multi-file)
2. **D1** Target-based compression with binary search (both modes)
3. **D2** Smart skip for files already under target
4. **T5** Per-file progress feedback
5. **T3** Results table with before/after sizes
6. **T4** Download individual files
7. **D7** Lazy WASM loading in Web Worker
8. **T9** Privacy messaging ("files never leave your browser")

### Ship soon after (Phase 2 -- polish)

9. **D4** ZIP download for batch results
10. **T8** Mobile-responsive layout (test and fix)
11. **D6** Open source repo with README and license

### Defer (Phase 3 -- nice to have)

12. **D5** PWA / offline support (service worker caching)
13. Dark mode (not a differentiator but increasingly expected)

### Never build

All anti-features (AF1-AF8). Revisit only if fundamental business model changes.

---

## Feature Prioritization Matrix

| Feature | User Impact | Build Effort | Risk | Priority |
|---------|------------|-------------|------|----------|
| D1 Target compression | Critical -- core value | High -- binary search + WASM | Medium -- WASM perf unknown | P0 |
| T1 Drag-and-drop | Critical -- entry point | Low | Low | P0 |
| D7 Lazy WASM load | Critical -- blocks all compression | Medium -- Worker + caching | Medium -- 10MB binary | P0 |
| T5 Progress feedback | High -- trust signal | Medium -- Worker messaging | Low | P0 |
| T3 Before/after display | High -- proof of value | Low | Low | P0 |
| T4 File download | Critical -- exit point | Low | Low | P0 |
| D2 Smart skip | Medium -- quality preservation | Low | Low | P1 |
| T9 Privacy messaging | Medium -- trust/positioning | Low | Low | P1 |
| D4 ZIP download | Medium -- batch convenience | Medium | Low | P1 |
| T8 Mobile responsive | Medium -- wider audience | Low | Low | P1 |
| D6 Open source setup | Low (immediate) / High (long-term trust) | Low | Low | P1 |
| D5 PWA offline | Low -- niche use case | Medium | Low | P2 |

---

## Competitive Gaps and Opportunities

### What competitors do poorly (opportunity)

1. **Goal-oriented compression**: Every competitor uses vague quality levels. Nobody lets you say "fit under 4MB" and automatically finds the best quality. This is the biggest UX gap in the market.

2. **Zero-friction client-side**: SaferPDF limits to 10/day. DownsizePDF requires email. LocalPDF is bare-bones. There is no polished, unlimited, no-strings client-side compressor.

3. **Batch + client-side**: DownsizePDF processes one file at a time. Most client-side tools are single-file. Batch processing with ZIP download in a client-side tool is genuinely differentiated.

### What competitors do well (learn from)

1. **iLovePDF/SmallPDF polish**: Beautiful, intuitive interfaces. The drag-and-drop zones are large, clear, and inviting. Results are presented cleanly.

2. **Squoosh comparison UI**: Real-time before/after slider is brilliant for images. For PDFs this is less applicable (no visual preview needed), but the principle of immediate feedback applies.

3. **PDF24 no-limits model**: No registration, no watermarks, no limits. This generosity builds massive trust and traffic. Follow this model.

---

## Sources

- [iLovePDF Compress](https://www.ilovepdf.com/compress_pdf) -- compression modes, features
- [SmallPDF Compress](https://smallpdf.com/compress-pdf) -- interface design, 21-tool suite
- [PDF24 Compress](https://tools.pdf24.org/en/compress-pdf) -- no-limits model, compression options
- [Compress2Go](https://www.compress2go.com/compress-pdf) -- compression methods, grayscale option
- [SaferPDF](https://www.saferpdf.com/) -- client-side competitor, daily limits, quality preview
- [DownsizePDF](https://downsizepdf.com/) -- client-side competitor, email gate, compression levels
- [LocalPDF](https://localpdf.online/compress-pdf) -- client-side competitor, minimal features
- [ghostscript-pdf-compress.wasm](https://github.com/laurentmmeyer/ghostscript-pdf-compress.wasm) -- open source Ghostscript WASM demo
- [Squoosh](https://squoosh.app/) -- gold standard client-side compression UX (images)
- [PDFClear on HN](https://news.ycombinator.com/item?id=46036944) -- WASM + browser PDF tools discussion
