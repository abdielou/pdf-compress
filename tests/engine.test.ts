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
    // output.pdf should have been unlinked after reading
    expect(gs.FS.unlink).toHaveBeenCalledWith('/output.pdf')
  })
})

describe('binarySearchCompress', () => {
  it('Test 1: early exit at 300 DPI when output fits target', () => {
    // At 300 DPI, output is 3MB (fits under 4MB target)
    const gs = createMockGs(() => 3_000_000)
    const input = new Uint8Array(10_000_000) // 10MB input
    const targetBytes = 4_000_000 // 4MB target
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(3_000_000)
    // Should only call callMain once (early exit at 300 DPI)
    expect(gs.callMain).toHaveBeenCalledTimes(1)
  })

  it('Test 2: binary search converges on highest DPI under target (size mode)', () => {
    // Linear: dpi * 20000 bytes. 300 DPI = 6MB, 200 DPI = 4MB, 100 DPI = 2MB
    const gs = createMockGs((dpi) => dpi * 20000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000 // 4MB target => need DPI <= 200
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).not.toBeNull()
    // Result should be around 200 DPI or just below (binary search precision)
    // The size should be <= targetBytes
    expect(result!.length).toBeLessThanOrEqual(targetBytes)
    // And it should be reasonably close to the target (not using 30 DPI)
    // At DPI 195, size would be 3.9MB. At DPI 165, 3.3MB. We want close to 200.
    expect(result!.length).toBeGreaterThan(3_000_000)
  })

  it('Test 3: percentage mode converts to bytes and uses same algorithm', () => {
    // 10MB input, 50% reduction target = 5MB target bytes
    const gs = createMockGs((dpi) => dpi * 20000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 5_000_000 // 50% of 10MB
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(targetBytes)
    // DPI 250 = 5MB, so should converge around 250
    expect(result!.length).toBeGreaterThan(4_000_000)
  })

  it('Test 4: returns null when even 30 DPI exceeds target (unreachable)', () => {
    // Even at 30 DPI, output is 2MB. Target is 500KB.
    const gs = createMockGs(() => 2_000_000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 500_000
    const onProgress = vi.fn()

    const result = binarySearchCompress(gs, input, targetBytes, onProgress)
    expect(result).toBeNull()
  })

  it('Test 5: max 10 iterations enforced', () => {
    // Make sizes that never converge to keep binary search going
    let callCount = 0
    const gs = createMockGs((dpi) => {
      callCount++
      return dpi * 20000 // This will converge, but we track iterations
    })
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000
    const onProgress = vi.fn()

    binarySearchCompress(gs, input, targetBytes, onProgress)
    // 1 for 300 DPI check + up to 10 binary search iterations = max 11
    expect(gs.callMain.mock.calls.length).toBeLessThanOrEqual(11)
  })

  it('Test 6: progress callback fires for each iteration', () => {
    const gs = createMockGs((dpi) => dpi * 20000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000
    const onProgress = vi.fn()

    binarySearchCompress(gs, input, targetBytes, onProgress)

    // Progress should fire at least once (for 300 DPI check)
    expect(onProgress).toHaveBeenCalled()
    // Each call should have iteration, dpi, and size
    for (const call of onProgress.mock.calls) {
      const [iteration, dpi, size] = call
      expect(typeof iteration).toBe('number')
      expect(typeof dpi).toBe('number')
      expect(typeof size).toBe('number')
      expect(dpi).toBeGreaterThanOrEqual(30)
      expect(dpi).toBeLessThanOrEqual(300)
    }
  })

  it('Test 7: FS.unlink called for input and output files (cleanup)', () => {
    const gs = createMockGs(() => 3_000_000)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000

    binarySearchCompress(gs, input, targetBytes, vi.fn())

    // Input file should be cleaned up
    expect(gs.FS.unlink).toHaveBeenCalledWith('/input.pdf')
    // Output file should be cleaned up (by compressAtDpi)
    expect(gs.FS.unlink).toHaveBeenCalledWith('/output.pdf')
  })

  it('Test 8: callMain non-zero does not crash, returns null for that iteration', () => {
    // callMain always fails
    const gs = createMockGs(() => 5000, 1)
    const input = new Uint8Array(10_000_000)
    const targetBytes = 4_000_000

    const result = binarySearchCompress(gs, input, targetBytes, vi.fn())
    // Should return null since no iteration succeeds
    expect(result).toBeNull()
  })
})
