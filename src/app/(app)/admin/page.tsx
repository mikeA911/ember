import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { KBManagement } from '@/components/admin/KBManagement'
import { CurationQueueManager } from '@/components/admin/CurationQueueManager'
import { UserManagement } from '@/components/admin/UserManagement'
import { AIProvidersList } from '@/components/admin/AIProvidersList'
import { ModelAssignmentsSummary } from '@/components/admin/ModelAssignmentsSummary'
import { PendingApprovals } from '@/components/admin/PendingApprovals'
import { AdminTabs } from '@/components/admin/AdminTabs'
import { listProviders, listModels, listChatCapableModels, listStructuredOutputCapableModels, listEmbeddingCapableModels, toRoleOption } from '@/lib/ai'
import { env } from '@/lib/env'
import { SectionHero } from '@/components/SectionHero'
import { UnpublishedWikiWidget } from '@/components/wiki/UnpublishedWikiWidget'
import { listUnpublishedArticles } from '@/lib/wiki/queries'
import { BrandingSettings } from '@/components/admin/BrandingSettings'
import { getBrandingUrls } from '@/lib/branding'
import { BlogPostsList } from '@/components/admin/BlogPostsList'
import { listAllPosts } from '@/lib/blog/posts'
import { WorkstreamPromotionsReview } from '@/components/projects/WorkstreamPromotionsReview'
import { listPendingWorkstreamPromotions } from '@/lib/workbench/workstream-promotions'
import { BuilderOperationsReview } from '@/components/admin/BuilderOperationsReview'
import { listBuilderOperationsRows } from '@/lib/workbench/builder-progress-updates'
import { MethodsReview } from '@/components/admin/MethodsReview'
import { listPendingMethods } from '@/lib/workbench/methods'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const [
    { data: knowledgeBases },
    { data: queue },
    { data: profiles },
    { data: pendingDocs },
    { data: allDocuments },
    aiProviders,
    aiModels,
    unpublishedWikiArticles,
    brandingUrls,
    conversationalOptions,
    structuredOutputOptions,
    blogPosts,
    embeddingOptions,
  ] = await Promise.all([
    supabase.from('knowledge_bases').select('*').order('name'),
    supabase.from('curation_queue').select('*').order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('email'),
    supabase.from('documents').select('*').eq('processing_status', 'submitted').order('upload_date'),
    supabase.from('documents').select('*').order('upload_date', { ascending: false }),
    listProviders(supabase),
    listModels(supabase),
    listUnpublishedArticles(supabase),
    getBrandingUrls(supabase),
    listChatCapableModels(supabase),
    listStructuredOutputCapableModels(supabase),
    listAllPosts(supabase),
    listEmbeddingCapableModels(supabase),
  ])

  // Workstream Promotion works the same in either deployment mode (a
  // Builder's solo Project or an ordinary Enterprise team Project) -- this
  // is the platform-wide overview; an ordinary team's own curator instead
  // reviews from their Project's own page, needing no /admin access.
  // listPendingWorkstreamPromotions only ever touches ctx.supabase, so this
  // profile/user pair (already validated admin above) is a valid
  // WorkbenchCallerContext for it.
  const callerCtx = { user, profile, supabase } as unknown as WorkbenchCallerContext
  const pendingWorkstreamPromotions = await listPendingWorkstreamPromotions(callerCtx)
  const pendingMethods = await listPendingMethods(callerCtx)

  // Builder Operations only makes sense in a builder-mode deployment --
  // there's no "builder_lab" Project category to review in Enterprise mode.
  const isBuilderMode = env.productMode() === 'builder'
  const builderOperationsRows = isBuilderMode ? await listBuilderOperationsRows(callerCtx) : []

  // Checked server-side only -- reports Configured/Missing, never the value.
  const configuredByProvider = Object.fromEntries(aiProviders.map((p) => [p.id, Boolean(env.byName(p.api_key_env_var))]))

  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email ?? p.id]))
  const activeKnowledgeBases = (knowledgeBases ?? []).filter(
    (kb) => kb.lifecycle_status !== 'reference' && kb.lifecycle_status !== 'archived'
  )

  const currentConversationalModel = aiModels.find((m) => m.model_type === 'generation' && m.is_default)
  const currentStructuredOutputModel = aiModels.find((m) => m.is_default_structured_output)
  const currentEmbeddingModel = aiModels.find((m) => m.model_type === 'embedding' && m.is_default)

  return (
    <div className="flex flex-col gap-6">
      <SectionHero image="/images/sections/admin.png" height="compact" priority />

      <h1 className="text-xl font-semibold">Administration</h1>

      <AdminTabs
        tabs={[
          { id: 'approvals', label: 'Document sign-off', content: <PendingApprovals documents={pendingDocs ?? []} /> },
          { id: 'users', label: 'Users', content: <UserManagement profiles={profiles ?? []} knowledgeBases={activeKnowledgeBases} /> },
          { id: 'kbs', label: 'Knowledge Bases', content: <KBManagement knowledgeBases={knowledgeBases ?? []} documents={allDocuments ?? []} /> },
          {
            id: 'queue',
            label: 'Curation Queue',
            content: <CurationQueueManager queue={queue ?? []} knowledgeBases={activeKnowledgeBases} />,
          },
          {
            id: 'ai',
            label: 'AI Config',
            content: (
              <div className="flex flex-col gap-4">
                <ModelAssignmentsSummary
                  conversational={{
                    current: currentConversationalModel ? toRoleOption(currentConversationalModel, aiProviders) : null,
                    options: conversationalOptions,
                  }}
                  structuredOutput={{
                    current: currentStructuredOutputModel ? toRoleOption(currentStructuredOutputModel, aiProviders) : null,
                    options: structuredOutputOptions,
                  }}
                  embedding={{
                    current: currentEmbeddingModel ? toRoleOption(currentEmbeddingModel, aiProviders) : null,
                    options: embeddingOptions,
                  }}
                />
                <AIProvidersList providers={aiProviders} models={aiModels} configuredByProvider={configuredByProvider} />
              </div>
            ),
          },
          { id: 'branding', label: 'Branding', content: <BrandingSettings current={brandingUrls} /> },
          { id: 'blog', label: 'Blog', content: <BlogPostsList posts={blogPosts} emailById={emailById} /> },
          {
            id: 'promotions',
            label: 'Workstream Promotions',
            content: <WorkstreamPromotionsReview promotions={pendingWorkstreamPromotions} />,
          },
          { id: 'methods', label: 'Methods', content: <MethodsReview methods={pendingMethods} /> },
          ...(isBuilderMode
            ? [
                {
                  id: 'builder-operations',
                  label: 'Builder Operations',
                  content: <BuilderOperationsReview rows={builderOperationsRows} />,
                },
              ]
            : []),
        ]}
      />

      <UnpublishedWikiWidget articles={unpublishedWikiArticles} />
    </div>
  )
}
