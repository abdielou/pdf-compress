import type { CompressionTarget } from '../compression/types'

interface TargetState {
  mode: 'size' | 'percentage'
  sizeValueMB: number
  percentValue: number
}

export function createTargetConfig(container: HTMLElement): {
  getTarget: () => CompressionTarget
} {
  const state: TargetState = {
    mode: 'size',
    sizeValueMB: 4,
    percentValue: 50,
  }

  // Build DOM structure
  const configDiv = document.createElement('div')
  configDiv.className = 'target-config'

  // Toggle buttons
  const toggleDiv = document.createElement('div')
  toggleDiv.className = 'target-config__toggle'

  const sizeButton = document.createElement('button')
  sizeButton.type = 'button'
  sizeButton.textContent = 'Size'
  sizeButton.className = 'active'

  const percentButton = document.createElement('button')
  percentButton.type = 'button'
  percentButton.textContent = 'Percentage'

  toggleDiv.appendChild(sizeButton)
  toggleDiv.appendChild(percentButton)

  // Input area
  const inputDiv = document.createElement('div')
  inputDiv.className = 'target-config__input'

  const label = document.createElement('label')
  const input = document.createElement('input')
  input.type = 'number'
  const suffix = document.createElement('span')
  suffix.className = 'target-config__suffix'

  inputDiv.appendChild(label)
  inputDiv.appendChild(input)
  inputDiv.appendChild(suffix)

  configDiv.appendChild(toggleDiv)
  configDiv.appendChild(inputDiv)
  container.appendChild(configDiv)

  function renderInputForMode(): void {
    if (state.mode === 'size') {
      label.textContent = 'Max file size'
      input.value = String(state.sizeValueMB)
      input.min = '0.1'
      input.step = '0.1'
      input.removeAttribute('max')
      suffix.textContent = 'MB'
      sizeButton.classList.add('active')
      percentButton.classList.remove('active')
    } else {
      label.textContent = 'Reduce by'
      input.value = String(state.percentValue)
      input.min = '1'
      input.max = '99'
      input.step = '1'
      suffix.textContent = '%'
      percentButton.classList.add('active')
      sizeButton.classList.remove('active')
    }
  }

  renderInputForMode()

  // Input event -- update state for active mode
  input.addEventListener('input', () => {
    const val = parseFloat(input.value)
    if (isNaN(val)) return
    if (state.mode === 'size') {
      state.sizeValueMB = val
    } else {
      state.percentValue = val
    }
  })

  // Clamp on blur
  input.addEventListener('blur', () => {
    let val = parseFloat(input.value)
    if (isNaN(val)) {
      val = state.mode === 'size' ? 4 : 50
    }
    if (state.mode === 'size') {
      val = Math.max(0.1, val)
      state.sizeValueMB = val
    } else {
      val = Math.min(99, Math.max(1, val))
      state.percentValue = val
    }
    input.value = String(val)
  })

  // Toggle handlers
  sizeButton.addEventListener('click', () => {
    if (state.mode !== 'size') {
      state.mode = 'size'
      renderInputForMode()
    }
  })

  percentButton.addEventListener('click', () => {
    if (state.mode !== 'percentage') {
      state.mode = 'percentage'
      renderInputForMode()
    }
  })

  function getTarget(): CompressionTarget {
    if (state.mode === 'size') {
      return { mode: 'size', maxBytes: state.sizeValueMB * 1024 * 1024 }
    } else {
      return { mode: 'percentage', reductionPct: state.percentValue }
    }
  }

  return { getTarget }
}
