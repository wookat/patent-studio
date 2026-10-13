import { describe, expect, it } from 'vitest'
import { decodeMarkdownFile } from '../textFile'

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('decodeMarkdownFile', () => {
  it('decodes UTF-8 text and strips BOM', () => {
    expect(decodeMarkdownFile(enc('# 标题\n正文'))).toBe('# 标题\n正文')
    expect(decodeMarkdownFile(enc('\uFEFF# a'))).toBe('# a')
  })
  it('rejects docx/zip bytes', () => {
    expect(decodeMarkdownFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer)).toBeNull()
  })
  it('rejects binary with NUL and invalid UTF-8', () => {
    expect(decodeMarkdownFile(new Uint8Array([0x61, 0x00, 0x62]).buffer)).toBeNull()
    expect(decodeMarkdownFile(new Uint8Array([0xff, 0xfe, 0x41]).buffer)).toBeNull()
  })
})
