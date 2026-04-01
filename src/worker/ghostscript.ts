// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isNode = typeof (globalThis as any).process !== 'undefined'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  && (globalThis as any).process.versions?.node

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GsModule = any
let gs: GsModule | null = null
const stderrBuffer: string[] = []

async function loadModule(): Promise<(opts: Record<string, unknown>) => Promise<GsModule>> {
  if (isNode) {
    // In Node (tests): use local package
    const mod = await import(/* @vite-ignore */ '@jspawn/ghostscript-wasm')
    return mod.default
  }
  // In browser: load from CDN to bypass Vite bundling issues
  const mod = await import(/* @vite-ignore */ `${CDN_BASE}/gs.mjs`)
  return mod.default
}

function resolveWasmUrl(file: string): string {
  if (!isNode && file === 'gs.wasm') return `${CDN_BASE}/gs.wasm`
  return new URL(`../../node_modules/@jspawn/ghostscript-wasm/${file}`, import.meta.url).href
}

export async function initGhostscript(): Promise<void> {
  stderrBuffer.length = 0

  const Module = await loadModule()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: Record<string, any> = {
    print: () => {},
    printErr: (text: string) => stderrBuffer.push(text),
    locateFile: resolveWasmUrl,
  }

  if (isNode) {
    const wasmUrl = resolveWasmUrl('gs.wasm')
    opts.instantiateWasm = (
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance) => void
    ) => {
      ;(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fsModule: any = await import(/* @vite-ignore */ 'fs')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const urlModule: any = await import(/* @vite-ignore */ 'url')
        const wasmPath = urlModule.fileURLToPath(wasmUrl)
        const wasmBytes = fsModule.readFileSync(wasmPath)
        const result = await WebAssembly.instantiate(wasmBytes, imports)
        successCallback(result.instance)
      })()
      return {}
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
