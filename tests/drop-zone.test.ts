import { describe, it, expect, vi, beforeAll } from 'vitest'

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-

function makePdfFile(name = 'test.pdf'): File {
  const bytes = new Uint8Array([...PDF_MAGIC, 0x20])
  return new File([bytes], name, { type: 'application/pdf' })
}

function makeNonPdfFile(name = 'test.txt'): File {
  return new File(['hello'], name, { type: 'text/plain' })
}

let createDropZone: typeof import('../src/ui/drop-zone').createDropZone

beforeAll(async () => {
  const mod = await import('../src/ui/drop-zone')
  createDropZone = mod.createDropZone
})

describe('drop-zone', () => {
  it('calls onFiles with valid PDFs when files are dropped', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onFiles = vi.fn()
    createDropZone(container, onFiles)

    const dropZone = container.querySelector('.drop-zone') as HTMLElement
    expect(dropZone).toBeTruthy()

    const pdfFile = makePdfFile('doc.pdf')

    // Simulate drop event
    const dropEvent = new Event('drop', { bubbles: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: [pdfFile],
        dropEffect: '',
      },
    })
    Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() })

    dropZone.dispatchEvent(dropEvent)

    // Wait for async validation
    await new Promise((r) => setTimeout(r, 50))

    expect(onFiles).toHaveBeenCalledWith([pdfFile])
    document.body.removeChild(container)
  })

  it('calls onFiles when files are selected via the hidden file input (click-to-browse)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onFiles = vi.fn()
    createDropZone(container, onFiles)

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement
    expect(fileInput).toBeTruthy()

    const pdfFile = makePdfFile('via-browse.pdf')

    // Simulate file input change
    Object.defineProperty(fileInput, 'files', {
      value: [pdfFile],
      configurable: true,
    })
    fileInput.dispatchEvent(new Event('change'))

    await new Promise((r) => setTimeout(r, 50))

    expect(onFiles).toHaveBeenCalledWith([pdfFile])
    document.body.removeChild(container)
  })

  it('shows rejection messages for non-PDF files', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onFiles = vi.fn()
    createDropZone(container, onFiles)

    const dropZone = container.querySelector('.drop-zone') as HTMLElement
    const nonPdf = makeNonPdfFile('image.png')

    const dropEvent = new Event('drop', { bubbles: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: [nonPdf],
        dropEffect: '',
      },
    })
    Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() })

    dropZone.dispatchEvent(dropEvent)

    await new Promise((r) => setTimeout(r, 50))

    const errors = container.querySelector('.drop-zone__errors')
    expect(errors).toBeTruthy()
    expect(errors!.textContent).toContain('image.png')
    document.body.removeChild(container)
  })
})
