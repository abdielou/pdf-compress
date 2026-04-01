import { createCompressionWorker, sendCommand } from './compression/worker-client'
import { CompressionController } from './compression/controller'
import type { CompressionTarget, CompressionResult } from './compression/types'

// Eager worker start (ENG-02): spawn immediately on page load
const worker = createCompressionWorker()
sendCommand(worker, { type: 'init' })

const controller = new CompressionController(worker)

/**
 * Compress PDF files to a target size or percentage reduction.
 * This is the main API for Phase 2 UI to call.
 */
export async function compressFiles(
  files: File[],
  target: CompressionTarget,
  onProgress?: (
    fileIndex: number,
    iteration: number,
    dpi: number,
    size: number
  ) => void
): Promise<CompressionResult[]> {
  const fileData = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      buffer: await f.arrayBuffer(),
    }))
  )
  return controller.compressFiles(fileData, target, onProgress)
}

export { controller }
export type { CompressionTarget, CompressionResult }

// Log when controller is available
console.log('PDF Compress controller initialized')
