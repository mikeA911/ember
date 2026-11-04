import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { transcribeWithOpenAI } from './openai-transcribe'

function fakeClient(create: (args: Record<string, unknown>) => Promise<{ text: string }>) {
  return { audio: { transcriptions: { create } } } as unknown as OpenAI
}

describe('transcribeWithOpenAI', () => {
  it('sends the audio with the chosen model and returns trimmed text', async () => {
    const create = vi.fn(async (args: Record<string, unknown>) => ({ text: args ? '  Napansin ko, renewal costs are rising.  ' : '' }))
    const result = await transcribeWithOpenAI(fakeClient(create), 'openai', 'gpt-4o-transcribe', {
      audio: new Uint8Array([1, 2, 3]),
      fileName: 'dictation.webm',
      mimeType: 'audio/webm',
      model: 'gpt-4o-mini-transcribe',
    })
    expect(result).toEqual({ text: 'Napansin ko, renewal costs are rising.', model: 'gpt-4o-mini-transcribe' })
    const args = create.mock.calls[0][0] as unknown as Record<string, unknown> & { file: File }
    expect(args.model).toBe('gpt-4o-mini-transcribe')
    expect(args.file.name).toBe('dictation.webm')
    expect(args).not.toHaveProperty('language')
  })

  it('uses the default model and passes a language hint when given', async () => {
    const create = vi.fn(async (args: Record<string, unknown>) => ({ text: args ? 'ok' : '' }))
    await transcribeWithOpenAI(fakeClient(create), 'openai', 'gpt-4o-transcribe', {
      audio: new Uint8Array([1]),
      fileName: 'a.m4a',
      mimeType: 'audio/mp4',
      language: 'tl',
    })
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-transcribe', language: 'tl' })
  })

  it('wraps failures as a provider error', async () => {
    const err = Object.assign(new Error('Rate limit reached'), { status: 429 })
    await expect(
      transcribeWithOpenAI(fakeClient(() => Promise.reject(err)), 'openai', 'gpt-4o-transcribe', {
        audio: new Uint8Array([1]),
        fileName: 'a.webm',
        mimeType: 'audio/webm',
      })
    ).rejects.toMatchObject({ operation: 'transcribe', errorCode: 'rate_limit' })
  })
})
