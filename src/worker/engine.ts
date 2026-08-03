/**
 * Ghostscript compression primitive.
 *
 * Runs a single compression pass at a given DPI. The search strategy
 * (parallel probes + power-law interpolation) lives in the controller,
 * which drives one compress-at-dpi call per iteration via the worker.
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
