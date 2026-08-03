import { CompressionController } from './compression/controller'
import type { CompressionTarget, CompressionResult } from './compression/types'

// Controller creates and manages its own worker pool (2 workers)
const controller = new CompressionController()

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

import { initApp } from './ui/app'
import { setupServiceWorker } from './pwa'

initApp(document.getElementById('app')!)
setupServiceWorker()

const versionEl = document.getElementById('app-version')
if (versionEl) {
  versionEl.textContent = `build ${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}`
}
