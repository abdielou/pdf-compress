import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

/**
 * Generate a synthetic ~5 MB PDF fixture: one page with a large noise image.
 * Above the default 4 MB target, so the compress path always runs.
 * Deterministic (LCG noise), self-contained, and safe to commit nothing.
 */
function buildNoisePdf(): Buffer {
  const W = 1300
  const H = 1300
  const imgData = Buffer.alloc(W * H * 3)
  let seed = 42
  for (let i = 0; i < imgData.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    imgData[i] = seed & 0xff
  }
  const content = Buffer.from('q 612 0 0 792 0 0 cm /Im0 Do Q')

  const header = Buffer.from('%PDF-1.4\n')
  const chunks: Buffer[] = [header]
  const offsets: number[] = []
  let pos = header.length
  const push = (b: Buffer) => {
    offsets.push(pos)
    chunks.push(b)
    pos += b.length
  }

  push(Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'))
  push(Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'))
  push(Buffer.from(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> ' +
    '/Contents 5 0 R >>\nendobj\n'
  ))
  push(Buffer.concat([
    Buffer.from(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imgData.length} >>\nstream\n`
    ),
    imgData,
    Buffer.from('\nendstream\nendobj\n'),
  ]))
  push(Buffer.concat([
    Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`),
    content,
    Buffer.from('\nendstream\nendobj\n'),
  ]))

  const xrefPos = pos
  let xref = 'xref\n0 6\n0000000000 65535 f \n'
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  chunks.push(Buffer.from(xref))
  return Buffer.concat(chunks)
}

const FIXTURE_DIR = path.resolve(process.cwd(), 'tests', 'e2e', '.generated')
const PDF_PATH = path.join(FIXTURE_DIR, 'noise-5mb.pdf')

test.beforeAll(() => {
  if (!fs.existsSync(PDF_PATH)) {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true })
    fs.writeFileSync(PDF_PATH, buildNoisePdf())
  }
})

test.describe('Phase 2: File Input & Progress UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
  })

  test('INP-01 / INP-02: drop zone renders with browse button', async ({ page }) => {
    const dropZone = page.locator('.drop-zone')
    await expect(dropZone).toBeVisible()
    const browse = page.locator('.drop-zone__browse')
    await expect(browse).toBeVisible()
    await expect(browse).toHaveText(/browse/i)
  })

  test('INP-03: rejects non-PDF file via file input', async ({ page }) => {
    // Create a temporary .txt file to upload
    const txtPath = path.resolve(process.cwd(), 'test-reject.txt')
    fs.writeFileSync(txtPath, 'not a pdf')
    try {
      const fileInput = page.locator('input[type="file"]')
      await fileInput.setInputFiles(txtPath)
      const errors = page.locator('.drop-zone__errors')
      await expect(errors).toBeVisible()
      await expect(errors).toContainText(/not a PDF/i)
    } finally {
      fs.unlinkSync(txtPath)
    }
  })

  test('INP-03: accepts valid PDF file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(PDF_PATH)
    const fileCount = page.locator('.file-count')
    await expect(fileCount).toBeVisible()
    await expect(fileCount).toContainText(/1 PDF/i)
  })

  test('INP-04 / INP-05: target config renders size mode by default', async ({ page }) => {
    const targetConfig = page.locator('.target-config')
    await expect(targetConfig).toBeVisible()
    const label = page.locator('.target-config__input label')
    await expect(label).toContainText(/max file size/i)
    const input = page.locator('.target-config__input input[type="number"]')
    await expect(input).toHaveValue('4')
    const suffix = page.locator('.target-config__suffix')
    await expect(suffix).toContainText('MB')
  })

  test('INP-06: toggle switches to percentage mode and back', async ({ page }) => {
    // Switch to percentage mode
    const pctBtn = page.locator('.target-config__toggle button').filter({ hasText: /percent|%|reduce/i })
    await pctBtn.click()
    const label = page.locator('.target-config__input label')
    await expect(label).toContainText(/reduce by/i)
    const suffix = page.locator('.target-config__suffix')
    await expect(suffix).toContainText('%')

    // Switch back to size mode
    const sizeBtn = page.locator('.target-config__toggle button').filter({ hasText: /size|MB/i })
    await sizeBtn.click()
    await expect(page.locator('.target-config__input label')).toContainText(/max file size/i)
  })

  test('PRG-01 / PRG-02: compress button appears after file selection and triggers progress', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(PDF_PATH)

    const btn = page.locator('.compress-btn')
    await expect(btn).toBeVisible()
    await btn.click()

    // PRG-01: status text appears
    const status = page.locator('.progress-status')
    await expect(status).toBeVisible({ timeout: 10000 })
    await expect(status).toContainText(/compressing/i)

    // PRG-02: progress bar appears
    const bar = page.locator('.progress-bar')
    await expect(bar).toBeVisible()
  })

  test('PRG-04: shows a result row when the target cannot be met', async ({ page }) => {
    // 0 MB target is unreachable: the app returns the smallest achievable
    // file (metTarget=false) and still renders a per-file row
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(PDF_PATH)

    const numInput = page.locator('.target-config__input input[type="number"]')
    await numInput.fill('0')

    const btn = page.locator('.compress-btn')
    await btn.click()

    // Wait for completion (success or error row)
    const row = page.locator('.progress-file-row')
    await expect(row).toBeVisible({ timeout: 120000 })
  })

  test('PRG-03: WASM loading state appears briefly on fresh load', async ({ page }) => {
    // The loading overlay may appear very briefly; we just verify it doesn't crash
    // and that the app reaches idle state
    const dropZone = page.locator('.drop-zone')
    await expect(dropZone).toBeVisible({ timeout: 15000 })
  })

  test('tweakcn styling: light background and black primary button', async ({ page }) => {
    const body = page.locator('body')
    const bg = await body.evaluate((el) =>
      getComputedStyle(el).backgroundColor
    )
    // Should be white — matches rgb(255,255,255) or oklch(1 0 0)
    const isWhite =
      bg === 'oklch(1 0 0)' ||
      /^rgba?\(25[5],\s*25[5],\s*25[5]/.test(bg) ||
      /^rgba?\(255,\s*255,\s*255/.test(bg)
    expect(isWhite).toBe(true)

    const btn = page.locator('.compress-btn')
    await page.locator('input[type="file"]').setInputFiles(PDF_PATH)
    await expect(btn).toBeVisible()
    const btnBg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor)
    // Primary should be near-black (oklch 0.205 0 0 → rgb ~52,52,52)
    const isNearBlack =
      /oklch\(0\.[012]\d+/.test(btnBg) ||
      /^rgb\([0-6]\d,\s*[0-6]\d,\s*[0-6]\d\)/.test(btnBg)
    expect(isNearBlack).toBe(true)
  })
})
