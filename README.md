# Safe PDF Resize

Compress PDF files directly in your browser. No uploads, no server, no data ever leaves your device.

## How it works

- Drag and drop (or browse) one or more PDF files
- Choose a target: **max file size** (e.g. 4 MB) or **percentage reduction**
- Hit **Compress** — results appear with original vs. compressed sizes
- Download files individually or all at once as a ZIP

Compression is done by [Ghostscript](https://www.ghostscript.com/) compiled to WebAssembly, running entirely client-side in a Web Worker pool.

## Privacy

Files are processed locally using WebAssembly. Nothing is uploaded anywhere. The page works fully offline once loaded.

## Development

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm test          # unit tests (Vitest)
npx playwright test   # e2e tests (requires dev server running)
npm run build     # production build → dist/
```

**Stack:** TypeScript · Vite · Ghostscript WASM · Vitest · Playwright

## Deploy

The build output (`dist/`) is a fully static site. Deploy to any static host:

```bash
npm run build
# upload dist/ to Vercel, Netlify, GitHub Pages, etc.
```
