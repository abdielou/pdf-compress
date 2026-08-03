// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderResults, formatSize, buildZipEntries } from '../src/ui/results'
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

describe('Fix 7c: failure is signaled by the error field', () => {
  it('renders a failed row when error is set', () => {
    const container = document.createElement('div')
    renderResults(container, [
      makeResult({ error: 'gs failed', compressedSize: 0, buffer: new ArrayBuffer(0), metTarget: false }),
    ])
    expect(container.textContent).toContain('Compression failed')
    expect(container.querySelector('.results__download-btn')).toBeNull()
  })

  it('renders a normal row with download when there is no error', () => {
    const container = document.createElement('div')
    renderResults(container, [makeResult({})])
    expect(container.textContent).not.toContain('Compression failed')
    expect(container.querySelector('.results__download-btn')).not.toBeNull()
  })
})

describe('Lossless label', () => {
  it('marks lossless results', () => {
    const container = document.createElement('div')
    renderResults(container, [makeResult({ lossless: true })])
    expect(container.textContent).toContain('(lossless)')
  })
})

describe('Fix 3 UI: unreachable target shows a warning but stays downloadable', () => {
  it('shows a target warning when metTarget is false', () => {
    const container = document.createElement('div')
    renderResults(container, [
      makeResult({ metTarget: false, compressedSize: 2_000_000 }),
    ])
    expect(container.textContent?.toLowerCase()).toContain('target')
    expect(container.querySelector('.results__download-btn')).not.toBeNull()
  })

  it('shows no warning when the target was met', () => {
    const container = document.createElement('div')
    renderResults(container, [makeResult({ metTarget: true })])
    expect(container.querySelector('.results__sizes--warning')).toBeNull()
  })
})
