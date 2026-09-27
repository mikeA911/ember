'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  sendChatMessageAction,
  listChatModelsAction,
  getChatActivityAction,
  getConversationPendingStatusAction,
  listRecentConversationsAction,
  listProjectConversationsAction,
  getProjectContextAction,
  getConversationMessagesAction,
  getAssistantOverviewAction,
} from '@/app/actions/chat'
import { sendFeedbackMessageAction } from '@/app/actions/feedback'
import type { ChatModelOption } from '@/lib/ai'
import type { ModelSelection } from '@/lib/chat/loop'
import type { DisplayMessage } from '@/lib/chat/conversations'
import type { MemberProjectOption } from '@/lib/projects/queries'
import type { Conversation, FeedbackType } from '@/types/database'
import { Markdown } from '@/components/shared/Markdown'
import { deriveArtifacts, artifactsCount } from '@/lib/chat/artifacts'
import { QuickSummary, RequirementsList, NextStepsList, LinksList, DocumentsList, CitationsList, KnowledgeUsedSummary, SuggestedPrompts } from './StructuredResponse'
import { GatewayInvocationCard } from './GatewayInvocationCard'

// Owner Roadmap and Ember Feedback Board, Phase 1. Only the three initial
// Ember-facing choices -- 'usability'/'documentation' exist as later
// owner-triage reclassifications, never an initial Ember choice.
const FEEDBACK_CATEGORIES: { type: FeedbackType; label: string }[] = [
  { type: 'bug', label: 'Report a problem' },
  { type: 'improvement', label: 'Suggest an improvement' },
  { type: 'feature_request', label: 'Request a new feature' },
]
const FEEDBACK_LABEL_BY_TYPE: Record<string, string> = Object.fromEntries(FEEDBACK_CATEGORIES.map((c) => [c.type, c.label]))

type PanelMessage = DisplayMessage & { embeddingModelDisplayName?: string }
type AssistantOverview = Awaited<ReturnType<typeof getAssistantOverviewAction>>

function modelKey(m: { providerName: string; modelId: string }): string {
  return `${m.providerName}::${m.modelId}`
}

// A `/projects/<id>/...` path whose <id> is one of the viewer's own
// memberships -- used both for ChatPanel's one-time initial project pick
// and for the live "which project's page are you on right now" comparison
// that drives the scope-mismatch nudge. Never matches a project the viewer
// isn't a member of (e.g. /projects/new, /projects/portfolio, or someone
// else's project an admin is merely viewing some other way) since those
// simply won't appear in `projects`.
function detectProjectIdFromPath(pathname: string, projects: MemberProjectOption[]): string | undefined {
  const candidate = pathname.match(/^\/projects\/([^/]+)/)?.[1]
  return candidate && projects.some((p) => p.id === candidate) ? candidate : undefined
}

// docs/dev-request-assistant-first-use-onboarding-and-history.md's own
// suggested copy -- shown as a client-only bubble, never sent to the server,
// never persisted, so it has no model cost or provenance (Acceptance
// criteria #1-2).
const ONBOARDING_GREETING =
  "Hi! I’m Ember, your Workbench Assistant, and I’m excited to explore the platform with you. We can investigate what you’re trying to accomplish, find the right Workbench method, check what information you already have, search approved platform guidance, and help you create projects or workstreams.\n\nYour conversations with me are saved to your account, so you can return to them in future sessions. What would you like to explore first?"

const STARTER_PROMPTS = [
  'Help me choose the right Workbench method.',
  'Show me what Ember can do.',
  'Help me turn an idea into a project.',
  'Explain what information I need to get started.',
]

const SHORT_WELCOME = "Welcome back — would you like to continue where we left off or start something new?"

// KB Sandbox Builder (docs/dev-request-kb-sandbox-builder-product.md) --
// the same three empty-state copy slots as above, framed around the
// builder's actual question rather than general platform exploration. Each
// builder has exactly one Project (auto-provisioned at account creation,
// see provisionBuilderProject in projects.ts); a new client is a Workstream
// on that Project, not a new Project -- Ember should point there, never
// suggest "starting a new project."
const ONBOARDING_GREETING_BUILDER =
  "Hi! I’m Ember. Let’s figure out what you’re trying to help this customer accomplish — I can help you discover the workflow, research the context, pick the right Method, and prepare architecture and specs. Start a new workstream to keep each customer's work separate, or tell me what you're working on now.\n\nYour conversations and saved notes are private to you. What are you trying to help this customer accomplish?"

const STARTER_PROMPTS_BUILDER = [
  'What are you trying to help this customer accomplish?',
  'Help me pick the right Method for this problem.',
  'Help me start a new workstream for a customer.',
  'Show me what Ember Builder can do.',
]

const SHORT_WELCOME_BUILDER = "Welcome back — continue an existing workstream, or start a new one?"

// A resumed conversation whose pending_turn_started_at is older than this is
// treated as abandoned (the tab that started it is long gone), not polled
// forever -- matches runAssistantTurn's own set/clear discipline.
const STALE_PENDING_MS = 5 * 60 * 1000
const PENDING_POLL_INTERVAL_MS = 3000

// Ember consolidation (2026-09-05): there used to be three places Ember
// could be opened from -- this global floating widget, an embedded copy on
// the dashboard's EmberHome, and another embedded copy on every project's
// own page (ProjectAssistantSection.tsx, now deleted) -- each with its own
// project-picker/remount logic. Now there is exactly one implementation,
// ChatSession, used in exactly two deliberate places: this floating widget
// (ChatPanel, below) and EmberHome's full-width inline placement. Neither
// wrapper duplicates ChatSession's own logic; they only decide how/when it
// is shown and which project it starts on.
//
// projectId/onSelectProject are fully controlled from outside -- the header
// project picker's <select> lives here, but ChatSession itself is never the
// one deciding which project is selected, so both wrappers can drive it
// identically. onClose is optional and gates whether a ✕ close button
// renders at all: the floating widget provides one, EmberHome's always-open
// inline placement does not.
export function ChatSession({
  projectId,
  projects,
  onSelectProject,
  currentPageProjectId,
  onClose,
  className,
  productMode = 'enterprise',
}: {
  projectId?: string
  projects: MemberProjectOption[]
  onSelectProject: (id: string | undefined) => void
  currentPageProjectId?: string
  onClose?: () => void
  className?: string
  productMode?: 'enterprise' | 'builder'
}) {
  const onboardingGreeting = productMode === 'builder' ? ONBOARDING_GREETING_BUILDER : ONBOARDING_GREETING
  const starterPrompts = productMode === 'builder' ? STARTER_PROMPTS_BUILDER : STARTER_PROMPTS
  const shortWelcome = productMode === 'builder' ? SHORT_WELCOME_BUILDER : SHORT_WELCOME
  const pathname = usePathname()
  // Owner Roadmap and Ember Feedback Board, Phase 1. showFeedbackChooser is
  // the three-choice screen; feedbackCategory non-null means an actual
  // feedback conversation is active (always a fresh conversation, never
  // resumed -- see chooseFeedbackCategory below).
  const [showFeedbackChooser, setShowFeedbackChooser] = useState(false)
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackType | null>(null)
  const [projectContext, setProjectContext] = useState<Awaited<ReturnType<typeof getProjectContextAction>>>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<PanelMessage[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [models, setModels] = useState<ChatModelOption[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detailsOpenFor, setDetailsOpenFor] = useState<number | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showShortWelcome, setShowShortWelcome] = useState(false)
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null)
  const [assistantOverview, setAssistantOverview] = useState<AssistantOverview | null>(null)
  // Set when a resumed conversation's own pending_turn_started_at says a
  // turn was still in flight -- distinct from isPending being true because
  // *this tab* just sent a message. Drives the recovery poll below instead
  // of the normal send() -> performTurn() path.
  const [resumedPendingConversationId, setResumedPendingConversationId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const historyDetailsRef = useRef<HTMLDetailsElement>(null)
  const artifactsDetailsRef = useRef<HTMLDetailsElement>(null)
  // Synchronous re-entry guard for send()/retry() -- isPending (state) isn't
  // enough on its own, since a second call can read the pre-update isPending
  // value from the current render's closure before React flushes the state
  // change that would disable the button (observed live: a fast double-click
  // or double-Enter could submit the same turn twice).
  const sendingRef = useRef(false)
  // Set the instant the user starts a new conversation, resumes one, or
  // sends a message -- their action always wins over a still-in-flight
  // auto-resume from the effect below (observed live: opening the panel and
  // acting before the delayed history load finished let the load silently
  // replace the active conversation once it resolved).
  const userActedRef = useRef(false)
  // Identifies which performTurn() call owns the pending/sendingRef/activity
  // state. Bumped both at the start of every new turn and whenever the user
  // switches conversations mid-turn (handleResume/handleNewConversation) --
  // a turn whose number no longer matches is stale and must not touch
  // shared state when it resolves, however late. Without this, a slow
  // response from conversation A landed in whichever conversation happened
  // to be displayed by the time it finished (regression: completion from
  // one conversation appearing in another after switching History).
  const turnSeqRef = useRef(0)
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [staleRun, setStaleRun] = useState(false)

  // A refresh mid-turn (this tab or another) leaves the resumed
  // conversation's last row as a tool-call/tool-result with no reply yet --
  // pending_turn_started_at is the durable signal that a completion is
  // still coming (or was abandoned), surviving the remount that reset every
  // other piece of state to its default.
  function checkResumedPending(conv: Conversation) {
    if (!conv.pending_turn_started_at) return
    const age = Date.now() - new Date(conv.pending_turn_started_at).getTime()
    if (age >= STALE_PENDING_MS) return
    setResumedPendingConversationId(conv.id)
    setIsPending(true)
  }

  // Polls the durable marker (not activity/messages directly) until it
  // clears, then does exactly one refetch of the finished conversation --
  // avoids re-fetching the full message list on every poll tick.
  useEffect(() => {
    if (!resumedPendingConversationId) return
    let cancelled = false
    const startedAt = Date.now()
    const interval = setInterval(async () => {
      if (cancelled) return
      if (Date.now() - startedAt >= STALE_PENDING_MS) {
        cancelled = true
        clearInterval(interval)
        setResumedPendingConversationId(null)
        setIsPending(false)
        setError("The turn Ember was working on for this conversation appears to have been abandoned.")
        return
      }
      try {
        const pendingSince = await getConversationPendingStatusAction(resumedPendingConversationId)
        if (cancelled || pendingSince) return
        const msgs = await getConversationMessagesAction(resumedPendingConversationId)
        if (cancelled) return
        setMessages(msgs)
        setResumedPendingConversationId(null)
        setIsPending(false)
      } catch {
        // Transient poll failure -- try again next tick rather than giving up.
      }
    }, PENDING_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [resumedPendingConversationId])

  useEffect(() => {
    if (!projectId || projectContext) return
    getProjectContextAction(projectId)
      .then(setProjectContext)
      .catch(() => {
        // Banner is informational -- if it fails, the panel still works.
      })
  }, [projectId, projectContext])

  useEffect(() => {
    if (models.length > 0) return
    listChatModelsAction()
      .then((opts) => {
        setModels(opts)
        const def = opts.find((m) => m.isDefault) ?? opts[0]
        if (def) setSelectedKey(modelKey(def))
      })
      .catch(() => {
        // Model list is a convenience for the picker/header -- if it fails
        // the Assistant still works, just without a visible model identity
        // until the first reply comes back.
      })
  }, [models.length])

  // Server-scoped, not a client flag: whether this user has ANY saved
  // conversation is what determines first-use vs. returning, so a reload or
  // a cleared browser cache never re-triggers the full greeting (design
  // doc's "First-use definition"). Runs once per mount (ChatSession is only
  // ever mounted while it should actually be active -- both wrappers
  // conditionally render it -- so "on mount" already means "just opened,"
  // no separate open flag needed here).
  useEffect(() => {
    if (historyLoaded) return
    let cancelled = false
    const listAction = projectId ? () => listProjectConversationsAction(projectId) : listRecentConversationsAction
    listAction()
      .then(async (list) => {
        if (cancelled) return
        // The History list itself is always safe to refresh, independent of
        // whether the active conversation gets auto-resumed below.
        setConversations(list)
        if (userActedRef.current) return
        if (list.length === 0) {
          // The full first-use greeting assumes a brand-new platform user --
          // wrong framing for "first time asking in this project" when the
          // same person has plenty of general conversations elsewhere.
          // Project-scoped panels skip straight to the plain placeholder.
          if (!projectId) setShowOnboarding(true)
          return
        }
        // listRecentConversationsAction deliberately returns the caller's
        // conversations regardless of project binding (its own comment: "every
        // conversation of the caller's, project-bound or not") -- that's
        // correct for the first-use/onboarding-suppression check just above,
        // which intentionally treats Ember familiarity as one continuous
        // relationship, not scoped per-project. But auto-resuming into THIS
        // general panel must not silently continue a project-bound
        // conversation -- resolvedProjectId in loop.ts always trusts a
        // conversation's OWN stored project_id, never what the client
        // passes, so picking one back up here would silently carry that
        // project's tools/context (e.g. Working Knowledge) into what the
        // user believes is general chat. Live-observed: asking a project-
        // bound question, then opening general Ember, auto-resumed that
        // same conversation and surfaced the project's private working
        // knowledge under the "General platform guidance" picker.
        const mostRecent = list.find((c) => projectId || c.project_id === null)
        if (!mostRecent) return
        try {
          const msgs = await getConversationMessagesAction(mostRecent.id)
          if (cancelled || userActedRef.current) return
          setConversationId(mostRecent.id)
          setMessages(msgs)
          checkResumedPending(mostRecent)
        } catch {
          // Resuming is a convenience -- if it fails, fall back to a blank
          // panel the user can still start chatting in.
        }
      })
      .catch(() => {
        // History is a convenience -- if it fails, the panel still works as
        // a blank slate, just without onboarding or auto-resume.
      })
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [historyLoaded, projectId])

  // Auto-scroll to the latest message whenever the message list changes
  // (new turn, switched conversation, resumed history) -- otherwise a
  // long-running conversation opens scrolled to its oldest message, reading
  // as an intimidating wall of text the user has to scroll through just to
  // see what Ember said last.
  useEffect(() => {
    const el = messageListRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Close an open popover first if one is open, rather than also
      // closing the whole panel in the same keypress.
      if (artifactsDetailsRef.current?.hasAttribute('open')) {
        artifactsDetailsRef.current.removeAttribute('open')
        return
      }
      if (historyDetailsRef.current?.hasAttribute('open')) {
        historyDetailsRef.current.removeAttribute('open')
        return
      }
      onClose?.()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [onClose])

  const artifacts = useMemo(() => deriveArtifacts(messages), [messages])
  const artifactsTotal = artifactsCount(artifacts)

  function goToMessage(index: number) {
    artifactsDetailsRef.current?.removeAttribute('open')
    const el = document.getElementById(`chat-message-${index}`)
    el?.scrollIntoView({ block: 'center' })
    el?.focus()
  }

  // Real (not simulated) activity feedback: polls whatever the tool-calling
  // loop has most recently persisted for this conversation. Only possible
  // once a conversationId is known client-side, which happens after the
  // FIRST turn completes -- so the very first message in a session just
  // shows a static "Thinking..." below, and polling kicks in from the
  // second message onward.
  useEffect(() => {
    if (!isPending || !conversationId) return
    const interval = setInterval(() => {
      getChatActivityAction(conversationId)
        .then(setActivity)
        .catch(() => {})
    }, 1200)
    return () => clearInterval(interval)
  }, [isPending, conversationId])

  const selectedModel = models.find((m) => modelKey(m) === selectedKey)

  // Shared by send() (which has already pushed the user bubble) and retry()
  // (which must not push a second one for the same failed turn).
  async function performTurn(message: string) {
    const modelSelection: ModelSelection | undefined = selectedModel
      ? { providerName: selectedModel.providerName, modelId: selectedModel.modelId }
      : undefined
    turnSeqRef.current += 1
    const myTurn = turnSeqRef.current
    setIsPending(true)
    setStaleRun(false)
    // Purely informational -- the provider call itself is already bounded
    // (60s per request), so this never invents a failure. It just gives the
    // user a visible way out if a turn is taking unusually long instead of
    // leaving "Thinking..." on screen with no recourse (regression: a
    // completed response only became visible after opening History).
    staleTimerRef.current = setTimeout(() => {
      if (myTurn === turnSeqRef.current) setStaleRun(true)
    }, 30_000)
    try {
      const result = feedbackCategory
        ? await sendFeedbackMessageAction(conversationId, message, feedbackCategory, pathname, modelSelection)
        : await sendChatMessageAction(conversationId, message, modelSelection, projectId)
      // The user may have switched to a different conversation (or started
      // a new one) while this was in flight -- a stale turn's result must
      // never overwrite what's currently displayed.
      if (myTurn !== turnSeqRef.current) return
      setConversationId(result.conversationId)
      // A provider failure (rate limit, capacity, ...) comes back as a
      // normal result rather than a thrown error -- see runAssistantTurn's
      // generateChat catch -- so it needs the same red-text-plus-Retry
      // treatment as the catch block below, not a normal assistant bubble.
      // An Information Sensitivity Classification policy block (the
      // selected model isn't eligible for what was retrieved -- see
      // src/lib/ai/sensitivity.ts) is also a normal result, same reason and
      // same treatment as isProviderError above. isInternalError is the same
      // shape again for any other uncaught error inside the turn (OL-008).
      if (result.isProviderError || result.isSensitivityBlock || result.isInternalError) {
        setError(result.reply)
        setLastFailedMessage(message)
        setConversations((prev) => (prev.some((c) => c.id === result.conversationId) ? prev : [{ id: result.conversationId } as Conversation, ...prev]))
        return
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.reply,
          providerDisplayName: result.providerDisplayName,
          modelDisplayName: result.modelDisplayName,
          toolsUsed: result.toolsUsed,
          embeddingModelDisplayName: result.embeddingModelDisplayName,
          structured: result.structured ?? undefined,
          createdRecords: result.createdRecords.length > 0 ? result.createdRecords : undefined,
          pendingGatewayInvocations: result.pendingGatewayInvocations.length > 0 ? result.pendingGatewayInvocations : undefined,
        },
      ])
      // The model that actually served this turn is now known -- if the
      // user hadn't picked one yet, reflect it in the picker/header.
      if (!selectedKey) setSelectedKey(`${result.providerName}::${result.modelId}`)
      // A brand-new conversation was just created -- it belongs at the top
      // of History from now on, without waiting for a full reload.
      setConversations((prev) => (prev.some((c) => c.id === result.conversationId) ? prev : [{ id: result.conversationId } as Conversation, ...prev]))
      setLastFailedMessage(null)
    } catch (err) {
      if (myTurn !== turnSeqRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to send message')
      // Kept as a durable per-turn failure state (not just a transient
      // banner) so the user can retry the exact same message rather than
      // retyping it -- the user's bubble is already visible and stays put.
      setLastFailedMessage(message)
    } finally {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
      if (myTurn === turnSeqRef.current) {
        setIsPending(false)
        setStaleRun(false)
        sendingRef.current = false
      }
    }
  }

  // Recovery action for a turn stuck past the stale threshold: reconcile
  // from the server's own record of the conversation instead of requiring
  // the user to discover the completed reply by opening History. Also
  // invalidates the stuck turn so its eventual (possibly very late)
  // resolution can't re-apply or duplicate anything.
  async function recoverStuckTurn() {
    turnSeqRef.current += 1
    setIsPending(false)
    setStaleRun(false)
    sendingRef.current = false
    if (!conversationId) return
    try {
      const msgs = await getConversationMessagesAction(conversationId)
      setMessages(msgs)
    } catch {
      // Reconciliation is best-effort -- if it fails, the user still has
      // working controls and can simply try again.
    }
  }

  async function send(message: string) {
    if (!message || sendingRef.current) return
    sendingRef.current = true
    userActedRef.current = true
    setError(null)
    setLastFailedMessage(null)
    setInput('')
    setDetailsOpenFor(null)
    setActivity(null)
    setShowOnboarding(false)
    setShowShortWelcome(false)
    setMessages((prev) => [...prev, { role: 'user', content: message }])
    await performTurn(message)
  }

  async function retry() {
    if (!lastFailedMessage || sendingRef.current) return
    sendingRef.current = true
    setError(null)
    setActivity(null)
    await performTurn(lastFailedMessage)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await send(input.trim())
  }

  // Any turn in flight for the conversation being left behind must stop
  // being able to affect what's on screen -- otherwise its late completion
  // (or its now-orphaned isPending/sendingRef) would either disable the
  // conversation the user just switched to, or splice its reply into the
  // wrong conversation's message list once it resolves.
  function abandonInFlightTurn() {
    turnSeqRef.current += 1
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    setIsPending(false)
    setStaleRun(false)
    setResumedPendingConversationId(null)
    sendingRef.current = false
  }

  function handleNewConversation() {
    userActedRef.current = true
    abandonInFlightTurn()
    setConversationId(null)
    setMessages([])
    setDetailsOpenFor(null)
    setActivity(null)
    setError(null)
    setLastFailedMessage(null)
    setShowOnboarding(false)
    // Starting a new conversation never replaces prior history -- it only
    // resets local state; the short contextual welcome, not the full
    // greeting, matches "don't repeat the full greeting" (criterion #10).
    setShowShortWelcome(true)
  }

  async function handleResume(conv: Conversation) {
    userActedRef.current = true
    abandonInFlightTurn()
    historyDetailsRef.current?.removeAttribute('open')
    artifactsDetailsRef.current?.removeAttribute('open')
    setShowOnboarding(false)
    setShowShortWelcome(false)
    setDetailsOpenFor(null)
    setActivity(null)
    setError(null)
    setLastFailedMessage(null)
    setConversationId(conv.id)
    try {
      const msgs = await getConversationMessagesAction(conv.id)
      setMessages(msgs)
      checkResumedPending(conv)
    } catch {
      setMessages([])
    }
  }

  // Owner Roadmap and Ember Feedback Board, Phase 1. openFeedbackChooser
  // shows the three-choice screen (never resumes anything, same
  // abandon-in-flight discipline as handleNewConversation/handleResume);
  // chooseFeedbackCategory commits to a category and starts a brand-new
  // conversation that performTurn routes to sendFeedbackMessageAction
  // instead of the normal chat action; cancelFeedback returns to ordinary
  // chat, discarding the feedback draft (never partially submitted -- only
  // Ember's own submit_feedback_report tool call creates a real report).
  function openFeedbackChooser() {
    userActedRef.current = true
    abandonInFlightTurn()
    historyDetailsRef.current?.removeAttribute('open')
    artifactsDetailsRef.current?.removeAttribute('open')
    setShowOnboarding(false)
    setShowShortWelcome(false)
    setError(null)
    setLastFailedMessage(null)
    setShowFeedbackChooser(true)
  }

  function chooseFeedbackCategory(category: FeedbackType) {
    setShowFeedbackChooser(false)
    setFeedbackCategory(category)
    setConversationId(null)
    setMessages([])
    setDetailsOpenFor(null)
  }

  function cancelFeedback() {
    abandonInFlightTurn()
    setShowFeedbackChooser(false)
    setFeedbackCategory(null)
    setConversationId(null)
    setMessages([])
    setError(null)
    setLastFailedMessage(null)
  }

  const headerModelLabel = selectedModel ? `${selectedModel.providerDisplayName} · ${selectedModel.modelDisplayName}` : null

  // Lazy-loaded on first open (details' onToggle fires on every open/close,
  // not just the first) so this popover never costs a Server Action call
  // just because the chat panel mounted -- same lazy-load spirit as the
  // model list above.
  function loadAssistantOverviewOnce() {
    if (assistantOverview) return
    getAssistantOverviewAction()
      .then(setAssistantOverview)
      .catch(() => {
        // Best-effort -- the popover just stays empty if this fails.
      })
  }

  // Curator/owner-set per-project prompt (Sandz Pilot Meeting Brief's
  // onboarding pattern) -- a clickable suggestion shown across every
  // empty-conversation state (first-ever use, "welcome back", and the
  // plain empty state), not just one of them, since a returning user
  // ("welcome back") is the common case for anyone who has used Ember
  // before, not an edge case.
  const projectStarterPromptChip =
    !feedbackCategory && projectId && projectContext?.starterPrompt ? (
      <button
        type="button"
        onClick={() => send(projectContext.starterPrompt!)}
        disabled={isPending}
        className="self-start rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
      >
        {projectContext.starterPrompt}
      </button>
    ) : null

  // Ember Role-Directed Product Experience: "the header should clearly
  // display the project it is on at all times" -- the title row already
  // did this (below); these two derive the names for the scope-mismatch
  // nudge, which shows only when the page you're viewing names a real,
  // authorized project (projects.find succeeds) different from the one
  // Ember is actually bound to. Never auto-switches -- see ChatPanel below.
  const selectedProjectName = projectId ? (projectContext?.name ?? projects.find((p) => p.id === projectId)?.name ?? 'this project') : 'General'
  const currentPageProjectName = currentPageProjectId ? projects.find((p) => p.id === currentPageProjectId)?.name : undefined
  const showScopeMismatchNudge = Boolean(currentPageProjectId && currentPageProjectId !== projectId && currentPageProjectName)

  return (
    <div ref={ref} className={className ?? 'flex h-[32rem] w-96 flex-col rounded border border-zinc-200 bg-white shadow-xl'}>
      <div className="border-b border-zinc-200 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {feedbackCategory
              ? `Ember -- ${FEEDBACK_LABEL_BY_TYPE[feedbackCategory]}`
              : projectId
                ? `Ember -- ${projectContext?.name ?? 'this project'}`
                : 'Ember -- General'}
          </span>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-zinc-700">
              ✕
            </button>
          )}
        </div>
        {!feedbackCategory && !showFeedbackChooser && (
          <div className="mt-1">
            <select
              value={projectId ?? ''}
              onChange={(e) => onSelectProject(e.target.value || undefined)}
              disabled={isPending}
              className="w-full rounded border border-zinc-300 px-1 py-0.5 text-xs text-zinc-700"
            >
              <option value="">General platform guidance</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {showScopeMismatchNudge && (
              <p className="mt-0.5 text-xs text-amber-700">
                Viewing <span className="font-medium">{currentPageProjectName}</span> — Ember is still on {selectedProjectName}.{' '}
                <button type="button" onClick={() => onSelectProject(currentPageProjectId)} className="underline">
                  Switch
                </button>
              </p>
            )}
          </div>
        )}
        {projectId && projectContext && !feedbackCategory && !showFeedbackChooser && (
          <p className="mt-0.5 text-xs text-zinc-500">Knowledge scope: {projectContext.knowledgeScope}</p>
        )}
        {feedbackCategory && (
          <div className="mt-0.5 flex items-center justify-between">
            <p className="text-xs text-amber-700">Filing feedback -- this is a separate conversation from ordinary chat.</p>
            <button type="button" onClick={cancelFeedback} className="shrink-0 text-xs text-zinc-400 underline hover:text-zinc-600">
              Cancel
            </button>
          </div>
        )}
        {models.length > 0 && (
          <select
            value={selectedKey ?? ''}
            onChange={(e) => setSelectedKey(e.target.value)}
            disabled={isPending}
            className="mt-1 w-full rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-xs text-zinc-600"
          >
            {models.map((m) => (
              <option key={modelKey(m)} value={modelKey(m)}>
                {m.providerDisplayName} · {m.modelDisplayName}
                {m.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        )}
        {!models.length && headerModelLabel && <p className="mt-0.5 text-xs text-zinc-400">{headerModelLabel}</p>}
        {!showFeedbackChooser && !feedbackCategory && (
        <>
        <details className="relative mt-1" onToggle={loadAssistantOverviewOnce}>
          <summary className="cursor-pointer list-none text-xs text-zinc-400 hover:text-zinc-600">How Ember works</summary>
          <div className="absolute left-0 z-10 mt-1 max-h-96 w-80 overflow-y-auto rounded border border-zinc-200 bg-white p-3 text-xs shadow-lg">
            {!assistantOverview && <p className="text-zinc-400">Loading…</p>}
            {assistantOverview && (
              <div className="flex flex-col gap-2">
                <div>
                  <p className="font-medium text-zinc-800">{assistantOverview.name}</p>
                  <p className="mt-0.5 text-zinc-600">{assistantOverview.purpose}</p>
                </div>
                {headerModelLabel && (
                  <p className="text-zinc-500">
                    Currently answering with: <span className="text-zinc-700">{headerModelLabel}</span>
                  </p>
                )}
                <p className="text-zinc-500">
                  Prompt version: <span className="text-zinc-700">{assistantOverview.promptVersion}</span>
                </p>
                <p className="text-zinc-600">{assistantOverview.plainLanguageExplanation}</p>
                <p className="text-zinc-500">User → Model → Tools (if needed) → Response</p>
                <div>
                  <p className="font-medium text-zinc-500">Tools</p>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {assistantOverview.tools.map((t) => (
                      <li key={t.name} className="text-zinc-600">
                        {t.name} — {t.description}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-zinc-500">Guardrails</p>
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {assistantOverview.guardrails.map((g) => (
                      <li key={g.label} className="text-zinc-600">
                        {g.label} — {g.description}
                      </li>
                    ))}
                  </ul>
                </div>
                <Link href="/agents/workbench-assistant" className="text-zinc-500 underline hover:text-zinc-700">
                  View full Agent flow →
                </Link>
              </div>
            )}
          </div>
        </details>
        {historyLoaded && (
          <div className="mt-1 flex items-center justify-between">
            <details ref={historyDetailsRef} className="relative">
              <summary className="cursor-pointer list-none text-xs text-zinc-400 hover:text-zinc-600">History</summary>
              <div className="absolute left-0 z-10 mt-1 max-h-48 w-64 overflow-y-auto rounded border border-zinc-200 bg-white p-1 shadow-lg">
                {conversations.length === 0 && <p className="px-2 py-1 text-xs text-zinc-400">No prior conversations yet.</p>}
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleResume(c)}
                    className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 ${
                      c.id === conversationId ? 'bg-zinc-50 font-medium' : ''
                    }`}
                  >
                    {c.title || 'Untitled conversation'}
                  </button>
                ))}
              </div>
            </details>
            <button type="button" onClick={handleNewConversation} className="text-xs text-zinc-400 hover:text-zinc-600">
              New conversation
            </button>
          </div>
        )}
        <details ref={artifactsDetailsRef} className="relative mt-1">
          <summary className="cursor-pointer list-none text-xs text-zinc-400 hover:text-zinc-600">
            Artifacts{artifactsTotal > 0 ? ` (${artifactsTotal})` : ''}
          </summary>
          <div className="absolute left-0 z-10 mt-1 max-h-96 w-80 overflow-y-auto rounded border border-zinc-200 bg-white p-3 text-xs shadow-lg">
            {artifactsTotal === 0 ? (
              <p className="text-zinc-400">Nothing collected in this conversation yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {artifacts.documents.length > 0 && (
                  <div>
                    <p className="font-medium text-zinc-500">Documents</p>
                    <ul className="mt-0.5 flex flex-col gap-1">
                      {artifacts.documents.map((doc) => (
                        <li key={doc.artifactId} className="rounded border border-zinc-200 p-1.5">
                          <p className="font-medium text-zinc-800">{doc.title}</p>
                          <p className="text-zinc-500">{doc.documentType.replace(/_/g, ' ')}</p>
                          <button type="button" onClick={() => goToMessage(doc.messageIndexes[doc.messageIndexes.length - 1])} className="text-blue-700 underline hover:text-blue-900">
                            Go to message
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {artifacts.citations.length > 0 && (
                  <div>
                    <p className="font-medium text-zinc-500">Citations</p>
                    <ul className="mt-0.5 flex flex-col gap-1">
                      {artifacts.citations.map((c) => (
                        <li key={`${c.sourceType}-${c.sourceId}`} className="rounded border border-zinc-200 p-1.5">
                          <p className="text-zinc-700">{c.label}</p>
                          <button type="button" onClick={() => goToMessage(c.messageIndexes[c.messageIndexes.length - 1])} className="text-blue-700 underline hover:text-blue-900">
                            Go to message
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {artifacts.nextSteps.length > 0 && (
                  <div>
                    <p className="font-medium text-zinc-500">Next steps</p>
                    <ul className="mt-0.5 flex flex-col gap-1">
                      {artifacts.nextSteps.map((s) => (
                        <li key={`${s.label}-${s.status}`} className="rounded border border-zinc-200 p-1.5">
                          <p className="text-zinc-700">
                            {s.label} <span className="text-zinc-500">({s.status})</span>
                          </p>
                          <button type="button" onClick={() => goToMessage(s.messageIndexes[s.messageIndexes.length - 1])} className="text-blue-700 underline hover:text-blue-900">
                            Go to message
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {artifacts.createdRecords.length > 0 && (
                  <div>
                    <p className="font-medium text-zinc-500">Created records</p>
                    <ul className="mt-0.5 flex flex-col gap-1">
                      {artifacts.createdRecords.map((r) => (
                        <li key={`${r.kind}-${r.id}`} className="rounded border border-zinc-200 p-1.5">
                          <p className="text-zinc-700">
                            {r.label} <span className="text-zinc-500">({r.kind.replace(/_/g, ' ')})</span>
                          </p>
                          <button type="button" onClick={() => goToMessage(r.messageIndexes[r.messageIndexes.length - 1])} className="text-blue-700 underline hover:text-blue-900">
                            Go to message
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <p className="font-medium text-zinc-500">External resources</p>
                  <p className="mt-0.5 text-zinc-400">None in this conversation yet.</p>
                </div>
              </div>
            )}
          </div>
        </details>
        </>
        )}
        {!showFeedbackChooser && !feedbackCategory && (
          <button type="button" onClick={openFeedbackChooser} className="mt-1 block text-xs text-zinc-400 hover:text-zinc-600">
            Feedback
          </button>
        )}
      </div>
      <div ref={messageListRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {showFeedbackChooser && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-600">
              Reporting from: <span className="font-medium text-zinc-800">{pathname}</span>. This page will be attached to your
              report. If that isn&apos;t where the issue is, close this and navigate there first, then reopen Feedback.
            </p>
            <div className="flex flex-col gap-2">
              {FEEDBACK_CATEGORIES.map((c) => (
                <button
                  key={c.type}
                  type="button"
                  onClick={() => chooseFeedbackCategory(c.type)}
                  className="rounded border border-zinc-300 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowFeedbackChooser(false)}
              className="self-start text-xs text-zinc-400 underline hover:text-zinc-600"
            >
              Cancel
            </button>
          </div>
        )}
        {!showFeedbackChooser && showOnboarding && messages.length === 0 && (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="inline-block max-w-[95%] whitespace-pre-wrap rounded bg-zinc-100 px-2 py-1 text-zinc-800">
                {onboardingGreeting}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  disabled={isPending}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
              {projectStarterPromptChip}
            </div>
          </div>
        )}
        {!showFeedbackChooser && showShortWelcome && messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-500">{shortWelcome}</p>
            {projectStarterPromptChip}
          </div>
        )}
        {!showFeedbackChooser && historyLoaded && !showOnboarding && !showShortWelcome && messages.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-500">
              {feedbackCategory
                ? 'Tell Ember about it below.'
                : projectId
                  ? productMode === 'builder'
                    ? `Ask about a customer's workstream, your saved notes, or what you're trying to help them accomplish.`
                    : `Ask about ${projectContext?.name ?? 'this project'}'s own knowledge first, or general platform guidance.`
                  : productMode === 'builder'
                    ? 'What are you trying to help this customer accomplish? Or ask me to start a new workstream.'
                    : 'Ask about the platform, search the Wiki, or ask me to create a project or workstream.'}
            </p>
            {projectStarterPromptChip}
          </div>
        )}
        {!showFeedbackChooser && messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} id={`chat-message-${i}`} tabIndex={-1} className="text-right text-sm outline-none">
              <span className="inline-block max-w-[85%] whitespace-pre-wrap rounded bg-zinc-900 px-2 py-1 text-white">{m.content}</span>
            </div>
          ) : (
            <div key={i} id={`chat-message-${i}`} tabIndex={-1} className="text-sm outline-none">
              <div className="inline-block max-w-[95%] rounded bg-zinc-100 px-2 py-1">
                <QuickSummary quickSummary={m.structured?.quickSummary} message={m.content} />
                <Markdown text={m.structured?.message ?? m.content} />
                <RequirementsList requirements={m.structured?.requirements} />
                <LinksList links={m.structured?.links} />
                <DocumentsList documents={m.structured?.documents} />
                <CitationsList citations={m.structured?.citations} />
                <KnowledgeUsedSummary citations={m.structured?.citations} />
                <NextStepsList nextSteps={m.structured?.nextSteps} />
                <SuggestedPrompts prompts={m.structured?.suggestedPrompts} onSelect={setInput} />
              </div>
              {m.pendingGatewayInvocations?.map((inv) => <GatewayInvocationCard key={inv.invocationId} invocation={inv} />)}
              {m.providerDisplayName && (
              <div className="mt-0.5">
                <button
                  type="button"
                  onClick={() => setDetailsOpenFor(detailsOpenFor === i ? null : i)}
                  className="text-xs text-zinc-400 underline hover:text-zinc-600"
                >
                  Details
                </button>
                {detailsOpenFor === i && (
                  <div className="mt-1 rounded border border-zinc-200 bg-zinc-50 p-2 text-left text-xs text-zinc-500">
                    <p>
                      Generated by: {m.providerDisplayName} / {m.modelDisplayName}
                    </p>
                    <p>Workbench tools used: {m.toolsUsed && m.toolsUsed.length > 0 ? m.toolsUsed.join(', ') : 'none'}</p>
                    {m.embeddingModelDisplayName && (
                      <>
                        <p>
                          Knowledge retrieval:{' '}
                          {m.toolsUsed?.includes('search_project_knowledge') ? 'This project + Platform Wiki' : 'Platform Wiki'}
                        </p>
                        <p>Embedding model: {m.embeddingModelDisplayName}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          )
        )}
        {isPending && !staleRun && (
          <p className="text-sm text-zinc-400">
            {resumedPendingConversationId
              ? 'Picking up where this conversation left off…'
              : activity ?? (conversationId ? 'Working…' : 'Thinking…')}
          </p>
        )}
        {isPending && staleRun && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-zinc-400">This is taking longer than expected.</p>
            {conversationId && (
              <button
                type="button"
                onClick={recoverStuckTurn}
                className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50"
              >
                Refresh conversation
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-red-600">{error}</p>
            {lastFailedMessage && (
              <button
                type="button"
                onClick={retry}
                disabled={isPending}
                className="shrink-0 rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-zinc-200 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={feedbackCategory ? 'Describe it…' : 'Ask Ember…'}
          disabled={isPending || showFeedbackChooser}
          className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
        />
        <button
          disabled={isPending || showFeedbackChooser || !input.trim()}
          className="rounded bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

// The single persistent Ember entry point for every role, floating
// bottom-right on every authenticated page. Owns `open` (bubble vs panel)
// and `selectedProjectId` (which project Ember is bound to) -- both live
// here, never in ChatSession, specifically so switching projects mid-chat
// cannot also silently collapse the panel back to a bubble, and so
// closing/reopening the bubble doesn't reset which project was selected.
//
// selectedProjectId is auto-picked ONCE, from the page you opened this from
// (if that page is a project you're a member of), and never re-synced after
// that -- see detectProjectIdFromPath. Navigating to a different project's
// page mid-chat is often just checking/copying something before going back
// to what you were actually working on; ChatSession's scope-mismatch nudge
// (passed currentPageProjectId, recomputed live below) is what surfaces
// that mismatch instead, with an explicit Switch action -- never automatic.
//
// Self-suppressed on the member/consultant Ember-first home (EmberHome.tsx,
// rendered at /dashboard, or /dashboard?view=ember for a curator/admin
// deliberately trying that experience) -- that page already shows a full,
// non-floating ChatSession, so this bubble would just be a second,
// redundant Ember on the one page whose entire purpose is being Ember.
export function ChatPanel({
  projects,
  role,
  productMode = 'enterprise',
}: {
  projects: MemberProjectOption[]
  role: string
  productMode?: 'enterprise' | 'builder'
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => detectProjectIdFromPath(pathname, projects))

  const isEmberFirstHome = pathname === '/dashboard' && (role === 'member' || role === 'consultant' || searchParams.get('view') === 'ember')
  if (isEmberFirstHome) return null

  const currentPageProjectId = detectProjectIdFromPath(pathname, projects)

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <ChatSession
          key={selectedProjectId ?? 'general'}
          projectId={selectedProjectId}
          projects={projects}
          onSelectProject={setSelectedProjectId}
          currentPageProjectId={currentPageProjectId}
          onClose={() => setOpen(false)}
          productMode={productMode}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Ask Ember"
          aria-label="Ask Ember"
          className="block h-14 w-14 overflow-hidden rounded-full shadow-lg transition-transform hover:scale-105"
        >
          <Image src="/images/ember-icon.png" alt="" width={56} height={56} priority className="h-full w-full object-cover" />
        </button>
      )}
    </div>
  )
}
