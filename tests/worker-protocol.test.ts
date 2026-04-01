import { describe, it, expect, vi } from 'vitest'
import { sendCommand } from '../src/compression/worker-client'
import type { WorkerCommand, WorkerEvent } from '../src/compression/types'

describe('Worker protocol: Transferable handling', () => {
  it('Protocol Test 1: sendCommand includes buffer in transfer list for compress commands', () => {
    // Create a minimal mock worker
    const postMessageSpy = vi.fn()
    const mockWorker = {
      postMessage: postMessageSpy,
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    } as unknown as Worker

    const buffer = new ArrayBuffer(1024)
    const cmd: WorkerCommand = {
      type: 'compress',
      fileIndex: 0,
      fileName: 'test.pdf',
      buffer,
      target: { mode: 'size', maxBytes: 500 },
    }

    sendCommand(mockWorker, cmd, [buffer])

    expect(postMessageSpy).toHaveBeenCalledWith(cmd, { transfer: [buffer] })
  })

  it('Protocol Test 2: sendCommand works without transfer list for init', () => {
    const postMessageSpy = vi.fn()
    const mockWorker = {
      postMessage: postMessageSpy,
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    } as unknown as Worker

    const cmd: WorkerCommand = { type: 'init' }
    sendCommand(mockWorker, cmd)

    expect(postMessageSpy).toHaveBeenCalledWith(cmd, { transfer: undefined })
  })
})

describe('Worker protocol: type exhaustiveness', () => {
  it('Protocol Test 3: all WorkerEvent types are handled (no unhandled case)', () => {
    // This tests type exhaustiveness at compile time + runtime
    function handleEvent(event: WorkerEvent): string {
      switch (event.type) {
        case 'ready':
          return 'ready'
        case 'progress':
          return `progress:${event.iteration}`
        case 'file-done':
          return `done:${event.compressedSize}`
        case 'file-skipped':
          return `skipped:${event.reason}`
        case 'file-error':
          return `error:${event.error}`
        default: {
          // TypeScript exhaustive check: if all cases are handled,
          // 'event' should be 'never' here
          const _exhaustive: never = event
          return _exhaustive
        }
      }
    }

    // Verify all event types are handled correctly
    expect(handleEvent({ type: 'ready' })).toBe('ready')
    expect(
      handleEvent({
        type: 'progress',
        fileIndex: 0,
        iteration: 3,
        totalEstimated: 11,
        currentDpi: 200,
        currentSize: 4_000_000,
      })
    ).toBe('progress:3')
    expect(
      handleEvent({
        type: 'file-done',
        fileIndex: 0,
        compressedSize: 3_000_000,
        buffer: new ArrayBuffer(0),
      })
    ).toBe('done:3000000')
    expect(
      handleEvent({
        type: 'file-skipped',
        fileIndex: 0,
        reason: 'already-fits',
      })
    ).toBe('skipped:already-fits')
    expect(
      handleEvent({
        type: 'file-error',
        fileIndex: 0,
        error: 'something failed',
      })
    ).toBe('error:something failed')
  })
})
