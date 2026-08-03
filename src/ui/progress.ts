import { formatSize, downloadResult } from './results'
import type { CompressionResult } from '../compression/types'

export interface ProgressUI {
  /** Begin a run: one row per file, all queued. */
  startRun(fileNames: string[]): void
  updateIteration(fileIndex: number, iteration: number, dpi: number, size: number): void
  showFileComplete(fileIndex: number): void
  /** Turn the file's row into its final result (sizes, download). */
  showFileResult(result: CompressionResult): void
  showFileError(fileIndex: number, fileName: string, message: string): void
  showLoading(message: string): void
  hideLoading(): void
  reset(): void
}

export function createProgressUI(container: HTMLElement): ProgressUI {
  const progressContainer = document.createElement('div')
  progressContainer.className = 'progress-container'

  const statusEl = document.createElement('p')
  statusEl.className = 'progress-status'

  const barEl = document.createElement('div')
  barEl.className = 'progress-bar'

  const fillEl = document.createElement('div')
  fillEl.className = 'progress-fill'
  fillEl.style.width = '0%'
  barEl.appendChild(fillEl)

  const filesEl = document.createElement('div')
  filesEl.className = 'progress-files'

  const loadingEl = document.createElement('div')
  loadingEl.className = 'progress-loading'
  loadingEl.style.display = 'none'

  progressContainer.appendChild(statusEl)
  progressContainer.appendChild(barEl)
  progressContainer.appendChild(filesEl)
  progressContainer.appendChild(loadingEl)

  container.appendChild(progressContainer)

  interface FileRow {
    root: HTMLElement
    nameEl: HTMLElement
    metaEl: HTMLElement
  }

  let names: string[] = []
  let rows: FileRow[] = []
  // Per-file progress in [0, 1]; the bar shows the average, so it moves
  // smoothly during long single-file runs and stays monotonic when
  // concurrent files report out of order
  let fractions: number[] = []
  let total = 0
  let completed = 0

  // A typical search converges within this many Ghostscript passes;
  // in-flight files approach (but never reach) full until they complete
  const EXPECTED_ITERATIONS = 6

  type RowState = 'queued' | 'active' | 'success' | 'error'

  function makeBadge(kind: string, text: string): HTMLElement {
    const badge = document.createElement('span')
    badge.className = `badge badge--${kind}`
    badge.textContent = text
    return badge
  }

  function makeRow(name: string, state: RowState, meta: string): FileRow {
    const root = document.createElement('div')
    root.className = `progress-file-row progress-file-row--${state}`

    const main = document.createElement('div')
    main.className = 'progress-file-row__main'

    const nameEl = document.createElement('span')
    nameEl.className = 'progress-file-row__name'
    nameEl.textContent = name
    nameEl.title = name

    const metaEl = document.createElement('span')
    metaEl.className = 'progress-file-row__meta'
    metaEl.textContent = meta

    main.appendChild(nameEl)
    main.appendChild(metaEl)
    root.appendChild(main)
    filesEl.appendChild(root)
    return { root, nameEl, metaEl }
  }

  function setState(row: FileRow, state: RowState): void {
    row.root.className = `progress-file-row progress-file-row--${state}`
  }

  function renderBar(): void {
    if (total === 0) return
    const sum = fractions.reduce((a, b) => a + b, 0)
    fillEl.style.width = `${Math.min(100, Math.round((sum / total) * 100))}%`
  }

  function fileDone(fileIndex: number): void {
    completed++
    if (fractions[fileIndex] !== undefined) fractions[fileIndex] = 1
    renderBar()
    if (completed >= total && total > 0) {
      statusEl.textContent = 'Done'
    }
  }

  function startRun(fileNames: string[]): void {
    names = [...fileNames]
    total = names.length
    completed = 0
    fractions = names.map(() => 0)
    statusEl.textContent = `Compressing ${total} file${total !== 1 ? 's' : ''}...`
    fillEl.style.transition = 'none'
    fillEl.style.width = '0%'
    requestAnimationFrame(() => {
      fillEl.style.transition = ''
    })
    filesEl.textContent = ''
    rows = names.map((name) => makeRow(name, 'queued', 'Queued'))
  }

  function updateIteration(fileIndex: number, iteration: number, dpi: number, size: number): void {
    const row = rows[fileIndex]
    if (!row) return
    setState(row, 'active')
    row.metaEl.textContent = `Attempt ${iteration} · ${dpi} DPI · ${formatSize(size)}`
    fractions[fileIndex] = Math.max(
      fractions[fileIndex],
      Math.min(0.9, iteration / EXPECTED_ITERATIONS)
    )
    renderBar()
  }

  function showFileComplete(fileIndex: number): void {
    const row = rows[fileIndex]
    if (row) {
      setState(row, 'success')
      row.metaEl.textContent = 'Complete'
    }
    fileDone(fileIndex)
  }

  function showFileResult(result: CompressionResult): void {
    const row = rows[result.fileIndex]
    if (!row) return

    setState(row, result.error ? 'error' : 'success')
    row.metaEl.textContent = ''

    if (result.error) {
      row.metaEl.textContent = `Compression failed: ${result.error}`
    } else if (result.skipped) {
      const sizes = document.createElement('span')
      sizes.textContent = formatSize(result.originalSize)
      row.metaEl.appendChild(sizes)
      row.metaEl.appendChild(makeBadge('muted', 'already under target'))
    } else {
      const saved = Math.round((1 - result.compressedSize / result.originalSize) * 100)
      const sizes = document.createElement('span')
      sizes.textContent = `${formatSize(result.originalSize)} → ${formatSize(result.compressedSize)}`
      row.metaEl.appendChild(sizes)
      row.metaEl.appendChild(makeBadge('saving', `${saved}% smaller`))
      if (result.lossless) {
        row.metaEl.appendChild(makeBadge('lossless', 'lossless'))
      }
      if (!result.metTarget) {
        row.root.classList.add('progress-file-row--warning')
        row.metaEl.appendChild(makeBadge('warning', 'target not reached, smallest possible'))
      }
    }

    if (!result.error && result.compressedSize > 0) {
      const downloadBtn = document.createElement('button')
      downloadBtn.className = 'results__download-btn'
      downloadBtn.textContent = 'Download'
      downloadBtn.type = 'button'
      downloadBtn.addEventListener('click', () => downloadResult(result))
      row.root.appendChild(downloadBtn)
    }

    fileDone(result.fileIndex)
  }

  function showFileError(fileIndex: number, fileName: string, message: string): void {
    const row = rows[fileIndex]
    if (row) {
      setState(row, 'error')
      row.metaEl.textContent = message
      fileDone(fileIndex)
      return
    }
    // No matching row (e.g. engine-level failure before a run starts)
    makeRow(fileName, 'error', message)
  }

  function showLoading(message: string): void {
    loadingEl.textContent = message
    loadingEl.style.display = 'block'
  }

  function hideLoading(): void {
    loadingEl.style.display = 'none'
  }

  function reset(): void {
    statusEl.textContent = ''
    fillEl.style.width = '0%'
    filesEl.textContent = ''
    names = []
    rows = []
    fractions = []
    total = 0
    completed = 0
    loadingEl.style.display = 'none'
    loadingEl.textContent = ''
  }

  return {
    startRun,
    updateIteration,
    showFileComplete,
    showFileResult,
    showFileError,
    showLoading,
    hideLoading,
    reset,
  }
}
