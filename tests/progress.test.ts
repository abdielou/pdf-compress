// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createProgressUI } from '../src/ui/progress'

describe('ProgressUI', () => {
  it('status text: showFileProgress renders "Compressing X/N... filename.pdf"', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.showFileProgress(0, 3, 'report.pdf')

    const status = container.querySelector('.progress-status')
    expect(status).toBeTruthy()
    expect(status!.textContent).toContain('Compressing 1/3... report.pdf')
  })

  it('progress bar: updateIteration updates bar width and iteration text', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.showFileProgress(0, 3, 'report.pdf')
    ui.updateIteration(2, 150, 2_000_000)

    const fill = container.querySelector('.progress-fill') as HTMLElement
    expect(fill).toBeTruthy()
    expect(fill!.style.width).not.toBe('')
    expect(fill!.style.width).not.toBe('0%')

    const iterText = container.querySelector('.progress-iteration')
    expect(iterText).toBeTruthy()
    expect(iterText!.textContent).toContain('Attempt 2')
    expect(iterText!.textContent).toContain('150 DPI')
  })

  it('error: showFileError renders error row with file name and message', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.showFileError(0, 'bad.pdf', 'Compression failed')

    const files = container.querySelector('.progress-files')
    expect(files).toBeTruthy()
    expect(files!.textContent).toContain('bad.pdf')
    expect(files!.textContent).toContain('Compression failed')
  })

  it('loading state: showLoading makes overlay visible, hideLoading hides it', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.showLoading('Preparing...')
    const overlay = container.querySelector('.progress-loading') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(overlay!.style.display).not.toBe('none')

    ui.hideLoading()
    expect(overlay!.style.display).toBe('none')
  })

  it('reset: clears all progress state', () => {
    const container = document.createElement('div')
    const ui = createProgressUI(container)

    ui.showFileProgress(0, 3, 'report.pdf')
    ui.updateIteration(1, 72, 500_000)
    ui.showFileError(0, 'bad.pdf', 'Error')

    ui.reset()

    const status = container.querySelector('.progress-status')
    expect(status!.textContent).toBe('')
    const fill = container.querySelector('.progress-fill') as HTMLElement
    expect(fill!.style.width).toBe('0%')
    const iterText = container.querySelector('.progress-iteration')
    expect(iterText!.textContent).toBe('')
    const files = container.querySelector('.progress-files')
    expect(files!.textContent).toBe('')
  })
})
