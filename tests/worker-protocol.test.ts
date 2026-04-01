import { describe, it, expect, vi } from 'vitest'
import { sendCommand } from '../src/compression/worker-client'
import type { WorkerCommand, WorkerEvent } from '../src/compression/types'

describe('Worker protocol: Transferable handling', () => {
  it('Protocol Test 1: sendCommand includes buffer in transfer list for compress-at-dpi', () => {
    const postMessageSpy = vi.fn()
    const mockWorker = {
      postMessage: postMessageSpy,
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    } as unknown as Worker

    const buffer = new ArrayBuffer(1024)
    const cmd: WorkerCommand = {
      type: 'compress-at-dpi',
      fileIndex: 0,
      buffer,
      dpi: 150,
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
    function handleEvent(event: WorkerEvent): string {
      switch (event.type) {
        case 'ready':
          return 'ready'
        case 'dpi-result':
          return `result:dpi=${event.dpi},size=${event.size}`
        case 'dpi-error':
          return `error:dpi=${event.dpi},${event.error}`
        default: {
          const _exhaustive: never = event
          return _exhaustive
        }
      }
    }

    expect(handleEvent({ type: 'ready' })).toBe('ready')
    expect(
      handleEvent({
        type: 'dpi-result',
        fileIndex: 0,
        dpi: 200,
        size: 4_000_000,
        buffer: new ArrayBuffer(0),
      })
    ).toBe('result:dpi=200,size=4000000')
    expect(
      handleEvent({
        type: 'dpi-error',
        fileIndex: 0,
        dpi: 200,
        error: 'something failed',
      })
    ).toBe('error:dpi=200,something failed')
  })
})
