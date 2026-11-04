'use client'

import { useEffect, useRef, useState } from 'react'
import { speechAvailableAction, transcribeAudioAction } from '@/app/actions/speech'

// Dictation for Ember's composer: record, transcribe on the server with the
// speech-to-text default, and put the words in the message box for the
// person to check. Nothing is sent and no audio is kept. Hidden when no
// speech-to-text model is set up, or the browser can't record.

const MAX_SECONDS = 180

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t))
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

export function DictationButton({
  projectId,
  disabled,
  onText,
}: {
  projectId?: string
  disabled?: boolean
  onText: (text: string) => void
}) {
  const [available, setAvailable] = useState(false)
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  useEffect(() => () => release(), [])

  function release() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 })
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => void finish(recorder.mimeType || mimeType || 'audio/webm')
      recorderRef.current = recorder
      recorder.start()
      setSeconds(0)
      setState('recording')
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS && recorderRef.current?.state === 'recording') recorderRef.current.stop()
          return s + 1
        })
      }, 1000)
    } catch {
      release()
      setError('Allow microphone access in your browser to dictate.')
    }
  }

  function stop() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  async function finish(mimeType: string) {
    release()
    setState('transcribing')
    const type = mimeType.split(';')[0]
    const blob = new Blob(chunksRef.current, { type })
    chunksRef.current = []
    const form = new FormData()
    form.append('audio', new File([blob], `dictation.${extensionFor(type)}`, { type }))
    if (projectId) form.append('projectId', projectId)
    try {
      const result = await transcribeAudioAction(form)
      if (result.error !== undefined) setError(result.error)
      else onText(result.text)
    } catch {
      setError('The recording couldn’t be transcribed. Try again.')
    } finally {
      setState('idle')
    }
  }

  if (!available) return null

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <>
      <button
        type="button"
        onClick={state === 'recording' ? stop : start}
        disabled={(disabled && state !== 'recording') || state === 'transcribing'}
        aria-pressed={state === 'recording'}
        title={state === 'recording' ? 'Stop and transcribe' : 'Dictate: speak, then check the words before sending'}
        className={
          state === 'recording'
            ? 'animate-pulse rounded border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-700'
            : 'rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50'
        }
      >
        {state === 'recording' ? `Stop ${clock}` : state === 'transcribing' ? 'Transcribing…' : 'Dictate'}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'recording' ? 'Recording' : state === 'transcribing' ? 'Transcribing' : error ?? ''}
      </span>
      {error && (
        <span role="alert" className="max-w-[12rem] text-xs text-red-600">
          {error}
        </span>
      )}
    </>
  )
}
