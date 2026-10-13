/**
 * Excalidraw 画布壳（W17）：~600KB 重资产 + 自带 css，仅画板页经 React.lazy 挂载时进包。
 * theme 锁 light——专利附图恒白底黑线，画布所见即导出所得。
 */
import '@excalidraw/excalidraw/index.css'
import './boardSkin.css'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { SceneElements } from './figureDraw'

export interface BoardCanvasProps {
  onApi: (api: ExcalidrawImperativeAPI) => void
  onUserEdit: () => void
  viewOnly: boolean
}

export default function BoardCanvas({ onApi, onUserEdit, viewOnly }: BoardCanvasProps) {
  return (
    <div className="board-skin size-full">
      <Excalidraw
      excalidrawAPI={onApi}
      initialData={{ elements: [] as unknown as SceneElements, appState: { theme: 'light', viewBackgroundColor: '#ffffff' } }}
      onChange={onUserEdit}
      viewModeEnabled={viewOnly}
      theme="light"
      langCode="zh-CN"
      UIOptions={{ canvasActions: { export: false, saveAsImage: false, saveToActiveFile: false, loadScene: false, toggleTheme: false } }}
      />
    </div>
  )
}
