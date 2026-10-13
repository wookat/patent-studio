import { ApiError, api } from '@/lib/api'
import { ROLE_RANK, type Member, type Role } from '@/lib/types'
import {
  DEFAULT_COLLAB_SETTINGS,
  type AccessReport,
  type CollabCenterTab,
  type CollabSettings,
  type EditorMode,
  type Invite,
} from '@/types/collab-center'
import type { Slice } from './types'
import type { Studio } from './types'

/**
 * W4-B 协作者中心 slice（docs/plan/14 §6.1）。prep：类型 + 默认值 + 纯状态动作 + 读接口（501 ⇒ *Unavailable）；
 * 写动作（invite / setInviteRole / revokeInvite / setMemberRole / saveCollabSettings）由 B3 填实现（prep 只调 api 并按返回 set）。
 *
 * 成员 / 链接沿用 auth slice 的 members / shareLinks（ShareLink 现带 accepted_by）。
 * 501 同 ast slice：置 *Unavailable=true + 占位文案，不弹 toast。
 */
export interface CollabCenterSlice {
  collabCenterOpen: boolean
  collabCenterTab: CollabCenterTab
  access: AccessReport | null
  accessLoading: boolean
  accessUnavailable: boolean
  /** 非 501 读取失败：抽屉对应段上屏 + 重试（auditError / publicLinksError 同例） */
  accessError: string | null
  invites: Invite[]
  invitesLoading: boolean
  invitesUnavailable: boolean
  invitesError: string | null
  collabSettings: CollabSettings
  collabSettingsLoading: boolean
  collabSettingsUnavailable: boolean
  collabSettingsError: string | null
  /** editor 手动选的模式（编辑 ↔ 审阅）；viewer / reviewer 由 selectEditorMode 固定，不读此值 */
  editorMode: EditorMode
  /** 批71：邀请表单草稿（邮箱为打字输入）——协同抽屉 Sheet 关闭即卸载 MembersSection，本地态草稿随实例死（卸载丢草稿族收口） */
  inviteDraft: { email: string; role: Exclude<Role, 'owner'> } | null

  openCollabCenter(tab?: CollabCenterTab): void
  closeCollabCenter(): void
  setCollabCenterTab(tab: CollabCenterTab): void
  loadAccess(pid: string): Promise<void>
  loadInvites(pid: string): Promise<void>
  /** 邮箱已注册 ⇒ 直接成员（刷新 members）；否则进 invites。返回是否成功 */
  invite(pid: string, email: string, role: Exclude<Role, 'owner'>): Promise<boolean>
  setInviteRole(pid: string, email: string, role: Exclude<Role, 'owner'>): Promise<void>
  revokeInvite(pid: string, email: string): Promise<void>
  setMemberRole(pid: string, userId: string, role: Role): Promise<void>
  loadCollabSettings(pid: string): Promise<void>
  saveCollabSettings(pid: string, patch: Partial<CollabSettings>): Promise<void>
  setEditorMode(mode: EditorMode): void
  setInviteDraft(d: { email: string; role: Exclude<Role, 'owner'> } | null): void
  resetCollabCenter(): void
}

const is501 = (e: unknown) => e instanceof ApiError && e.status === 501
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * W9 审阅 bug：editorMode 按案子持久化（key `ps:mode:<pid>`），切案 / 刷新后一致。
 * 只存 edit / review：readonly 由角色 / 协同只读派生，不持久化；reviewer 由 selectEditorMode 固定 review，不读此值。
 */
export const modeStorageKey = (pid: string) => `ps:mode:${pid}`

const storage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readEditorMode(pid: string | null): EditorMode {
  if (!pid) return 'edit'
  try {
    const v = storage()?.getItem(modeStorageKey(pid))
    return v === 'review' ? 'review' : 'edit'
  } catch {
    return 'edit'
  }
}

export function writeEditorMode(pid: string | null, mode: EditorMode): void {
  if (!pid || mode === 'readonly') return
  try {
    storage()?.setItem(modeStorageKey(pid), mode)
  } catch {
    /* 隐身模式 / 配额满：不持久化也不影响当前会话 */
  }
}

export const collabCenterSlice: Slice<CollabCenterSlice> = (set, get) => ({
  collabCenterOpen: false,
  collabCenterTab: 'members',
  access: null,
  accessLoading: false,
  accessUnavailable: false,
  accessError: null,
  invites: [],
  invitesLoading: false,
  invitesUnavailable: false,
  invitesError: null,
  collabSettings: DEFAULT_COLLAB_SETTINGS,
  collabSettingsLoading: false,
  collabSettingsUnavailable: false,
  collabSettingsError: null,
  editorMode: 'edit',
  inviteDraft: null,

  openCollabCenter: (tab) => {
    // 与伴随栏互斥（抽屉 Sheet 覆盖整右侧）：走 closeCompanion 保留其审阅栏恢复语义
    get().closeCompanion()
    set({ collabCenterOpen: true, ...(tab ? { collabCenterTab: tab } : {}) })
  },
  closeCollabCenter: () => set({ collabCenterOpen: false }),
  setCollabCenterTab: (collabCenterTab) => set({ collabCenterTab }),

  loadAccess: async (pid) => {
    set({ accessLoading: true, accessError: null })
    try {
      const access = await api.access(pid)
      if (!get().pid || get().pid === pid) set({ access, accessUnavailable: false })
    } catch (e) {
      if (is501(e)) set({ accessUnavailable: true })
      else set({ accessError: msg(e) })
    } finally {
      set({ accessLoading: false })
    }
  },

  loadInvites: async (pid) => {
    set({ invitesLoading: true, invitesError: null })
    try {
      const invites = await api.invites(pid)
      if (!get().pid || get().pid === pid) set({ invites, invitesUnavailable: false })
    } catch (e) {
      if (is501(e)) set({ invitesUnavailable: true })
      else set({ invitesError: msg(e) })
    } finally {
      set({ invitesLoading: false })
    }
  },

  invite: async (pid, email, role) => {
    try {
      const r = await api.invite(pid, email, role)
      if (get().pid && get().pid !== pid) return true
      if ('member' in r) await get().loadMembers(pid)
      else set({ invites: [...get().invites.filter((i) => i.email !== r.email), r] })
      return true
    } catch (e) {
      if (is501(e)) set({ invitesUnavailable: true })
      else get().toast(msg(e), 'error')
      return false
    }
  },

  setInviteRole: async (pid, email, role) => {
    try {
      const r = await api.setInviteRole(pid, email, role)
      if (!get().pid || get().pid === pid) set({ invites: get().invites.map((i) => (i.email === r.email ? r : i)) })
    } catch (e) {
      if (is501(e)) set({ invitesUnavailable: true })
      else get().toast(msg(e), 'error')
    }
  },

  revokeInvite: async (pid, email) => {
    try {
      const invites = await api.revokeInvite(pid, email)
      if (!get().pid || get().pid === pid) set({ invites })
    } catch (e) {
      if (is501(e)) set({ invitesUnavailable: true })
      else get().toast(msg(e), 'error')
    }
  },

  setMemberRole: async (pid, userId, role) => {
    try {
      const members = await api.setMemberRole(pid, userId, role)
      if (!get().pid || get().pid === pid) set({ members })
    } catch (e) {
      get().toast(msg(e), 'error')
    }
  },

  loadCollabSettings: async (pid) => {
    set({ collabSettingsLoading: true, collabSettingsError: null })
    try {
      const collabSettings = await api.collabSettings(pid)
      if (!get().pid || get().pid === pid) set({ collabSettings, collabSettingsUnavailable: false })
    } catch (e) {
      if (is501(e)) set({ collabSettingsUnavailable: true })
      else set({ collabSettingsError: msg(e) })
    } finally {
      set({ collabSettingsLoading: false })
    }
  },

  saveCollabSettings: async (pid, patch) => {
    const prev = get().collabSettings
    set({ collabSettings: { ...prev, ...patch } })
    try {
      const next = await api.saveCollabSettings(pid, patch)
      if (!get().pid || get().pid === pid) set({ collabSettings: next })
    } catch (e) {
      if (!get().pid || get().pid === pid) set({ collabSettings: prev })
      if (is501(e)) set({ collabSettingsUnavailable: true })
      else get().toast(msg(e), 'error')
    }
  },

  setEditorMode: (editorMode) => {
    writeEditorMode(get().pid, editorMode)
    set({ editorMode })
  },
  setInviteDraft: (d) => set({ inviteDraft: d }),
  // openProject 先 set({ pid }) 再 reset：这里按新 pid 恢复该案上次选的模式
  resetCollabCenter: () =>
    set({
      collabCenterOpen: false,
      collabCenterTab: 'members',
      access: null,
      accessLoading: false,
      accessUnavailable: false,
      accessError: null,
      invites: [],
      invitesLoading: false,
      invitesUnavailable: false,
      invitesError: null,
      collabSettings: DEFAULT_COLLAB_SETTINGS,
      collabSettingsLoading: false,
      collabSettingsUnavailable: false,
      collabSettingsError: null,
      editorMode: readEditorMode(get().pid),
      inviteDraft: null,
    }),
})

/**
 * 编辑器实际模式（14 §6.1）：viewer / 协同只读 ⇒ 只读；reviewer 固定审阅；editor 及以上取手动选择。
 * `project.role` 为 null（AUTH=off / superuser 未入 ACL）按 editor 处理。
 */
export const selectEditorMode = (s: Pick<Studio, 'project' | 'collabReadonly' | 'editorMode'>): EditorMode => {
  const role = s.project?.role ?? null
  if (role === 'reviewer') return 'review'
  if (role === 'viewer' || s.collabReadonly) return 'readonly'
  return s.editorMode
}

/** 能否手动切换 编辑 ↔ 审阅：editor 及以上且非协同只读 */
export const selectCanSwitchMode = (s: Pick<Studio, 'project' | 'collabReadonly'>): boolean => {
  const role = s.project?.role ?? null
  return !s.collabReadonly && role !== 'viewer' && role !== 'reviewer'
}

/** 顶栏「分享 · N 在线」的 N（14 D4 / §3）：去重({me.uid} ∪ peers.uid)——uid 缺失时退回 name（访客/旧端）；协同 off / 不可用 ⇒ null（不显示） */
export const selectOnlineCount = (s: Pick<Studio, 'collabStatus' | 'collabUnavailable' | 'peers' | 'user'>): number | null => {
  if (s.collabStatus === 'off' || s.collabUnavailable) return null
  const keys = new Set(s.peers.map((p) => p.uid ?? `name:${p.name}`))
  if (s.user) keys.add(s.user.id)
  return keys.size + (s.user ? 0 : 1)
}

/** 成员在 awareness 里的名字（与 collab/provider collabUserFor 同源：display_name || email），用于成员行 ↔ peer 对齐 */
export const peerNameOf = (m: Pick<Member, 'display_name' | 'email'>): string => m.display_name?.trim() || m.email

/** 能否管理协作者（邀请 / 改角色 / 链接 / 设置）：superuser 或本案 owner；`project.role` 未知时按 members 里自己的行判（不在表中 ⇒ 当 owner，后端 403 兜底） */
export const selectCanManage = (s: Pick<Studio, 'project' | 'user' | 'members'>): boolean => {
  if (s.user?.is_superuser) return true
  const role = s.project?.role
  if (role) return role === 'owner'
  const me = s.members.find((m) => m.user_id === s.user?.id)
  return !me || ROLE_RANK[me.role] >= ROLE_RANK.owner
}
