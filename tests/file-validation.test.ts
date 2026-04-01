// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { isPdf, validateFiles } from '../src/ui/file-validation'

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-

function makePdfFile(name = 'test.pdf', extraBytes: number[] = []): File {
  const bytes = new Uint8Array([...PDF_MAGIC, ...extraBytes])
  return new File([bytes], name, { type: 'application/pdf' })
}

function makeNonPdfFile(name = 'test.txt', content = 'hello world'): File {
  return new File([content], name, { type: 'text/plain' })
}

describe('file-validation', () => {
  describe('isPdf', () => {
    it('accepts a file with correct PDF magic bytes', async () => {
      const file = makePdfFile('valid.pdf')
      expect(await isPdf(file)).toBe(true)
    })

    it('rejects a file with wrong magic bytes', async () => {
      const file = makeNonPdfFile('not-a-pdf.txt')
      expect(await isPdf(file)).toBe(false)
    })

    it('rejects a file with application/pdf MIME but wrong bytes (magic bytes are authoritative)', async () => {
      // MIME says PDF but content is wrong
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) // PNG header
      const file = new File([bytes], 'fake.pdf', { type: 'application/pdf' })
      expect(await isPdf(file)).toBe(false)
    })

    it('rejects an empty file', async () => {
      const file = new File([], 'empty.pdf', { type: 'application/pdf' })
      expect(await isPdf(file)).toBe(false)
    })
  })

  describe('validateFiles', () => {
    it('returns correct valid/rejected split for multiple files', async () => {
      const pdfFile = makePdfFile('real.pdf')
      const txtFile = makeNonPdfFile('doc.txt')
      const result = await validateFiles([pdfFile, txtFile])

      expect(result.valid).toHaveLength(1)
      expect(result.valid[0]).toBe(pdfFile)
      expect(result.rejected).toHaveLength(1)
      expect(result.rejected[0].file).toBe(txtFile)
      expect(result.rejected[0].reason).toContain('doc.txt')
      expect(result.rejected[0].reason).toContain('is not a PDF file')
    })

    it('includes the filename in the rejection reason', async () => {
      const file = makeNonPdfFile('my-document.docx')
      const result = await validateFiles([file])
      expect(result.rejected[0].reason).toBe('"my-document.docx" is not a PDF file')
    })

    it('returns all valid when all files are PDFs', async () => {
      const files = [makePdfFile('a.pdf'), makePdfFile('b.pdf')]
      const result = await validateFiles(files)
      expect(result.valid).toHaveLength(2)
      expect(result.rejected).toHaveLength(0)
    })

    it('returns all rejected when no files are PDFs', async () => {
      const files = [makeNonPdfFile('a.txt'), makeNonPdfFile('b.png')]
      const result = await validateFiles(files)
      expect(result.valid).toHaveLength(0)
      expect(result.rejected).toHaveLength(2)
    })
  })
})
