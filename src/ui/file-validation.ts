export interface ValidationResult {
  valid: File[]
  rejected: Array<{ file: File; reason: string }>
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-

export async function isPdf(file: File): Promise<boolean> {
  // Always verify magic bytes -- MIME type is not authoritative
  const slice = file.slice(0, 5)
  const buffer = await slice.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 5) return false
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false
  }
  return true
}

export async function validateFiles(files: File[]): Promise<ValidationResult> {
  const valid: File[] = []
  const rejected: Array<{ file: File; reason: string }> = []

  for (const file of files) {
    const ok = await isPdf(file)
    if (ok) {
      valid.push(file)
    } else {
      rejected.push({ file, reason: `"${file.name}" is not a PDF file` })
    }
  }

  return { valid, rejected }
}
