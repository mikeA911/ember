import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listProviders, listModels, listChatCapableModels, listStructuredOutputCapableModels, listEmbeddingCapableModels, toRoleOption } from '@/lib/ai'
import { env } from '@/lib/env'
import { ProviderDetail } from '@/components/admin/ProviderDetail'
import { ModelAssignmentsSummary } from '@/components/admin/ModelAssignmentsSummary'

export default async function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const { data: provider } = await supabase.from('ai_providers').select('*').eq('id', id).single()
  if (!provider) notFound()

  // The summary needs the cross-provider picture (per docs/dev-request-ai-model-role-clarity.md
  // §1: "must show assignments across all providers, even when viewing one
  // provider's detail page"), so this fetches everything rather than just
  // this provider's own models.
  const [models, allProviders, allModels, conversationalOptions, structuredOutputOptions, sensitivityEligibility, embeddingOptions] = await Promise.all([
    listModels(supabase, { providerId: id }),
    listProviders(supabase),
    listModels(supabase),
    listChatCapableModels(supabase),
    listStructuredOutputCapableModels(supabase),
    supabase.from('ai_provider_sensitivity_eligibility').select('max_sensitivity').eq('provider_id', id).maybeSingle(),
    listEmbeddingCapableModels(supabase),
  ])
  const configured = Boolean(env.byName(provider.api_key_env_var))

  const currentConversationalModel = allModels.find((m) => m.model_type === 'generation' && m.is_default)
  const currentStructuredOutputModel = allModels.find((m) => m.is_default_structured_output)
  const currentConversational = currentConversationalModel ? toRoleOption(currentConversationalModel, allProviders) : null
  const currentStructuredOutput = currentStructuredOutputModel ? toRoleOption(currentStructuredOutputModel, allProviders) : null
  const currentEmbeddingModel = allModels.find((m) => m.model_type === 'embedding' && m.is_default)
  const currentEmbedding = currentEmbeddingModel ? toRoleOption(currentEmbeddingModel, allProviders) : null

  return (
    <div className="flex flex-col gap-6">
      <ModelAssignmentsSummary
        conversational={{ current: currentConversational, options: conversationalOptions }}
        structuredOutput={{ current: currentStructuredOutput, options: structuredOutputOptions }}
        embedding={{ current: currentEmbedding, options: embeddingOptions }}
      />
      <ProviderDetail
        provider={provider}
        models={models}
        configured={configured}
        currentConversational={currentConversational}
        currentStructuredOutput={currentStructuredOutput}
        maxSensitivity={sensitivityEligibility.data?.max_sensitivity ?? null}
      />
    </div>
  )
}
