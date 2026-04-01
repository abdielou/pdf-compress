import { zipSync } from 'fflate'
import type { CompressionResult } from '../compression/types'

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function renderResults(container: HTMLElement, results: CompressionResult[]): void {
  container.innerHTML = ''

  const section = document.createElement('div')
  section.className = 'results'

  // Per-file rows
  for (const r of results) {
    const row = document.createElement('div')
    row.className = 'results__row'

    const info = document.createElement('div')
    info.className = 'results__info'

    const name = document.createElement('span')
    name.className = 'results__name'
    name.textContent = r.fileName
    name.title = r.fileName

    const sizes = document.createElement('span')
    sizes.className = 'results__sizes'

    if (r.skipped) {
      sizes.textContent = `${formatSize(r.originalSize)} — already under target`
      sizes.classList.add('results__sizes--skipped')
    } else if (r.compressedSize === 0) {
      sizes.textContent = 'Compression failed'
      sizes.classList.add('results__sizes--error')
    } else {
      const saved = Math.round((1 - r.compressedSize / r.originalSize) * 100)
      sizes.textContent = `${formatSize(r.originalSize)} → ${formatSize(r.compressedSize)} (${saved}% smaller)`
    }

    info.appendChild(name)
    info.appendChild(sizes)

    const actions = document.createElement('div')
    actions.className = 'results__actions'

    if (r.compressedSize > 0) {
      const downloadBtn = document.createElement('button')
      downloadBtn.className = 'results__download-btn'
      downloadBtn.textContent = 'Download'
      downloadBtn.type = 'button'
      downloadBtn.addEventListener('click', () => {
        const blob = new Blob([r.buffer], { type: 'application/pdf' })
        const outName = r.fileName.replace(/\.pdf$/i, '') + '_compressed.pdf'
        downloadBlob(blob, outName)
      })
      actions.appendChild(downloadBtn)
    }

    row.appendChild(info)
    row.appendChild(actions)
    section.appendChild(row)
  }

  // Download all as ZIP (only if > 1 file with valid output)
  const downloadable = results.filter((r) => r.compressedSize > 0)
  if (downloadable.length > 1) {
    const zipBtn = document.createElement('button')
    zipBtn.className = 'results__zip-btn'
    zipBtn.textContent = `Download all as ZIP (${downloadable.length} files)`
    zipBtn.type = 'button'
    zipBtn.addEventListener('click', () => {
      const files: Record<string, Uint8Array> = {}
      for (const r of downloadable) {
        const outName = r.fileName.replace(/\.pdf$/i, '') + '_compressed.pdf'
        files[outName] = new Uint8Array(r.buffer)
      }
      const zipped = zipSync(files)
      const blob = new Blob([zipped], { type: 'application/zip' })
      downloadBlob(blob, 'compressed_pdfs.zip')
    })
    section.appendChild(zipBtn)
  }

  container.appendChild(section)
}
