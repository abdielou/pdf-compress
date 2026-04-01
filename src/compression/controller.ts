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

function getPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
  // Use half the cores (leave room for UI thread + OS), minimum 2 for parallel probes
  return Math.max(MIN_WORKERS, Math.floor(cores / 2))
}

/**
 * Interpolate DPI using power-law model from two data points.
 */
function interpolateDpi(
  dpi1: number, size1: number,
  dpi2: number, size2: number,
  targetSize: number
): number {
  if (size1 <= 0 || size2 <= 0 || dpi1 <= 0 || dpi2 <= 0 || size1 === size2) {
    const ratio = (targetSize - size1) / (size2 - size1)
    return Math.round(dpi1 + ratio * (dpi2 - dpi1))
  }

  const exp = Math.log(size2 / size1) / Math.log(dpi2 / dpi1)
  if (!isFinite(exp) || exp === 0) {
    const ratio = (targetSize - size1) / (size2 - size1)
    return Math.round(dpi1 + ratio * (dpi2 - dpi1))
  }

  const k = size1 / Math.pow(dpi1, exp)
  const estimatedDpi = Math.pow(targetSize / k, 1 / exp)
  return Math.round(Math.max(MIN_DPI, Math.min(MAX_DPI, estimatedDpi)))
}

/** Send a compress-at-dpi command and wait for result */
function compressAtDpi(
  worker: Worker,
  fileIndex: number,
  buffer: ArrayBuffer,
  dpi: number
): Promise<{ dpi: number; size: number; buffer: ArrayBuffer } | null> {
  return new Promise((resolve) => {
    const handler = (e: MessageEvent<WorkerEvent>) => {
      const event = e.data
      if (event.type === 'dpi-result' && event.fileIndex === fileIndex) {
        worker.removeEventListener('message', handler)
        resolve({ dpi: event.dpi, size: event.size, buffer: event.buffer })
      } else if (event.type === 'dpi-error' && event.fileIndex === fileIndex) {
        worker.removeEventListener('message', handler)
        resolve(null)
      }
    }
    worker.addEventListener('message', handler)
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
  private workers: Worker[]
  private poolSize: number
  private ready: Promise<void>
  public isReady: boolean = false

  constructor() {
    this.poolSize = getPoolSize()
    this.workers = Array.from({ length: this.poolSize }, () => createCompressionWorker())

    // Init all workers and wait for all to be ready
    this.ready = Promise.all(
      this.workers.map((w) =>
        new Promise<void>((resolve, reject) => {
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
            reject(new Error(`Worker error: ${err.message}`))
          })
          sendCommand(w, { type: 'init' })
        })
      )
    ).then(() => {
      this.isReady = true
    })
  }

  public waitUntilReady(): Promise<void> {
    return this.ready
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
    await this.ready

    const results: CompressionResult[] = new Array(files.length)
    const pending: Promise<void>[] = []

    // Process files in batches using worker pool
    for (let i = 0; i < files.length; i += this.poolSize) {
      const batch: Promise<void>[] = []

      for (let j = 0; j < this.poolSize && i + j < files.length; j++) {
        const fileIdx = i + j
        const file = files[fileIdx]
        const originalSize = file.buffer.byteLength

        const targetBytes =
          target.mode === 'size'
            ? target.maxBytes
            : Math.floor(originalSize * (1 - target.reductionPct / 100))

        // Skip check
        if (originalSize <= targetBytes) {
          results[fileIdx] = {
            fileIndex: fileIdx,
            fileName: file.name,
            originalSize,
            compressedSize: originalSize,
            buffer: file.buffer,
            skipped: true,
          }
          continue
        }

        // Assign a primary worker for this file
        const primaryWorker = this.workers[j]
        const secondaryWorker = this.workers[(j + 1) % this.poolSize]

        batch.push(
          this.compressFileWithParallelProbes(
            file, fileIdx, targetBytes, primaryWorker, secondaryWorker, onProgress
          ).then((result) => {
            results[fileIdx] = result
          })
        )
      }

      await Promise.all(batch)
    }

    return results
  }

  private async compressFileWithParallelProbes(
    file: { name: string; buffer: ArrayBuffer },
    fileIndex: number,
    targetBytes: number,
    workerA: Worker,
    workerB: Worker,
    onProgress?: (fileIndex: number, iteration: number, dpi: number, size: number) => void
  ): Promise<CompressionResult> {
    const originalSize = file.buffer.byteLength
    let iteration = 0
    let bestResult: { size: number; buffer: ArrayBuffer } | null = null

    const trackBest = (result: { size: number; buffer: ArrayBuffer } | null) => {
      if (result && result.size <= targetBytes) {
        if (!bestResult || result.size > bestResult.size) {
          bestResult = result
        }
      }
    }

    // Step 1: Parallel probes — DPI 300 and DPI 72 simultaneously
    const [highProbe, lowProbe] = await Promise.all([
      compressAtDpi(workerA, fileIndex, file.buffer, MAX_DPI),
      compressAtDpi(workerB, fileIndex, file.buffer, LOW_PROBE_DPI),
    ])

    iteration++
    if (highProbe) {
      onProgress?.(fileIndex, iteration, MAX_DPI, highProbe.size)
      trackBest(highProbe)
    }
    iteration++
    if (lowProbe) {
      onProgress?.(fileIndex, iteration, LOW_PROBE_DPI, lowProbe.size)
      trackBest(lowProbe)
    }

    // Early exit: 300 DPI fits
    if (highProbe && highProbe.size <= targetBytes) {
      return this.buildResult(fileIndex, file.name, originalSize, bestResult!)
    }

    // Even low probe too big — try minimum DPI
    if (!lowProbe || lowProbe.size > targetBytes) {
      if (!bestResult) {
        const minProbe = await compressAtDpi(workerA, fileIndex, file.buffer, MIN_DPI)
        iteration++
        if (minProbe) {
          onProgress?.(fileIndex, iteration, MIN_DPI, minProbe.size)
          trackBest(minProbe)
        }
      }
      return this.buildResult(fileIndex, file.name, originalSize, bestResult)
    }

    // Step 2: Interpolate from the two probes
    const estimatedDpi = interpolateDpi(
      LOW_PROBE_DPI, lowProbe.size,
      MAX_DPI, highProbe?.size ?? originalSize,
      targetBytes
    )

    const interProbe = await compressAtDpi(workerA, fileIndex, file.buffer, estimatedDpi)
    iteration++
    if (interProbe) {
      onProgress?.(fileIndex, iteration, estimatedDpi, interProbe.size)
      trackBest(interProbe)
    }

    // Step 3: Refine if needed
    if (interProbe) {
      if (interProbe.size > targetBytes && !bestResult) {
        // Overshot, no result yet — try between low and estimated
        const refinedDpi = interpolateDpi(
          LOW_PROBE_DPI, lowProbe.size,
          estimatedDpi, interProbe.size,
          targetBytes
        )
        const refineProbe = await compressAtDpi(workerA, fileIndex, file.buffer, refinedDpi)
        iteration++
        if (refineProbe) {
          onProgress?.(fileIndex, iteration, refinedDpi, refineProbe.size)
          trackBest(refineProbe)
        }
      } else if (interProbe.size <= targetBytes && interProbe.size < targetBytes * 0.85) {
        // Undershot significantly — try higher for better quality
        const refinedDpi = interpolateDpi(
          estimatedDpi, interProbe.size,
          MAX_DPI, highProbe?.size ?? originalSize,
          targetBytes
        )
        const refineProbe = await compressAtDpi(workerA, fileIndex, file.buffer, refinedDpi)
        iteration++
        if (refineProbe) {
          onProgress?.(fileIndex, iteration, refinedDpi, refineProbe.size)
          trackBest(refineProbe)
        }
      }
    }

    return this.buildResult(fileIndex, file.name, originalSize, bestResult)
  }

  private buildResult(
    fileIndex: number,
    fileName: string,
    originalSize: number,
    best: { size: number; buffer: ArrayBuffer } | null
  ): CompressionResult {
    if (best) {
      return {
        fileIndex,
        fileName,
        originalSize,
        compressedSize: best.size,
        buffer: best.buffer,
        skipped: false,
      }
    }
    return {
      fileIndex,
      fileName,
      originalSize,
      compressedSize: 0,
      buffer: new ArrayBuffer(0),
      skipped: false,
    }
  }
}
