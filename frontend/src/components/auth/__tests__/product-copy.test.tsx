// @vitest-environment jsdom
/**
 * 文案回归：落地页与 index.html 元信息统一为「知撰·AI 专利撰写与协同平台」协作办案定位。
 * 防旧定位（「撰写与审阅工作台」/「机构工作台」窄口径）在主入口复现。
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import indexHtml from '../../../../index.html?raw'
import { LandingPage } from '../LandingPage'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

async function renderLanding(): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    root = createRoot(host)
    root.render(<LandingPage />)
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
})

function ldBlocks(): Record<string, unknown>[] {
  return [...indexHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>,
  )
}

describe('产品文案统一（知撰·AI 专利撰写与协同平台）', () => {
  it('index.html 元信息：正式名 + 协作办案定位，无旧「撰写与审阅工作台」总定位', () => {
    expect(indexHtml).toContain('<title>知撰·AI 专利撰写与协同平台')
    expect(indexHtml).toContain('协作办案')
    expect(indexHtml).not.toContain('撰写与审阅工作台')
    for (const role of ['作者', '代理人', '机构']) expect(indexHtml).toContain(role)
    for (const sel of ['name="description"', 'property="og:description"', 'name="twitter:description"'])
      expect(indexHtml).toContain(sel)
  })

  it('JSON-LD：SoftwareApplication / FAQ 可解析，页面 FAQ 全部问答与 JSON-LD 一致', async () => {
    const blocks = ldBlocks()
    const app = blocks.find((b) => b['@type'] === 'SoftwareApplication') as Record<string, string>
    const faq = blocks.find((b) => b['@type'] === 'FAQPage') as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[]
    }
    expect(app?.name).toBe('知撰·AI 专利撰写与协同平台')
    expect(app?.description).toContain('协作办案')
    expect(Array.isArray(faq?.mainEntity)).toBe(true)
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4)
    const el = await renderLanding()
    const pageFaq = [...el.querySelectorAll('#faq details')].map((d) => ({
      name: d.querySelector('summary')?.textContent?.trim(),
      text: d.querySelector('summary + p')?.textContent?.trim(),
    }))
    const ldFaq = faq.mainEntity.map((e) => ({ name: e.name, text: e.acceptedAnswer?.text }))
    expect(pageFaq).toEqual(ldFaq)
  })

  it('落地页：正式名 + 协作办案首屏 + 三类角色 + 图库 15 组口径，无旧定位', async () => {
    const el = await renderLanding()
    const text = el.textContent ?? ''
    expect(text).toContain('知撰 · AI 专利撰写与协同平台')
    expect(text).toContain('协作办案')
    for (const s of ['作者 / 发明人', '代理人 / 撰写人', '机构管理者', 'AI 办案成员'])
      expect(text).toContain(s)
    expect(text).toContain('114 篇')
    expect(el.innerHTML).toContain('15 组')
    expect(text).not.toContain('AI 撰写与审阅工作台')
    expect(text).not.toContain('机构工作台')
  })
})
