import Module from '@jspawn/ghostscript-wasm'

type GsModule = Awaited<ReturnType<typeof Module>>

let gs: GsModule | null = null
const stderrBuffer: string[] = []

// Detect Node.js environment (used for test-time WASM loading workaround)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isNode = typeof (globalThis as any).process !== 'undefined'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  && (globalThis as any).process.versions?.node

const JSDELIVR_WASM = 'https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/gs.wasm'

function resolveWasmUrl(file: string): string {
  // In browser: serve the WASM from jsDelivr CDN to avoid Vercel bandwidth costs
  if (!isNode && file === 'gs.wasm') return JSDELIVR_WASM
  // In Node (tests): use local file — break static string so Vite doesn't bundle the WASM
  const base = '../../node_modules/@jspawn/ghostscript-wasm/'
  return new URL(base + file, import.meta.url).href
}

export async function initGhostscript(): Promise<void> {
  stderrBuffer.length = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: Record<string, any> = {
    print: () => {},
    printErr: (text: string) => stderrBuffer.push(text),
    locateFile: resolveWasmUrl,
  }

  // In Node (test environments), Emscripten's WASM loader is broken:
  // - file:// URLs get mangled by path.normalize()
  // - plain paths trigger fetch() in Node 18+ (which fails on local files)
  // Provide instantiateWasm to bypass Emscripten's detection entirely.
  if (isNode) {
    const wasmUrl = resolveWasmUrl('gs.wasm')
    opts.instantiateWasm = (
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance) => void
    ) => {
      ;(async () => {
        // Dynamic imports typed as any to avoid requiring @types/node
        // These only run in Node.js test environments, never in browser
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fsModule: any = await import(/* @vite-ignore */ 'fs')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const urlModule: any = await import(/* @vite-ignore */ 'url')
        const wasmPath = urlModule.fileURLToPath(wasmUrl)
        const wasmBytes = fsModule.readFileSync(wasmPath)
        const result = await WebAssembly.instantiate(wasmBytes, imports)
        successCallback(result.instance)
      })()
      return {} // Emscripten expects this return value
    }
  }

  gs = await Module(opts)
}

export function getGs(): GsModule {
  if (!gs) throw new Error('Ghostscript not initialized')
  return gs
}

export function getStderr(): string {
  return stderrBuffer.join('\n')
}
