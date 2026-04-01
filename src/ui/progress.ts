export interface ProgressUI {
  showFileProgress(fileIndex: number, totalFiles: number, fileName: string): void
  updateIteration(iteration: number, dpi: number, size: number): void
  showFileComplete(fileIndex: number): void
  showFileError(fileIndex: number, fileName: string, message: string): void
  showLoading(message: string): void
  hideLoading(): void
  reset(): void
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function createProgressUI(container: HTMLElement): ProgressUI {
  // Build DOM structure
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

  const iterEl = document.createElement('small')
  iterEl.className = 'progress-iteration'

  const filesEl = document.createElement('div')
  filesEl.className = 'progress-files'

  const loadingEl = document.createElement('div')
  loadingEl.className = 'progress-loading'
  loadingEl.style.display = 'none'

  progressContainer.appendChild(statusEl)
  progressContainer.appendChild(barEl)
  progressContainer.appendChild(iterEl)
  progressContainer.appendChild(filesEl)
  progressContainer.appendChild(loadingEl)

  container.appendChild(progressContainer)

  function showFileProgress(fileIndex: number, totalFiles: number, fileName: string): void {
    statusEl.textContent = `Compressing ${fileIndex + 1}/${totalFiles}... ${fileName}`
    fillEl.style.width = '0%'
    iterEl.textContent = ''
  }

  function updateIteration(iteration: number, dpi: number, size: number): void {
    iterEl.textContent = `Attempt ${iteration} at ${dpi} DPI (${formatSize(size)})`
    // Estimate percentage: 5 iterations typical; cap at 90%
    const pct = Math.min(90, (iteration / 5) * 100)
    fillEl.style.width = `${pct}%`
  }

  function showFileComplete(fileIndex: number): void {
    fillEl.style.width = '100%'
    const row = document.createElement('div')
    row.className = 'progress-file-row progress-file-row--success'
    row.textContent = `\u2713 File ${fileIndex + 1} complete`
    filesEl.appendChild(row)
  }

  function showFileError(fileIndex: number, fileName: string, message: string): void {
    const row = document.createElement('div')
    row.className = 'progress-file-row progress-file-row--error'
    row.textContent = `${fileName}: ${message}`
    filesEl.appendChild(row)
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
    iterEl.textContent = ''
    filesEl.textContent = ''
    loadingEl.style.display = 'none'
    loadingEl.textContent = ''
  }

  return {
    showFileProgress,
    updateIteration,
    showFileComplete,
    showFileError,
    showLoading,
    hideLoading,
    reset,
  }
}
