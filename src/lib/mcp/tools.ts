import 'server-only'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { listProjectNotes } from '@/lib/projects/notes'
import { setProjectInformationSensitivity } from '@/lib/projects/evidence-access'
import * as workbenchProjects from '@/lib/workbench/projects'
import * as workbenchWorkstreams from '@/lib/workbench/workstreams'
import { createManualDraftArticle, WikiValidationError } from '@/lib/wiki/articles'
import { linkRelatedArticle } from '@/lib/wiki/relations'
import { getActiveEmbeddingProvider } from '@/lib/ai'
import { listDiscoverableProjects } from '@/lib/projects/directory'
import { requestProjectJoin } from '@/lib/projects/join-requests'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { Database, InformationSensitivity } from '@/types/database'

// M5F Phase D: the internal MCP tool contract. Each tool wraps an existing,
// already-permission-checked service function -- this module never adds a
// role/membership check of its own (per the design note's core principle:
// one authorization model, enforced once, in src/lib/workbench/* /
// src/lib/{curator,wiki,projects}/*, not duplicated here). Transport-
// independent: callTool is called directly in-process by Phase E's future
// Assistant; nothing here assumes an MCP SDK transport exists.

const ArtifactTypeSchema = z.enum([
  'capability_inventory',
  'endpoint_inventory',
  'openapi_spec',
  'mcp_server',
  'evidence_map',
  'test_results',
  'findings',
  'design_note',
  'implementation_handoff',
  'research_dossier',
  'other',
])

const ProjectTypeSchema = z.enum(['learning', 'experiment', 'consulting', 'transformation', 'knowledge'])

// create_wiki_draft is restricted to these two categories -- not the general
// AI-engineering reference taxonomy (foundations/knowledge_engineering/etc),
// which is curator-curated conceptual content with its own editorial
// standards, not something a chat-generated draft should land in
// unsupervised. platform_handbook (Workbench Methods) and product_handbook
// (product knowledge/release notes) are exactly the categories this session
// already established as "AI/curator co-authored content flowing through
// the normal draft -> review -> approve gate."
const WikiDraftCategorySchema = z.enum(['platform_handbook', 'product_handbook'])

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'article'
  )
}

// get_navigation_guide reads docs/ember/KB-SANDBOX-CAPABILITY-AND-NAVIGATION-
// CATALOGUE.md directly from disk rather than ingesting it into wiki_articles
// (per Mike, 2026-08-28). That file is owner-authored ground truth about the
// product's own navigation, already committed with the app -- routing it
// through the Wiki's draft/review/approve ceremony (built for gating
// unverified, curator-submitted content) would only add process, and
// re-seeding on every edit reintroduces the same "watch a committed file,
// auto-update knowledge" shape already rejected once today for the git-
// merge-approval pipeline. Reading the file live means editing it *is* the
// update -- no separate sync/approval step, ever. Module-scope cache is safe
// for a running process: the file only changes between deployments.
let cachedCatalogue: string | null = null

function loadNavigationCatalogue(): string {
  if (cachedCatalogue) return cachedCatalogue
  const docPath = path.join(process.cwd(), 'docs', 'ember', 'KB-SANDBOX-CAPABILITY-AND-NAVIGATION-CATALOGUE.md')
  const raw = readFileSync(docPath, 'utf8')
  // Exclude maintainer-facing sections: how Ember should format its own
  // answers (a behavioral/prompt concern, not something to cite as product
  // knowledge), and process notes ("Update checklist", "Discovery backlog").
  const stopIndex = raw.indexOf('## Ember response contract for navigation')
  cachedCatalogue = (stopIndex === -1 ? raw : raw.slice(0, stopIndex)).trim()
  return cachedCatalogue
}

interface ToolDefinition<TInput, TOutput> {
  description: string
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  handler: (ctx: WorkbenchCallerContext, input: TInput) => Promise<TOutput>
}

// Loosely typed at the map level (each entry is internally consistent, but
// TS can't express "the Nth value's input/output types match the Nth key"
// across a heterogeneous map) -- callTool is the one place that matters,
// and it's fully checked via generics at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools: Record<string, ToolDefinition<any, any>> = {
  get_navigation_guide: {
    description:
      "Look up how a user accomplishes something in Ember's own UI -- which page to start at, who is allowed to do it, and what to expect. Use this for questions about Ember's navigation, pages, or workflows (e.g. \"where do I create a project\", \"who can approve a Wiki article\", \"how do I register an external agent\"), not for domain/business knowledge -- use search_wiki for that. Optionally pass a topic keyword to narrow the result; omit it to get the full navigation map and every capability entry.",
    inputSchema: z.object({ topic: z.string().optional() }),
    outputSchema: z.object({ guide: z.string() }),
    handler: async (_ctx, input: { topic?: string }) => {
      const full = loadNavigationCatalogue()
      if (!input.topic) return { guide: full }

      const needle = input.topic.toLowerCase()
      // Split on any heading (## or ###) and keep whichever chunks mention
      // the topic anywhere in their own text -- deliberately simple
      // substring matching, not semantic search, since this is a small,
      // well-organized document a keyword should already match well against.
      const chunks = full.split(/\n(?=#{1,3} )/)
      const matched = chunks.filter((c) => c.toLowerCase().includes(needle))
      return { guide: matched.length > 0 ? matched.join('\n\n') : full }
    },
  },

  create_wiki_draft: {
    description:
      "Save a fully-composed Workbench Handbook article (a Method, or Product Handbook content) as a draft Wiki article, so the user doesn't have to copy the text out of this conversation and paste it into the Wiki UI themselves. Only usable by a curator or admin -- fails otherwise. ALWAYS creates status='draft': never approved or made retrievable by search_wiki as part of this call. Only call this once the user has confirmed the finished content is what they want saved -- do not call it on a rough draft still being discussed, and never call it more than once for the same piece of content. After saving, tell the user it's a draft awaiting their own review/approval in the Wiki UI; do not claim it is now approved knowledge.",
    inputSchema: z.object({
      title: z.string(),
      category: WikiDraftCategorySchema,
      quickHelp: z.string(),
      content: z.string(),
      shortDescription: z.string().optional(),
      relatedArticleTitles: z.array(z.string()).max(10).optional(),
    }),
    outputSchema: z.object({ articleId: z.string(), slug: z.string(), status: z.literal('draft') }),
    handler: async (
      ctx,
      input: {
        title: string
        category: z.infer<typeof WikiDraftCategorySchema>
        quickHelp: string
        content: string
        shortDescription?: string
        relatedArticleTitles?: string[]
      }
    ) => {
      const baseSlug = slugifyTitle(input.title)
      let slug = baseSlug
      let article
      try {
        ;({ article } = await createManualDraftArticle(ctx.supabase, {
          slug,
          title: input.title,
          category: input.category,
          shortDescription: input.shortDescription ?? null,
          quickHelp: input.quickHelp,
          content: input.content,
          createdBy: ctx.user.id,
        }))
      } catch (err) {
        // Same retry-once-with-suffix convention as the curator-facing
        // "create a new knowledge base" flow (DocumentUploader.tsx) -- a
        // slug collision is expected occasionally (two similarly-titled
        // articles), not exceptional, so retry rather than surface a raw
        // Postgres unique-violation to the model/user.
        if (err instanceof WikiValidationError) {
          slug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`
          ;({ article } = await createManualDraftArticle(ctx.supabase, {
            slug,
            title: input.title,
            category: input.category,
            shortDescription: input.shortDescription ?? null,
            quickHelp: input.quickHelp,
            content: input.content,
            createdBy: ctx.user.id,
          }))
        } else {
          throw err
        }
      }

      if (input.relatedArticleTitles?.length) {
        for (const relatedTitle of input.relatedArticleTitles) {
          const { data: related } = await ctx.supabase.from('wiki_articles').select('id').eq('title', relatedTitle).maybeSingle()
          if (related) await linkRelatedArticle(ctx.supabase, article.id, related.id)
        }
      }

      return { articleId: article.id, slug: article.slug, status: 'draft' as const }
    },
  },

  search_wiki: {
    description:
      'Semantic search over approved platform Wiki articles -- finds conceptually related content, not just literal keyword matches. Returns each matched article\'s full content (including, for Workbench Handbook articles, its Requirements/Deliverables/Boundary sections), not just a title -- one search is normally enough to both find the right method and read what it requires.',
    // match_wiki_vectors has no category parameter (confirmed) -- dropped
    // here rather than silently ignored if a caller tried to pass one.
    inputSchema: z.object({ query: z.string(), limit: z.number().int().min(1).max(10).default(5) }),
    outputSchema: z.object({
      articles: z.array(
        z.object({
          articleId: z.string(),
          slug: z.string(),
          title: z.string(),
          category: z.string().nullable(),
          similarity: z.number(),
          content: z.string(),
        })
      ),
    }),
    handler: async (ctx, input: { query: string; limit: number }) => {
      const embeddingProvider = await getActiveEmbeddingProvider(ctx.supabase, { task: 'mcp_search', requestedBy: ctx.user.id })
      const { embedding } = await embeddingProvider.embed({ text: input.query })
      const { data, error } = await ctx.supabase.rpc('match_wiki_vectors', {
        query_embedding: embedding,
        match_threshold: 0,
        match_count: input.limit,
      })
      if (error) throw error
      type Row = Database['public']['Functions']['match_wiki_vectors']['Returns'][number]
      const rows: Row[] = data ?? []

      // match_wiki_vectors doesn't carry category -- one follow-up query
      // against wiki_articles rather than widening a shared RPC also used
      // by src/lib/eval/retrieval.ts.
      const articleIds = [...new Set(rows.map((m) => m.wiki_article_id))]
      const { data: articleRows } = articleIds.length
        ? await ctx.supabase.from('wiki_articles').select('id, category').in('id', articleIds)
        : { data: [] as { id: string; category: string }[] }
      const categoryById = new Map((articleRows ?? []).map((a) => [a.id, a.category]))

      // Capped, not truncated to nothing -- bounds worst-case context size
      // if a future Handbook article is unusually long, while every current
      // article (a few hundred words) comes through whole.
      const MAX_CONTENT_CHARS = 4000
      return {
        articles: rows.map((m) => ({
          articleId: m.wiki_article_id,
          slug: m.article_slug,
          title: m.article_title,
          category: categoryById.get(m.wiki_article_id) ?? null,
          similarity: m.similarity,
          content: m.content.length > MAX_CONTENT_CHARS ? `${m.content.slice(0, MAX_CONTENT_CHARS)}…` : m.content,
        })),
      }
    },
  },

  list_project_notes: {
    description: "List a project's notes, optionally filtered to open or resolved.",
    inputSchema: z.object({ projectId: z.string(), status: z.enum(['open', 'resolved']).optional() }),
    outputSchema: z.object({
      notes: z.array(
        z.object({
          id: z.string(),
          subject: z.string(),
          body: z.string(),
          authorEmail: z.string().nullable(),
          status: z.string(),
          createdAt: z.string(),
        })
      ),
    }),
    handler: async (ctx, input: { projectId: string; status?: 'open' | 'resolved' }) => {
      const notes = await listProjectNotes(ctx.supabase, input.projectId, { status: input.status })
      return {
        notes: notes.map((n) => ({
          id: n.id,
          subject: n.subject,
          body: n.body,
          authorEmail: n.author?.email ?? null,
          status: n.status,
          createdAt: n.created_at,
        })),
      }
    },
  },

  search_projects: {
    description:
      'Search existing projects by name (e.g. a company, client, or workspace name) -- use this BEFORE proposing to create a new project, so you reuse or reference existing work instead of creating a duplicate. Returns id, name, project type, status, and objective for each match; does not return project content, membership, or evidence.',
    inputSchema: z.object({ query: z.string(), limit: z.number().int().min(1).max(20).default(10) }),
    outputSchema: z.object({
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          projectType: z.string(),
          status: z.string(),
          objective: z.string().nullable(),
        })
      ),
    }),
    handler: async (ctx, input: { query: string; limit: number }) => {
      const results = await workbenchProjects.searchProjects(ctx, input.query, input.limit)
      return { projects: results }
    },
  },

  list_discoverable_projects: {
    description:
      "List Projects the user isn't necessarily a member of but is allowed to know exist -- name, type, objective, status, owner, and whether the user is already a member or has a pending join request. Never returns Project content, membership lists, or evidence. Use this when a user asks to find a Project, or what Projects exist, that search_projects (their own memberships only) doesn't already cover.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          projectType: z.string(),
          objective: z.string().nullable(),
          status: z.string(),
          ownerEmail: z.string().nullable(),
          isOrganizationHome: z.boolean(),
          viewerIsMember: z.boolean(),
          viewerHasPendingJoinRequest: z.boolean(),
        })
      ),
    }),
    handler: async (ctx) => {
      const projects = await listDiscoverableProjects(ctx)
      return { projects }
    },
  },

  request_project_membership: {
    description:
      "File a request to join a discoverable Project the user is not yet a member of. Does NOT grant access immediately -- the Project's owner or curator must approve it. Only usable on a Project returned by list_discoverable_projects with viewerIsMember false; fails for a Project the user can't already see. Tell the user their request is pending, never that they've joined.",
    inputSchema: z.object({ projectId: z.string(), reason: z.string().optional() }),
    outputSchema: z.object({ requestId: z.string(), alreadyRequested: z.boolean() }),
    handler: async (ctx, input: { projectId: string; reason?: string }) => {
      return requestProjectJoin(ctx, input)
    },
  },

  classify_project: {
    description:
      'Set the AI-processing information-sensitivity tier for a project (public/internal/confidential/restricted) -- controls which AI provider ceilings may process this project\'s evidence and its own name/goal. This is a SEPARATE axis from human access: it does not restrict membership and does not invite or remove anyone. Only usable by the project\'s owner or a platform admin -- fails otherwise. Only call this after the user has explicitly asked for a project to be treated as sensitive, never speculatively -- and never describe a project as "restricted", "secured", or "isolated" in your reply unless this call just succeeded this same turn.',
    inputSchema: z.object({
      projectId: z.string(),
      sensitivity: z.enum(['public', 'internal', 'confidential', 'restricted']),
    }),
    outputSchema: z.object({ classified: z.literal(true), sensitivity: z.string() }),
    handler: async (ctx, input: { projectId: string; sensitivity: InformationSensitivity }) => {
      await setProjectInformationSensitivity(ctx, input.projectId, input.sensitivity)
      return { classified: true as const, sensitivity: input.sensitivity }
    },
  },

  create_project: {
    description: 'Create a new draft project.',
    inputSchema: z.object({
      name: z.string(),
      projectType: ProjectTypeSchema,
      objective: z.string(),
      details: z.record(z.string(), z.string()).default({}),
    }),
    outputSchema: z.object({ projectId: z.string() }),
    handler: async (
      ctx,
      input: { name: string; projectType: z.infer<typeof ProjectTypeSchema>; objective: string; details: Record<string, string> }
    ) => {
      const result = await workbenchProjects.createProject(ctx, {
        name: input.name,
        projectType: input.projectType,
        objective: input.objective,
        details: input.details,
        knowledgeBaseId: null,
        evalDatasetId: null,
        members: [],
      })
      return { projectId: result.projectId }
    },
  },

  approve_project: {
    description: 'Approve a draft project (moves it to completed). Requires curator or admin.',
    inputSchema: z.object({ projectId: z.string() }),
    outputSchema: z.object({ approved: z.literal(true) }),
    handler: async (ctx, input: { projectId: string }) => {
      await workbenchProjects.approveProject(ctx, input.projectId)
      return { approved: true as const }
    },
  },

  create_workstream: {
    description:
      "Create a new workstream on a project. Only usable by that project's owner or curator, or a platform admin -- fails otherwise for an ordinary project member (e.g. a consultant). If you don't know the caller's project role, ask or check with list_project_members before presenting this as a ready action -- don't offer to create a workstream and let the user discover the permission failure themselves. In a project-bound conversation, projectId is automatically corrected to the current project regardless of what you pass -- you don't need to know the real id there, but do supply the real project id from search_projects/create_project's own result when this is a general (non-project-bound) conversation.",
    inputSchema: z.object({
      projectId: z.string(),
      name: z.string(),
      slug: z.string(),
      goal: z.string().optional(),
      guardrail: z.string().optional(),
      deliverables: z.array(z.string()).default([]),
    }),
    outputSchema: z.object({ workstreamId: z.string() }),
    handler: async (
      ctx,
      input: { projectId: string; name: string; slug: string; goal?: string; guardrail?: string; deliverables: string[] }
    ) => {
      const result = await workbenchWorkstreams.createWorkstream(ctx, {
        projectId: input.projectId,
        name: input.name,
        slug: input.slug,
        repositoryScope: [],
        goal: input.goal,
        guardrail: input.guardrail,
        deliverables: input.deliverables,
      })
      return { workstreamId: result.workstreamId }
    },
  },

  attach_workstream_artifact: {
    description:
      "Attach an artifact (evidence) to a workstream. workstreamId must be a real workstream id -- if you're in a project-bound conversation and don't already know it, call list_workstreams first rather than guessing one from a display name (a name/slug is not a valid id and the call will fail). Saving the row always succeeds if the call itself succeeds, but that is NOT the same as the artifact being complete or correct -- check the returned status. For artifactType 'openapi_spec', the content is automatically checked for required sections (openapi/info/paths/responses) and status will be 'validation_failed' (with validationNotes listing exactly what's missing) or 'ready_for_review'. Every other artifact type has no automated check yet and is always 'ready_for_review'. Never tell the user the artifact was 'successfully attached' as if that means it's done -- report the actual status, and if it's 'validation_failed', relay the specific validationNotes so they know what to fix.",
    inputSchema: z.object({
      workstreamId: z.string(),
      artifactType: ArtifactTypeSchema,
      title: z.string(),
      externalTool: z.string().optional(),
      content: z.string().optional(),
      externalUrl: z.string().optional(),
      notes: z.string().optional(),
    }),
    outputSchema: z.object({
      attached: z.literal(true),
      artifactId: z.string(),
      status: z.enum(['draft', 'validation_failed', 'ready_for_review', 'approved', 'rejected']),
      validationNotes: z.array(z.string()),
    }),
    handler: async (
      ctx,
      input: {
        workstreamId: string
        artifactType: z.infer<typeof ArtifactTypeSchema>
        title: string
        externalTool?: string
        content?: string
        externalUrl?: string
        notes?: string
      }
    ) => {
      const result = await workbenchWorkstreams.attachArtifact(ctx, input)
      return { attached: true as const, artifactId: result.artifactId, status: result.status, validationNotes: result.validationNotes }
    },
  },
}

export async function callTool(ctx: WorkbenchCallerContext, name: string, rawInput: unknown): Promise<unknown> {
  const tool = tools[name]
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  const input = tool.inputSchema.parse(rawInput)
  const output = await tool.handler(ctx, input)
  return tool.outputSchema.parse(output)
}

export function listTools(): { name: string; description: string }[] {
  return Object.entries(tools).map(([name, t]) => ({ name, description: t.description }))
}

// What generateChat's `tools` param is built from -- z.toJSONSchema turns
// each tool's zod input schema into the JSON Schema shape both Gemini's
// parametersJsonSchema and OpenAI's function.parameters expect.
export function getToolSpecs(): { name: string; description: string; parameters: unknown }[] {
  return Object.entries(tools).map(([name, t]) => ({ name, description: t.description, parameters: z.toJSONSchema(t.inputSchema) }))
}
