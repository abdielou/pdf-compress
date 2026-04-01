import { createDropZone } from './drop-zone'
import { createTargetConfig } from './target-config'
import { createProgressUI } from './progress'
import { renderResults } from './results'
import { compressFiles, controller } from '../main'
import type { CompressionResult } from '../compression/types'

type AppState = 'idle' | 'files-selected' | 'compressing' | 'done'

export let lastResults: CompressionResult[] = []

export function initApp(root: HTMLElement): void {
  let state: AppState = 'idle'
  let selectedFiles: File[] = []

  // --- Build layout ---

  // Target config section (above drop zone)
  const targetSection = document.createElement('div')
  targetSection.className = 'app-section'
  root.appendChild(targetSection)
  const targetConfig = createTargetConfig(targetSection)

  // Drop zone section
  const dropSection = document.createElement('div')
  dropSection.className = 'app-section'
  root.appendChild(dropSection)

  // File count indicator
  const fileCountEl = document.createElement('p')
  fileCountEl.className = 'file-count'
  fileCountEl.style.display = 'none'
  dropSection.appendChild(fileCountEl)

  // File list
  const fileListEl = document.createElement('ul')
  fileListEl.className = 'file-list'
  fileListEl.style.display = 'none'
  dropSection.appendChild(fileListEl)

  const dropZone = createDropZone(dropSection, onFiles)

  // Compress button (initially hidden)
  const compressBtn = document.createElement('button')
  compressBtn.className = 'compress-btn'
  compressBtn.textContent = 'Compress'
  compressBtn.style.display = 'none'
  root.appendChild(compressBtn)

  // Progress section
  const progressSection = document.createElement('div')
  progressSection.className = 'app-section'
  root.appendChild(progressSection)
  const progressUI = createProgressUI(progressSection)

  // Results section
  const resultsSection = document.createElement('div')
  resultsSection.className = 'app-section'
  root.appendChild(resultsSection)

  // --- State machine ---

  function setState(next: AppState): void {
    state = next
    switch (state) {
      case 'idle':
        compressBtn.style.display = 'none'
        fileCountEl.style.display = 'none'
        fileListEl.style.display = 'none'
        fileListEl.innerHTML = ''
        progressUI.reset()
        resultsSection.innerHTML = ''
        break
      case 'files-selected':
        compressBtn.style.display = 'block'
        compressBtn.disabled = false
        compressBtn.textContent = 'Compress'
        fileCountEl.style.display = 'block'
        fileCountEl.textContent = `${selectedFiles.length} PDF${selectedFiles.length !== 1 ? 's' : ''} selected`
        renderFileList()
        break
      case 'compressing':
        compressBtn.disabled = true
        compressBtn.textContent = 'Compressing...'
        break
      case 'done':
        compressBtn.style.display = 'none'
        break
    }
  }

  // --- Helpers ---

  function renderFileList(): void {
    fileListEl.innerHTML = ''
    fileListEl.style.display = 'block'
    for (let i = 0; i < selectedFiles.length; i++) {
      const li = document.createElement('li')
      li.className = 'file-list__item'

      const name = document.createElement('span')
      name.className = 'file-list__name'
      name.textContent = selectedFiles[i].name

      const removeBtn = document.createElement('button')
      removeBtn.className = 'file-list__remove'
      removeBtn.textContent = '×'
      removeBtn.type = 'button'
      removeBtn.setAttribute('aria-label', `Remove ${selectedFiles[i].name}`)
      removeBtn.dataset.index = String(i)

      li.appendChild(name)
      li.appendChild(removeBtn)
      fileListEl.appendChild(li)
    }
  }

  fileListEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.file-list__remove') as HTMLElement | null
    if (!btn) return
    const idx = Number(btn.dataset.index)
    selectedFiles = selectedFiles.filter((_, i) => i !== idx)
    if (selectedFiles.length === 0) {
      setState('idle')
    } else {
      fileCountEl.textContent = `${selectedFiles.length} PDF${selectedFiles.length !== 1 ? 's' : ''} selected`
      renderFileList()
    }
  })

  // --- Callbacks ---

  function onFiles(files: File[]): void {
    selectedFiles = files
    setState('files-selected')
  }

  async function onCompressClick(): Promise<void> {
    if (state !== 'files-selected') return
    setState('compressing')

    // PRG-03: Check WASM readiness
    if (!controller.isReady) {
      progressUI.showLoading('Preparing compression engine...')
      await controller.waitUntilReady()
      progressUI.hideLoading()
    }

    const target = targetConfig.getTarget()
    const totalFiles = selectedFiles.length
    let lastFileIndex = -1

    try {
      const results = await compressFiles(selectedFiles, target, (fileIndex, iteration, dpi, size) => {
        // PRG-01: Only call showFileProgress when fileIndex changes
        if (fileIndex !== lastFileIndex) {
          progressUI.showFileProgress(fileIndex, totalFiles, selectedFiles[fileIndex].name)
          lastFileIndex = fileIndex
        }
        // PRG-02: Update progress bar per iteration
        progressUI.updateIteration(iteration, dpi, size)
      })

      // Process results
      for (const result of results) {
        if (result.compressedSize === 0 && !result.skipped) {
          // PRG-04: Per-file error
          progressUI.showFileError(result.fileIndex, result.fileName, 'Compression failed')
        } else {
          progressUI.showFileComplete(result.fileIndex)
        }
      }

      lastResults = results
      renderResults(resultsSection, results)
      setState('done')
    } catch (err) {
      // Unexpected error — show as generic message but don't crash
      progressUI.showFileError(-1, 'Error', err instanceof Error ? err.message : 'Unknown error')
      setState('done')
    }
  }

  compressBtn.addEventListener('click', () => {
    void onCompressClick()
  })
}
