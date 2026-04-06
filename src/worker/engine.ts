/**
 * Interpolation-based compression engine.
 *
 * Finds the highest DPI (30-300) that produces output under a target byte size.
 * Uses 2 probes to establish a size-vs-DPI curve, then interpolates to estimate
 * the optimal DPI. Typically converges in 3-4 Ghostscript calls, not 10.
 */

/** Minimal GS module interface matching @jspawn/ghostscript-wasm */
interface GsModule {
  callMain(args: string[]): number
  FS: {
    writeFile(path: string, data: Uint8Array | string): void
    readFile(path: string): Uint8Array
    unlink(path: string): void
    stat(path: string): { size: number }
  }
}

const INPUT_PATH = '/input.pdf'
const OUTPUT_PATH = '/output.pdf'
const MIN_DPI = 30
const MAX_DPI = 300
const MAX_REFINEMENTS = 3
const GOOD_ENOUGH_RATIO = 0.90

/** Build Ghostscript arguments matching compress.sh exactly. */
function buildGsArgs(dpi: number): string[] {
  return [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    '-dNOPAUSE',
    '-dBATCH',
    '-dQUIET',
    '-dAutoRotatePages=/None',
    '-dDownsampleColorImages=true',
    '-dDownsampleGrayImages=true',
    '-dDownsampleMonoImages=true',
    '-dColorImageDownsampleType=/Bicubic',
    `-dColorImageResolution=${dpi}`,
    '-dColorImageDownsampleThreshold=1.0',
    '-dGrayImageDownsampleType=/Bicubic',
    `-dGrayImageResolution=${dpi}`,
    '-dGrayImageDownsampleThreshold=1.0',
    '-dMonoImageDownsampleType=/Bicubic',
    `-dMonoImageResolution=${dpi}`,
    '-dMonoImageDownsampleThreshold=1.0',
    `-sOutputFile=${OUTPUT_PATH}`,
    INPUT_PATH,
  ]
}

/**
 * Compress at a specific DPI. Assumes input is already written to /input.pdf.
 * Cleans up /output.pdf in finally block.
 * Returns { bytes, size } on success, null if callMain returns non-zero.
 */
export function compressAtDpi(
  gs: GsModule,
  dpi: number
): { bytes: Uint8Array; size: number } | null {
  try {
    const exitCode = gs.callMain(buildGsArgs(dpi))
    if (exitCode !== 0) {
      return null
    }
    const bytes = gs.FS.readFile(OUTPUT_PATH)
    return { bytes, size: bytes.length }
  } finally {
    try {
      gs.FS.unlink(OUTPUT_PATH)
    } catch {
      // Output file may not exist if callMain failed
    }
  }
}

/**
 * Progress callback signature.
 * (iteration, dpi, currentSize) => void
 */
export type ProgressCallback = (
  iteration: number,
  dpi: number,
  currentSize: number
) => void

/**
 * Interpolation-based compression: find the highest DPI (30-300) that produces
 * output under targetBytes in 3-4 iterations.
 *
 * Strategy:
 * 1. Probe at 300 DPI — if it fits, done (best quality).
 * 2. Probe at LOW_PROBE DPI — now we have two (DPI, size) data points.
 * 3. Interpolate to estimate the DPI that hits targetBytes, try it.
 * 4. If still over, adjust once more. Pick the best result under target.
 *
 * Writes input to /input.pdf, cleans up in finally block.
 */
const LOW_PROBE_DPI = 72

/**
 * Estimate a DPI that would produce targetSize bytes, given two data points.
 * Assumes size scales roughly as DPI^exponent (power law).
 * Falls back to linear interpolation if power law fails.
 */
function interpolateDpi(
  dpi1: number, size1: number,
  dpi2: number, size2: number,
  targetSize: number
): number {
  // Avoid division by zero or log of zero/negative
  if (size1 <= 0 || size2 <= 0 || dpi1 <= 0 || dpi2 <= 0 || size1 === size2) {
    // Linear fallback
    const ratio = (targetSize - size1) / (size2 - size1)
    return Math.round(dpi1 + ratio * (dpi2 - dpi1))
  }

  // Power law: size = k * dpi^exp
  // exp = log(size2/size1) / log(dpi2/dpi1)
  const exp = Math.log(size2 / size1) / Math.log(dpi2 / dpi1)

  if (!isFinite(exp) || exp === 0) {
    // Fallback to linear
    const ratio = (targetSize - size1) / (size2 - size1)
    return Math.round(dpi1 + ratio * (dpi2 - dpi1))
  }

  // k = size1 / dpi1^exp
  const k = size1 / Math.pow(dpi1, exp)
  // targetSize = k * dpi^exp  =>  dpi = (targetSize / k) ^ (1/exp)
  const estimatedDpi = Math.pow(targetSize / k, 1 / exp)

  return Math.round(Math.max(MIN_DPI, Math.min(MAX_DPI, estimatedDpi)))
}

export function binarySearchCompress(
  gs: GsModule,
  inputBytes: Uint8Array,
  targetBytes: number,
  onProgress?: ProgressCallback
): Uint8Array | null {
  gs.FS.writeFile(INPUT_PATH, inputBytes)

  try {
    let iteration = 0
    let bestResult: Uint8Array | null = null
    let bestSize = Infinity

    const tryDpi = (dpi: number): { bytes: Uint8Array; size: number } | null => {
      iteration++
      const result = compressAtDpi(gs, dpi)
      const size = result?.size ?? 0
      onProgress?.(iteration, dpi, size)

      if (result && result.size <= targetBytes) {
        if (result.size > (bestResult ? bestResult.length : 0)) {
          // Better quality (larger size that still fits)
          bestResult = result.bytes
          bestSize = result.size
        }
      }
      return result
    }

    // Step 1: Probe at 300 DPI (best quality)
    const highProbe = tryDpi(MAX_DPI)
    if (highProbe && highProbe.size <= targetBytes) {
      return bestResult // Already fits at max quality
    }

    // Step 2: Probe at low DPI (establish baseline)
    const lowProbe = tryDpi(LOW_PROBE_DPI)
    if (!lowProbe || lowProbe.size > targetBytes) {
      // Even at 72 DPI it's too big — try absolute minimum
      if (!bestResult) {
        tryDpi(MIN_DPI)
      }
      return bestResult
    }

    // Now we have two data points: (300, highSize) and (72, lowSize)
    // and we know: lowSize <= target < highSize
    let lowDpi = LOW_PROBE_DPI
    let lowSize = lowProbe.size
    let highDpi = MAX_DPI
    let highSize = highProbe?.size ?? 0

    // Step 3: Interpolate and refine until good enough
    for (let r = 0; r < MAX_REFINEMENTS; r++) {
      const estimatedDpi = interpolateDpi(lowDpi, lowSize, highDpi, highSize, targetBytes)

      // Avoid re-testing a DPI we've already tried
      if (estimatedDpi <= lowDpi || estimatedDpi >= highDpi) break

      const probe = tryDpi(estimatedDpi)
      if (!probe) break

      // Good enough — within 90% of target
      if (probe.size <= targetBytes && probe.size >= targetBytes * GOOD_ENOUGH_RATIO) {
        break
      }

      // Narrow the search bounds
      if (probe.size > targetBytes) {
        highDpi = estimatedDpi
        highSize = probe.size
      } else {
        lowDpi = estimatedDpi
        lowSize = probe.size
      }
    }

    return bestResult
  } finally {
    try {
      gs.FS.unlink(INPUT_PATH)
    } catch {
      // Input file may already be cleaned up
    }
  }
}
