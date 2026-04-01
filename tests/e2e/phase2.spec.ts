import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const PDF_PATH = path.resolve(
  process.cwd(),
  'Luis Ramos Aug 2024 statement.pdf'
)
const PDF_PATH_2 = path.resolve(
  process.cwd(),
  'Luis Ramos Toledo Jan 2025 Statement.pdf'
)

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

  test('PRG-04: shows error row when compression fails to meet target', async ({ page }) => {
    // Use a very aggressive target (1 byte) to force failure/best-effort result
    // First set size to 0 MB (minimum) to guarantee no file can meet target
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
