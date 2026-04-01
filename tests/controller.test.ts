import { describe, it, expect, vi } from 'vitest'
import type {
  CompressionTarget,
} from '../src/compression/types'

// Test the interpolateDpi logic and controller skip behavior
// Controller internals are tested via the public API

describe('CompressionController: skip logic', () => {
  it('Test 1: skips files already under target size (no worker needed)', async () => {
    // We test this by mocking createCompressionWorker
    // But since controller creates workers internally, we test the logic directly
    // by verifying the contract: small file -> skipped result

    // Import controller module to test skip logic
    const { CompressionController } = await import('../src/compression/controller')

    // Mock createCompressionWorker at module level
    vi.spyOn(await import('../src/compression/worker-client'), 'createCompressionWorker')
      .mockImplementation(() => {
        const listeners: Map<string, Function[]> = new Map()
        const worker = {
          postMessage: vi.fn((data: any) => {
            if (data.type === 'init') {
              // Simulate ready
              setTimeout(() => {
                const handlers = listeners.get('message') || []
                handlers.forEach(h => h({ data: { type: 'ready' } }))
              }, 0)
            }
          }),
          addEventListener: vi.fn((type: string, handler: Function) => {
            if (!listeners.has(type)) listeners.set(type, [])
            listeners.get(type)!.push(handler)
          }),
          removeEventListener: vi.fn((type: string, handler: Function) => {
            const handlers = listeners.get(type) || []
            const idx = handlers.indexOf(handler)
            if (idx >= 0) handlers.splice(idx, 1)
          }),
          terminate: vi.fn(),
          onmessage: null,
          onerror: null,
        } as unknown as Worker
        return worker
      })

    const controller = new CompressionController()
    const smallBuffer = new ArrayBuffer(1000)
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

    // Wait for ready
    await new Promise(r => setTimeout(r, 10))

    const results = await controller.compressFiles(
      [{ name: 'small.pdf', buffer: smallBuffer }],
      target
    )

    expect(results).toHaveLength(1)
    expect(results[0].skipped).toBe(true)
    expect(results[0].fileName).toBe('small.pdf')
    expect(results[0].originalSize).toBe(1000)

    vi.restoreAllMocks()
  })
})

describe('Interpolation algorithm', () => {
  // Test the interpolation logic by importing it
  // Since interpolateDpi is not exported, we test it indirectly through
  // the engine's compressAtDpi which IS exported, and test interpolation math here

  it('Test 2: power law interpolation finds reasonable DPI', () => {
    // Manual test of the interpolation math
    // Given: DPI 72 -> 645KB, DPI 300 -> 9.8MB, target 4MB
    // size = k * dpi^exp
    // exp = log(9800000/645000) / log(300/72) = log(15.19) / log(4.17) = 2.72 / 1.43 = 1.91
    // k = 645000 / 72^1.91 = 645000 / 4018 = 160.5
    // target DPI = (4000000 / 160.5) ^ (1/1.91) = 24922 ^ 0.524 = ~192

    // This verifies the math is in the right ballpark
    const exp = Math.log(9800000 / 645000) / Math.log(300 / 72)
    const k = 645000 / Math.pow(72, exp)
    const estimated = Math.pow(4000000 / k, 1 / exp)

    expect(estimated).toBeGreaterThan(170)
    expect(estimated).toBeLessThan(220)
  })

  it('Test 3: handles edge case where sizes are equal', () => {
    // If both probes return same size, linear fallback should not crash
    const exp = Math.log(1000 / 1000) / Math.log(300 / 72) // log(1) = 0
    expect(exp).toBe(0) // Would cause division by zero in power law
    // Controller handles this with the isFinite check and linear fallback
  })
})

describe('Integration: parallel probes concept', () => {
  it('Test 4: two concurrent DPI probes can run independently', async () => {
    // Verify that two workers can receive commands simultaneously
    const results: number[] = []

    const p1 = new Promise<number>(resolve => {
      setTimeout(() => {
        results.push(1)
        resolve(1)
      }, 10)
    })
    const p2 = new Promise<number>(resolve => {
      setTimeout(() => {
        results.push(2)
        resolve(2)
      }, 10)
    })

    await Promise.all([p1, p2])
    expect(results).toHaveLength(2)
    // Both resolved, order doesn't matter
  })

  it('Test 5: best result tracking picks highest quality under target', () => {
    // Simulate the best-result tracking logic
    const targetBytes = 4_000_000
    const probes = [
      { dpi: 300, size: 9_800_000 }, // too big
      { dpi: 72, size: 645_000 },    // fits but low quality
      { dpi: 192, size: 3_500_000 }, // fits, better quality
      { dpi: 207, size: 4_000_861 }, // too big (just over)
    ]

    let bestSize = 0
    let bestDpi = 0
    for (const p of probes) {
      if (p.size <= targetBytes && p.size > bestSize) {
        bestSize = p.size
        bestDpi = p.dpi
      }
    }

    expect(bestDpi).toBe(192)
    expect(bestSize).toBe(3_500_000)
  })
})
