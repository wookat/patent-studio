import { readHashShareToken, takeShareToken } from '@/lib/hash'
import { useStudio } from '@/store'

export const PASSWORD_MIN = 8

/** fastapi-users 的 ErrorCode（detail 为裸代码字符串）→ 中文；其余原样透出 */
const AUTH_ERROR_TEXT: Record<string, string> = {
  LOGIN_BAD_CREDENTIALS: '邮箱或密码错误',
  LOGIN_USER_NOT_VERIFIED: '该账号尚未启用，请联系管理员',
  REGISTER_USER_ALREADY_EXISTS: '该邮箱已注册，请直接登录',
  REGISTER_INVALID_PASSWORD: `密码不符合要求（至少 ${PASSWORD_MIN} 位）`,
  UPDATE_USER_INVALID_PASSWORD: `密码不符合要求（至少 ${PASSWORD_MIN} 位）`,
  UPDATE_USER_EMAIL_ALREADY_EXISTS: '该邮箱已被其他账号使用',
}

export function authErrorText(raw: string): string {
  return AUTH_ERROR_TEXT[raw] ?? raw
}

/** 登录成功后的去向：分享链接 → 留在 / 恢复 #/share/<token>（ShareAccept 接手）；否则落新工作台 #/workbench（旧案卷深链已退役，returnPid 仅保留签名） */
export async function enterWorkspace(_returnPid: string | null): Promise<void> {
  if (readHashShareToken()) return
  // 领取页→登录途中 share hash 被 #/login 覆盖：token 暂存过就恢复路由，交给 ShareAccept 继续领取（R14-01）
  const stashed = takeShareToken()
  if (stashed) {
    window.location.hash = `/share/${encodeURIComponent(stashed)}`
    return
  }
  window.location.hash = '/workbench'
}

/** 登出：先拆掉全部协同房间（ws / 光标 / 头像），再清工作区状态并结束会话；两处登出入口（用户菜单 / 登录页「换账号」）共用 */
export async function signOut(): Promise<void> {
  // collab/registry → provider → yjs/y-codemirror 整套协同栈——动态 import，登出瞬间才加载（不背进首屏分包）
  const { destroyAllRooms } = await import('@/collab/registry')
  destroyAllRooms()
  await useStudio.getState().logout()
}
