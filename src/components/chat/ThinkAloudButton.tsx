'use client'

import { useEffect, useRef, useState } from 'react'
import { speechAvailableAction, transcribeAudioAction } from '@/app/actions/speech'
import { THINKING_ALOUD_MAX_SECONDS, formatClock } from '@/lib/chat/thinking-aloud'

// Thinking aloud (docs/design-notes/ember-sli-calm-workspace.md §4): talk an
// idea through for up to ten minutes. The recording is cut into two-minute
// parts, each transcribed on the server while the person keeps talking
// (treated as confidential; no audio is kept), so Done is quick and a
// failed part doesn't lose the rest. The joined transcript goes to Ember,
// which organises it into notes. Hidden when no speech-to-text model is set
// up, or the browser can't record.

const SEGMENT_SECONDS = 120

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t))
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

type Part = { text: string } | { error: string }

export function ThinkAloudButton({
  projectId,
  disabled,
  onTranscript,
}: {
  projectId?: string
  disabled?: boolean
  onTranscript: (transcript: string, seconds: number) => void
}) {
  const [available, setAvailable] = useState(false)
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'transcribing'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const partsRef = useRef<Promise<Part>[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const secondsRef = useRef(0)
  const segmentStartRef = useRef(0)
  // What the current recorder's stop means: start the next part, finish, or throw it away.
  const afterStopRef = useRef<'next' | 'finish' | 'discard'>('next')

  useEffect(() => {
    let cancelled = false
    const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
    if (!canRecord) return
    speechAvailableAction()
      .then((ok) => {
        if (!cancelled) setAvailable(ok)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      afterStopRef.current = 'discard'
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      release()
    },
    []
  )

  function release() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function transcribe(chunks: Blob[], mimeType: string): Promise<Part> {
    const type = mimeType.split(';')[0]
    const blob = new Blob(chunks, { type })
    if (blob.size === 0) return Promise.resolve({ text: '' })
    const form = new FormData()
    form.append('audio', new File([blob], `thinking-aloud.${extensionFor(type)}`, { type }))
    form.append('confidential', '1')
    if (projectId) form.append('projectId', projectId)
    return transcribeAudioAction(form)
      .then((r): Part => (r.error !== undefined ? { error: r.error } : { text: r.text }))
      .catch((): Part => ({ error: 'A part of the recording couldn’t be transcribed.' }))
  }

  function startPart() {
    const stream = streamRef.current
    if (!stream) return
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => {
      const next = afterStopRef.current
      if (next === 'discard') return
      partsRef.current.push(transcribe(chunks, recorder.mimeType || mimeType || 'audio/webm'))
      if (next === 'next') startPart()
      else void finish()
    }
    recorderRef.current = recorder
    segmentStartRef.current = secondsRef.current
    afterStopRef.current = 'next'
    recorder.start()
  }

  async function start() {
    setError(null)
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      release()
      setError('Allow microphone access in your browser to think aloud.')
      return
    }
    partsRef.current = []
    secondsRef.current = 0
    setSeconds(0)
    startPart()
    setState('recording')
    timerRef.current = setInterval(() => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state !== 'recording') return
      secondsRef.current += 1
      setSeconds(secondsRef.current)
      if (secondsRef.current >= THINKING_ALOUD_MAX_SECONDS) done()
      else if (secondsRef.current - segmentStartRef.current >= SEGMENT_SECONDS) recorder.stop()
    }, 1000)
  }

  function pause() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause()
      setState('paused')
    }
  }

  function resume() {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume()
      setState('recording')
    }
  }

  function done() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    afterStopRef.current = 'finish'
    setState('transcribing')
    recorder.stop()
  }

  function discard() {
    afterStopRef.current = 'discard'
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    release()
    partsRef.current = []
    setState('idle')
  }

  async function finish() {
    release()
    const parts = await Promise.all(partsRef.current)
    partsRef.current = []
    const transcript = parts
      .map((p) => ('text' in p ? p.text : ''))
      .filter(Boolean)
      .join(' ')
    const failed = parts.filter((p) => 'error' in p) as { error: string }[]
    setState('idle')
    if (!transcript) {
      setError(failed[0]?.error ?? 'No speech was heard. Try again a little closer to the microphone.')
      return
    }
    if (failed.length > 0) setError(`${failed.length === 1 ? 'One part' : `${failed.length} parts`} of the recording couldn’t be transcribed; Ember has the rest.`)
    onTranscript(transcript, secondsRef.current)
  }

  if (!available) return null

  if (state === 'idle') {
    return (
      <>
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          title="Think aloud: talk an idea through for up to ten minutes; Ember turns it into notes"
          className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          Think aloud
        </button>
        {error && (
          <span role="alert" className="max-w-[14rem] text-xs text-red-600">
            {error}
          </span>
        )}
      </>
    )
  }

  const remaining = THINKING_ALOUD_MAX_SECONDS - seconds
  return (
    <div role="group" aria-label="Thinking aloud" className="flex w-full basis-full flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/80 px-3 py-2 text-sm">
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500 ${state === 'recording' ? 'motion-safe:animate-pulse' : 'opacity-40'}`}
      />
      <span className="tabular-nums text-zinc-800">{formatClock(seconds)}</span>
      <span className="flex-1 text-xs text-zinc-600">
        {state === 'transcribing'
          ? 'Turning your words into text…'
          : state === 'paused'
            ? 'Paused.'
            : remaining <= 60
              ? `${remaining} seconds left.`
              : 'Talk freely, in any language. Ember will turn it into notes.'}
      </span>
      {state !== 'transcribing' && (
        <>
          {state === 'recording' ? (
            <button type="button" onClick={pause} className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs">
              Pause
            </button>
          ) : (
            <button type="button" onClick={resume} className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs">
              Resume
            </button>
          )}
          <button type="button" onClick={done} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white">
            Done
          </button>
          <button type="button" onClick={discard} className="rounded-full px-2 py-1 text-xs text-zinc-600 underline">
            Discard
          </button>
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {state === 'transcribing' ? 'Transcribing' : state === 'paused' ? 'Paused' : 'Recording'}
      </span>
    </div>
  )
}
