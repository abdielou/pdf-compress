import type { WorkerCommand, WorkerEvent } from '../compression/types'
import { initGhostscript, getGs } from './ghostscript'
import { compressAtDpi } from './engine'

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
        post({
          type: 'dpi-error',
          fileIndex: -1,
          dpi: 0,
          error: `WASM init failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
      break
    }
    case 'compress-at-dpi': {
      try {
        const input = new Uint8Array(cmd.buffer)
        const gs = getGs()

        // Write input, compress, clean up
        gs.FS.writeFile('/input.pdf', input)
        try {
          const result = compressAtDpi(gs, cmd.dpi)
          if (result) {
            const buffer = result.bytes.buffer.slice(
              result.bytes.byteOffset,
              result.bytes.byteOffset + result.bytes.byteLength
            ) as ArrayBuffer
            post(
              {
                type: 'dpi-result',
                fileIndex: cmd.fileIndex,
                dpi: cmd.dpi,
                size: result.size,
                buffer,
              },
              [buffer]
            )
          } else {
            post({
              type: 'dpi-error',
              fileIndex: cmd.fileIndex,
              dpi: cmd.dpi,
              error: `Ghostscript returned non-zero at DPI ${cmd.dpi}`,
            })
          }
        } finally {
          try { gs.FS.unlink('/input.pdf') } catch { /* may not exist */ }
        }
      } catch (err) {
        post({
          type: 'dpi-error',
          fileIndex: cmd.fileIndex,
          dpi: cmd.dpi,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }
  }
}
