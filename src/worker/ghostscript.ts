// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isNode = typeof (globalThis as any).process !== 'undefined'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  && (globalThis as any).process.versions?.node

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2'

// SRI SHA-384 hashes of pinned CDN assets
const SRI_HASHES: Record<string, string> = {
  'gs.js': 'v3VW0yBONkKtZ5KiciD5wg/rgQBbDYVR7TP1J88obzveRDWQKmfKFfL2icuBVoBX',
  'gs.wasm': 'Ge6T6CfPVwH/AnZksXP3eV9ayuAMqKW2fb+D0/dN6XdUnh7QCk7tCEMncNMGZCIl',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GsModule = any
let gs: GsModule | null = null
const stderrBuffer: string[] = []

async function verifySRI(data: ArrayBuffer, expectedHash: string): Promise<boolean> {
  const hashBuffer = await crypto.subtle.digest('SHA-384', data)
  const hashArray = new Uint8Array(hashBuffer)
  // Convert to base64
  let binary = ''
  for (const byte of hashArray) binary += String.fromCharCode(byte)
  const actualHash = btoa(binary)
  return actualHash === expectedHash
}

async function fetchWithSRI(url: string, filename: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${filename}: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const expectedHash = SRI_HASHES[filename]
  if (expectedHash) {
    const valid = await verifySRI(buffer, expectedHash)
    if (!valid) {
      throw new Error(
        `SRI verification failed for ${filename}. ` +
        `The CDN may have been compromised. Aborting for your safety.`
      )
    }
  }
  return buffer
}

async function loadModuleBrowser(): Promise<(opts: Record<string, unknown>) => Promise<GsModule>> {
  // Fetch gs.js with SRI verification
  const jsBuffer = await fetchWithSRI(`${CDN_BASE}/gs.js`, 'gs.js')
  const jsText = new TextDecoder().decode(jsBuffer)

  // gs.js expects globalThis.exports to exist (set by browser.js)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).exports = {}

  // Evaluate the verified Emscripten glue code
  // eslint-disable-next-line no-eval
  const fn = new Function(jsText + '\nreturn Module;')
  const createModule = fn()

  // Clean up
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).exports

  return createModule
}

export async function initGhostscript(): Promise<void> {
  stderrBuffer.length = 0

  let Module: (opts: Record<string, unknown>) => Promise<GsModule>

  if (isNode) {
    const mod = await import(/* @vite-ignore */ '@jspawn/ghostscript-wasm')
    Module = mod.default
  } else {
    Module = await loadModuleBrowser()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: Record<string, any> = {
    print: () => {},
    printErr: (text: string) => stderrBuffer.push(text),
  }

  if (isNode) {
    // Node test path: load WASM from local file
    const wasmUrl = new URL(
      '../../node_modules/@jspawn/ghostscript-wasm/gs.wasm',
      import.meta.url
    ).href
    opts.locateFile = () => wasmUrl
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
  } else {
    // Browser path: fetch WASM with SRI, then instantiate from verified bytes
    const wasmBuffer = await fetchWithSRI(`${CDN_BASE}/gs.wasm`, 'gs.wasm')

    opts.instantiateWasm = (
      imports: WebAssembly.Imports,
      successCallback: (instance: WebAssembly.Instance) => void
    ) => {
      WebAssembly.instantiate(wasmBuffer, imports).then((result) => {
        successCallback(result.instance)
      })
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
