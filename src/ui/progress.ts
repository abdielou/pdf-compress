import { formatSize } from './results'

export interface ProgressUI {
  /** Begin a run: one row per file, all queued. */
  startRun(fileNames: string[]): void
  updateIteration(fileIndex: number, iteration: number, dpi: number, size: number): void
  showFileComplete(fileIndex: number): void
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

  let names: string[] = []
  let rows: HTMLElement[] = []
  let total = 0
  let completed = 0

  function setRow(row: HTMLElement, state: 'queued' | 'active' | 'success' | 'error', text: string): void {
    row.className = `progress-file-row progress-file-row--${state}`
    row.textContent = text
  }

  function fileDone(): void {
    completed++
    if (total > 0) {
      fillEl.style.width = `${Math.min(100, Math.round((completed / total) * 100))}%`
    }
    if (completed >= total && total > 0) {
      statusEl.textContent = 'Done'
    }
  }

  function startRun(fileNames: string[]): void {
    names = [...fileNames]
    total = names.length
    completed = 0
    statusEl.textContent = `Compressing ${total} file${total !== 1 ? 's' : ''}...`
    fillEl.style.transition = 'none'
    fillEl.style.width = '0%'
    requestAnimationFrame(() => {
      fillEl.style.transition = ''
    })
    filesEl.textContent = ''
    rows = names.map((name) => {
      const row = document.createElement('div')
      setRow(row, 'queued', `${name}: queued`)
      filesEl.appendChild(row)
      return row
    })
  }

  function updateIteration(fileIndex: number, iteration: number, dpi: number, size: number): void {
    const row = rows[fileIndex]
    if (!row) return
    setRow(row, 'active', `${names[fileIndex]}: attempt ${iteration} at ${dpi} DPI (${formatSize(size)})`)
  }

  function showFileComplete(fileIndex: number): void {
    const row = rows[fileIndex]
    if (row) setRow(row, 'success', `✓ ${names[fileIndex]}`)
    fileDone()
  }

  function showFileError(fileIndex: number, fileName: string, message: string): void {
    const row = rows[fileIndex]
    if (row) {
      setRow(row, 'error', `${names[fileIndex]}: ${message}`)
      fileDone()
      return
    }
    // No matching row (e.g. engine-level failure before a run starts)
    const orphan = document.createElement('div')
    setRow(orphan, 'error', `${fileName}: ${message}`)
    filesEl.appendChild(orphan)
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
    total = 0
    completed = 0
    loadingEl.style.display = 'none'
    loadingEl.textContent = ''
  }

  return {
    startRun,
    updateIteration,
    showFileComplete,
    showFileError,
    showLoading,
    hideLoading,
    reset,
  }
}
