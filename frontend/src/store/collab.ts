import { ApiError, api } from '@/lib/api'
import type { Slice } from './types'

/**
 * R8 实时协同 slice（docs/plan/11-r8-realtime-design.md §5.2）。prep：类型 + 默认值 + 纯状态动作；
 * 连接/断开的真实实现（Y.Doc / y-websocket provider / awareness 订阅）在 `frontend/src/collab/`（G2）。
 *
 * - `'off'`：后端 PATENT_STUDIO_COLLAB=off 或 /collab 501（G1 未落地）⇒ 与现状完全一致：本地编辑 + PUT /content。
 * - `'connecting' | 'connected' | 'reconnecting'`：协同生效，编辑经 Y.Text 同步、服务端写回；本地 PUT 路径关闭（`selectCollabActive`）。
 * - `readonly`：viewer 角色或服务端拒绝写入 ⇒ 编辑器 `EditorState.readOnly`，顶栏显示「只读」。
 */
export type CollabStatus = 'off' | 'connecting' | 'connected' | 'reconnecting'

export interface CollabPeer {
  /** awareness clientID */
  id: number
  /** AUTH=on 的用户 id——跨房间 / 同名去重键；off / 访客 / 旧端缺省 */
  uid?: string | null
  name: string
  /** `colorFor(name)` 十六进制色（frontend/src/collab/colors.ts） */
  color: string
  /** 光标所在行（1 起）；无光标 = null */
  line: number | null
  /** 该端只读（viewer） */
  readonly: boolean
}

export interface CollabSlice {
  collabStatus: CollabStatus
  /** 后端已声明不可用（off / 501）：不再尝试连接，顶栏不显示在线数 */
  collabUnavailable: boolean
  /** 已完成 GET /collab 探测的案子；编辑器只在 collabProbed === pid 且可用时才建连接（避免 off 时先连再被 1008 踢回） */
  collabProbed: string | null
  /** 不含自己 */
  peers: CollabPeer[]
  collabReadonly: boolean
  /** 最近一次连接错误（握手 403 / 1008 等），供状态指示 title */
  collabError: string | null

  /** GET /api/projects/{pid}/collab：501/off ⇒ collabUnavailable；readonly（viewer）⇒ collabReadonly；完成后 collabProbed = pid */
  loadCollabStatus(pid: string): Promise<void>
  setCollabStatus(status: CollabStatus, error?: string | null): void
  setPeers(peers: CollabPeer[]): void
  setCollabReadonly(readonly: boolean): void
  resetCollab(): void
}

export const collabSlice: Slice<CollabSlice> = (set, get) => ({
  collabStatus: 'off',
  collabUnavailable: false,
  collabProbed: null,
  peers: [],
  collabReadonly: false,
  collabError: null,

  loadCollabStatus: async (pid) => {
    try {
      const r = await api.collabStatus(pid)
      set({ collabUnavailable: !r.enabled, collabReadonly: r.enabled && r.readonly, collabProbed: pid })
    } catch (e) {
      set({ collabUnavailable: e instanceof ApiError && e.status === 501, collabProbed: pid })
    }
  },
  setCollabStatus: (collabStatus, error = null) => {
    // 协同在线期间写盘由服务端完成，本地 saved 不跟进；正常离开房间（connected → off，非错误）时把当前内容视为已保存，
    // 否则切到递交页 / 关页会被误判为未保存而弹「离开站点？」
    const prev = get().collabStatus
    if (collabStatus === 'off' && prev === 'connected' && !error) set({ collabStatus, collabError: null, saved: get().content })
    else set({ collabStatus, collabError: error })
  },
  setPeers: (peers) => set({ peers }),
  setCollabReadonly: (collabReadonly) => set({ collabReadonly }),
  resetCollab: () => set({ collabStatus: 'off', collabProbed: null, peers: [], collabReadonly: false, collabError: null }),
})

/** 协同生效：本地 PUT /content 关闭，写盘由服务端去抖完成（doc.save 仍可显式触发 flush，G2 决定） */
export const selectCollabActive = (s: CollabSlice) => s.collabStatus !== 'off'
