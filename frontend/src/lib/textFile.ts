/** 把用户选中的文件按 UTF-8 文本解码；ZIP/DOCX 签名、NUL 字节或非法 UTF-8 ⇒ null（不是文本） */
export function decodeMarkdownFile(buf: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] <= 0x08 && bytes[3] <= 0x08) return null
  const head = bytes.subarray(0, 8192)
  for (let i = 0; i < head.length; i++) if (head[i] === 0) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return null
  }
}
