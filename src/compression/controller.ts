import type {
  CompressionTarget,
  CompressionResult,
  WorkerEvent,
} from './types'
import { createCompressionWorker, sendCommand } from './worker-client'

const MAX_DPI = 300
const LOW_PROBE_DPI = 72
const MIN_DPI = 30
const MIN_WORKERS = 2  // Need at least 2 for parallel probes
const GOOD_ENOUGH_RATIO = 0.90  // Stop if result is within 90% of target
const MAX_REFINEMENTS = 3

function getPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
  // Use half the cores (leave room for UI thread + OS), minimum 2 for parallel probes
  return Math.max(MIN_WORKERS, Math.floor(cores / 2))
}

/**
 * Interpolate DPI using power-law model from two data points.
 * Falls back to linear interpolation when the power law is undefined.
 * Always returns a finite value clamped to [MIN_DPI, MAX_DPI].
 */
export function interpolateDpi(
  dpi1: number, size1: number,
  dpi2: number, size2: number,
  targetSize: number
): number {
  const clamp = (value: number): number =>
    Number.isFinite(value)
      ? Math.round(Math.max(MIN_DPI, Math.min(MAX_DPI, value)))
      : Math.round((dpi1 + dpi2) / 2)

  if (size1 <= 0 || size2 <= 0 || dpi1 <= 0 || dpi2 <= 0 || size1 === size2) {
    const ratio = (targetSize - size1) / (size2 - size1)
    return clamp(dpi1 + ratio * (dpi2 - dpi1))
  }

  const exp = Math.log(size2 / size1) / Math.log(dpi2 / dpi1)
  if (!isFinite(exp) || exp === 0) {
    const ratio = (targetSize - size1) / (size2 - size1)
    return clamp(dpi1 + ratio * (dpi2 - dpi1))
  }

  const k = size1 / Math.pow(dpi1, exp)
  return clamp(Math.pow(targetSize / k, 1 / exp))
}

interface Probe {
  dpi: number
  size: number
  buffer: ArrayBuffer
}

/**
 * Send a compress-at-dpi command and wait for the result.
 * Resolves null on a dpi-error response or a worker-level error event,
 * so a crashed worker can never leave the promise pending.
 */
function compressAtDpi(
  worker: Worker,
  fileIndex: number,
  buffer: ArrayBuffer,
  dpi: number
): Promise<Probe | null> {
  return new Promise((resolve) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const onMessage = (e: MessageEvent<WorkerEvent>) => {
      const event = e.data
      if (event.type === 'dpi-result' && event.fileIndex === fileIndex) {
        cleanup()
        resolve({ dpi: event.dpi, size: event.size, buffer: event.buffer })
      } else if (event.type === 'dpi-error' && event.fileIndex === fileIndex) {
        cleanup()
        resolve(null)
      }
    }
    const onError = () => {
      cleanup()
      resolve(null)
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    // Clone buffer since Transferable empties the original
    const clone = buffer.slice(0)
    sendCommand(worker, {
      type: 'compress-at-dpi',
      fileIndex,
      buffer: clone,
      dpi,
    }, [clone])
  })
}

export class CompressionController {
  private poolSize: number
  private workers: Worker[] = []
  private idle: Worker[] = []
  private waiters: Array<(w: Worker) => void> = []
  private started = false
  private ready: Promise<void> | null = null
  public isReady: boolean = false

  constructor() {
    this.poolSize = getPoolSize()
  }

  /**
   * Spawn and initialize the worker pool. Called lazily on first use so
   * loading the page does not pay the Ghostscript WASM cost per worker.
   *
   * Readiness is staged: `ready` resolves when the FIRST worker is up, so
   * compression starts immediately. The remaining workers join the pool as
   * their WASM finishes loading. It only rejects when every worker fails.
   */
  private start(): Promise<void> {
    if (this.started) return this.ready!
    this.started = true

    this.workers = Array.from({ length: this.poolSize }, () => createCompressionWorker())

    const inits = this.workers.map((w) =>
      this.initWorker(w).then(() => {
        // Worker is live: hand it to a queued task or park it as idle
        this.release(w)
      })
    )
    // Individual failures are reported through Promise.any below;
    // observe them here so they never surface as unhandled rejections
    for (const p of inits) p.catch(() => {})

    this.ready = Promise.any(inits).then(
      () => {
        this.isReady = true
      },
      (err: unknown) => {
        const first = err instanceof AggregateError ? err.errors[0] : err
        throw first instanceof Error ? first : new Error(String(first))
      }
    )

    return this.ready
  }

  private initWorker(w: Worker): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const handler = (e: MessageEvent<WorkerEvent>) => {
        if (e.data.type === 'ready') {
          w.removeEventListener('message', handler)
          resolve()
        } else if (e.data.type === 'dpi-error' && e.data.fileIndex === -1) {
          w.removeEventListener('message', handler)
          reject(new Error(e.data.error))
        }
      }
      w.addEventListener('message', handler)
      w.addEventListener('error', (err) => {
        reject(new Error(`Worker error: ${(err as ErrorEvent).message}`))
      })
      sendCommand(w, { type: 'init' })
    })
  }

  /** Start loading the engine in the background (e.g. when files are selected). */
  public warmup(): void {
    // Swallow the rejection here; callers of waitUntilReady/compressFiles still see it
    void this.start().catch(() => {})
  }

  public waitUntilReady(): Promise<void> {
    return this.start()
  }

  // --- Worker pool ---

  private acquire(): Promise<Worker> {
    const w = this.idle.pop()
    if (w) return Promise.resolve(w)
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private tryAcquire(): Worker | null {
    return this.idle.pop() ?? null
  }

  private release(w: Worker): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter(w)
    else this.idle.push(w)
  }

  async compressFiles(
    files: Array<{ name: string; buffer: ArrayBuffer }>,
    target: CompressionTarget,
    onProgress?: (
      fileIndex: number,
      iteration: number,
      dpi: number,
      size: number
    ) => void
  ): Promise<CompressionResult[]> {
    await this.start()

    const results: CompressionResult[] = new Array(files.length)

    // Queue scheduling: every file task competes for workers, so a slow file
    // never blocks the files behind it (no fixed batches).
    await Promise.all(
      files.map(async (file, fileIdx) => {
        const originalSize = file.buffer.byteLength

        const targetBytes =
          target.mode === 'size'
            ? target.maxBytes
            : Math.floor(originalSize * (1 - target.reductionPct / 100))

        if (originalSize <= targetBytes) {
          results[fileIdx] = {
            fileIndex: fileIdx,
            fileName: file.name,
            originalSize,
            compressedSize: originalSize,
            buffer: file.buffer,
            skipped: true,
            metTarget: true,
          }
          return
        }

        const worker = await this.acquire()
        try {
          results[fileIdx] = await this.compressFile(
            file, fileIdx, targetBytes, worker, onProgress
          )
        } finally {
          this.release(worker)
        }
      })
    )

    return results
  }

  private async compressFile(
    file: { name: string; buffer: ArrayBuffer },
    fileIndex: number,
    targetBytes: number,
    worker: Worker,
    onProgress?: (fileIndex: number, iteration: number, dpi: number, size: number) => void
  ): Promise<CompressionResult> {
    const originalSize = file.buffer.byteLength
    let iteration = 0
    let best: Probe | null = null      // Largest result that fits the target
    let smallest: Probe | null = null  // Smallest result overall (fallback)

    const track = (result: Probe | null) => {
      if (!result) return
      if (!smallest || result.size < smallest.size) smallest = result
      if (result.size <= targetBytes && (!best || result.size > best.size)) {
        best = result
      }
    }
    const report = (probe: Probe | null, dpi: number) => {
      iteration++
      if (probe) onProgress?.(fileIndex, iteration, dpi, probe.size)
      track(probe)
    }

    // Step 1: probes at 300 and 72 DPI. Run them in parallel only when a
    // second worker is idle; otherwise run sequentially on our own worker
    // so queued files are not starved.
    let highProbe: Probe | null
    let lowProbe: Probe | null = null

    const second = this.tryAcquire()
    if (second) {
      try {
        ;[highProbe, lowProbe] = await Promise.all([
          compressAtDpi(worker, fileIndex, file.buffer, MAX_DPI),
          compressAtDpi(second, fileIndex, file.buffer, LOW_PROBE_DPI),
        ])
      } finally {
        this.release(second)
      }
      report(highProbe, MAX_DPI)
      report(lowProbe, LOW_PROBE_DPI)
    } else {
      highProbe = await compressAtDpi(worker, fileIndex, file.buffer, MAX_DPI)
      report(highProbe, MAX_DPI)
      if (!highProbe || highProbe.size > targetBytes) {
        lowProbe = await compressAtDpi(worker, fileIndex, file.buffer, LOW_PROBE_DPI)
        report(lowProbe, LOW_PROBE_DPI)
      }
    }

    // Early exit: 300 DPI fits
    if (highProbe && highProbe.size <= targetBytes) {
      return this.buildResult(fileIndex, file.name, originalSize, best, smallest)
    }

    // Even low probe too big — try minimum DPI
    if (!lowProbe || lowProbe.size > targetBytes) {
      if (!best) {
        const minProbe = await compressAtDpi(worker, fileIndex, file.buffer, MIN_DPI)
        report(minProbe, MIN_DPI)
      }
      return this.buildResult(fileIndex, file.name, originalSize, best, smallest)
    }

    // Step 2: Interpolate and refine until good enough
    let lowDpi = LOW_PROBE_DPI
    let lowSize = lowProbe.size
    let highDpi = MAX_DPI
    let highSize = highProbe?.size ?? originalSize

    for (let r = 0; r < MAX_REFINEMENTS; r++) {
      const estimatedDpi = interpolateDpi(lowDpi, lowSize, highDpi, highSize, targetBytes)

      // Avoid re-testing a DPI we've already tried
      if (estimatedDpi <= lowDpi || estimatedDpi >= highDpi) break

      const probe = await compressAtDpi(worker, fileIndex, file.buffer, estimatedDpi)
      report(probe, estimatedDpi)
      if (!probe) break

      // Good enough — within 90% of target
      if (probe.size <= targetBytes && probe.size >= targetBytes * GOOD_ENOUGH_RATIO) {
        break
      }

      // Narrow the search bounds
      if (probe.size > targetBytes) {
        highDpi = estimatedDpi
        highSize = probe.size
      } else {
        lowDpi = estimatedDpi
        lowSize = probe.size
      }
    }

    return this.buildResult(fileIndex, file.name, originalSize, best, smallest)
  }

  private buildResult(
    fileIndex: number,
    fileName: string,
    originalSize: number,
    best: Probe | null,
    smallest: Probe | null
  ): CompressionResult {
    if (best) {
      return {
        fileIndex,
        fileName,
        originalSize,
        compressedSize: best.size,
        buffer: best.buffer,
        skipped: false,
        metTarget: true,
      }
    }
    if (smallest) {
      // Target unreachable even at minimum DPI: return the smallest we got
      return {
        fileIndex,
        fileName,
        originalSize,
        compressedSize: smallest.size,
        buffer: smallest.buffer,
        skipped: false,
        metTarget: false,
      }
    }
    return {
      fileIndex,
      fileName,
      originalSize,
      compressedSize: 0,
      buffer: new ArrayBuffer(0),
      skipped: false,
      metTarget: false,
      error: 'Ghostscript could not process this file',
    }
  }
}
