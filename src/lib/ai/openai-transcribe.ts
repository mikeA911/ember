import 'server-only'
import OpenAI, { toFile } from 'openai'
import type { TranscribeInput, TranscribeResult } from './provider'
import { AIProviderError, describeError } from './provider'

// Speech to text through OpenAI's (or an OpenAI-compatible) transcription
// endpoint, shared by OpenAIProvider and OpenAICompatibleProvider. The
// audio is sent and dropped; nothing is written to disk or storage.
export async function transcribeWithOpenAI(
  client: OpenAI,
  providerName: string,
  defaultModel: string,
  input: TranscribeInput
): Promise<TranscribeResult> {
  const model = input.model ?? defaultModel
  try {
    const file = await toFile(input.audio, input.fileName, { type: input.mimeType })
    const res = await client.audio.transcriptions.create({
      file,
      model,
      ...(input.language ? { language: input.language } : {}),
    })
    return { text: res.text.trim(), model }
  } catch (err) {
    throw new AIProviderError(providerName, 'transcribe', `${providerName} transcribe failed: ${describeError(err)}`, err)
  }
}
