import { describe, it, expect, vi } from 'vitest'
import '@vitest/web-worker'
import { createCompressionWorker, sendCommand } from '../src/compression/worker-client'
import type { WorkerEvent, WorkerCommand } from '../src/compression/types'

describe('Worker creation', () => {
  it('createCompressionWorker returns a Worker instance', () => {
    const worker = createCompressionWorker()
    expect(worker).toBeInstanceOf(Worker)
    worker.terminate()
  })
})

describe('Worker init -> ready round-trip', () => {
  it('sends init command and receives ready event', async () => {
    const worker = createCompressionWorker()

    const event = await new Promise<WorkerEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Timed out waiting for ready event'))
      }, 30000)

      worker.onmessage = (e: MessageEvent<WorkerEvent>) => {
        clearTimeout(timeout)
        resolve(e.data)
      }

      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timeout)
        reject(new Error(`Worker error: ${e.message}`))
      }

      sendCommand(worker, { type: 'init' })
    })

    expect(event.type).toBe('ready')
    worker.terminate()
  })
})

describe('Typed message protocol', () => {
  it('WorkerCommand and WorkerEvent types compile correctly', () => {
    // Type-level test: these assignments must compile without errors
    const initCmd: WorkerCommand = { type: 'init' }
    expect(initCmd.type).toBe('init')

    const compressCmd: WorkerCommand = {
      type: 'compress',
      fileIndex: 0,
      fileName: 'test.pdf',
      buffer: new ArrayBuffer(8),
      target: { mode: 'size', maxBytes: 4_000_000 },
    }
    expect(compressCmd.type).toBe('compress')

    const readyEvent: WorkerEvent = { type: 'ready' }
    expect(readyEvent.type).toBe('ready')

    const progressEvent: WorkerEvent = {
      type: 'progress',
      fileIndex: 0,
      iteration: 1,
      totalEstimated: 10,
      currentDpi: 300,
      currentSize: 5_000_000,
    }
    expect(progressEvent.type).toBe('progress')

    const doneEvent: WorkerEvent = {
      type: 'file-done',
      fileIndex: 0,
      compressedSize: 3_000_000,
      buffer: new ArrayBuffer(8),
    }
    expect(doneEvent.type).toBe('file-done')

    const skippedEvent: WorkerEvent = {
      type: 'file-skipped',
      fileIndex: 0,
      reason: 'already-fits',
    }
    expect(skippedEvent.type).toBe('file-skipped')

    const errorEvent: WorkerEvent = {
      type: 'file-error',
      fileIndex: 0,
      error: 'something went wrong',
    }
    expect(errorEvent.type).toBe('file-error')
  })
})

describe('Transferable support', () => {
  it('sendCommand accepts Transferable list and forwards to postMessage', () => {
    const worker = createCompressionWorker()
    const buffer = new ArrayBuffer(1024)
    expect(buffer.byteLength).toBe(1024)

    // Spy on postMessage to verify transfer list is passed
    const postMessageSpy = vi.spyOn(worker, 'postMessage')

    const cmd: WorkerCommand = {
      type: 'compress',
      fileIndex: 0,
      fileName: 'test.pdf',
      buffer,
      target: { mode: 'percentage', reductionPct: 50 },
    }

    sendCommand(worker, cmd, [buffer])

    // Verify postMessage was called with the transfer option
    expect(postMessageSpy).toHaveBeenCalledWith(cmd, { transfer: [buffer] })

    postMessageSpy.mockRestore()
    worker.terminate()
  })
})
