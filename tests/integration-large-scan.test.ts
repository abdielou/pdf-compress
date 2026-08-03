import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import '@vitest/web-worker'
import { initGhostscript, getGs } from '../src/worker/ghostscript'
import { compressAtDpi } from '../src/worker/engine'
import { buildNoisePdf } from './noise-pdf'

/**
 * Regression tests for the 67MB-to-0.8MB overshoot bug: with AutoFilter
 * enabled, Ghostscript's output size was erratic in DPI, so the DPI search
 * collapsed to the 72 DPI probe instead of landing near the target.
 * These run REAL Ghostscript WASM.
 */

describe('Real Ghostscript: size tracks DPI monotonically', () => {
  it('produces non-increasing sizes as DPI decreases', { timeout: 120_000 }, async () => {
    const pdf = buildNoisePdf(1, 1700, 2200)
    await initGhostscript()
    const gs = getGs()

    const sizes: number[] = []
    for (const dpi of [300, 150, 100, 72]) {
      gs.FS.writeFile('/input.pdf', pdf)
      try {
        const result = compressAtDpi(gs, dpi)
        expect(result, `compression failed at DPI ${dpi}`).not.toBeNull()
        sizes.push(result!.size)
      } finally {
        try { gs.FS.unlink('/input.pdf') } catch { /* ignore */ }
      }
    }

    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i], `size at rung ${i} vs ${i - 1} of [300,150,100,72]`)
        .toBeLessThanOrEqual(sizes[i - 1])
    }
  })
})

describe('Real end-to-end: large scan with 4MB target', () => {
  beforeAll(() => {
    // 2 workers: keep the Node test light
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('lands near the target instead of collapsing to the low probe', { timeout: 300_000 }, async () => {
    const pdf = buildNoisePdf(5, 1700, 2200)  // ~53MB
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'big-scan.pdf', buffer: pdf.buffer.slice(0) as ArrayBuffer }],
      { mode: 'size', maxBytes: 4_000_000 }
    )

    console.log(
      `large-scan e2e: ${(pdf.length / 1024 / 1024).toFixed(1)} MB -> ` +
      `${(results[0].compressedSize / 1024 / 1024).toFixed(2)} MB (target 4 MB)`
    )
    expect(results[0].error).toBeUndefined()
    expect(results[0].metTarget).toBe(true)
    // Incompressible noise cannot fit losslessly: the DPI search must run
    expect(results[0].lossless).toBeFalsy()
    expect(results[0].compressedSize).toBeLessThanOrEqual(4_000_000)
    // The bug returned 0.26MB here. Require at least half the budget used:
    // the discrete DPI grid can step over the 90% band, but not this far.
    expect(results[0].compressedSize).toBeGreaterThanOrEqual(2_000_000)
  })

  it('compressible graphics fit losslessly at full resolution', { timeout: 300_000 }, async () => {
    // Models a huge raw synthetic image (the CustomerAnalytics case):
    // lossless deflate beats every JPEG setting, so quality-first wins
    const pdf = buildNoisePdf(5, 1700, 2200, 'compressible')
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'graphics.pdf', buffer: pdf.buffer.slice(0) as ArrayBuffer }],
      { mode: 'size', maxBytes: 4_000_000 }
    )

    console.log(
      `graphics e2e: ${(pdf.length / 1024 / 1024).toFixed(1)} MB -> ` +
      `${(results[0].compressedSize / 1024 / 1024).toFixed(2)} MB lossless=${results[0].lossless}`
    )
    expect(results[0].metTarget).toBe(true)
    expect(results[0].lossless).toBe(true)
    expect(results[0].compressedSize).toBeLessThanOrEqual(4_000_000)
  })
})
