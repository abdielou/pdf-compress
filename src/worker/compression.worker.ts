import type { WorkerCommand, WorkerEvent } from '../compression/types'
import { initGhostscript, getGs } from './ghostscript'
import { binarySearchCompress } from './engine'

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
      try {
        const input = new Uint8Array(cmd.buffer)

        // Convert CompressionTarget to targetBytes
        const targetBytes =
          cmd.target.mode === 'size'
            ? cmd.target.maxBytes
            : Math.floor(input.length * (1 - cmd.target.reductionPct / 100))

        // Skip check (ENG-05): file already under target size
        if (input.length <= targetBytes) {
          post({
            type: 'file-skipped',
            fileIndex: cmd.fileIndex,
            reason: 'already-fits',
          })
          break
        }

        // Run binary search compression
        const result = binarySearchCompress(
          getGs(),
          input,
          targetBytes,
          (iteration, currentDpi, currentSize) => {
            post({
              type: 'progress',
              fileIndex: cmd.fileIndex,
              iteration,
              totalEstimated: 11, // 1 initial + max 10 binary search
              currentDpi,
              currentSize,
            })
          }
        )

        if (result) {
          const buffer = result.buffer.slice(
            result.byteOffset,
            result.byteOffset + result.byteLength
          )
          post(
            {
              type: 'file-done',
              fileIndex: cmd.fileIndex,
              compressedSize: result.length,
              buffer,
            },
            [buffer]
          )
        } else {
          post({
            type: 'file-error',
            fileIndex: cmd.fileIndex,
            error: 'Could not compress to target size even at minimum DPI',
          })
        }
      } catch (err) {
        post({
          type: 'file-error',
          fileIndex: cmd.fileIndex,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }
  }
}
