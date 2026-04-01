import { createCompressionWorker, sendCommand } from './compression/worker-client'
import type { WorkerEvent } from './compression/types'

// Eager worker start: spawn immediately on page load to begin WASM download
const worker = createCompressionWorker()

worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
  const event = e.data

  switch (event.type) {
    case 'ready': {
      console.log('Ghostscript WASM ready')
      const app = document.getElementById('app')
      if (app) {
        app.textContent = 'Ghostscript WASM ready'
      }
      break
    }
    case 'file-error': {
      console.error(`Worker error: ${event.error}`)
      break
    }
    default:
      break
  }
}

worker.onerror = (e: ErrorEvent) => {
  console.error('Worker error:', e.message)
}

// Send init command to start WASM loading
sendCommand(worker, { type: 'init' })
