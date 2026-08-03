// Shared test fixture: scan-like PDF made of noise images.
// Effective image DPI is 200 (1700x2200 drawn on a letter page).

export function buildNoisePdf(pages: number, W: number, H: number): Uint8Array {
  const enc = (s: string) => Buffer.from(s, 'latin1')
  const chunks: Buffer[] = []
  const offsets: number[] = []
  let pos = 0
  const push = (b: Buffer, record = true) => {
    if (record) offsets.push(pos)
    chunks.push(b)
    pos += b.length
  }
  push(enc('%PDF-1.4\n'), false)
  pos = chunks[0].length

  const numObjects = 2 + pages * 3
  // obj 1: catalog, obj 2: pages, then per page: page, image, content
  const kids = Array.from({ length: pages }, (_, p) => `${3 + p * 3} 0 R`).join(' ')
  push(enc('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'))
  push(enc(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n`))

  let seed = 42
  for (let p = 0; p < pages; p++) {
    const pageObj = 3 + p * 3
    const imgObj = pageObj + 1
    const contentObj = pageObj + 2
    push(enc(
      `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /XObject << /Im${p} ${imgObj} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
      `/Contents ${contentObj} 0 R >>\nendobj\n`
    ))
    const imgData = Buffer.alloc(W * H * 3)
    for (let i = 0; i < imgData.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      imgData[i] = seed & 0xff
    }
    push(Buffer.concat([
      enc(
        `${imgObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imgData.length} >>\nstream\n`
      ),
      imgData,
      enc('\nendstream\nendobj\n'),
    ]))
    const content = enc(`q 612 0 0 792 0 0 cm /Im${p} Do Q`)
    push(Buffer.concat([
      enc(`${contentObj} 0 obj\n<< /Length ${content.length} >>\nstream\n`),
      content,
      enc('\nendstream\nendobj\n'),
    ]))
  }

  const xrefPos = pos
  let xref = `xref\n0 ${numObjects + 1}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${numObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  push(enc(xref), false)
  return new Uint8Array(Buffer.concat(chunks))
}

