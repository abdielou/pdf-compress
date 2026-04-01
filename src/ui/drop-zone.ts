import { validateFiles } from './file-validation'

export function createDropZone(
  container: HTMLElement,
  onFiles: (files: File[]) => void,
): { reset: () => void } {
  // Prevent browser default drag-and-drop behavior globally
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())

  // Build DOM structure
  const zone = document.createElement('div')
  zone.className = 'drop-zone'

  const prompt = document.createElement('p')
  prompt.className = 'drop-zone__prompt'

  const browseButton = document.createElement('button')
  browseButton.className = 'drop-zone__browse'
  browseButton.textContent = 'browse'
  browseButton.type = 'button'

  prompt.appendChild(document.createTextNode('Drop PDF files here or '))
  prompt.appendChild(browseButton)

  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.pdf,application/pdf'
  fileInput.multiple = true
  fileInput.style.display = 'none'

  const errorsDiv = document.createElement('div')
  errorsDiv.className = 'drop-zone__errors'

  zone.appendChild(prompt)
  zone.appendChild(fileInput)
  zone.appendChild(errorsDiv)
  container.appendChild(zone)

  // Counter-based drag flicker prevention
  let dragCounter = 0

  function clearErrors(): void {
    errorsDiv.textContent = ''
  }

  async function handleFiles(files: File[] | FileList): Promise<void> {
    clearErrors()
    const fileArray = Array.from(files) as File[]
    if (fileArray.length === 0) return

    const result = await validateFiles(fileArray)

    if (result.rejected.length > 0) {
      for (const { reason } of result.rejected) {
        const msg = document.createElement('p')
        msg.textContent = reason
        errorsDiv.appendChild(msg)
      }
    }

    if (result.valid.length > 0) {
      onFiles(result.valid)
    }
  }

  // Drag events
  zone.addEventListener('dragenter', (e) => {
    e.preventDefault()
    dragCounter++
    zone.classList.add('drag-over')
  })

  zone.addEventListener('dragleave', () => {
    dragCounter--
    if (dragCounter <= 0) {
      dragCounter = 0
      zone.classList.remove('drag-over')
    }
  })

  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  })

  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    dragCounter = 0
    zone.classList.remove('drag-over')
    const dt = (e as DragEvent).dataTransfer
    if (dt && dt.files) {
      void handleFiles(dt.files)
    }
  })

  // Click-to-browse
  browseButton.addEventListener('click', (e) => {
    e.stopPropagation()
    fileInput.click()
  })

  zone.addEventListener('click', () => {
    fileInput.click()
  })

  // File input change handler
  fileInput.addEventListener('change', () => {
    if (fileInput.files) {
      void handleFiles(fileInput.files)
    }
    fileInput.value = ''
  })

  function reset(): void {
    clearErrors()
    dragCounter = 0
    zone.classList.remove('drag-over')
  }

  return { reset }
}
