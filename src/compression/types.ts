export type CompressionTarget =
  | { mode: 'size'; maxBytes: number }
  | { mode: 'percentage'; reductionPct: number }

/**
 * Image re-encoding choice for a compression pass.
 * flate: lossless. dct: JPEG, where a LOWER qFactor means HIGHER quality.
 */
export type ImageEncode =
  | { filter: 'flate' }
  | { filter: 'dct'; qFactor: number }

// Main --> Worker
export type WorkerCommand =
  | { type: 'init' }
  | {
      type: 'compress-at-dpi'
      fileIndex: number
      buffer: ArrayBuffer
      dpi: number
      encode?: ImageEncode
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
  /** True when the output size is at or under the requested target */
  metTarget: boolean
  /** True when the output was produced without any lossy re-encoding */
  lossless?: boolean
  /** Set when compression produced no output at all */
  error?: string
}
