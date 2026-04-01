import type { WorkerCommand } from './types'

export function createCompressionWorker(): Worker {
  return new Worker(
    new URL('../worker/compression.worker.ts', import.meta.url),
    { type: 'module' }
  )
}

export function sendCommand(
  worker: Worker,
  cmd: WorkerCommand,
  transfer?: Transferable[]
): void {
  worker.postMessage(cmd, { transfer } as StructuredSerializeOptions)
}
