// W6 规格冻结：并排采集 真实 `#/__ds`（vite :5173，无需后端）与 C 原型 `components.html`
// 用法：NODE_PATH=<含 playwright-core 的 node_modules> node shoot-ds.js
//   环境：BASE（默认 http://127.0.0.1:5173）、OUT（默认本目录）、CHROME（默认 ~/.cache/ms-playwright/chromium-1228）
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = process.env.OUT || __dirname;
const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const EXE = process.env.CHROME || process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const PROTO = 'file://' + path.resolve(__dirname, '..', 'prototype-w6-c-pro-dense', 'components.html');

async function probe(p) {
  return p.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const pick = (names) => Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]).filter(([, v]) => v));
    const btn = document.querySelector('button');
    return {
      dark: root.classList.contains('dark') || root.dataset.theme === 'dark',
      fontSize: getComputedStyle(document.body).fontSize,
      tokens: pick(['--g0', '--g1', '--g11', '--bg-app', '--bg-panel', '--bg-sunken', '--bg-elevated', '--n0', '--n1', '--n9', '--background', '--surface', '--fs-md', '--fs-base', '--fs-2xs', '--h-md', '--h-control', '--h-segmented', '--w-side', '--w-companion', '--w-agent', '--radius-sm', '--r-sm', '--r-xl']),
      firstButton: btn ? { h: btn.getBoundingClientRect().height, fs: getComputedStyle(btn).fontSize, r: getComputedStyle(btn).borderRadius } : null,
      buttonHeights: [...new Set([...document.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height)))].sort((a, b) => a - b),
      fontSizes: [...new Set([...document.querySelectorAll('body *')].map((e) => getComputedStyle(e).fontSize))].sort((a, b) => parseFloat(a) - parseFloat(b)),
    };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const report = {};
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
    // 真实 #/__ds：主题由 zustand persist（patent-studio:ui:v2）读取
    const p = await ctx.newPage();
    await p.addInitScript((theme) => {
      try {
        const k = 'patent-studio:ui:v2';
        const cur = JSON.parse(localStorage.getItem(k) || '{"state":{},"version":4}');
        cur.state = { ...(cur.state || {}), theme };
        cur.version = 4;
        localStorage.setItem(k, JSON.stringify(cur));
      } catch {}
    }, theme);
    await p.goto(BASE + '/#/__ds', { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(OUT, `ds-real--1440-${theme}.png`), fullPage: false });
    await p.screenshot({ path: path.join(OUT, `ds-real--1440-${theme}-full.png`), fullPage: true });
    report[`real-${theme}`] = await probe(p);
    // 原型 components.html
    const q = await ctx.newPage();
    await q.goto(PROTO + `?shot=1&theme=${theme}`, { waitUntil: 'load' });
    await q.waitForTimeout(500);
    await q.screenshot({ path: path.join(OUT, `ds-proto--1440-${theme}.png`), fullPage: false });
    await q.screenshot({ path: path.join(OUT, `ds-proto--1440-${theme}-full.png`), fullPage: true });
    report[`proto-${theme}`] = await probe(q);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})();
