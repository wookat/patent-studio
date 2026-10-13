import { describe, expect, it } from 'vitest'
import { parseSettingsJson } from '../settingsJson'

describe('parseSettingsJson', () => {
  it('整份 studio.json → 白名单字段全收（style/附图/例外/上限）', () => {
    const s = parseSettingsJson(
      JSON.stringify({
        style: { page: { size: 'A4' } },
        abstract_figure: ['fig1.png', 14.5],
        spec_figures: [['fig1.png', 15]],
        sub_except: ['tsf_guard'],
        abstract_limit: 300,
        ai_enabled: true, // 非白名单：不带出（沿用导入前语义）
      }),
    )
    expect(s.style).toEqual({ page: { size: 'A4' } })
    expect(s.abstract_figure).toEqual(['fig1.png', 14.5])
    expect(s.spec_figures).toEqual([['fig1.png', 15]])
    expect(s.sub_except).toEqual(['tsf_guard'])
    expect(s.abstract_limit).toBe(300)
    expect('ai_enabled' in s).toBe(false)
  })

  it('style 缺省 → {}（导入视为整份文档，置零漂移基准）', () => {
    expect(parseSettingsJson('{"sub_except":[]}').style).toEqual({})
  })

  it('null 与缺省同义——不带出字段', () => {
    const s = parseSettingsJson('{"abstract_figure":null,"sub_except":null,"abstract_limit":null}')
    expect(s).toEqual({ style: {} })
  })

  it.each([
    ['"not object"', '不是 JSON 对象'],
    ['[1,2]', '不是 JSON 对象'],
    ['{"style":"x"}', 'style 应为对象'],
    ['{"style":[1]}', 'style 应为对象'],
    ['{"sub_except":"tsf_guard"}', 'sub_except 应为数组'],
    ['{"spec_figures":{"a":1}}', 'spec_figures 应为数组'],
    ['{"abstract_figure":"fig.png"}', 'abstract_figure 应为数组'],
    ['{"abstract_limit":"300"}', 'abstract_limit 应为数字'],
    ['{"abstract_limit":null,"abstract_limit2":1}', null],
  ] as const)('%s → %s', (text, msg) => {
    if (msg === null) expect(() => parseSettingsJson(text)).not.toThrow()
    else expect(() => parseSettingsJson(text)).toThrow(msg)
  })

  it('畸形 JSON 原文抛出（调用方 toast 导入失败）', () => {
    expect(() => parseSettingsJson('{oops')).toThrow()
  })
})
