import { describe, it, expect, vi } from 'vitest'
import { binarySearchCompress, compressAtDpi } from '../src/worker/engine'

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

describe('binarySearchCompress', () => {
  it('early exit at 300 DPI when output fits target', () => {
    const gs = createMockGs(() => 3_000_000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(3_000_000)
    // Should only call callMain once (early exit at 300 DPI)
    expect(gs.callMain).toHaveBeenCalledTimes(1)
  })

  it('converges in 3-4 iterations for typical files (size mode)', () => {
    // Realistic power-law: size scales with DPI^2
    // DPI 300 = 9MB, DPI 72 = 518KB, DPI ~200 = 4MB
    const gs = createMockGs((dpi) => Math.round(100 * dpi * dpi))
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000 // 4MB target
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(targetBytes)
    // Should use at most 4 Ghostscript calls
    expect(gs.callMain.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('percentage mode: same algorithm with converted target', () => {
    const gs = createMockGs((dpi) => Math.round(100 * dpi * dpi))
    const input = new Uint8Array(10_000_000)
    const targetBytes = 5_000_000 // 50% of 10MB
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(targetBytes)
  })

  it('returns null when even minimum DPI exceeds target (unreachable)', () => {
    // Even at 30 DPI, output is 2MB. Target is 500KB.
    const gs = createMockGs(() => 2_000_000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 500_000
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).toBeNull()
  })

  it('max 4 iterations enforced', () => {
    const gs = createMockGs((dpi) => dpi * 20000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000
    const onProgress = vi.fn()

    binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(gs.callMain.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('progress callback fires for each iteration', () => {
    const gs = createMockGs((dpi) => Math.round(100 * dpi * dpi))
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000
    const onProgress = vi.fn()

    binarySearchCompress(gs, input, targetBytes, onProgress)

    expect(onProgress).toHaveBeenCalled()
    for (const call of onProgress.mock.calls) {
      const [iteration, dpi, size] = call
      expect(typeof iteration).toBe('number')
      expect(typeof dpi).toBe('number')
      expect(typeof size).toBe('number')
      expect(dpi).toBeGreaterThanOrEqual(30)
      expect(dpi).toBeLessThanOrEqual(300)
    }
  })

  it('FS.unlink called for input and output files (cleanup)', () => {
    const gs = createMockGs(() => 3_000_000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000

    binarySearchCompress(gs, input, targetBytes, vi.fn())

    expect(gs.FS.unlink).toHaveBeenCalledWith('/input.pdf')
    expect(gs.FS.unlink).toHaveBeenCalledWith('/output.pdf')
  })

  it('callMain non-zero does not crash, returns null', () => {
    const gs = createMockGs(() => 5000, 1)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000

    const result = binarySearchCompress(gs, input, targetBytes, vi.fn())
    expect(result).toBeNull()
  })

  it('result is close to target (not wasting quality)', () => {
    // With power-law scaling, interpolation should get close
    const gs = createMockGs((dpi) => Math.round(100 * dpi * dpi))
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).not.toBeNull()
    // Result should be at least 70% of target (not over-compressing)
    expect(result!.length).toBeGreaterThan(targetBytes * 0.7)
    expect(result!.length).toBeLessThanOrEqual(targetBytes)
  })
})
