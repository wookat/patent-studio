export * from './api/net'
export type { CollabBook, CollabRoomInfo, CollabStatusResponse } from './api/collab'

import { coreApi } from './api/core'
import { blocksApi } from './api/blocks'
import { figuresApi } from './api/figures'
import { attachmentsApi } from './api/attachments'
import { commentsApi } from './api/comments'
import { historyApi } from './api/history'
import { aiApi } from './api/ai'
import { termsApi } from './api/terms'
import { oaApi } from './api/oa'
import { convertApi } from './api/convert'
import { templatesApi } from './api/templates'
import { noveltyApi } from './api/novelty'
import { claimsApi } from './api/claims'
import { accountApi } from './api/account'
import { collabApi } from './api/collab'
import { lifecycleApi } from './api/lifecycle'
import { publicShareApi } from './api/public_share'

export const api = {
  ...coreApi,
  ...blocksApi,
  ...figuresApi,
  ...attachmentsApi,
  ...commentsApi,
  ...historyApi,
  ...aiApi,
  ...termsApi,
  ...oaApi,
  ...convertApi,
  ...templatesApi,
  ...noveltyApi,
  ...claimsApi,
  ...accountApi,
  ...collabApi,
  ...lifecycleApi,
  ...publicShareApi,
}
