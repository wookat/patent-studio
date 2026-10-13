import { describe, expect, it } from 'vitest'

/** 全部源码原文（Vite glob，键形如 /src/components/mobile/MobileShell.tsx） */
const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const EXT = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']

function normalize(path: string): string {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '..') out.pop()
    else if (seg !== '.' && seg !== '') out.push(seg)
  }
  return '/' + out.join('/')
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? '/src/' + spec.slice(2) : spec.startsWith('.') ? normalize(from.slice(0, from.lastIndexOf('/')) + '/' + spec) : null
  if (!base) return null
  for (const e of EXT) if (base + e in SOURCES) return base + e
  return null
}

/** 静态走一遍 import 图（不含 type-only import），收集第三方包名与 src 内模块 */
function importGraph(entry: string) {
  const seen = new Set<string>()
  const packages = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const m of SOURCES[file].matchAll(/^\s*import\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1] ?? m[2]
      const local = resolveLocal(file, spec)
      if (local) walk(local)
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
    }
  }
  walk(entry)
  return { files: [...seen].map((f) => f.slice('/src/'.length)), packages }
}

describe('375 移动壳不装 dockview（08 §9）', () => {
  it('MobileShell 的静态 import 图不含 dockview-react，也不含 layout/*（DockArea/panels/registry）', () => {
    const g = importGraph('/src/components/mobile/MobileShell.tsx')
    expect(g.files.length).toBeGreaterThan(20)
    expect(g.packages.has('dockview-react')).toBe(false)
    expect(g.packages.has('dockview-core')).toBe(false)
    expect(g.files.filter((f) => f.startsWith('layout/'))).toEqual([])
    expect(g.files).toContain('components/mobile/BookSwitcher.tsx')
    expect(g.files).toContain('components/mobile/MobileBookEditor.tsx')
  })
})
