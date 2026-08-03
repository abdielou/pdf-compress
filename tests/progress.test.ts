// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createProgressUI } from '../src/ui/progress'

describe('ProgressUI: per-file rows', () => {
  it('startRun renders overall status and one queued row per file', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.startRun(['a.pdf', 'b.pdf', 'c.pdf'])

    const status = container.querySelector('.progress-status')
    expect(status!.textContent).toContain('Compressing 3 files')

    const rows = container.querySelectorAll('.progress-file-row')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('a.pdf')
    expect(rows[1].textContent).toContain('b.pdf')
    expect(rows[2].textContent).toContain('c.pdf')
  })

  it('updateIteration updates only that file row (concurrent files keep their own state)', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.startRun(['a.pdf', 'b.pdf'])
    ui.updateIteration(1, 2, 150, 2_000_000)

    const rows = container.querySelectorAll('.progress-file-row')
    expect(rows[1].textContent).toContain('attempt 2')
    expect(rows[1].textContent).toContain('150 DPI')
    expect(rows[0].textContent).not.toContain('attempt')

    // A second concurrent file reports without clobbering the first
    ui.updateIteration(0, 1, 300, 5_000_000)
    expect(rows[0].textContent).toContain('attempt 1')
    expect(rows[1].textContent).toContain('attempt 2')
  })

  it('showFileComplete marks the row and advances the overall bar', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.startRun(['a.pdf', 'b.pdf'])
    ui.showFileComplete(0)

    const rows = container.querySelectorAll('.progress-file-row')
    expect(rows[0].className).toContain('success')

    const fill = container.querySelector('.progress-fill') as HTMLElement
    expect(fill.style.width).toBe('50%')

    ui.showFileComplete(1)
    expect(fill.style.width).toBe('100%')
  })

  it('showFileError marks that row with the message', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.startRun(['a.pdf', 'bad.pdf'])
    ui.showFileError(1, 'bad.pdf', 'Compression failed')

    const rows = container.querySelectorAll('.progress-file-row')
    expect(rows[1].className).toContain('error')
    expect(rows[1].textContent).toContain('bad.pdf')
    expect(rows[1].textContent).toContain('Compression failed')
  })

  it('showFileError without a matching row appends one (engine-level failure)', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.showFileError(-1, 'Engine', 'WASM failed to load')

    const files = container.querySelector('.progress-files')
    expect(files!.textContent).toContain('Engine')
    expect(files!.textContent).toContain('WASM failed to load')
  })

  it('loading state: showLoading makes overlay visible, hideLoading hides it', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.showLoading('Preparing...')
    const overlay = container.querySelector('.progress-loading') as HTMLElement
    expect(overlay.style.display).not.toBe('none')

    ui.hideLoading()
    expect(overlay.style.display).toBe('none')
  })

  it('reset: clears all progress state', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.startRun(['a.pdf'])
    ui.updateIteration(0, 1, 72, 500_000)
    ui.showFileError(0, 'a.pdf', 'Error')

    ui.reset()

    expect(container.querySelector('.progress-status')!.textContent).toBe('')
    expect((container.querySelector('.progress-fill') as HTMLElement).style.width).toBe('0%')
    expect(container.querySelector('.progress-files')!.textContent).toBe('')
  })
})
