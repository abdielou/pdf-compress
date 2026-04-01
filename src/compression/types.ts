export type CompressionTarget =
  | { mode: 'size'; maxBytes: number }
  | { mode: 'percentage'; reductionPct: number }

// Main --> Worker
export type WorkerCommand =
  | { type: 'init' }
  | {
      type: 'compress'
      fileIndex: number
      fileName: string
      buffer: ArrayBuffer
      target: CompressionTarget
    }

// Worker --> Main
export type WorkerEvent =
  | { type: 'ready' }
  | {
      type: 'progress'
      fileIndex: number
      iteration: number
      totalEstimated: number
      currentDpi: number
      currentSize: number
    }
  | {
      type: 'file-done'
      fileIndex: number
      compressedSize: number
      buffer: ArrayBuffer
    }
  | { type: 'file-skipped'; fileIndex: number; reason: 'already-fits' }
  | { type: 'file-error'; fileIndex: number; error: string }

export interface CompressionResult {
  fileIndex: number
  fileName: string
  originalSize: number
  compressedSize: number
  buffer: ArrayBuffer
  skipped: boolean
}
