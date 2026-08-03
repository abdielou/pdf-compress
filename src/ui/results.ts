import { zipSync } from 'fflate'
import type { CompressionResult } from '../compression/types'

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function outputName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '') + '_compressed'
}

/** Build ZIP entries, deduplicating output names so no file is overwritten. */
export function buildZipEntries(results: CompressionResult[]): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {}
  for (const r of results) {
    const base = outputName(r.fileName)
    let name = `${base}.pdf`
    for (let n = 1; name in entries; n++) {
      name = `${base} (${n}).pdf`
    }
    entries[name] = new Uint8Array(r.buffer)
  }
  return entries
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
      sizes.textContent = `${formatSize(r.originalSize)} (already under target)`
      sizes.classList.add('results__sizes--skipped')
    } else if (r.error) {
      sizes.textContent = `Compression failed: ${r.error}`
      sizes.classList.add('results__sizes--error')
    } else {
      const saved = Math.round((1 - r.compressedSize / r.originalSize) * 100)
      sizes.textContent = `${formatSize(r.originalSize)} → ${formatSize(r.compressedSize)} (${saved}% smaller)`
      if (r.lossless) {
        sizes.textContent += ' (lossless)'
      }
      if (!r.metTarget) {
        sizes.textContent += ' (could not reach target, smallest possible shown)'
        sizes.classList.add('results__sizes--warning')
      }
    }

    info.appendChild(name)
    info.appendChild(sizes)

    const actions = document.createElement('div')
    actions.className = 'results__actions'

    if (!r.error && r.compressedSize > 0) {
      const downloadBtn = document.createElement('button')
      downloadBtn.className = 'results__download-btn'
      downloadBtn.textContent = 'Download'
      downloadBtn.type = 'button'
      downloadBtn.addEventListener('click', () => {
        const blob = new Blob([r.buffer], { type: 'application/pdf' })
        downloadBlob(blob, `${outputName(r.fileName)}.pdf`)
      })
      actions.appendChild(downloadBtn)
    }

    row.appendChild(info)
    row.appendChild(actions)
    section.appendChild(row)
  }

  // Download all as ZIP (only if > 1 file with valid output)
  const downloadable = results.filter((r) => !r.error && r.compressedSize > 0)
  if (downloadable.length > 1) {
    const zipBtn = document.createElement('button')
    zipBtn.className = 'results__zip-btn'
    zipBtn.textContent = `Download all as ZIP (${downloadable.length} files)`
    zipBtn.type = 'button'
    zipBtn.addEventListener('click', () => {
      const zipped = zipSync(buildZipEntries(downloadable))
      const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
      downloadBlob(blob, 'compressed_pdfs.zip')
    })
    section.appendChild(zipBtn)
  }

  container.appendChild(section)
}
