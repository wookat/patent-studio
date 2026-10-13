/**
 * 极简 CDP 客户端（Node ≥22 原生 WebSocket，无第三方依赖），供 shot-cdp.mjs / axe-cdp.mjs 共用。
 * 连接策略：
 *   1. CDP_URL（默认 http://localhost:29229）可达 → 复用已开的 Chrome（Devin 浏览器 / 手动 --remote-debugging-port）
 *   2. 否则用 CHROME_BIN（默认 google-chrome）以 --headless=new 拉起一个临时实例（脚本结束后杀掉）
 * 每个页面用独立 target；视口/主题/触屏走 Emulation.*，全部在同一 websocket 会话内生效（会话关闭即失效）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ROUTES = [
  { name: 'home', hash: '#/' },
  { name: 'deadlines', hash: '#/deadlines' },
  { name: 'inbox', hash: '#/inbox' },
  { name: 'workbench', hash: '#/p/{pid}' },
  { name: 'deliver', hash: '#/p/{pid}/deliver' },
  { name: 'ds', hash: '#/__ds' },
  { name: 'login', hash: '#/login' },
  { name: 'account', hash: '#/account' },
  { name: 'admin', hash: '#/admin' },
]
export const VIEWPORTS = { desktop: { width: 1440, height: 900, mobile: false }, mobile: { width: 375, height: 812, mobile: true } }
export const THEMES = ['light', 'dark']

export function parseArgs(argv) {
  const opts = { base: process.env.STUDIO_URL ?? 'http://localhost:5173', routes: null, viewports: ['desktop', 'mobile'], themes: THEMES, out: null, pid: process.env.STUDIO_PID ?? null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--base') opts.base = next()
    else if (a === '--routes') opts.routes = next().split(',')
    else if (a === '--viewports') opts.viewports = next().split(',')
    else if (a === '--themes') opts.themes = next().split(',')
    else if (a === '--out') opts.out = next()
    else if (a === '--pid') opts.pid = next()
    else if (a === '--help' || a === '-h') {
      console.log('用法：node scripts/<script>.mjs [--base http://localhost:5173] [--routes home,workbench,ds] [--viewports desktop,mobile] [--themes light,dark] [--pid <案卷id>] [--out dir]')
      process.exit(0)
    }
  }
  return opts
}

/** 解析首个案卷 id（工作台 / 递交页路由需要）：--pid > STUDIO_PID > GET /api/projects 第一项 */
export async function resolvePid(opts) {
  if (opts.pid) return opts.pid
  try {
    const r = await fetch(new URL('/api/projects', opts.base))
    if (!r.ok) return null
    const j = await r.json()
    const list = Array.isArray(j) ? j : j.projects ?? j.items ?? []
    return list[0]?.id ?? null
  } catch {
    return null
  }
}

async function reachable(url) {
  try {
    const r = await fetch(`${url}/json/version`)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function connectBrowser() {
  const url = process.env.CDP_URL ?? 'http://localhost:29229'
  let info = await reachable(url)
  let child = null
  let profile = null
  let httpBase = url
  if (!info) {
    const bin = process.env.CHROME_BIN ?? 'google-chrome'
    const port = Number(process.env.CDP_PORT ?? 9333)
    profile = mkdtempSync(join(tmpdir(), 'ps-cdp-'))
    child = spawn(bin, [`--remote-debugging-port=${port}`, '--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
    httpBase = `http://127.0.0.1:${port}`
    for (let i = 0; i < 50 && !info; i++) {
      await new Promise((r) => setTimeout(r, 200))
      info = await reachable(httpBase)
    }
    if (!info) throw new Error(`无法连接 CDP：${url} 不可达，且 ${bin} 启动失败（设 CDP_URL 或 CHROME_BIN）`)
  }
  const close = () => {
    if (child) child.kill('SIGTERM')
    if (profile) rmSync(profile, { recursive: true, force: true })
  }
  return { httpBase, info, close, owned: !!child }
}

export class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`))
        else resolve(msg.result)
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }
  close() {
    this.ws.close()
  }
}

/** 新开一个 tab 并返回会话；调用方负责 page.close() 与 Target.closeTarget */
export async function openPage(browser) {
  const r = await fetch(`${browser.httpBase}/json/new?about:blank`, { method: 'PUT' })
  const target = await r.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const s = new Session(ws)
  await s.send('Page.enable')
  await s.send('Runtime.enable')
  await s.send('Log.enable')
  const console_ = []
  s.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') console_.push({ level: p.type, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ') })
  })
  s.on('Runtime.exceptionThrown', (p) => console_.push({ level: 'exception', text: p.exceptionDetails.exception?.description ?? p.exceptionDetails.text }))
  s.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') console_.push({ level: 'log-error', text: p.entry.text })
  })
  s.console = console_
  s.targetId = target.id
  s.closeTarget = async () => {
    s.close()
    await fetch(`${browser.httpBase}/json/close/${target.id}`).catch(() => {})
  }
  return s
}

export async function setViewport(s, vp) {
  await s.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile })
  await s.send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile })
}

export async function setTheme(s, theme) {
  // 应用用 .dark class（store ui.theme 持久化）；这里在导航前写入 localStorage 并同时模拟 prefers-color-scheme
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  await s.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{const k='patent-studio:ui:v2';const raw=localStorage.getItem(k);const j=raw?JSON.parse(raw):{state:{},version:4};j.state={...(j.state||{}),theme:'${theme}'};localStorage.setItem(k,JSON.stringify(j));document.documentElement.classList.toggle('dark','${theme}'==='dark')}catch(e){}`,
  })
}

export async function navigate(s, url, { settleMs = 800 } = {}) {
  const loaded = new Promise((resolve) => s.on('Page.loadEventFired', resolve))
  await s.send('Page.navigate', { url })
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))])
  await evaluate(s, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  await new Promise((r) => setTimeout(r, settleMs))
}

export async function evaluate(s, expression) {
  const r = await s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
