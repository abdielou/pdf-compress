// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We mock the modules that require WASM / workers
vi.mock('../src/main', () => ({
  compressFiles: vi.fn(),
  controller: {
    isReady: false,
    waitUntilReady: vi.fn(),
  },
}))

vi.mock('../src/ui/drop-zone', () => ({
  createDropZone: vi.fn().mockReturnValue({ reset: vi.fn() }),
}))

vi.mock('../src/ui/target-config', () => ({
  createTargetConfig: vi.fn().mockReturnValue({
    getTarget: vi.fn().mockReturnValue({ mode: 'size', maxBytes: 4_000_000 }),
  }),
}))

describe('App Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wasm loading: shows loading overlay when controller not ready, hides after ready', async () => {
    const { controller, compressFiles } = await import('../src/main')
    const mockController = controller as { isReady: boolean; waitUntilReady: ReturnType<typeof vi.fn> }

    // Arrange: controller not ready initially
    mockController.isReady = false
    let resolveReady!: () => void
    const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve })
    mockController.waitUntilReady.mockReturnValue(readyPromise)

    // compressFiles mock returns valid result after ready
    ;(compressFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        fileIndex: 0,
        fileName: 'test.pdf',
        originalSize: 5_000_000,
        compressedSize: 3_000_000,
        buffer: new ArrayBuffer(0),
        skipped: false,
      },
    ])

    const { initApp } = await import('../src/ui/app')
    const root = document.createElement('div')
    document.body.appendChild(root)

    initApp(root)

    // Simulate file selection via drop zone callback
    const { createDropZone } = await import('../src/ui/drop-zone')
    const dropZoneCall = (createDropZone as ReturnType<typeof vi.fn>).mock.calls[0]
    const onFilesCb = dropZoneCall[1] as (files: File[]) => void

    const pdfFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'test.pdf', { type: 'application/pdf' })
    onFilesCb([pdfFile])

    // Click the compress button
    const compressBtn = root.querySelector('.compress-btn') as HTMLButtonElement
    expect(compressBtn).toBeTruthy()

    // Start compress (don't await — it will block on waitUntilReady)
    const clickPromise = compressBtn.click()

    // Give the click handler microtask time to run
    await new Promise((r) => setTimeout(r, 10))

    // Loading overlay should be visible
    const overlay = root.querySelector('.progress-loading') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(overlay.style.display).not.toBe('none')

    // Resolve ready
    mockController.isReady = true
    resolveReady()
    await new Promise((r) => setTimeout(r, 20))

    // Overlay should be hidden
    expect(overlay.style.display).toBe('none')

    document.body.removeChild(root)
    vi.resetModules()
  })

  it('error per file: shows per-file error when compressedSize is 0 and not skipped', async () => {
    const { controller, compressFiles } = await import('../src/main')
    const mockController = controller as { isReady: boolean; waitUntilReady: ReturnType<typeof vi.fn> }

    // Arrange: controller already ready
    mockController.isReady = true

    // compressFiles returns a failed result
    ;(compressFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        fileIndex: 0,
        fileName: 'bad.pdf',
        originalSize: 5_000_000,
        compressedSize: 0,
        buffer: new ArrayBuffer(0),
        skipped: false,
      },
    ])

    const { initApp } = await import('../src/ui/app')
    const root = document.createElement('div')
    document.body.appendChild(root)

    initApp(root)

    // Simulate file selection
    const { createDropZone } = await import('../src/ui/drop-zone')
    const dropZoneCall = (createDropZone as ReturnType<typeof vi.fn>).mock.calls[0]
    const onFilesCb = dropZoneCall[1] as (files: File[]) => void

    const pdfFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'bad.pdf', { type: 'application/pdf' })
    onFilesCb([pdfFile])

    const compressBtn = root.querySelector('.compress-btn') as HTMLButtonElement
    expect(compressBtn).toBeTruthy()

    compressBtn.click()
    await new Promise((r) => setTimeout(r, 30))

    // Error should be visible in progress files
    const progressFiles = root.querySelector('.progress-files')
    expect(progressFiles).toBeTruthy()
    expect(progressFiles!.textContent).toContain('bad.pdf')

    document.body.removeChild(root)
    vi.resetModules()
  })
})
