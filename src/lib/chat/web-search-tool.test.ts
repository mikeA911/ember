import { describe, it, expect, vi, beforeEach } from 'vitest'

const tavilyApiKeyMock = vi.fn()
vi.mock('@/lib/env', () => ({ env: { tavilyApiKey: () => tavilyApiKeyMock() } }))

const { runSearchWeb, SEARCH_WEB_TOOL, WEB_QUERY_RULE, WebSearchRequestError } = await import('./web-search-tool')

const fetchMock = vi.fn()

beforeEach(() => {
  tavilyApiKeyMock.mockReset()
  tavilyApiKeyMock.mockReturnValue('fake-tavily-key')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('runSearchWeb', () => {
  it('maps a successful Tavily response into WebSearchHit results', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: 'Acme Corp — About', url: 'https://acme.example/about', content: 'Acme makes widgets.', score: 0.92, published_date: '2026-08-01' },
        ],
        answer: null,
      }),
    })

    const result = await runSearchWeb({ query: 'Acme Corp' })

    expect(result.results).toEqual([
      { title: 'Acme Corp — About', url: 'https://acme.example/about', content: 'Acme makes widgets.', score: 0.92, publishedDate: '2026-08-01' },
    ])
    expect(result.answer).toBeNull()
    expect(result.query).toBe('Acme Corp')
  })

  it('applies input defaults and omits timeRange from the request body when not provided', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })

    await runSearchWeb({ query: 'Acme Corp' })

    const [, requestInit] = fetchMock.mock.calls[0]
    const body = JSON.parse(requestInit.body)
    expect(body).toMatchObject({ query: 'Acme Corp', search_depth: 'basic', topic: 'general', max_results: 5 })
    expect(body).not.toHaveProperty('time_range')
  })

  it('throws with the status code when Tavily returns a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid api key' })

    await expect(runSearchWeb({ query: 'Acme Corp' })).rejects.toThrow(/401/)
  })

  it('reports the sent query on a failure after the request went out', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' })

    const err = await runSearchWeb({ query: 'Acme Corp' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WebSearchRequestError)
    expect((err as InstanceType<typeof WebSearchRequestError>).query).toBe('Acme Corp')
  })

  it('reports the sent query when the network request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))

    const err = await runSearchWeb({ query: 'Acme Corp' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WebSearchRequestError)
    expect((err as InstanceType<typeof WebSearchRequestError>).query).toBe('Acme Corp')
    expect((err as Error).message).toMatch(/ECONNRESET/)
  })

  it('rejects invalid input without calling fetch, so nothing is reported as sent', async () => {
    const err = await runSearchWeb({}).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(WebSearchRequestError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws without calling fetch when TAVILY_API_KEY is unset', async () => {
    tavilyApiKeyMock.mockReturnValue(undefined)

    await expect(runSearchWeb({ query: 'Acme Corp' })).rejects.toThrow(/not configured/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('SEARCH_WEB_TOOL', () => {
  it('tells the model to keep project-internal details out of every query', () => {
    expect(SEARCH_WEB_TOOL.description).toContain(WEB_QUERY_RULE)
    expect(WEB_QUERY_RULE).toMatch(/only public names and topics/)
    expect(WEB_QUERY_RULE).toMatch(/Never put project-internal details in a query/)
  })
})
