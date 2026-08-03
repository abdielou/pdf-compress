import { describe, it, expect, vi } from 'vitest'
import { compressAtDpi } from '../src/worker/engine'

/**
 * Create a mock GsModule that simulates Ghostscript behavior.
 * sizeForDpi controls the output size for a given DPI.
 * returnCode controls the callMain exit code (0 = success).
 */
function createMockGs(
  sizeForDpi: (dpi: number) => number,
  returnCode: number | ((dpi: number) => number) = 0
) {
  const files = new Map<string, Uint8Array>()
  let lastDpi = 300

  const gs = {
    FS: {
      writeFile: vi.fn((path: string, data: Uint8Array) => {
        files.set(path, data)
      }),
      readFile: vi.fn((path: string) => {
        const data = files.get(path)
        if (!data) throw new Error(`File not found: ${path}`)
        return data
      }),
      unlink: vi.fn((path: string) => {
        files.delete(path)
      }),
      stat: vi.fn((path: string) => ({
        size: files.get(path)?.length ?? 0,
      })),
    },
    callMain: vi.fn((args: string[]) => {
      // Parse DPI from args
      const dpiArg = args.find((a) => a.startsWith('-dColorImageResolution='))
      lastDpi = parseInt(dpiArg?.split('=')[1] ?? '300')
      const size = sizeForDpi(lastDpi)

      const code = typeof returnCode === 'function' ? returnCode(lastDpi) : returnCode
      if (code === 0) {
        // Write output file
        files.set('/output.pdf', new Uint8Array(size))
      }
      return code
    }),
  }

  return gs
}

describe('compressAtDpi', () => {
  it('returns bytes and size on success', async () => {
    const gs = createMockGs(() => 5000)
    const input = new Uint8Array(10000)
    gs.FS.writeFile('/input.pdf', input)

    const result = compressAtDpi(gs, 150)
    expect(result).not.toBeNull()
    expect(result!.size).toBe(5000)
    expect(result!.bytes).toBeInstanceOf(Uint8Array)
    expect(result!.bytes.length).toBe(5000)
  })

  it('returns null when callMain returns non-zero', () => {
    const gs = createMockGs(() => 5000, 1)
    const input = new Uint8Array(10000)
    gs.FS.writeFile('/input.pdf', input)

    const result = compressAtDpi(gs, 150)
    expect(result).toBeNull()
  })

  it('cleans up output file in finally block', () => {
    const gs = createMockGs(() => 5000)
    const input = new Uint8Array(10000)
    gs.FS.writeFile('/input.pdf', input)

    compressAtDpi(gs, 150)
    expect(gs.FS.unlink).toHaveBeenCalledWith('/output.pdf')
  })
})
