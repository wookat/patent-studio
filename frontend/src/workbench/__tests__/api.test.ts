import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/net'
import { workbenchApi } from '../api'

const response = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  ...init,
})

afterEach(() => vi.restoreAllMocks())

describe('workbench API boundary', () => {
  it('injects a fresh Idempotency-Key on every write', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ id: 'a1' }))
      .mockResolvedValueOnce(response({ id: 'a1' }))
    await workbenchApi.setWorkItemStatus('w1', 'done')
    await workbenchApi.setWorkItemStatus('w1', 'done')
    const first = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    const second = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(first.get('Idempotency-Key')).toMatch(/^[a-z0-9-]{8,}$/)
    expect(second.get('Idempotency-Key')).toMatch(/^[a-z0-9-]{8,}$/)
    expect(first.get('Idempotency-Key')).not.toBe(second.get('Idempotency-Key'))
  })

  it('preserves 401 as ApiError for the workbench auth state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ detail: { kind: 'auth', message: 'login required' } }, { status: 401 }))
    await expect(workbenchApi.me()).rejects.toMatchObject({ status: 401 } satisfies Partial<ApiError>)
  })
})
