import { useEffect, useState } from 'react'
import { FileText, FolderOpen } from 'lucide-react'
import { getPlatformCase } from '@/lib/platform'
import { editorHash } from '@/lib/hash'
import { workbenchApi } from '@/workbench/api'
import type { Document, PlatformCase } from '@/workbench/types'
import { TreeRow } from '@/components/outline/TreeRow'
import { useStudio } from '@/store'

const BOOK_LABEL: Record<string, string> = { abstract: '摘要', claims: '权利要求书', description: '说明书' }

/**
 * B17 M5：工作台文件树「平台文稿」组——pid→平台案命中时列出 PG 三书文稿，
 * 行点击直达 `#/edit/<case>/<doc>`（DocEditorPage 深链；同一 BookEditor）。
 * 纯旧案 / 401 / 无文稿返回 null，文件树行为零变化。裸 fetch 只读列表（不进 query 缓存）。
 */
export function PlatformDocsGroup() {
  const pid = useStudio((s) => s.pid)
  const fileTreeCollapsed = useStudio((s) => s.fileTreeCollapsed)
  const toggleFileTreeCollapsed = useStudio((s) => s.toggleFileTreeCollapsed)
  const [docs, setDocs] = useState<{ pid: string; caseItem: PlatformCase; docs: Document[] } | null>(null)
  useEffect(() => {
    if (!pid) return
    let on = true
    void (async () => {
      const c = await getPlatformCase(pid)
      if (!c) {
        if (on) setDocs({ pid, caseItem: null as never, docs: [] })
        return
      }
      try {
        const list = await workbenchApi.documents(c.id)
        if (on) setDocs({ pid, caseItem: c, docs: list })
      } catch {
        if (on) setDocs({ pid, caseItem: c, docs: [] })
      }
    })()
    return () => {
      on = false
    }
  }, [pid])
  if (!pid || !docs || docs.pid !== pid || !docs.docs.length) return null
  const open = !fileTreeCollapsed.includes('pdocs')
  const cid = docs.caseItem.id
  return (
    <>
      <TreeRow
        id="dir:pdocs"
        collapsed={!open}
        onToggle={() => toggleFileTreeCollapsed('pdocs')}
        onActivate={() => toggleFileTreeCollapsed('pdocs')}
        icon={<FolderOpen />}
        count={docs.docs.length}
        title="平台文稿：PG 库中的三书（与目录件并行，编辑进平台编辑器）"
        testId="file-pdocs"
      >
        平台文稿
      </TreeRow>
      {open && (
        <div role="group" data-testid="file-pdocs-list">
          {docs.docs.map((doc) => (
            <TreeRow
              key={doc.id}
              id={`platform-doc:${doc.id}`}
              level={1}
              icon={<FileText />}
              tag="平台"
              title={`${BOOK_LABEL[doc.book] ?? doc.book} · 点击在平台编辑器打开`}
              onActivate={() => {
                window.location.hash = editorHash(cid, doc.id)
              }}
              testId="file-platform-doc"
            >
              {BOOK_LABEL[doc.book] ?? doc.book}
            </TreeRow>
          ))}
        </div>
      )}
    </>
  )
}
