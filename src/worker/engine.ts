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

import type { ImageEncode } from '../compression/types'

const DEFAULT_ENCODE: ImageEncode = { filter: 'dct', qFactor: 0.4 }

/** Build Ghostscript arguments for one pass at the given DPI and encoding. */
function buildGsArgs(dpi: number, encode: ImageEncode): string[] {
  const args = [
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
    // AutoFilter picks JPEG quality per image heuristically, which makes
    // output size erratic and non-monotonic in DPI. Explicit filters keep
    // both search knobs (DPI, quality) deterministic and monotonic.
    '-dAutoFilterColorImages=false',
    '-dAutoFilterGrayImages=false',
  ]

  if (encode.filter === 'flate') {
    args.push(
      '-dColorImageFilter=/FlateEncode',
      '-dGrayImageFilter=/FlateEncode',
      `-sOutputFile=${OUTPUT_PATH}`,
      INPUT_PATH,
    )
    return args
  }

  const q = encode.qFactor
  const imageDict = `<< /QFactor ${q} /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >>`
  args.push(
    '-dColorImageFilter=/DCTEncode',
    '-dGrayImageFilter=/DCTEncode',
    `-sOutputFile=${OUTPUT_PATH}`,
    '-c', `<< /ColorImageDict ${imageDict} /GrayImageDict ${imageDict} >> setdistillerparams`,
    '-f', INPUT_PATH,
  )
  return args
}

/**
 * Compress at a specific DPI and encoding. Assumes input is already written
 * to /input.pdf. Cleans up /output.pdf in finally block.
 * Returns { bytes, size } on success, null if callMain returns non-zero.
 */
export function compressAtDpi(
  gs: GsModule,
  dpi: number,
  encode: ImageEncode = DEFAULT_ENCODE
): { bytes: Uint8Array; size: number } | null {
  try {
    const exitCode = gs.callMain(buildGsArgs(dpi, encode))
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
