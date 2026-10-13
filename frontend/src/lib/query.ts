import { QueryClient } from '@tanstack/react-query'

/**
 * 全站共享 QueryClient——服务端数据读链迁往 TanStack Query 的落点。
 * 默认策略：30s 内视为新鲜（重复挂载不再重取）、失败重试 1 次、窗口聚焦不自动重取
 * （本应用自身有轮询/订阅机制，聚焦重取会与既有节奏打架）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
