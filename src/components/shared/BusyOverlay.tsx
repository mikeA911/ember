'use client'

import { EmberLoadingScreen } from '@/components/shared/EmberLoadingScreen'

// The ember loading screen for a slow action that isn't a navigation --
// uploading and parsing a document, embedding chunks, an AI generation.
// Drop it into the form that runs the action and drive it with that form's
// own pending state; `message` says what's happening.
export function BusyOverlay({ active, message }: { active: boolean; message?: string }) {
  return active ? <EmberLoadingScreen message={message} /> : null
}
