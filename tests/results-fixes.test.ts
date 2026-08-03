// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderZipButton, formatSize, buildZipEntries } from '../src/ui/results'
import type { CompressionResult } from '../src/compression/types'

function makeResult(overrides: Partial<CompressionResult>): CompressionResult {
  return {
    fileIndex: 0,
    fileName: 'doc.pdf',
    originalSize: 5_000_000,
    compressedSize: 2_000_000,
    buffer: new ArrayBuffer(8),
    skipped: false,
    metTarget: true,
    ...overrides,
  }
}

describe('Fix 7a: formatSize uses sensible units', () => {
  it('formats sub-megabyte sizes in KB', () => {
    expect(formatSize(320 * 1024)).toBe('320 KB')
  })

  it('formats megabyte sizes with one decimal', () => {
    expect(formatSize(2_621_440)).toBe('2.5 MB')
  })

  it('formats tiny sizes in bytes', () => {
    expect(formatSize(500)).toBe('500 B')
  })
})

describe('Fix 7b: ZIP entries deduplicate file names', () => {
  it('appends a counter to duplicate output names', () => {
    const results = [
      makeResult({ fileIndex: 0, fileName: 'scan.pdf' }),
      makeResult({ fileIndex: 1, fileName: 'scan.pdf' }),
      makeResult({ fileIndex: 2, fileName: 'other.pdf' }),
    ]
    const entries = buildZipEntries(results)
    expect(Object.keys(entries).sort()).toEqual([
      'other_compressed.pdf',
      'scan_compressed (1).pdf',
      'scan_compressed.pdf',
    ])
  })

  it('keeps every buffer (no silent overwrite)', () => {
    const results = [
      makeResult({ fileIndex: 0, fileName: 'a.pdf', buffer: new ArrayBuffer(4) }),
      makeResult({ fileIndex: 1, fileName: 'a.pdf', buffer: new ArrayBuffer(6) }),
    ]
    const entries = buildZipEntries(results)
    const sizes = Object.values(entries).map((b) => b.length).sort()
    expect(sizes).toEqual([4, 6])
  })
})

describe('renderZipButton', () => {
  it('renders a ZIP button when more than one file is downloadable', () => {
    const container = document.createElement('div')
    renderZipButton(container, [
      makeResult({ fileIndex: 0, fileName: 'a.pdf' }),
      makeResult({ fileIndex: 1, fileName: 'b.pdf' }),
    ])
    const btn = container.querySelector('.results__zip-btn')
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toContain('2 files')
  })

  it('renders nothing for a single downloadable file', () => {
    const container = document.createElement('div')
    renderZipButton(container, [makeResult({})])
    expect(container.querySelector('.results__zip-btn')).toBeNull()
  })

  it('excludes failed files from the ZIP count', () => {
    const container = document.createElement('div')
    renderZipButton(container, [
      makeResult({ fileIndex: 0, fileName: 'a.pdf' }),
      makeResult({ fileIndex: 1, fileName: 'b.pdf' }),
      makeResult({
        fileIndex: 2,
        fileName: 'bad.pdf',
        error: 'gs failed',
        compressedSize: 0,
        buffer: new ArrayBuffer(0),
        metTarget: false,
      }),
    ])
    expect(container.querySelector('.results__zip-btn')!.textContent).toContain('2 files')
  })

  it('clears previously rendered content', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>old</p>'
    renderZipButton(container, [makeResult({})])
    expect(container.textContent).not.toContain('old')
  })
})
