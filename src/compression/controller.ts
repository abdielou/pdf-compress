import type {
  CompressionTarget,
  CompressionResult,
  WorkerCommand,
  WorkerEvent,
} from './types'
import { sendCommand } from './worker-client'

export class CompressionController {
  private worker: Worker
  private ready: Promise<void>

  constructor(worker: Worker) {
    this.worker = worker

    // Set up ready promise that resolves when worker sends 'ready' event
    this.ready = new Promise<void>((resolve) => {
      const existing = this.worker.onmessage
      this.worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
        if (e.data.type === 'ready') {
          resolve()
        }
        // Forward to existing handler if any
        if (existing) {
          ;(existing as (e: MessageEvent<WorkerEvent>) => void)(e)
        }
      }
    })
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

    const results: CompressionResult[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const originalSize = file.buffer.byteLength

      // Compute target bytes for skip check
      const targetBytes =
        target.mode === 'size'
          ? target.maxBytes
          : Math.floor(originalSize * (1 - target.reductionPct / 100))

      // Controller-level skip: file already fits
      if (originalSize <= targetBytes) {
        results.push({
          fileIndex: i,
          fileName: file.name,
          originalSize,
          compressedSize: originalSize,
          buffer: file.buffer,
          skipped: true,
        })
        continue
      }

      // Send compress command with Transferable
      const result = await this.compressFile(file, i, target, onProgress)
      results.push(result)
    }

    return results
  }

  private compressFile(
    file: { name: string; buffer: ArrayBuffer },
    fileIndex: number,
    target: CompressionTarget,
    onProgress?: (
      fileIndex: number,
      iteration: number,
      dpi: number,
      size: number
    ) => void
  ): Promise<CompressionResult> {
    return new Promise<CompressionResult>((resolve) => {
      const originalSize = file.buffer.byteLength

      // Set up listener for this file's response
      const prevOnMessage = this.worker.onmessage
      this.worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
        const event = e.data

        switch (event.type) {
          case 'progress': {
            if (event.fileIndex === fileIndex && onProgress) {
              onProgress(
                fileIndex,
                event.iteration,
                event.currentDpi,
                event.currentSize
              )
            }
            break
          }
          case 'file-done': {
            if (event.fileIndex === fileIndex) {
              this.worker.onmessage = prevOnMessage
              resolve({
                fileIndex,
                fileName: file.name,
                originalSize,
                compressedSize: event.compressedSize,
                buffer: event.buffer,
                skipped: false,
              })
            }
            break
          }
          case 'file-skipped': {
            if (event.fileIndex === fileIndex) {
              this.worker.onmessage = prevOnMessage
              resolve({
                fileIndex,
                fileName: file.name,
                originalSize,
                compressedSize: originalSize,
                buffer: file.buffer,
                skipped: true,
              })
            }
            break
          }
          case 'file-error': {
            if (event.fileIndex === fileIndex) {
              this.worker.onmessage = prevOnMessage
              resolve({
                fileIndex,
                fileName: file.name,
                originalSize,
                compressedSize: 0,
                buffer: new ArrayBuffer(0),
                skipped: false,
              })
            }
            break
          }
          default:
            break
        }
      }

      // Send the compress command with buffer as Transferable
      const cmd: WorkerCommand = {
        type: 'compress',
        fileIndex,
        fileName: file.name,
        buffer: file.buffer,
        target,
      }
      sendCommand(this.worker, cmd, [file.buffer])
    })
  }
}
