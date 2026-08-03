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

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadResult(result: CompressionResult): void {
  const blob = new Blob([result.buffer], { type: 'application/pdf' })
  downloadBlob(blob, `${outputName(result.fileName)}.pdf`)
}

/**
 * Render the download-all-as-ZIP button (only when more than one file is
 * downloadable). Per-file rows live in the progress list.
 */
export function renderZipButton(container: HTMLElement, results: CompressionResult[]): void {
  container.innerHTML = ''

  const downloadable = results.filter((r) => !r.error && r.compressedSize > 0)
  if (downloadable.length <= 1) return

  const zipBtn = document.createElement('button')
  zipBtn.className = 'results__zip-btn'
  zipBtn.textContent = `Download all as ZIP (${downloadable.length} files)`
  zipBtn.type = 'button'
  zipBtn.addEventListener('click', () => {
    const zipped = zipSync(buildZipEntries(downloadable))
    const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
    downloadBlob(blob, 'compressed_pdfs.zip')
  })
  container.appendChild(zipBtn)
}
