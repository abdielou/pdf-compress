// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'

let createTargetConfig: typeof import('../src/ui/target-config').createTargetConfig

beforeAll(async () => {
  const mod = await import('../src/ui/target-config')
  createTargetConfig = mod.createTargetConfig
})

describe('target-config', () => {
  it('defaults to size mode with 4MB target', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { getTarget } = createTargetConfig(container)

    const target = getTarget()
    expect(target.mode).toBe('size')
    if (target.mode === 'size') {
      expect(target.maxBytes).toBe(4 * 1024 * 1024)
    }
    document.body.removeChild(container)
  })

  it('returns percentage target after toggling to percentage mode', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { getTarget } = createTargetConfig(container)

    // Find the percentage toggle button
    const buttons = container.querySelectorAll('button')
    const percentButton = Array.from(buttons).find((b) =>
      b.textContent?.toLowerCase().includes('percent'),
    )
    expect(percentButton).toBeTruthy()
    percentButton!.click()

    const target = getTarget()
    expect(target.mode).toBe('percentage')
    if (target.mode === 'percentage') {
      expect(target.reductionPct).toBe(50)
    }
    document.body.removeChild(container)
  })

  it('preserves size value after toggling to percentage and back', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { getTarget } = createTargetConfig(container)

    // Change size to 8MB
    const input = container.querySelector('input[type="number"]') as HTMLInputElement
    expect(input).toBeTruthy()
    input.value = '8'
    input.dispatchEvent(new Event('input'))

    // Toggle to percentage
    const buttons = container.querySelectorAll('button')
    const percentButton = Array.from(buttons).find((b) =>
      b.textContent?.toLowerCase().includes('percent'),
    )
    percentButton!.click()

    // Toggle back to size
    const sizeButton = Array.from(
      container.querySelectorAll('button'),
    ).find((b) => b.textContent?.toLowerCase().includes('size'))
    sizeButton!.click()

    const target = getTarget()
    expect(target.mode).toBe('size')
    if (target.mode === 'size') {
      expect(target.maxBytes).toBe(8 * 1024 * 1024)
    }
    document.body.removeChild(container)
  })
})
