import type { WorkerCommand, WorkerEvent } from '../compression/types'
import { initGhostscript } from './ghostscript'

function post(event: WorkerEvent, transfer?: Transferable[]) {
  self.postMessage(event, { transfer } as StructuredSerializeOptions)
}

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data

  switch (cmd.type) {
    case 'init': {
      try {
        await initGhostscript()
        post({ type: 'ready' })
      } catch (err) {
        // Post error if init fails - fileIndex 0 is used as placeholder
        post({
          type: 'file-error',
          fileIndex: -1,
          error: `WASM init failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
      break
    }
    case 'compress': {
      post({
        type: 'file-error',
        fileIndex: cmd.fileIndex,
        error: 'Compression not implemented yet',
      })
      break
    }
  }
}
