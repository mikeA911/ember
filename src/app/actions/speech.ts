'use server'

import { requireUser } from '@/lib/auth'
import { AISensitivityError, AIProviderError, assertProviderEligible, getSpeechProvider } from '@/lib/ai'
import type { InformationSensitivity } from '@/types/database'

// Dictation in Ember's chat (speech to text). The recording is passed to
// the speech-to-text default and dropped: nothing is stored, and only the
// returned text goes into the message box, where the person checks it
// before sending. A Project's sensitivity applies as it does to chat: a
// confidential Project's audio goes only to a provider approved for
// confidential material.

// Under Vercel's 4.5MB request limit; the recorder stops at three minutes
// at a low bitrate (about 1MB), so this is only a backstop.
const MAX_AUDIO_BYTES = 4 * 1024 * 1024

export async function speechAvailableAction(): Promise<boolean> {
  const ctx = await requireUser()
  return (await getSpeechProvider(ctx.supabase)) !== null
}

export async function transcribeAudioAction(formData: FormData): Promise<{ text: string; error?: never } | { text?: never; error: string }> {
  const ctx = await requireUser()
  const audio = formData.get('audio')
  const projectId = formData.get('projectId')
  // Thinking aloud: always treated as confidential, wherever it happens.
  const confidential = formData.get('confidential') === '1'
  if (!(audio instanceof File) || audio.size === 0) return { error: 'No recording was received.' }
  if (audio.size > MAX_AUDIO_BYTES) return { error: 'That recording is too long. Keep dictation under three minutes.' }
  // Thinking aloud sends its recording in two-minute parts, each under this limit.
  if (!audio.type.startsWith('audio/')) return { error: 'That isn’t an audio recording.' }

  const speech = await getSpeechProvider(ctx.supabase)
  if (!speech) return { error: 'Dictation isn’t set up. Ask an administrator to choose a speech-to-text model.' }

  let sensitivity: InformationSensitivity = 'internal'
  if (typeof projectId === 'string' && projectId) {
    const { data: project } = await ctx.supabase.from('projects').select('information_sensitivity').eq('id', projectId).maybeSingle()
    if (!project) return { error: 'You don’t have access to that Project.' }
    sensitivity = project.information_sensitivity ?? 'internal'
  }
  if (confidential && sensitivity !== 'restricted') sensitivity = 'confidential'

  try {
    await assertProviderEligible(ctx.supabase, speech.provider.id, sensitivity)
    const { text } = await speech.client.transcribe({
      audio: new Uint8Array(await audio.arrayBuffer()),
      fileName: audio.name || 'dictation.webm',
      mimeType: audio.type,
      model: speech.model.model_id,
    })
    if (!text) return { error: 'No speech was heard. Try again a little closer to the microphone.' }
    return { text }
  } catch (err) {
    if (err instanceof AISensitivityError) {
      return { error: `Dictation isn’t allowed here: ${speech.provider.display_name} isn’t approved for ${sensitivity} information.` }
    }
    if (err instanceof AIProviderError && err.errorCode === 'rate_limit') return { error: 'Dictation is busy right now. Try again in a moment.' }
    return { error: 'The recording couldn’t be transcribed. Try again.' }
  }
}
