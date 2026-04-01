import Module from '@jspawn/ghostscript-wasm'

type GsModule = Awaited<ReturnType<typeof Module>>

let gs: GsModule | null = null
const stderrBuffer: string[] = []

export async function initGhostscript(): Promise<void> {
  stderrBuffer.length = 0
  gs = await Module({
    print: () => {},
    printErr: (text: string) => stderrBuffer.push(text),
    locateFile: (file: string) =>
      new URL(
        `../../node_modules/@jspawn/ghostscript-wasm/${file}`,
        import.meta.url
      ).href,
  })
}

export function getGs(): GsModule {
  if (!gs) throw new Error('Ghostscript not initialized')
  return gs
}

export function getStderr(): string {
  return stderrBuffer.join('\n')
}
