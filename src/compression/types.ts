export type CompressionTarget =
  | { mode: 'size'; maxBytes: number }
  | { mode: 'percentage'; reductionPct: number }

// Main --> Worker
export type WorkerCommand =
  | { type: 'init' }
  | {
      type: 'compress-at-dpi'
      fileIndex: number
      buffer: ArrayBuffer
      dpi: number
    }

// Worker --> Main
export type WorkerEvent =
  | { type: 'ready' }
  | {
      type: 'dpi-result'
      fileIndex: number
      dpi: number
      size: number
      buffer: ArrayBuffer
    }
  | {
      type: 'dpi-error'
      fileIndex: number
      dpi: number
      error: string
    }

export interface CompressionResult {
  fileIndex: number
  fileName: string
  originalSize: number
  compressedSize: number
  buffer: ArrayBuffer
  skipped: boolean
}
