import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CompressionTarget } from '../src/compression/types'

/**
 * Mock worker harness.
 *
 * Behavior is selected by the input buffer's byteLength, which survives
 * the structured-clone boundary. Each behavior controls:
 *  - sizeForDpi: output size for a given DPI
 *  - delayMs: how long a compress call takes
 *  - crash: fire a worker 'error' event instead of responding
 *  - failDpi: respond with a dpi-error event
 */
type Encode = { filter: 'flate' } | { filter: 'dct'; qFactor: number }

interface FileBehavior {
  sizeForDpi?: (dpi: number) => number
  /** Quality-aware size model; takes precedence over sizeForDpi */
  sizeForProbe?: (dpi: number, encode: Encode) => number
  delayMs?: number
  crash?: boolean
  failDpi?: boolean
  /** Probes above this DPI respond with dpi-error (models resource limits) */
  failAboveDpi?: number
}

interface HarnessLog {
  entries: string[]
}

type InitMode = 'ready' | 'silent' | 'fail'

async function installMockWorkers(
  behaviorBySize: Map<number, FileBehavior>,
  log: HarnessLog = { entries: [] },
  initModes: InitMode[] = []
) {
  const workerClient = await import('../src/compression/worker-client')
  let workerCount = 0

  const spy = vi
    .spyOn(workerClient, 'createCompressionWorker')
    .mockImplementation(() => {
      const workerIndex = workerCount
      workerCount++
      const initMode = initModes[workerIndex] ?? 'ready'
      const listeners = new Map<string, Set<Function>>()
      const on = (type: string, h: Function) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(h)
      }
      const off = (type: string, h: Function) => {
        listeners.get(type)?.delete(h)
      }
      const emit = (type: string, ev: unknown) => {
        for (const h of [...(listeners.get(type) ?? [])]) h(ev)
      }

      const worker = {
        addEventListener: on,
        removeEventListener: off,
        terminate: vi.fn(),
        postMessage: (cmd: any) => {
          if (cmd.type === 'init') {
            if (initMode === 'silent') return
            if (initMode === 'fail') {
              setTimeout(() => emit('message', {
                data: { type: 'dpi-error', fileIndex: -1, dpi: 0, error: 'WASM init failed' },
              }), 0)
              return
            }
            setTimeout(() => emit('message', { data: { type: 'ready' } }), 0)
            return
          }
          if (cmd.type === 'compress-at-dpi') {
            const b = behaviorBySize.get(cmd.buffer.byteLength) ?? {}
            log.entries.push(`start:${cmd.fileIndex}:${cmd.dpi}`)
            const respond = () => {
              if (b.crash) {
                log.entries.push(`crash:${cmd.fileIndex}`)
                emit('error', { message: 'worker crashed' })
                return
              }
              if (b.failDpi || (b.failAboveDpi !== undefined && cmd.dpi > b.failAboveDpi)) {
                log.entries.push(`fail:${cmd.fileIndex}`)
                emit('message', {
                  data: {
                    type: 'dpi-error',
                    fileIndex: cmd.fileIndex,
                    dpi: cmd.dpi,
                    error: 'gs failed',
                  },
                })
                return
              }
              const encode: Encode = cmd.encode ?? { filter: 'dct', qFactor: 0.4 }
              const size = b.sizeForProbe
                ? b.sizeForProbe(cmd.dpi, encode)
                : b.sizeForDpi!(cmd.dpi)
              log.entries.push(`done:${cmd.fileIndex}:${cmd.dpi}`)
              emit('message', {
                data: {
                  type: 'dpi-result',
                  fileIndex: cmd.fileIndex,
                  dpi: cmd.dpi,
                  size,
                  buffer: new ArrayBuffer(size),
                },
              })
            }
            setTimeout(respond, b.delayMs ?? 0)
          }
        },
      } as unknown as Worker
      return worker
    })

  return { spy, getWorkerCount: () => workerCount, log }
}

const SIZE_TARGET: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

beforeEach(() => {
  // Deterministic pool size: 4 cores -> 2 workers
  vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Fix 2: worker crash does not hang compression', () => {
  it(
    'resolves with an error result when the worker fires an error event',
    { timeout: 3000 },
    async () => {
      const behaviors = new Map<number, FileBehavior>([
        [10_000_000, { crash: true }],
      ])
      await installMockWorkers(behaviors)
      const { CompressionController } = await import('../src/compression/controller')
      const controller = new CompressionController()

      const results = await controller.compressFiles(
        [{ name: 'crash.pdf', buffer: new ArrayBuffer(10_000_000) }],
        SIZE_TARGET
      )

      expect(results).toHaveLength(1)
      expect(results[0].error).toBeTruthy()
      expect(results[0].metTarget).toBe(false)
    }
  )
})

describe('Fix 3: unreachable target returns smallest achievable result', () => {
  it('returns the smallest output with metTarget=false instead of failing', async () => {
    // Constant 2MB output at every DPI; target is 500KB -> unreachable
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: () => 2_000_000 }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'big.pdf', buffer: new ArrayBuffer(10_000_000) }],
      { mode: 'size', maxBytes: 500_000 }
    )

    expect(results[0].error).toBeUndefined()
    expect(results[0].compressedSize).toBe(2_000_000)
    expect(results[0].buffer.byteLength).toBe(2_000_000)
    expect(results[0].metTarget).toBe(false)
  })

  it('sets error when every probe fails outright', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { failDpi: true }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'bad.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )

    expect(results[0].error).toBeTruthy()
    expect(results[0].compressedSize).toBe(0)
    expect(results[0].metTarget).toBe(false)
  })

  it('sets metTarget=true when the target is reached', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: (dpi) => Math.round(100 * dpi * dpi) }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'ok.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )

    expect(results[0].error).toBeUndefined()
    expect(results[0].metTarget).toBe(true)
    expect(results[0].compressedSize).toBeLessThanOrEqual(4_000_000)
  })
})

describe('Fix 4: queue scheduling (no head-of-line blocking)', () => {
  it('starts the third file while a slow first file is still compressing', async () => {
    // Pool of 2. f0 is slow (60ms per probe), f1 and f2 are fast (2ms).
    // With batching, f2 waits for f0. With a queue, f2 starts when f1's
    // worker frees up, well before f0 finishes.
    const powerLaw = (dpi: number) => Math.round(100 * dpi * dpi)
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: powerLaw, delayMs: 60 }],
      [10_000_001, { sizeForDpi: powerLaw, delayMs: 2 }],
      [10_000_002, { sizeForDpi: powerLaw, delayMs: 2 }],
    ])
    const { log } = await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [
        { name: 'slow.pdf', buffer: new ArrayBuffer(10_000_000) },
        { name: 'fast1.pdf', buffer: new ArrayBuffer(10_000_001) },
        { name: 'fast2.pdf', buffer: new ArrayBuffer(10_000_002) },
      ],
      SIZE_TARGET
    )

    expect(results).toHaveLength(3)

    const firstStartF2 = log.entries.findIndex((e) => e.startsWith('start:2:'))
    const lastDoneF0 = log.entries
      .map((e, i) => (e.startsWith('done:0:') ? i : -1))
      .reduce((a, b) => Math.max(a, b), -1)
    expect(firstStartF2).toBeGreaterThanOrEqual(0)
    expect(firstStartF2).toBeLessThan(lastDoneF0)

    for (const r of results) expect(r.metTarget).toBe(true)
  })

  it('results keep file order even when completion order differs', async () => {
    const powerLaw = (dpi: number) => Math.round(100 * dpi * dpi)
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: powerLaw, delayMs: 40 }],
      [10_000_001, { sizeForDpi: powerLaw, delayMs: 2 }],
      [10_000_002, { sizeForDpi: powerLaw, delayMs: 2 }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [
        { name: 'a.pdf', buffer: new ArrayBuffer(10_000_000) },
        { name: 'b.pdf', buffer: new ArrayBuffer(10_000_001) },
        { name: 'c.pdf', buffer: new ArrayBuffer(10_000_002) },
      ],
      SIZE_TARGET
    )

    expect(results.map((r) => r.fileName)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])
    expect(results.map((r) => r.fileIndex)).toEqual([0, 1, 2])
  })
})

describe('Fix 5: lazy worker startup', () => {
  it('creates no workers in the constructor', async () => {
    const { spy } = await installMockWorkers(new Map())
    const { CompressionController } = await import('../src/compression/controller')

    new CompressionController()
    expect(spy).not.toHaveBeenCalled()
  })

  it('creates workers on first compressFiles call', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: (dpi) => Math.round(100 * dpi * dpi) }],
    ])
    const { spy } = await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    await controller.compressFiles(
      [{ name: 'x.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )
    expect(spy).toHaveBeenCalled()
  })

  it('warmup() starts the workers without compressing', async () => {
    const { spy } = await installMockWorkers(new Map())
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    controller.warmup()
    expect(spy).toHaveBeenCalled()
    await controller.waitUntilReady()
    expect(controller.isReady).toBe(true)
  })
})

describe('Fix 5b: staged readiness (first worker unblocks compression)', () => {
  const powerLaw = (dpi: number) => Math.round(100 * dpi * dpi)

  it(
    'starts compressing when the first worker is ready, without waiting for the rest',
    { timeout: 3000 },
    async () => {
      const behaviors = new Map<number, FileBehavior>([
        [10_000_000, { sizeForDpi: powerLaw }],
      ])
      // Worker 0 initializes; worker 1 never responds
      await installMockWorkers(behaviors, { entries: [] }, ['ready', 'silent'])
      const { CompressionController } = await import('../src/compression/controller')
      const controller = new CompressionController()

      const results = await controller.compressFiles(
        [{ name: 'x.pdf', buffer: new ArrayBuffer(10_000_000) }],
        SIZE_TARGET
      )
      expect(results[0].metTarget).toBe(true)
    }
  )

  it('a failed worker init does not block the others', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: powerLaw }],
    ])
    await installMockWorkers(behaviors, { entries: [] }, ['ready', 'fail'])
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'x.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )
    expect(results[0].metTarget).toBe(true)
  })

  it('waitUntilReady rejects when every worker fails to load', async () => {
    await installMockWorkers(new Map(), { entries: [] }, ['fail', 'fail'])
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    await expect(controller.waitUntilReady()).rejects.toThrow()
    expect(controller.isReady).toBe(false)
  })
})

describe('Ported engine behavior: convergence and quality', () => {
  it('converges in at most 6 Ghostscript calls for a power-law file', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: (dpi) => Math.round(100 * dpi * dpi) }],
    ])
    const { log } = await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'x.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )

    const calls = log.entries.filter((e) => e.startsWith('start:0:')).length
    expect(calls).toBeLessThanOrEqual(6)
    expect(results[0].metTarget).toBe(true)
  })

  it('does not waste quality: result is at least 70% of target', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: (dpi) => Math.round(100 * dpi * dpi) }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'x.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )

    expect(results[0].compressedSize).toBeGreaterThan(4_000_000 * 0.7)
    expect(results[0].compressedSize).toBeLessThanOrEqual(4_000_000)
  })

  it('early exit: a file that fits at 300 DPI uses a minimal number of calls', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, { sizeForDpi: () => 3_000_000 }],
    ])
    const { log } = await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'x.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )

    expect(results[0].metTarget).toBe(true)
    expect(results[0].compressedSize).toBe(3_000_000)
    const calls = log.entries.filter((e) => e.startsWith('start:0:')).length
    expect(calls).toBeLessThanOrEqual(2)
  })
})

describe('Quality-first search: DPI-insensitive files', () => {
  // Models the user's CustomerAnalytics.pdf: one giant 72-effective-DPI
  // raw image. DPI does nothing; encoding choice controls the size.
  // Measured: lossless 0.82MB, DCT qf0.06 2.59MB, qf0.4 1.43MB.
  const flatFile = (dpi: number, encode: Encode): number => {
    if (encode.filter === 'flate') return 820_000
    if (encode.qFactor <= 0.06) return 2_590_000
    if (encode.qFactor <= 0.15) return 1_940_000
    return 1_430_000
  }

  it('returns the lossless result when it fits the target', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [70_000_000, { sizeForProbe: flatFile }],
    ])
    const { log } = await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'analytics.pdf', buffer: new ArrayBuffer(70_000_000) }],
      SIZE_TARGET
    )

    expect(results[0].metTarget).toBe(true)
    expect(results[0].lossless).toBe(true)
    expect(results[0].compressedSize).toBe(820_000)
    // Quality probes resolve it without any DPI search
    const calls = log.entries.filter((e) => e.startsWith('start:0:')).length
    expect(calls).toBeLessThanOrEqual(2)
  })

  it('falls back to maximum-quality JPEG when lossless overshoots', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [70_000_000, {
        sizeForProbe: (dpi, encode) =>
          encode.filter === 'flate' ? 60_000_000 : flatFile(dpi, encode),
      }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'photo.pdf', buffer: new ArrayBuffer(70_000_000) }],
      SIZE_TARGET
    )

    expect(results[0].metTarget).toBe(true)
    expect(results[0].lossless).toBeFalsy()
    expect(results[0].compressedSize).toBe(2_590_000)
  })

  it('polishes quality upward when the DPI search leaves budget unused', async () => {
    // DPI curve is a step: >=100 DPI overshoots, below it flat at 1MB.
    // Target 2.5MB: DPI search can only reach 1MB (40% of budget);
    // the quality polish at the found DPI recovers most of the rest.
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, {
        sizeForProbe: (dpi, encode) => {
          if (encode.filter === 'flate') return 60_000_000
          if (encode.qFactor <= 0.06) return dpi >= 100 ? 8_000_000 : 2_400_000
          if (encode.qFactor <= 0.15) return dpi >= 100 ? 6_000_000 : 1_800_000
          return dpi >= 100 ? 5_000_000 : 1_000_000
        },
      }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'step.pdf', buffer: new ArrayBuffer(10_000_000) }],
      { mode: 'size', maxBytes: 2_500_000 }
    )

    expect(results[0].metTarget).toBe(true)
    expect(results[0].compressedSize).toBe(2_400_000)
  })
})

describe('Overshoot fix: refinement converges on hard curves', () => {
  // Curve measured from real Ghostscript on a 53MB scan-like PDF
  // (piecewise power law: steep in the middle, shallow near 300 DPI)
  const measuredCurve = (dpi: number): number => {
    if (dpi <= 150) return Math.round(1_950_000 * Math.pow(dpi / 150, 2.75))
    if (dpi <= 200) return Math.round(1_950_000 * Math.pow(dpi / 150, 2.89))
    return Math.round(4_480_000 * Math.pow(dpi / 200, 0.415))
  }

  it('lands within the good-enough band instead of collapsing to the low probe', async () => {
    const behaviors = new Map<number, FileBehavior>([
      [50_000_000, { sizeForDpi: measuredCurve }],
    ])
    const { log } = await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'scan.pdf', buffer: new ArrayBuffer(50_000_000) }],
      SIZE_TARGET
    )

    // Best achievable near 4MB exists (DPI ~195). Collapsing to the
    // 72 DPI probe (0.26MB) wastes 93% of the allowed size budget.
    expect(results[0].metTarget).toBe(true)
    expect(results[0].compressedSize).toBeGreaterThanOrEqual(3_600_000)
    expect(results[0].compressedSize).toBeLessThanOrEqual(4_000_000)

    // Bounded work: probes + refinements stay within 10 Ghostscript calls
    const calls = log.entries.filter((e) => e.startsWith('start:0:')).length
    expect(calls).toBeLessThanOrEqual(10)
  })

  it('keeps refining after a failed probe instead of giving up', async () => {
    // High-DPI passes fail (e.g. resource limits); everything under 100 DPI works
    const behaviors = new Map<number, FileBehavior>([
      [10_000_000, {
        sizeForDpi: (dpi) => dpi * 10_000,
        failAboveDpi: 99,
      }],
    ])
    await installMockWorkers(behaviors)
    const { CompressionController } = await import('../src/compression/controller')
    const controller = new CompressionController()

    const results = await controller.compressFiles(
      [{ name: 'fragile.pdf', buffer: new ArrayBuffer(10_000_000) }],
      SIZE_TARGET
    )

    // Old behavior: first failed refinement probe aborted the loop,
    // returning the 72 DPI result (720KB). The search should push toward
    // the best working DPI just under 100 (roughly 950KB or better).
    expect(results[0].metTarget).toBe(true)
    expect(results[0].compressedSize).toBeGreaterThanOrEqual(900_000)
  })
})

describe('interpolateDpi: exported and clamped', () => {
  it('power-law interpolation lands near the analytic answer', async () => {
    const { interpolateDpi } = await import('../src/compression/controller')
    const dpi = interpolateDpi(72, 645_000, 300, 9_800_000, 4_000_000)
    expect(dpi).toBeGreaterThan(170)
    expect(dpi).toBeLessThan(220)
  })

  it('returns a finite clamped value when both sizes are equal', async () => {
    const { interpolateDpi } = await import('../src/compression/controller')
    const dpi = interpolateDpi(72, 1000, 300, 1000, 4000)
    expect(Number.isFinite(dpi)).toBe(true)
    expect(dpi).toBeGreaterThanOrEqual(30)
    expect(dpi).toBeLessThanOrEqual(300)
  })

  it('clamps the linear fallback into the 30-300 DPI range', async () => {
    const { interpolateDpi } = await import('../src/compression/controller')
    // Zero size forces the linear fallback; extreme target pushes it out of range
    const dpi = interpolateDpi(72, 0, 300, 1000, 10_000_000)
    expect(Number.isFinite(dpi)).toBe(true)
    expect(dpi).toBeGreaterThanOrEqual(30)
    expect(dpi).toBeLessThanOrEqual(300)
  })
})
