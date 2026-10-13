/**
 * R8 实时协同前端（docs/plan/11-r8-realtime-design.md）；单元 G2-collab-client 只改本目录。
 * 接线点：Editor.tsx `collabExtension` 插槽 · store `collab` slice · api.collabStatus/collabWs。
 * W4-B D10：原顶栏 PresenceBar 已并入 components/share/ShareButton（头像 + 在线数）与协作者中心抽屉；RemoteCursor / colors 保留。
 */
export { PEER_COLORS, colorFor, labelText, initialOf, type PeerColor } from './colors'
export {
  connectCollab,
  collabUserFor,
  guestName,
  peersFrom,
  cursorLine,
  storeHandlers,
  localDoc,
  YTEXT_KEY,
  REJECT_CODE,
  type CollabSession,
  type CollabUser,
  type CollabSessionHandlers,
  type ConnectOptions,
  type AwarenessState,
} from './provider'
export { collabExtension } from './yCodemirror'
export { useCollabSession } from './useCollabSession'
export { CollabMirror, useCollabMirror } from './useCollabMirror'
export { acquireRoom, releaseRoom, activeBooks, roomEntries, destroyAllRooms, type RoomEntry } from './registry'
export { RemoteCursorLabel, remoteCursorTheme } from './RemoteCursor'
