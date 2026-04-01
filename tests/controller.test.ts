import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  WorkerCommand,
  WorkerEvent,
  CompressionTarget,
  CompressionResult,
} from '../src/compression/types'
import { CompressionController } from '../src/compression/controller'

/**
 * MockWorker simulates a Web Worker for testing the CompressionController.
 * Records postMessage calls and allows simulating responses.
 */
class MockWorker {
  postMessageCalls: Array<{ data: WorkerCommand; options?: StructuredSerializeOptions }> = []
  onmessage: ((e: MessageEvent<WorkerEvent>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null

  postMessage(data: WorkerCommand, options?: StructuredSerializeOptions): void {
    this.postMessageCalls.push({ data, options })
  }

  /** Simulate worker sending back an event */
  simulateResponse(event: WorkerEvent): void {
    if (this.onmessage) {
      this.onmessage({ data: event } as MessageEvent<WorkerEvent>)
    }
  }

  terminate(): void {}

  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('CompressionController', () => {
  let mockWorker: MockWorker

  beforeEach(() => {
    mockWorker = new MockWorker()
    // Immediately simulate ready event when controller sets up onmessage
  })

  function createController(): CompressionController {
    const controller = new CompressionController(mockWorker as unknown as Worker)
    // Simulate worker ready after short delay
    queueMicrotask(() => mockWorker.simulateResponse({ type: 'ready' }))
    return controller
  }

  it('Test 1: skips files already under target size without sending to worker', async () => {
    const controller = createController()
    const smallBuffer = new ArrayBuffer(1000) // 1KB, well under 4MB target
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

    const results = await controller.compressFiles(
      [{ name: 'small.pdf', buffer: smallBuffer }],
      target
    )

    expect(results).toHaveLength(1)
    expect(results[0].skipped).toBe(true)
    expect(results[0].fileName).toBe('small.pdf')
    expect(results[0].originalSize).toBe(1000)
    // No compress command should have been sent to worker
    const compressCommands = mockWorker.postMessageCalls.filter(
      (c) => c.data.type === 'compress'
    )
    expect(compressCommands).toHaveLength(0)
  })

  it('Test 2: sends compress command with Transferable buffer for files that need compression', async () => {
    const controller = createController()
    const bigBuffer = new ArrayBuffer(8_000_000) // 8MB, needs compression
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

    const compressPromise = controller.compressFiles(
      [{ name: 'big.pdf', buffer: bigBuffer }],
      target
    )

    // Wait for compress command to be sent
    await new Promise((r) => setTimeout(r, 50))

    // Worker should have received a compress command
    const compressCommands = mockWorker.postMessageCalls.filter(
      (c) => c.data.type === 'compress'
    )
    expect(compressCommands).toHaveLength(1)
    expect(compressCommands[0].options?.transfer).toBeDefined()
    expect(compressCommands[0].options!.transfer!.length).toBeGreaterThan(0)

    // Simulate worker done response
    const compressedBuffer = new ArrayBuffer(3_000_000)
    mockWorker.simulateResponse({
      type: 'file-done',
      fileIndex: 0,
      compressedSize: 3_000_000,
      buffer: compressedBuffer,
    })

    const results = await compressPromise
    expect(results).toHaveLength(1)
    expect(results[0].skipped).toBe(false)
    expect(results[0].compressedSize).toBe(3_000_000)
    expect(results[0].buffer).toBe(compressedBuffer)
  })

  it('Test 3: collects file-done results into CompressionResult array', async () => {
    const controller = createController()
    const buffer = new ArrayBuffer(8_000_000)
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

    const compressPromise = controller.compressFiles(
      [{ name: 'doc.pdf', buffer }],
      target
    )

    await new Promise((r) => setTimeout(r, 50))

    const compressedBuffer = new ArrayBuffer(2_500_000)
    mockWorker.simulateResponse({
      type: 'file-done',
      fileIndex: 0,
      compressedSize: 2_500_000,
      buffer: compressedBuffer,
    })

    const results = await compressPromise
    expect(results[0]).toEqual({
      fileIndex: 0,
      fileName: 'doc.pdf',
      originalSize: 8_000_000,
      compressedSize: 2_500_000,
      buffer: compressedBuffer,
      skipped: false,
    })
  })

  it('Test 4: collects file-skipped results with skipped=true', async () => {
    const controller = createController()
    const buffer = new ArrayBuffer(8_000_000)
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

    const compressPromise = controller.compressFiles(
      [{ name: 'already-small.pdf', buffer }],
      target
    )

    await new Promise((r) => setTimeout(r, 50))

    // Worker says file is skipped (worker-level skip)
    mockWorker.simulateResponse({
      type: 'file-skipped',
      fileIndex: 0,
      reason: 'already-fits',
    })

    const results = await compressPromise
    expect(results[0].skipped).toBe(true)
    expect(results[0].fileName).toBe('already-small.pdf')
  })

  it('Test 5: handles file-error by including error in results (not throwing)', async () => {
    const controller = createController()
    const buffer = new ArrayBuffer(8_000_000)
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

    const compressPromise = controller.compressFiles(
      [{ name: 'corrupt.pdf', buffer }],
      target
    )

    await new Promise((r) => setTimeout(r, 50))

    mockWorker.simulateResponse({
      type: 'file-error',
      fileIndex: 0,
      error: 'Could not compress to target size even at minimum DPI',
    })

    const results = await compressPromise
    // Should not throw, should include result with error info
    expect(results).toHaveLength(1)
    expect(results[0].fileName).toBe('corrupt.pdf')
    expect(results[0].compressedSize).toBe(0)
    expect(results[0].skipped).toBe(false)
  })

  it('Test 6: multiple files processed sequentially (file 2 not sent until file 1 completes)', async () => {
    const controller = createController()
    const buffer1 = new ArrayBuffer(8_000_000)
    const buffer2 = new ArrayBuffer(6_000_000)
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }

    const compressPromise = controller.compressFiles(
      [
        { name: 'file1.pdf', buffer: buffer1 },
        { name: 'file2.pdf', buffer: buffer2 },
      ],
      target
    )

    await new Promise((r) => setTimeout(r, 50))

    // Only file1 should have been sent so far
    let compressCommands = mockWorker.postMessageCalls.filter(
      (c) => c.data.type === 'compress'
    )
    expect(compressCommands).toHaveLength(1)
    expect((compressCommands[0].data as Extract<WorkerCommand, { type: 'compress' }>).fileIndex).toBe(0)

    // Complete file1
    mockWorker.simulateResponse({
      type: 'file-done',
      fileIndex: 0,
      compressedSize: 3_000_000,
      buffer: new ArrayBuffer(3_000_000),
    })

    await new Promise((r) => setTimeout(r, 50))

    // Now file2 should be sent
    compressCommands = mockWorker.postMessageCalls.filter(
      (c) => c.data.type === 'compress'
    )
    expect(compressCommands).toHaveLength(2)
    expect((compressCommands[1].data as Extract<WorkerCommand, { type: 'compress' }>).fileIndex).toBe(1)

    // Complete file2
    mockWorker.simulateResponse({
      type: 'file-done',
      fileIndex: 1,
      compressedSize: 2_000_000,
      buffer: new ArrayBuffer(2_000_000),
    })

    const results = await compressPromise
    expect(results).toHaveLength(2)
    expect(results[0].fileName).toBe('file1.pdf')
    expect(results[1].fileName).toBe('file2.pdf')
  })

  it('Test 7: progress callback fires with iteration info during compression', async () => {
    const controller = createController()
    const buffer = new ArrayBuffer(8_000_000)
    const target: CompressionTarget = { mode: 'size', maxBytes: 4_000_000 }
    const onProgress = vi.fn()

    const compressPromise = controller.compressFiles(
      [{ name: 'big.pdf', buffer }],
      target,
      onProgress
    )

    await new Promise((r) => setTimeout(r, 50))

    // Send progress events
    mockWorker.simulateResponse({
      type: 'progress',
      fileIndex: 0,
      iteration: 1,
      totalEstimated: 11,
      currentDpi: 300,
      currentSize: 6_000_000,
    })
    mockWorker.simulateResponse({
      type: 'progress',
      fileIndex: 0,
      iteration: 2,
      totalEstimated: 11,
      currentDpi: 165,
      currentSize: 3_500_000,
    })

    // Complete the file
    mockWorker.simulateResponse({
      type: 'file-done',
      fileIndex: 0,
      compressedSize: 3_500_000,
      buffer: new ArrayBuffer(3_500_000),
    })

    await compressPromise

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalledWith(0, 1, 300, 6_000_000)
    expect(onProgress).toHaveBeenCalledWith(0, 2, 165, 3_500_000)
  })
})
