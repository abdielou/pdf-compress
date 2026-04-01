/**
 * Binary search compression engine.
 *
 * Finds the highest DPI (30-300) that produces output under a target byte size.
 * Mirrors the proven compress.sh prototype algorithm.
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
const MAX_ITERATIONS = 10

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
 * Binary search compression: find the highest DPI (30-300) that produces
 * output under targetBytes.
 *
 * Strategy:
 * 1. Try 300 DPI first (early exit if already fits)
 * 2. Binary search between 30-300 DPI, max 10 iterations
 * 3. Return best result or null if unreachable
 *
 * Writes input to /input.pdf, cleans up in finally block.
 */
export function binarySearchCompress(
  gs: GsModule,
  inputBytes: Uint8Array,
  targetBytes: number,
  onProgress?: ProgressCallback
): Uint8Array | null {
  // Write input file
  gs.FS.writeFile(INPUT_PATH, inputBytes)

  try {
    let iteration = 0

    // Step 1: Try 300 DPI (early exit)
    iteration++
    const fullQuality = compressAtDpi(gs, MAX_DPI)
    if (fullQuality) {
      onProgress?.(iteration, MAX_DPI, fullQuality.size)
      if (fullQuality.size <= targetBytes) {
        return fullQuality.bytes
      }
    } else {
      onProgress?.(iteration, MAX_DPI, 0)
    }

    // Step 2: Binary search
    let lo = MIN_DPI
    let hi = MAX_DPI
    let bestResult: Uint8Array | null = null

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (hi - lo <= 1) break

      const mid = Math.floor((lo + hi) / 2)
      iteration++

      const result = compressAtDpi(gs, mid)
      if (!result) {
        onProgress?.(iteration, mid, 0)
        // callMain failed, try lower DPI
        hi = mid
        continue
      }

      onProgress?.(iteration, mid, result.size)

      if (result.size <= targetBytes) {
        // Fits -- try higher DPI for better quality
        bestResult = result.bytes
        lo = mid
      } else {
        // Too big -- try lower DPI
        hi = mid
      }
    }

    // If binary search didn't find anything, try minimum DPI as last resort
    if (!bestResult) {
      iteration++
      const lastResort = compressAtDpi(gs, MIN_DPI)
      if (lastResort) {
        onProgress?.(iteration, MIN_DPI, lastResort.size)
        if (lastResort.size <= targetBytes) {
          return lastResort.bytes
        }
      } else {
        onProgress?.(iteration, MIN_DPI, 0)
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
