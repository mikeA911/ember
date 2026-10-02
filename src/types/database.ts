// Mirrors supabase/migrations/*.sql. Keep in sync by hand until this project
// generates types via `supabase gen types` against the live project.

// 'member' (OL-007): least-privileged authenticated role, below 'consultant'
// -- an ordinary employee who uses Ember within their own Projects but
// can't create Projects, self-register Builder integrations, or curate
// anything. See supabase/migrations/20260831120001_member_role.sql.
export type UserRole = 'anonymous' | 'member' | 'consultant' | 'curator' | 'admin'
export type DocType = string
export type KnowledgeBaseClassification = 'platform' | 'legacy_sample' | 'project' | 'partner_pilot'
export type KnowledgeBaseLifecycleStatus = 'active' | 'reference' | 'archived'
// Orthogonal to lifecycle_status (a retention concept) -- this is the
// curator-creates/admin-approves review state. See
// supabase/migrations/20260828120001_knowledge_base_curator_review.sql.
export type KnowledgeBaseStatus = 'pending' | 'approved' | 'rejected'

export type ProcessingStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'review'
  | 'submitted'
  | 'completed'
  | 'failed'

export type ProcessingStage = 'upload' | 'parse' | 'chunk' | 'enrich' | 'embed' | 'review' | 'completed'

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'filtered' | 'enriching' | 'draft' | 'failed'

export type Parser = 'pdf' | 'docx' | 'text'

export interface ProcessingError {
  stage: ProcessingStage
  code: string
  message: string
  detail?: string
  occurred_at: string
  retryable: boolean
}

export interface EnrichmentError {
  code: string
  message: string
  occurred_at: string
}

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  role: UserRole
  is_active: boolean
  assigned_kbs: string[]
  created_at: string
  updated_at: string
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string | null
  project_id: string | null
  classification: KnowledgeBaseClassification
  lifecycle_status: KnowledgeBaseLifecycleStatus
  status: KnowledgeBaseStatus
  origin: string | null
  // Same convention/values as WikiVisibilityScope -- added to the DB in
  // 20260824180001_project_knowledge_visibility_retrieval_fix.sql but missed
  // in this hand-maintained interface until now.
  visibility_scope: WikiVisibilityScope
  created_at: string
  updated_at: string
}

export interface CurationQueueItem {
  id: string
  kb_id: string
  title: string
  url: string
  status: 'pending' | 'in_progress' | 'completed'
  added_by: string | null
  created_at: string
}

export interface DocumentMetadata {
  filters_applied?: string[]
  processed_at?: string
  processing_duration_ms?: number
  [key: string]: unknown
}

export interface Document {
  id: string
  filename: string
  original_filename: string
  doc_type: DocType
  storage_path: string
  file_size: number | null
  mime_type: string | null
  source_url: string | null
  upload_date: string
  uploaded_by: string | null
  processing_status: ProcessingStatus
  processing_stage: ProcessingStage | null
  processing_error: ProcessingError | null
  total_chunks: number | null
  approved_chunks: number
  rejected_chunks: number
  metadata: DocumentMetadata
  // Versioned Knowledge Source Documents, Stage 1 (docs/dev-request-versioned-
  // knowledge-source-documents.md): documents is the immutable version table.
  // knowledge_source_id is required -- every document belongs to exactly one
  // logical source.
  knowledge_source_id: string
  version_number: number
  change_note: string | null
  superseded_at: string | null
  retired_at: string | null
  created_at: string
  updated_at: string
}

export type KnowledgeSourceLifecycleStatus = 'active' | 'retired'

// The stable logical-source identity a document's versions belong to --
// mirrors wiki_articles/wiki_versions' current_version_id pattern exactly,
// applied to source documents instead of Wiki content.
export interface KnowledgeSource {
  id: string
  knowledge_base_id: string
  title: string
  source_url: string | null
  publisher: string | null
  current_version_id: string | null
  lifecycle_status: KnowledgeSourceLifecycleStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ChunkAIMetadata {
  topic?: string
  subtopic?: string
  relevance_score?: number
  use_cases?: string[]
  key_concepts?: string[]
  confidence?: number
  reasoning?: string
}

export interface DocumentChunk {
  id: string
  document_id: string
  chunk_index: number
  chunk_text: string
  chunk_size: number | null
  source_page: number | null
  source_section: string | null
  parser: Parser
  char_start: number | null
  char_end: number | null
  ai_metadata: ChunkAIMetadata | null
  confidence_score: number | null
  review_status: ReviewStatus
  enrichment_error: EnrichmentError | null
  curator_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  is_filtered: boolean
  filtered_reason: string | null
  metadata_edited: boolean
  metadata_edited_by: string | null
  metadata_edited_at: string | null
  created_at: string
}

export interface KBVector {
  id: string
  chunk_id: string
  document_id: string
  content: string
  embedding?: number[]
  embedding_model: string
  embedding_dim: number
  doc_type: DocType
  topic: string | null
  subtopic: string | null
  use_cases: string[] | null
  key_concepts: string[] | null
  relevance_score: number | null
  curator_notes: string | null
  source_document: string | null
  source_page: number | null
  source_url: string | null
  domain: string | null
  curator_name: string | null
  tags: string[] | null
  chunk_index: number | null
  word_count: number | null
  approved_date: string
  approved_by: string | null
  last_updated: string | null
}

export interface Setting<T = unknown> {
  key: string
  value: T
  updated_at: string
  updated_by: string | null
}

export type AIOperationName = 'generate_text' | 'generate_structured' | 'embed'

export interface AIOperationLog {
  id: string
  created_at: string
  operation: AIOperationName
  provider: string
  model: string
  document_id: string | null
  chunk_id: string | null
  requested_by: string | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  success: boolean
  error_message: string | null
  // The already-computed classification (rate_limit / quota_exceeded /
  // model_unavailable / authentication / invalid_request / unknown -- see
  // classifyProviderError in src/lib/ai/provider.ts), stored alongside the
  // free-text error_message so a failure category can be queried directly.
  error_code: string | null
  eval_run_id: string | null
  eval_case_id: string | null
  graph_run_id: string | null
  graph_step_id: string | null
  // Builder AI Usage Metering (src/lib/ai/metering.ts). project_id attributes
  // a call to a builder's own builder_lab Project; estimated_cost_usd is
  // null when pricing isn't configured for that model (never a fabricated
  // 0); is_byo_llm marks a call made through a builder's own supplied
  // credential (src/lib/workbench/builder-llm-credentials.ts), which is
  // never priced or counted against the platform's own allowance.
  project_id: string | null
  estimated_cost_usd: number | null
  is_byo_llm: boolean
  // Builder Ontology, Part C: runtime evidence that this call was made
  // while executing an instantiated Method -- foundational column for a
  // deferred design-time integration (see methods.ts's own header comment),
  // nothing populates it in this pass.
  applied_method_id: string | null
}

export interface ChunkForReview extends DocumentChunk {
  document?: {
    filename: string
    doc_type: DocType
  }
}

// ============================================
// Wiki
// ============================================

export type WikiCategoryId =
  | 'foundations'
  | 'knowledge_engineering'
  | 'agent_engineering'
  | 'reliability'
  | 'governance'
  | 'improvement'
  | 'platform_handbook'
  | 'product_handbook'

export type WikiArticleStatus = 'draft' | 'review' | 'approved' | 'archived'
export type WikiVerificationStatus = 'unverified' | 'verified' | 'needs_review'
export type WikiGeneratedBy = 'human' | 'ai_assisted'
export type WikiSourceType = 'document' | 'chunk' | 'external' | 'workstream_artifact'
// Project-Aware Knowledge and Assistant Context, Stage 1 (docs/dev-request-
// project-aware-knowledge-and-assistant-context.md). Visibility and
// approval are separate dimensions -- an approved article can still be
// project_private. 'organization' is deliberately not offered: this schema
// has no organizations/tenant table to enforce that boundary against yet.
export type WikiVisibilityScope = 'project_private' | 'selected_projects' | 'platform' | 'public'

export interface WikiCategory {
  id: WikiCategoryId
  name: string
  sort_order: number
  created_at: string
}

export interface WikiArticle {
  id: string
  knowledge_base_id: string | null
  slug: string
  title: string
  category: WikiCategoryId
  short_description: string | null
  current_version_id: string | null
  status: WikiArticleStatus
  // Separate from status='approved' -- approved means "trusted canonical
  // knowledge", public means "safe for anonymous disclosure". Set only via
  // setArticlePublicAction (admin-only).
  is_public: boolean
  // Separate again from both status and is_public -- see WikiVisibilityScope.
  // Defaults to 'platform', matching every article's behavior before this
  // column existed.
  visibility_scope: WikiVisibilityScope
  created_by: string | null
  created_at: string
  updated_at: string
}

// A project association -- the allow-list for project_private/
// selected_projects articles, and also how a platform-visibility article
// gets explicitly associated with a project's Knowledge display without
// copying it.
export interface ProjectWikiArticle {
  id: string
  project_id: string
  wiki_article_id: string
  relationship: string | null
  attached_by: string | null
  attached_at: string
}

// Many-to-many: the same knowledge base may serve more than one authorized
// project (e.g. a shared Zadara/Sandz KB across two client engagements).
// Supersedes knowledge_bases.project_id, which is one-to-one and left in
// place but no longer read or written by Stage 1 code.
export interface ProjectKnowledgeBase {
  id: string
  project_id: string
  knowledge_base_id: string
  purpose: string | null
  attached_by: string | null
  attached_at: string
}

// Builder Ontology, Part D (docs/kbs-ontology-dev-req-3.md): a Workstream's
// own scoped KB, distinct from its Project's -- exact structural mirror of
// ProjectKnowledgeBase above. See 20260928100001_workstream_knowledge_bases.sql.
export interface WorkstreamKnowledgeBase {
  id: string
  workstream_id: string
  knowledge_base_id: string
  purpose: string | null
  attached_by: string | null
  attached_at: string
}

export interface WikiVersion {
  id: string
  wiki_article_id: string
  version_number: number
  quick_help: string
  content: string
  implementation_notes: string | null
  limitations: string | null
  verification_status: WikiVerificationStatus
  last_verified_at: string | null
  generated_by: WikiGeneratedBy
  ai_provider: string | null
  ai_model: string | null
  ai_generated_at: string | null
  source_chunk_ids: string[] | null
  created_by: string | null
  approved_by: string | null
  created_at: string
  approved_at: string | null
  // Which Trending item (if any) this version was promoted from -- see
  // trending_items / promoteTrendingToWikiAction.
  promoted_from_trending_item_id: string | null
  // Product Handbook metadata (Ember Product Knowledge Publishing Pipeline,
  // Stage 1). Nullable/optional -- only meaningful for product_handbook
  // articles, but not enforced at the schema level since a general Wiki
  // article could reasonably use them too.
  applicable_roles: string[] | null
  related_routes: string[] | null
  applicable_version: string | null
}

export interface WikiSource {
  id: string
  wiki_version_id: string
  document_id: string | null
  chunk_id: string | null
  workstream_artifact_id: string | null
  source_type: WikiSourceType
  relationship: string | null
  notes: string | null
  created_at: string
}

export interface WikiRelation {
  id: string
  from_article_id: string
  to_article_id: string
  relation_type: string
  created_at: string
}

export interface WikiVector {
  id: string
  wiki_version_id: string
  content: string
  embedding?: number[]
  embedding_model: string
  embedding_dim: number
  created_at: string
}

export interface WikiArticleWithVersion extends WikiArticle {
  current_version: WikiVersion | null
}

export interface WikiSourceWithEvidence extends WikiSource {
  document?: Pick<Document, 'id' | 'original_filename' | 'doc_type'> | null
  chunk?: Pick<DocumentChunk, 'id' | 'chunk_index' | 'source_page' | 'chunk_text'> | null
}

// ============================================
// Trending Knowledge (M5E)
// ============================================

// Deliberately not the Wiki draft/review/approved lifecycle -- Trending is
// "what are we watching?", Wiki is "what do we currently know?". See
// supabase/migrations/20260814110001_trending_knowledge.sql.
export type TrendingVisibility = 'platform' | 'project'
export type TrendingStatus = 'active' | 'under_review' | 'promoted' | 'archived'

export interface TrendingItem {
  id: string
  title: string
  source_url: string
  source_name: string | null
  description: string
  tags: string[]
  submitted_by: string | null
  project_id: string | null
  visibility: TrendingVisibility
  status: TrendingStatus
  // Separate axis from status -- see wiki_articles.is_public precedent.
  is_public: boolean
  published_at: string | null
  // Dashboard Shared Links moderation audit trail -- stamped by
  // removeSharedLinkAction, the admin-only path (stricter than the existing
  // curator-or-admin RLS, enforced in application code -- see the migration
  // comment in 20260821100001_shared_links_moderation.sql).
  archived_by: string | null
  archived_at: string | null
  moderation_reason: string | null
  // Computed by normalizeUrlForDuplicateDetection (src/lib/trending/url-safety.ts)
  // at submission time -- never the displayed/stored URL itself.
  normalized_source_url: string | null
  created_at: string
  updated_at: string
}

export type TrendingItemInsert = Omit<
  TrendingItem,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'status'
  | 'is_public'
  | 'published_at'
  | 'visibility'
  | 'tags'
  | 'archived_by'
  | 'archived_at'
  | 'moderation_reason'
  | 'normalized_source_url'
> &
  Partial<
    Pick<
      TrendingItem,
      'status' | 'is_public' | 'published_at' | 'visibility' | 'tags' | 'archived_by' | 'archived_at' | 'moderation_reason' | 'normalized_source_url'
    >
  >
export type TrendingItemUpdate = Partial<Omit<TrendingItem, 'id' | 'created_at'>>

// ============================================
// Public Blog
// ============================================
// Modeled on the Projects/Examples "just publish" pattern (visibility/
// published_at, one Publish/Unpublish toggle) rather than Wiki's
// draft/review/approved lifecycle -- see src/app/actions/projects.ts.

export type BlogPostStatus = 'draft' | 'published'

export interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  status: BlogPostStatus
  author_id: string | null
  last_editor_id: string | null
  submitted_for_review_at: string | null
  submitted_by: string | null
  published_by: string | null
  source_reference: string | null
  cover_image_path: string | null
  cover_image_alt: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export type BlogPostInsert = Omit<BlogPost, 'id' | 'created_at' | 'updated_at' | 'status' | 'published_at'> &
  Partial<Pick<BlogPost, 'status' | 'published_at'>>
export type BlogPostUpdate = Partial<Omit<BlogPost, 'id' | 'created_at'>>

export interface BlogRelation {
  id: string
  from_post_id: string
  to_post_id: string
  relation_type: string
  created_at: string
}
export type BlogRelationInsert = Omit<BlogRelation, 'id' | 'created_at' | 'relation_type'> & Partial<Pick<BlogRelation, 'relation_type'>>

export interface TrendingComment {
  id: string
  trending_item_id: string
  author_id: string | null
  body: string
  created_at: string
  updated_at: string | null
}
export type TrendingCommentInsert = Omit<TrendingComment, 'id' | 'created_at' | 'updated_at'>

export interface TrendingWikiLink {
  id: string
  trending_item_id: string
  wiki_article_id: string
  linked_by: string | null
  created_at: string
}
export type TrendingWikiLinkInsert = Omit<TrendingWikiLink, 'id' | 'created_at'>

// ============================================
// Project Notes (M5E)
// ============================================

// 'project_team' means every member; 'curator'/'admin' mean any curator/admin
// on staff, not a specific person -- see can_view_project_note in
// supabase/migrations/20260814120001_project_notes.sql.
export type ProjectNoteRecipientType = 'user' | 'project_team' | 'curator' | 'admin'
export type ProjectNoteStatus = 'open' | 'resolved'

export interface ProjectNote {
  id: string
  project_id: string
  author_id: string | null
  recipient_type: ProjectNoteRecipientType
  recipient_user_id: string | null
  subject: string
  body: string
  // Polymorphic reference to a Workbench object (eval run, document, ...) --
  // no FK constraint, resolved per-type at read time. See ProjectNotes
  // Interpretive decisions in the M5E plan.
  context_type: string | null
  context_id: string | null
  status: ProjectNoteStatus
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export type ProjectNoteInsert = Omit<
  ProjectNote,
  'id' | 'created_at' | 'status' | 'resolved_at' | 'resolved_by' | 'recipient_user_id' | 'context_type' | 'context_id'
> &
  Partial<Pick<ProjectNote, 'status' | 'resolved_at' | 'resolved_by' | 'recipient_user_id' | 'context_type' | 'context_id'>>
export type ProjectNoteUpdate = Partial<Omit<ProjectNote, 'id' | 'created_at' | 'project_id'>>

export interface ProjectNoteReply {
  id: string
  note_id: string
  author_id: string | null
  body: string
  created_at: string
}
export type ProjectNoteReplyInsert = Omit<ProjectNoteReply, 'id' | 'created_at'>

// ============================================
// Working Knowledge & Research Notebooks
// (docs/dev-request-project-scoped-working-knowledge-and-research-notebooks.md)
// ============================================

export type WorkingKnowledgeItemType = 'research_notebook' | 'working_note'
export type WorkingKnowledgeVisibility = 'private' | 'shared_selected' | 'shared_project'
// Only 'working'/'archived'/'superseded' are reachable via app logic this
// increment -- 'submitted'/'returned'/'promoted' exist as forward-compatible
// schema for the deferred Stage 3 (curation promotion).
export type WorkingKnowledgeTrustStatus = 'working' | 'submitted' | 'returned' | 'promoted' | 'superseded' | 'archived'
export type WorkingKnowledgeClaimStatus = 'unconfirmed' | 'corroborated' | 'conflicting' | 'customer_confirmed'

export interface WorkingKnowledgeItem {
  id: string
  project_id: string
  owner_id: string
  type: WorkingKnowledgeItemType
  title: string
  objective: string | null
  content: string
  visibility: WorkingKnowledgeVisibility
  trust_status: WorkingKnowledgeTrustStatus
  source_conversation_id: string | null
  source_workstream_id: string | null
  source_artifact_id: string | null
  synthesis_provider: string | null
  synthesis_model: string | null
  created_at: string
  updated_at: string
  last_used_at: string | null
  refresh_after: string | null
  archived_at: string | null
}
export type WorkingKnowledgeItemInsert = Omit<
  WorkingKnowledgeItem,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'objective'
  | 'visibility'
  | 'trust_status'
  | 'source_conversation_id'
  | 'source_workstream_id'
  | 'source_artifact_id'
  | 'synthesis_provider'
  | 'synthesis_model'
  | 'last_used_at'
  | 'refresh_after'
  | 'archived_at'
> &
  Partial<
    Pick<
      WorkingKnowledgeItem,
      | 'objective'
      | 'visibility'
      | 'trust_status'
      | 'source_conversation_id'
      | 'source_workstream_id'
      | 'source_artifact_id'
      | 'synthesis_provider'
      | 'synthesis_model'
      | 'last_used_at'
      | 'refresh_after'
      | 'archived_at'
    >
  >
export type WorkingKnowledgeItemUpdate = Partial<Omit<WorkingKnowledgeItem, 'id' | 'created_at' | 'project_id' | 'owner_id'>>

export interface WorkingKnowledgeSource {
  id: string
  item_id: string
  url: string
  domain: string | null
  title: string | null
  published_date: string | null
  retrieved_at: string
  excerpt: string | null
  content_fingerprint: string | null
  claim_status: WorkingKnowledgeClaimStatus | null
  created_at: string
}
export type WorkingKnowledgeSourceInsert = Omit<WorkingKnowledgeSource, 'id' | 'created_at' | 'retrieved_at' | 'domain' | 'title' | 'published_date' | 'excerpt' | 'content_fingerprint' | 'claim_status'> &
  Partial<Pick<WorkingKnowledgeSource, 'retrieved_at' | 'domain' | 'title' | 'published_date' | 'excerpt' | 'content_fingerprint' | 'claim_status'>>

export interface WorkingKnowledgeShare {
  id: string
  item_id: string
  recipient_user_id: string
  status: 'active' | 'revoked'
  granted_by: string | null
  granted_at: string
  revoked_by: string | null
  revoked_at: string | null
  revocation_reason: string | null
}
export type WorkingKnowledgeShareInsert = Omit<WorkingKnowledgeShare, 'id' | 'status' | 'granted_at' | 'revoked_by' | 'revoked_at' | 'revocation_reason'> &
  Partial<Pick<WorkingKnowledgeShare, 'status' | 'granted_at' | 'revoked_by' | 'revoked_at' | 'revocation_reason'>>
export type WorkingKnowledgeShareUpdate = Partial<Omit<WorkingKnowledgeShare, 'id' | 'item_id' | 'recipient_user_id'>>

// ============================================
// Evaluation
// ============================================

export type ProjectType = 'learning' | 'experiment' | 'consulting' | 'transformation' | 'knowledge'
export type ProjectStatus = 'draft' | 'active' | 'review' | 'completed' | 'archived'
// "My Projects" list grouping (2026-09-04) -- a separate axis from
// ProjectType (see 20260904120001_project_portfolio_category.sql's own
// comment for why the two don't line up). Mike's "Suggested categorization
// of existing Projects" scheme (20260904130001_project_portfolio_category_v2.sql).
// 'other' is the safe default for every new project until its owner/curator
// classifies it -- 'sandz' names today's one real client literally rather
// than generically; revisit once a second real client exists.
export type PortfolioCategory = 'sandz' | 'foundation' | 'showcases' | 'builder_lab' | 'templates' | 'legacy_test' | 'archived' | 'other'

// Written only from the service layer (src/lib/workbench/projects.ts), never
// a database trigger -- actor_id needs the real acting user, which a
// service-role write can't get from auth.uid(). See
// supabase/migrations/20260828110001_project_status_history.sql.
export interface ProjectStatusHistoryEntry {
  id: string
  project_id: string
  from_status: ProjectStatus | null
  to_status: ProjectStatus
  actor_id: string | null
  created_at: string
}

// private = members/admin only (default, never auto-changed). internal =
// any authenticated user can view (editing still gated by project_members).
// public = a deliberately published presentation, visible with no session
// at all. Publishing is owner/admin only (see can_manage_project) -- never
// implied by curator/consultant project access.
export type ProjectVisibility = 'private' | 'internal' | 'public'

// Hand-authored public presentation content -- deliberately NOT a live
// rollup of eval_results (see publishProjectAction) and deliberately not
// one DB column per section. benchmarkSummary is a safe, curated summary
// table, never raw eval_run/eval_result rows.
export interface PublicProjectProfile {
  title?: string
  summary?: string
  problem?: string
  approach?: string
  findings?: string
  conclusion?: string
  benchmarkSummary?: {
    name: string
    rows: { metric: string; baseline?: string; variant?: string }[]
  }
  relatedWikiSlugs?: string[]
}

export interface Project {
  id: string
  name: string
  project_type: ProjectType
  objective: string | null
  status: ProjectStatus
  notes: string | null
  // Shared method/approach, common to every workstream in this project --
  // e.g. "the same 4-phase discovery method, run by two different AI
  // tools." A workstream's own page links back here rather than repeating
  // it (see project_workstreams.goal, still per-workstream for cases where
  // it genuinely differs, but no longer the primary display).
  goal: string | null
  // Type-specific fields (hypothesis, success_criteria, business_problem, ...)
  // live here rather than as a wide table of nullable columns -- no template
  // engine, per the Project Model brief's explicit scope limit.
  details: Record<string, string>
  owner_id: string | null
  visibility: ProjectVisibility
  public_slug: string | null
  public_profile: PublicProjectProfile | null
  published_at: string | null
  published_by: string | null
  // Stricter, admin-only opt-in layered on top of visibility='public' --
  // exposes real workstreams/artifacts/assessment responses to anonymous
  // visitors, not just the curated public_profile summary. See
  // setPublicFullDetailAction and 20260817120001_public_full_detail.sql.
  public_full_detail: boolean
  // Information Sensitivity Classification (Shadow AI blog, 2026-08-28):
  // "which AI models may process this project's own name/goal" -- the same
  // axis and enforcement as resource_access_policies.information_sensitivity,
  // kept as a plain column here rather than a resource_access_policies row
  // (see 20260829120001_project_information_sensitivity.sql). null =
  // unclassified, treated as 'internal' by src/lib/ai/sensitivity.ts.
  information_sensitivity: InformationSensitivity | null
  // A short, clickable prompt Ember offers when opened bound to this
  // project (ChatPanel.tsx's project-bound empty state). Curator/owner/
  // admin-settable, see updateProjectStarterPrompt -- deliberately not
  // gated by the same RLS as the rest of this row (see that function's
  // comment). 20260904110001_project_starter_prompt.sql.
  starter_prompt: string | null
  // See PortfolioCategory above -- 20260904120001_project_portfolio_category.sql.
  portfolio_category: PortfolioCategory
  // OR-036 (20260904140001_project_join_requests.sql). See
  // ProjectDiscoverability above -- default 'members_only', opt-in only.
  discoverability: ProjectDiscoverability
  // True for exactly one Project per single-tenant deployment (seeded, not
  // yet UI-settable) -- makes the read-only "Projects at X" directory
  // section render on that Project's own page. See ProjectDirectory.tsx.
  is_organization_home: boolean
  // Provenance -- who/what created this row. 'ui' is the default (and the
  // only value possible before M6D); 'assistant' is stamped by the chat
  // tool-calling loop (src/lib/chat/loop.ts) as a follow-up update after
  // create_project succeeds, never by the service layer itself.
  created_via: string
  assistant_prompt_version: string | null
  assistant_conversation_id: string | null
  created_at: string
  updated_at: string
  // Builder Ontology, Part B (docs/kbs-ontology-dev-req-3.md): set when this
  // Project was created by cloneProject (project-cloning.ts), for
  // side-by-side comparison of two options under otherwise-identical
  // conditions. null for every ordinarily-created Project.
  cloned_from_project_id: string | null
  // Project creation approval (20261004100001_project_creation_approval.sql):
  // 'pending' for a project a consultant/builder created, until their
  // agency curator or a platform admin decides (project-approval.ts).
  approval_status: ProjectApprovalStatus
  approval_decided_by: string | null
  approval_decided_at: string | null
  approval_decision_reason: string | null
  // Wizard-picked team members held until approval adds them.
  pending_members: PendingProjectMember[]
}

export type ProjectApprovalStatus = 'pending' | 'approved' | 'rejected'
export interface PendingProjectMember {
  user_id: string
  role: ProjectRole
}

// Project role (owner/curator/consultant/viewer) is deliberately a separate
// concept from platform role (UserRole, above) -- one controls what someone
// can administer across KB Sandbox, the other what they can do inside one
// specific project. Granting 'consultant' in one project must never imply
// access to another.
export type ProjectRole = 'owner' | 'curator' | 'consultant' | 'viewer'
export type ProjectMemberStatus = 'active' | 'inactive'

export type BusinessFunction =
  | 'business_development_sales'
  | 'finance_pricing'
  | 'legal_commercial'
  | 'customer_support'
  | 'delivery_consulting'
  | 'architecture_engineering'
  | 'security_compliance'
  | 'customer_representative'
  | 'project_governance'
  | 'other'

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: ProjectRole
  status: ProjectMemberStatus
  // Project Approval Authorities, Stage 1 (docs/dev-request-project-approval-
  // authorities.md): why a member participates -- routes approval work, does
  // not by itself grant approval authority. Separate from ProjectRole.
  business_function: BusinessFunction | null
  function_notes: string | null
  created_at: string
  updated_at: string
}

// Bounded catalogue per the dev request -- extensible via migration later,
// not via an admin UI in Stage 1.
export type ApprovalType =
  | 'technical'
  | 'pricing'
  | 'commercial'
  | 'security_compliance'
  | 'support_commitment'
  | 'proposal_release'
  | 'customer_acceptance'
  | 'knowledge_publication'
  | 'production_change'

export type ApprovalRequirementStatus = 'required' | 'optional' | 'not_applicable'
export type ApprovalMode = 'any_authorized' | 'all_assigned'
export type ApprovalVisibilityScope = 'internal' | 'customer_visible'
export type AuthorityStatus = 'active' | 'revoked'

// A policy says WHAT approval a project needs; an authority assignment
// (below) says WHO may make that specific decision. Stage 1 only builds
// this planning shell -- no project_approval_requests/decisions yet.
export interface ProjectApprovalPolicy {
  id: string
  project_id: string
  approval_type: ApprovalType
  requirement_status: ApprovalRequirementStatus
  sequence: number | null
  minimum_approvals: number
  approval_mode: ApprovalMode
  allow_self_approval: boolean
  monetary_trigger: number | null
  discount_trigger_percent: number | null
  visibility_scope: ApprovalVisibilityScope
  required_before_release: boolean
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectAuthorityAssignment {
  id: string
  project_id: string
  user_id: string
  business_function: BusinessFunction | null
  approval_type: ApprovalType
  monetary_limit: number | null
  discount_limit_percent: number | null
  conditions: string | null
  effective_from: string
  expires_at: string | null
  status: AuthorityStatus
  allow_self_approval: boolean
  granted_by: string | null
  granted_at: string
  revoked_by: string | null
  revoked_at: string | null
  revocation_reason: string | null
  created_at: string
  updated_at: string
}

// Project Evidence Access Controls, Stage 1 (docs/dev-request-project-
// evidence-access-controls.md): project membership grants participation,
// not universal knowledge access. A fourth independent concept alongside
// ProjectRole, BusinessFunction, and ApprovalType/ProjectAuthorityAssignment
// above -- none of these silently grant another. resource_id in
// ResourceAccessPolicy is always the *stable* identity (knowledge_sources.id,
// never documents.id) so classification/grants apply uniformly across every
// version of a source.
export type EvidenceResourceType = 'knowledge_source' | 'wiki_article' | 'workstream_artifact'
export type EvidenceClassification =
  | 'project_general'
  | 'internal_confidential'
  | 'commercial_confidential'
  | 'security_restricted'
  | 'customer_confidential'
  | 'customer_visible'
export type AccessGrantStatus = 'active' | 'revoked'

// Information Sensitivity Classification (Shadow AI blog, 2026-08-28):
// answers "which AI models may process this resource's content" -- a
// machine-eligibility axis, deliberately separate from EvidenceClassification
// above (which answers "which humans can see this resource"). A simple
// ordinal ladder -- see src/lib/ai/sensitivity.ts's SENSITIVITY_RANK.
export type InformationSensitivity = 'public' | 'internal' | 'confidential' | 'restricted'

export interface ProjectAccessGroup {
  id: string
  project_id: string
  name: string
  description: string | null
  is_system_group: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ProjectAccessGroupMember {
  id: string
  project_access_group_id: string
  project_member_id: string
  effective_from: string
  expires_at: string | null
  status: AccessGrantStatus
  granted_by: string | null
  granted_at: string
  revoked_by: string | null
  revoked_at: string | null
  revocation_reason: string | null
}

// A resource with NO row in this table is implicitly project_general --
// today's exact behavior, unchanged. A row only ever exists once someone
// has deliberately restricted something.
export interface ResourceAccessPolicy {
  id: string
  project_id: string
  resource_type: EvidenceResourceType
  resource_id: string
  classification: EvidenceClassification
  information_sensitivity: InformationSensitivity | null
  access_steward_user_id: string | null
  review_at: string | null
  rationale: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// One row per AI provider -- the highest InformationSensitivity tier that
// provider is approved to receive. No row = treated as 'internal'-only by
// the enforcement side (the safe default), not "approved for everything".
export interface AiProviderSensitivityEligibility {
  provider_id: string
  max_sensitivity: InformationSensitivity
  updated_by: string | null
  updated_at: string
}

// Exactly one of project_access_group_id / project_member_id is set (DB
// constraint) -- a whole group is granted, or one named user is.
export interface ResourceAccessGrant {
  id: string
  resource_access_policy_id: string
  project_access_group_id: string | null
  project_member_id: string | null
  status: AccessGrantStatus
  granted_by: string | null
  granted_at: string
  revoked_by: string | null
  revoked_at: string | null
  revocation_reason: string | null
}

export type EvidenceAuditEventType =
  | 'resource_classified'
  | 'resource_reclassified'
  | 'group_created'
  | 'group_member_granted'
  | 'group_member_revoked'
  | 'resource_grant_granted'
  | 'resource_grant_revoked'

// Insert-only, written via the admin client from the service layer -- never
// stores evidence content, only which resource/who/when/what classification
// (see 20260825100001_project_evidence_access_schema.sql's own comment).
export interface ResourceAccessAuditLogEntry {
  id: string
  project_id: string
  event_type: EvidenceAuditEventType
  resource_type: EvidenceResourceType | null
  resource_id: string | null
  actor_id: string | null
  from_classification: EvidenceClassification | null
  to_classification: EvidenceClassification | null
  target_group_id: string | null
  target_member_id: string | null
  created_at: string
}

export type ResourceAccessRequestStatus = 'pending' | 'approved' | 'denied'

// A member locked out of a restricted resource by has_evidence_access can
// ask for it instead of never learning it exists -- the request/approve/
// reject counterpart to ResourceAccessGrant above. note_id is the
// notification sent to whoever decides (access_steward_user_id, else the
// Project owner, else any curator); outcome_note_id is the reply sent back
// to the requester once decided. See src/lib/projects/access-requests.ts.
export interface ResourceAccessRequest {
  id: string
  project_id: string
  resource_type: EvidenceResourceType
  resource_id: string
  requester_id: string
  status: ResourceAccessRequestStatus
  note_id: string | null
  outcome_note_id: string | null
  decided_by: string | null
  decision_reason: string | null
  decided_at: string | null
  created_at: string
}

export type ProjectDiscoverability = 'platform' | 'members_only'
export type ProjectJoinRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled'

// A non-member requesting to join a Project (OR-036, 20260904140001) --
// mirrors ResourceAccessRequest almost exactly, but for membership itself
// rather than access to a specific resource, and insertable by someone who
// is NOT yet a project member (the RLS insert policy allows this only when
// the project is discoverability='platform' or already visible to them).
// Decided by can_curate_project (owner-or-curator), not can_manage_project.
// See src/lib/projects/join-requests.ts.
export interface ProjectJoinRequest {
  id: string
  project_id: string
  requester_id: string
  status: ProjectJoinRequestStatus
  note_id: string | null
  outcome_note_id: string | null
  decided_by: string | null
  decision_reason: string | null
  decided_at: string | null
  created_at: string
}

export type SourceSubmissionKind = 'file' | 'artifact' | 'working_knowledge'
export type ProjectSourceSubmissionStatus = 'pending' | 'approved' | 'rejected'

// Member-submitted knowledge sources, with project-curator approval
// (20260904100001_project_source_submissions.sql) -- the propose/decide
// counterpart to ResourceAccessRequest above, but for *new* content rather
// than access to existing content, and gated on can_curate_project
// (owner-or-curator) rather than can_manage_project (owner-only). See
// src/lib/workbench/source-submissions.ts. 'working_knowledge' added by
// 20260905110001 (KB Sandbox Builder MVP) -- a builder's own notebook
// promoted for curator review, same snapshot-at-approval-time shape as
// 'artifact'.
export interface ProjectSourceSubmission {
  id: string
  project_id: string
  knowledge_base_id: string
  source_kind: SourceSubmissionKind
  title: string
  document_id: string | null
  workstream_artifact_id: string | null
  working_knowledge_item_id: string | null
  submitted_by: string
  status: ProjectSourceSubmissionStatus
  decision_reason: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

// M5D (simplified) -- a Workstream is a scope document (repository scope,
// goal, a named guardrail, a deliverables checklist) that tells a
// consultant what to do with an external tool (e.g. Claude Code against a
// cloned openapi-modernizer/mcp-modernizer repo template); KB Sandbox never
// executes this itself. workstream_artifacts is the evidence trail the
// consultant attaches when they're done -- insert-only, no automated
// scoring against it in this pass.
export type WorkstreamStatus = 'draft' | 'active' | 'completed' | 'archived'

export interface WorkstreamDeliverable {
  label: string
  completed: boolean
}

export type WorkstreamLifecycleStage = 'presales' | 'deployment' | 'management_maintenance'
export type WorkstreamOperationalStatus = 'open' | 'concluded'

export interface ProjectWorkstream {
  id: string
  project_id: string
  name: string
  slug: string
  status: WorkstreamStatus
  repository_scope: string[]
  goal: string | null
  guardrail: string | null
  // Outcome summary -- distinct from `goal` (what we set out to do). Curator-
  // editable, populated once artifacts/evidence exist.
  summary: string | null
  deliverables: WorkstreamDeliverable[]
  created_by: string | null
  created_via: string
  assistant_prompt_version: string | null
  assistant_conversation_id: string | null
  created_at: string
  updated_at: string
  // Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md). parent_
  // workstream_id nests a granular task under a broader interface-level
  // workstream -- self-referencing, cycle-guarded by a DB trigger
  // (prevent_workstream_cycle), not declaratively enforceable. lifecycle_
  // stage is the commercial/engagement axis, a different concern than
  // `status` above (which tracks draft/active/completed/archived).
  parent_workstream_id: string | null
  lifecycle_stage: WorkstreamLifecycleStage | null
  operational_status: WorkstreamOperationalStatus
  // Postgres interval comes back through supabase-js as a string (e.g. "3 days").
  planned_duration: string | null
  actual_duration: string | null
  // Builder Ontology, Part B: set when this Workstream was created by
  // cloneWorkstream (project-cloning.ts) -- a same-project sibling subtree
  // for comparison, sharing the project's project_objects but starting with
  // its own fresh run history. null for every ordinarily-created Workstream.
  cloned_from_workstream_id: string | null
  // Builder Ontology, Part C: set when this Workstream was created by
  // instantiateMethodAsWorkstream (methods.ts) from a published Method --
  // distinct from cloned_from_workstream_id (a direct copy of another
  // Workstream) since a Method is reusable process reference, not a
  // specific prior run. null for every Workstream not instantiated this way.
  derived_from_method_id: string | null
}

// A reusable process a builder promotes from a Workstream that worked --
// other builders can browse (once published) and instantiate into a fresh
// Workstream of their own. requirements/evidence/deliverables/guardrails/
// review_points are plain free-text, not jsonb -- this codebase's own
// "no template engine" convention (see Project.details' own comment),
// rendered as Markdown like ProjectWorkstream.guardrail/summary/goal. See
// 20260927100001_methods_schema.sql.
export interface Method {
  id: string
  name: string
  slug: string
  description: string | null
  derived_from_workstream_id: string
  derived_from_wiki_article_id: string | null
  requirements: string | null
  evidence: string | null
  deliverables: string | null
  guardrails: string | null
  review_points: string | null
  status: MethodStatus
  published_by: string | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type MethodStatus = 'draft' | 'published'

export type WorkstreamObjectAccessMode = 'reads' | 'writes' | 'creates'

// Per-project domain-object ontology -- a self-referencing tree of the
// domain object TYPES that matter for this specific builder's business
// (e.g. Plane/Route for an airline client), not instances of those types
// and not a platform-wide taxonomy. See 20260925100001_project_objects_and_
// workstream_structure.sql.
export interface ProjectObject {
  id: string
  project_id: string
  parent_object_id: string | null
  name: string
  slug: string
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Which objects a workstream reads/writes/creates -- one row per
// (workstream_id, object_id) pair with an access_modes array, reusing the
// repository_scope text[] precedent on ProjectWorkstream itself rather than
// one row per relation type.
export interface WorkstreamObjectLink {
  id: string
  workstream_id: string
  object_id: string
  access_modes: WorkstreamObjectAccessMode[]
  created_by: string | null
  created_at: string
  updated_at: string
}

// Pipeline ordering between workstreams -- a DAG (a workstream can have
// multiple upstream/downstream neighbors), not a simple tree.
export interface WorkstreamFlowEdge {
  id: string
  upstream_workstream_id: string
  downstream_workstream_id: string
  created_by: string | null
  created_at: string
}

export type ArtifactType =
  | 'capability_inventory'
  | 'endpoint_inventory'
  | 'openapi_spec'
  | 'mcp_server'
  | 'evidence_map'
  | 'test_results'
  | 'findings'
  | 'design_note'
  | 'implementation_handoff'
  | 'research_dossier'
  | 'other'

// OL-010: status/review fields, additive on an otherwise-immutable row (see
// 20260831130001_workstream_artifact_status.sql). 'draft' is the state for
// an artifact type with no automated validator yet (everything except
// 'openapi_spec' today); validateOpenApiContent (src/lib/workbench/
// workstreams.ts) computes 'validation_failed'/'ready_for_review' at attach
// time for openapi_spec; 'approved'/'rejected' only ever come from
// reviewArtifact.
export type WorkstreamArtifactStatus = 'draft' | 'validation_failed' | 'ready_for_review' | 'approved' | 'rejected'

export interface WorkstreamArtifact {
  id: string
  workstream_id: string
  artifact_type: ArtifactType
  title: string
  external_tool: string | null
  content: string | null
  external_url: string | null
  notes: string | null
  created_by: string | null
  created_via: string
  assistant_prompt_version: string | null
  assistant_conversation_id: string | null
  created_at: string
  status: WorkstreamArtifactStatus
  validation_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

// The shape src/lib/projects/ontology-map.ts's getOntologyMapData fetches
// and computeOntologyMapLayout lays out -- declared here (this file's own
// leaf-of-the-dependency-graph convention) rather than in that lib module,
// so PresentationSlide.diagramData below can reference it without this
// file importing application code.
export interface OntologyMapData {
  objects: { id: string; name: string; parentId: string | null }[]
  workstreams: { id: string; name: string; parentId: string | null }[]
  flowEdges: { upstreamId: string; downstreamId: string }[]
  linkEdges: { workstreamId: string; objectId: string; accessModes: string[] }[]
}

// Workstream Presentation & Review, Part A (docs/Workstream Presentation &
// Customer Review.docx): a builder turns a completed Workstream into a
// slide-based proposal that goes through structured review before a
// curator approval gate. See 20260930100001_workstream_presentations.sql.
// status is the review-period state machine (doc §11) -- content itself
// lives in PresentationVersion, never here.
export type PresentationStatus = 'draft' | 'review_open' | 'review_closed' | 'builder_revision' | 'curator_review' | 'approved'

export interface Presentation {
  id: string
  workstream_id: string
  status: PresentationStatus
  review_deadline: string | null
  // A curator can schedule review to open automatically at a future
  // date/time instead of clicking "Open for review" that day -- cleared
  // (by openPresentationReview or the auto-open cron job) the moment
  // status actually leaves 'draft', by whichever path gets there first.
  scheduled_open_at: string | null
  current_version_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// 'diagram_ref' points a slide at the project's Ontology Map (diagramData
// is a frozen snapshot taken at generation time, same as every other
// slide's content -- not live-refreshed on later views).
export interface PresentationSlide {
  id: string
  type: 'text' | 'diagram_ref'
  title: string
  body: string
  items?: string[]
  diagramData?: OntologyMapData
}

// Insert-only, immutable once written (wiki_versions' own shape) -- a new
// "Generate Presentation" call always creates a new version, never edits
// an existing one's slides.
export interface PresentationVersion {
  id: string
  presentation_id: string
  version_number: number
  slides: PresentationSlide[]
  generated_by: string | null
  created_at: string
}

export interface PresentationStatusHistoryEntry {
  id: string
  presentation_id: string
  from_status: PresentationStatus | null
  to_status: PresentationStatus
  actor_id: string | null
  created_at: string
}

export type SlideCommentClassification =
  | 'question'
  | 'evaluation_candidate'
  | 'action'
  | 'security_review'
  | 'requirement_gap'
  | 'approval_signal'
  | 'scope_change'
  | 'risk_concern'
  | 'customer_requirement'

// slide_id is a polymorphic pointer into PresentationVersion.slides' own
// array (not a real FK) -- same convention as ProjectNote.context_id.
// builder_reply* are plain nullable columns directly on this row (not a
// child table) so "one reply" is a structural fact of the shape, not a
// business rule layered on an unbounded table -- see the migration's own
// RLS comment for how this is enforced at the database layer too.
export interface PresentationSlideComment {
  id: string
  presentation_version_id: string
  slide_id: string
  author_id: string | null
  comment_text: string
  classification: SlideCommentClassification | null
  builder_reply: string | null
  builder_reply_by: string | null
  builder_reply_at: string | null
  created_at: string
}

export type PresentationActionType = 'action' | 'evaluation' | 'security' | 'requirement'
export type PresentationActionStatus = 'open' | 'in_progress' | 'complete'

export interface PresentationAction {
  id: string
  presentation_id: string
  source_comment_id: string | null
  action_text: string
  owner_id: string | null
  type: PresentationActionType
  status: PresentationActionStatus
  evidence: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// KB Sandbox Builder: workstream promotion (business-process handoff,
// docs/dev-request-builder-operations-and-progress-updates.md's own note
// "Each Builder has one private Project"). See
// 20260906100001_workstream_promotions_schema.sql -- distinct from
// docs/dev-request-builder-capability-promotion-evaluation-templates.md's
// separate technical certification ladder for a *built capability*.
export type WorkstreamPromotionStatus = 'pending' | 'approved' | 'rejected'

export interface WorkstreamPromotion {
  id: string
  workstream_id: string
  submitted_by: string
  status: WorkstreamPromotionStatus
  decision_reason: string | null
  decided_by: string | null
  decided_at: string | null
  created_project_id: string | null
  // Client email addresses the builder named when submitting -- added as
  // viewers on the client Project at approval.
  // 20261003100002_builder_proposal_promotions.sql.
  client_emails: string[]
  // The maintenance fee the builder proposes for this client -- all three
  // set or all null. 20261003100003_client_project_fees.sql.
  proposed_fee_amount: number | null
  proposed_fee_currency: FeeCurrency | null
  proposed_fee_period: FeeBillingPeriod | null
  created_at: string
}

// Builder Operations and Progress Updates (docs/dev-request-builder-
// operations-and-progress-updates.md) -- one row per Workstream; "replace"
// updates this same row, "withdraw" flips status. See
// 20260906120001_builder_progress_updates_schema.sql.
export type BuilderProgressConfidence = 'on_track' | 'at_risk' | 'blocked'
export type BuilderProgressUpdateStatus = 'active' | 'withdrawn'

export interface BuilderProgressUpdate {
  id: string
  workstream_id: string
  submitted_by: string
  current_stage: string
  opportunity_label: string | null
  progress: string
  next_step: string
  help_requested: string | null
  confidence: BuilderProgressConfidence
  status: BuilderProgressUpdateStatus
  created_at: string
  updated_at: string
}

// Client maintenance fees and the platform's share. See
// 20261003100003_client_project_fees.sql.
export type FeeCurrency = 'PHP' | 'USD'
export type FeeBillingPeriod = 'monthly' | 'annual'

export interface ClientProjectFee {
  project_id: string
  amount: number
  currency: FeeCurrency
  billing_period: FeeBillingPeriod
  platform_rate_pct: number
  set_by: string | null
  created_at: string
  updated_at: string
}

// Builder agencies: which curator (agency) a consultant (builder) works
// under. See 20261003100001_agency_builders.sql.
export interface AgencyBuilder {
  builder_id: string
  agency_id: string
  assigned_by: string | null
  created_at: string
  updated_at: string
}

// Builder AI Usage Metering + BYOLLM. See
// 20260907100001_builder_ai_metering_schema.sql.
export interface BuilderAiAllowance {
  builder_id: string
  monthly_allowance_usd: number
  warning_threshold_pct: number
  stop_at_allowance: boolean
  current_period_start: string
  created_at: string
  updated_at: string
}

export interface BuilderCreditGrant {
  id: string
  builder_id: string
  amount_usd: number
  reason: string
  granted_by: string | null
  created_at: string
}

export type BuilderLlmProviderTypeColumn = 'openai' | 'gemini' | 'groq' | 'openai_compatible'

export interface BuilderLlmCredential {
  builder_id: string
  provider_type: BuilderLlmProviderTypeColumn
  base_url: string | null
  model_id: string
  encrypted_api_key: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ============================================
// Chat / Conversational Workbench Assistant (M6D)
// ============================================

// The doc's own list of summary fields (dev-request-assistant-first-use-onboarding-and-history.md):
// objective, confirmed requirements, decisions, open questions, records
// created, evidence referenced, and the likely next action.
export interface ConversationSummary {
  objective: string
  confirmedRequirements: string[]
  decisions: string[]
  openQuestions: string[]
  createdRecords: string[]
  referencedEvidence: string[]
  nextAction: string
}

export interface Conversation {
  id: string
  user_id: string
  title: string | null
  created_at: string
  updated_at: string
  // Bumped by a trigger on every chat_messages insert (see
  // 20260820130001_chat_history_and_summary.sql) -- lets conversation
  // history be listed/resumed by recency without joining chat_messages.
  last_message_at: string | null
  // Rolling per-conversation summary (Stage 2) -- see maybeRefreshSummary in
  // src/lib/chat/summary.ts. summary_through_message_id is set null, not
  // cascaded, if that message is ever deleted.
  summary_json: ConversationSummary | null
  summary_through_message_id: string | null
  summary_updated_at: string | null
  summary_provider: string | null
  summary_model: string | null
  summary_version: string | null
  // Project-Aware Knowledge and Assistant Context, Stage 2. Null means
  // general/unbound. Immutable once set (20260824190001_conversations_project_binding.sql's
  // trigger) -- "changing project context" means starting a new conversation.
  project_id: string | null
  // Set at turn start, cleared when the turn resolves either way -- survives
  // a page refresh, unlike in-memory isPending state. See runAssistantTurn
  // and ChatPanel's mount-time recovery check.
  pending_turn_started_at: string | null
  // Owner Roadmap and Ember Feedback Board. 'feedback' conversations are
  // never resumed and never shown in the normal History list -- orthogonal
  // to project_id, not a replacement for it.
  kind: 'chat' | 'feedback'
}

export type ConversationInsert = Omit<
  Conversation,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'title'
  | 'last_message_at'
  | 'summary_json'
  | 'summary_through_message_id'
  | 'summary_updated_at'
  | 'summary_provider'
  | 'summary_model'
  | 'summary_version'
  | 'project_id'
  | 'pending_turn_started_at'
  | 'kind'
> &
  Partial<
    Pick<
      Conversation,
      | 'title'
      | 'last_message_at'
      | 'summary_json'
      | 'summary_through_message_id'
      | 'summary_updated_at'
      | 'summary_provider'
      | 'summary_model'
      | 'summary_version'
      | 'project_id'
      | 'pending_turn_started_at'
      | 'kind'
    >
  >
export type ConversationUpdate = Partial<Omit<Conversation, 'id' | 'user_id' | 'created_at'>>

export type ChatMessageRole = 'user' | 'assistant' | 'tool'

export interface ChatMessageRow {
  id: string
  conversation_id: string
  user_id: string
  role: ChatMessageRole
  content: string | null
  // Present on an assistant message that requested one or more tool calls.
  tool_calls: { id: string; name: string; arguments: Record<string, unknown> }[] | null
  // Present on a 'tool' role message: which call this is the result of.
  tool_call_id: string | null
  tool_name: string | null
  // M6E: plain-text provenance snapshot (raw provider name / model_id),
  // set only on assistant-role rows -- same convention as
  // wiki_versions.ai_provider/.ai_model, deliberately not an FK so
  // historical rows stay accurate if the model is later renamed/disabled.
  provider: string | null
  model: string | null
  // The structured response envelope (docs/dev-request-structured-assistant-
  // responses-and-artifacts-panel.md), set only on the final assistant-role
  // row of a turn. Kept loosely typed here (like tool_calls above) rather
  // than importing src/lib/chat/response-envelope.ts's PersistedAssistantEnvelope
  // shape -- the stored references (target kind/id, artifactId, sourceId)
  // are re-resolved against the current user's access on every read (see
  // conversations.ts's toDisplayMessages), so this column is never trusted
  // as pre-resolved routes, and a future schema-version change must fall
  // back gracefully rather than being assumed to match today's shape.
  response_payload: Record<string, unknown> | null
  // Phase 2, increment 1: the COMPLETE set of resources this 'tool' row's
  // call actually retrieved -- deliberately separate from
  // response_payload.citations (a subset: only what the model chose to
  // cite). Powers src/lib/chat/summary.ts's policy manifest, which needs
  // every retrieved resource across the whole transcript, not just cited
  // ones. Set only on a 'tool' row whose call retrieved something; null
  // everywhere else, same convention as response_payload.
  retrieved_resources: { resourceType: 'wiki_article' | 'knowledge_source'; resourceId: string }[] | null
  created_at: string
}

export type ChatMessageInsert = Omit<
  ChatMessageRow,
  'id' | 'created_at' | 'tool_calls' | 'tool_call_id' | 'tool_name' | 'content' | 'provider' | 'model' | 'response_payload' | 'retrieved_resources'
> &
  Partial<
    Pick<ChatMessageRow, 'tool_calls' | 'tool_call_id' | 'tool_name' | 'content' | 'provider' | 'model' | 'response_payload' | 'retrieved_resources'>
  >

// ============================================
// Workstream System Understanding Assessment
// ============================================

// A curator-authored, versioned set of standardized questions every
// "participant" (an external AI tool/method) answers after independently
// examining a system -- testing whether they understood it, not just
// whether they produced plausible artifacts. Deliberately reusable, not
// specific to OpenAPI/CareCall. See docs/ design note for the full model.
export interface SystemAssessment {
  id: string
  project_id: string
  // Soft/optional link to the originating workstream -- not used for
  // access control. An assessment spans every workstream/participant in
  // the project (Claude Code and ChatGPT/Codex are separate *workstreams*
  // in this app, but the same assessment).
  workstream_id: string | null
  name: string
  description: string | null
  current_version_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
export type SystemAssessmentInsert = Omit<SystemAssessment, 'id' | 'created_at' | 'updated_at' | 'current_version_id'> &
  Partial<Pick<SystemAssessment, 'current_version_id'>>
export type SystemAssessmentUpdate = Partial<Omit<SystemAssessment, 'id' | 'created_at' | 'project_id'>>

// "Immutable once active" (no silent edits after a version has responses)
// is enforced in the action layer, not by a status-derived RLS/trigger
// rule -- see the migration's RLS section comment.
export type SystemAssessmentVersionStatus = 'draft' | 'active' | 'retired'

export interface SystemAssessmentVersion {
  id: string
  assessment_id: string
  project_id: string
  version_number: number
  // How a participant should answer -- versioned alongside the questions
  // so a response can always be traced to exactly what was asked and how.
  instructions: string
  status: SystemAssessmentVersionStatus
  created_by: string | null
  created_at: string
}
export type SystemAssessmentVersionInsert = Omit<SystemAssessmentVersion, 'id' | 'created_at' | 'status'> &
  Partial<Pick<SystemAssessmentVersion, 'status'>>

export interface SystemAssessmentQuestion {
  id: string
  assessment_version_id: string
  project_id: string
  sequence: number
  title: string
  question: string
  category: string | null
  guidance: string | null
}
export type SystemAssessmentQuestionInsert = Omit<SystemAssessmentQuestion, 'id'>

export type AssessmentResponseStatus = 'in_progress' | 'completed'

// A response belongs to a participant/method, not to a workstream --
// participant_label is descriptive metadata (e.g. "Claude Code"), not a
// workstream FK. See the migration comment for why.
export interface AssessmentResponse {
  id: string
  assessment_version_id: string
  project_id: string
  participant_label: string
  external_tool: string | null
  model: string | null
  repository_ref: string | null
  status: AssessmentResponseStatus
  created_by: string | null
  created_at: string
  updated_at: string
}
export type AssessmentResponseInsert = Omit<
  AssessmentResponse,
  'id' | 'created_at' | 'updated_at' | 'status' | 'external_tool' | 'model' | 'repository_ref'
> &
  Partial<Pick<AssessmentResponse, 'status' | 'external_tool' | 'model' | 'repository_ref'>>
export type AssessmentResponseUpdate = Partial<Omit<AssessmentResponse, 'id' | 'created_at' | 'project_id' | 'assessment_version_id'>>

export type AnswerClassification = 'CONFIRMED' | 'INFERRED' | 'UNKNOWN'

// One row per question per response -- not one giant Markdown blob -- so
// individual questions stay independently reviewable/scoreable later.
// Evidence stays inline free text in this pass, not a normalized table.
export interface AssessmentAnswer {
  id: string
  response_id: string
  question_id: string
  project_id: string
  answer: string
  classification: AnswerClassification | null
  evidence: string | null
  created_at: string
  updated_at: string
}
export type AssessmentAnswerInsert = Omit<AssessmentAnswer, 'id' | 'created_at' | 'updated_at' | 'classification' | 'evidence'> &
  Partial<Pick<AssessmentAnswer, 'classification' | 'evidence'>>
export type AssessmentAnswerUpdate = Partial<Pick<AssessmentAnswer, 'answer' | 'classification' | 'evidence'>>

export type EvalDatasetStatus = 'draft' | 'active' | 'archived'
export type EvalDifficulty = 'easy' | 'medium' | 'hard'
export type EvalRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type EvalResultStatus = 'completed' | 'failed'
export type EvidenceSource = 'chunks' | 'wiki' | 'both'
export type EvaluatorType = 'none' | 'llm_judge'
// Was a fixed 'openai' | 'gemini' union; providers are now admin-managed rows
// (see ai_providers/ai_models below) rather than a compile-time enum, so this
// is just ai_providers.name at the type level. Kept as a named alias (rather
// than inlining `string` at every call site) so the intent -- "this is a
// provider name" -- stays legible.
export type AIProviderName = string
export type FailureClassification =
  | 'knowledge_failure'
  | 'retrieval_failure'
  | 'reasoning_failure'
  | 'workflow_failure'
  | 'tool_failure'
  | 'behavior_failure'
  | 'rule_failure'
  | 'unknown'

// ============================================
// AI provider/model registry
// ============================================

export type AIProviderType = 'openai' | 'gemini' | 'groq' | 'openai_compatible'
export type AIModelType = 'generation' | 'embedding' | 'speech' | 'multimodal'
export type AIModelStatus = 'active' | 'deprecated' | 'disabled' | 'unavailable'

export interface AIProviderRow {
  id: string
  name: string
  provider_type: AIProviderType
  display_name: string
  base_url: string | null
  // The env var NAME (e.g. 'GROQ_API_KEY'), never the secret value itself.
  api_key_env_var: string
  enabled: boolean
  supports_model_discovery: boolean
  created_at: string
  updated_at: string
}

export interface AIModelRow {
  id: string
  provider_id: string
  model_id: string
  display_name: string
  model_type: AIModelType
  enabled: boolean
  is_default: boolean
  // Independent of is_default -- see 20260818090001_ai_models_structured_output_default.sql.
  // Only meaningful (and only settable) when supports_structured_output is true.
  is_default_structured_output: boolean
  context_window: number | null
  max_output_tokens: number | null
  input_cost_per_million: number | null
  output_cost_per_million: number | null
  embedding_dimensions: number | null
  supports_structured_output: boolean
  supports_tools: boolean
  supports_reasoning: boolean
  supports_vision: boolean
  supports_embeddings: boolean
  status: AIModelStatus
  deprecation_date: string | null
  replacement_model_id: string | null
  notes: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface EvalDataset {
  id: string
  name: string
  description: string | null
  version: number
  status: EvalDatasetStatus
  knowledge_base_id: string | null
  project_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface EvalCase {
  id: string
  dataset_id: string
  question: string
  expected_answer: string | null
  expected_concepts: string[] | null
  expected_article_ids: string[] | null
  expected_chunk_ids: string[] | null
  scoring_criteria: string | null
  tags: string[] | null
  difficulty: EvalDifficulty | null
  created_at: string
  updated_at: string
}

// Absent = today's exact single-pass behavior (backward compatible with
// every stored run). graphId/graphVersionId/maxIterations/acceptanceThresholds
// are the config snapshot Milestone 4 requires so a historical graph run
// stays interpretable even after the active graph version changes later --
// see docs/CURRENT-ARCHITECTURE.md's Graph Runtime section.
export interface EvalRunExecutionConfig {
  mode: 'single_pass' | 'graph'
  graphId?: string
  graphVersionId?: string
  maxIterations?: number
  acceptanceThresholds?: {
    requiredOutcomeScore?: number
    requiredGroundingScore?: number
    requireExpectedEvidence?: boolean
  }
  // Milestone 5B -- both-or-neither, optional. Absent = today's exact
  // graph-mode behavior. Set when a run is "an Agent's evaluation suite"
  // rather than a bare graph-mode run, so graph_runs.agent_id/
  // agent_version_id get populated (see src/lib/eval/run.ts's
  // runCaseViaGraph) without any other change to how the run executes.
  agentId?: string
  agentVersionId?: string
}

export interface EvalRunConfig {
  // model is required, not optional -- a run must snapshot exactly which
  // model was tested (see the brief this shipped with: "historical eval runs
  // must continue to record the actual model tested").
  generation: { provider: AIProviderName; model: string }
  embedding: { provider: AIProviderName; model: string; dimensions?: number }
  retrieval: { evidence_source: EvidenceSource; top_k: number; threshold?: number }
  // provider/model stay optional as a pair -- evaluator.type='none' genuinely
  // has neither.
  evaluator: { type: EvaluatorType; provider?: AIProviderName; model?: string }
  execution?: EvalRunExecutionConfig
}

export interface EvalRun {
  id: string
  dataset_id: string
  dataset_version: number
  name: string | null
  status: EvalRunStatus
  config: EvalRunConfig
  is_baseline: boolean
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  created_by: string | null
  created_at: string
  // Builder Ontology, Part A: connects a run back to the Workstream it was
  // evaluating, for the Evals-section workstream list (docs/kbs-ontology-
  // dev-req-3.md §9) and the workstream-clone comparison view (§11/Part B).
  workstream_id: string | null
}

export interface EvalError {
  stage: string
  code: string
  message: string
  occurred_at: string
}

export interface RetrievedEvidenceItem {
  type: 'chunk' | 'wiki'
  id: string
  rank: number
  similarity: number
  title: string
  content: string
  // Stage 3: only set when the retrieval config carried a projectId --
  // same layer concept as chat's search_project_knowledge tool, computed the
  // same way (project_knowledge_bases/project_wiki_articles membership).
  // Absent entirely for a project-agnostic eval run.
  layer?: 'project' | 'platform'
}

export interface EvaluatorDetails {
  provider: string
  model: string
  reasoning: string
  missing_concepts: string[]
  unsupported_claims: string[]
}

export interface EvalResult {
  id: string
  eval_run_id: string
  eval_case_id: string
  status: EvalResultStatus
  error: EvalError | null
  generated_answer: string | null
  retrieved_evidence: RetrievedEvidenceItem[] | null
  retrieval_hit: boolean | null
  retrieval_recall: number | null
  retrieval_mrr: number | null
  generation_score: number | null
  grounding_score: number | null
  outcome_score: number | null
  overall_score: number | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  estimated_cost: number | null
  evaluator_details: EvaluatorDetails | null
  failure_classification: FailureClassification | null
  human_reviewed_by: string | null
  human_reviewed_at: string | null
  human_accepted: boolean | null
  human_generation_score: number | null
  human_grounding_score: number | null
  human_outcome_score: number | null
  human_failure_classification: FailureClassification | null
  human_notes: string | null
  created_at: string
  // Null for a single-pass run. Set together -- a graph-mode result always
  // has both, a single-pass result always has neither.
  graph_run_id: string | null
  iteration_count: number | null
}

export interface EvalResultWithCase extends EvalResult {
  case: Pick<EvalCase, 'question' | 'expected_answer' | 'expected_concepts' | 'expected_article_ids' | 'expected_chunk_ids'>
}

// ============================================
// Graph Runtime (Milestone 4)
// ============================================
// graphs (stable identity) -> graph_versions (immutable config snapshot) ->
// graph_runs (one execution) -> graph_steps (one row per executed node,
// the actual trace). The executable graph wiring lives in TypeScript
// (src/lib/graph/); graph_versions.definition documents what ran, it is
// never reconstructed from jsonb at runtime. See
// docs/CURRENT-ARCHITECTURE.md's Graph Runtime section for the full model.

export type GraphType = 'rag_retry'
export type GraphStatus = 'draft' | 'active' | 'archived'

export interface Graph {
  id: string
  name: string
  slug: string
  description: string | null
  graph_type: GraphType
  status: GraphStatus
  project_id: string | null
  active_version_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Config snapshot only -- not reconstructed into an executable graph at
// runtime. Mirrors the 5-node RAG Retry flow; a future graph_type would get
// its own definition shape.
export interface GraphVersionDefinition {
  nodes: string[]
  edges: { from: string; to: string }[]
  conditionalEdges: { from: string; condition: string; accept: string; retry: string }[]
  maxIterations: number
  acceptanceThresholds: {
    requiredOutcomeScore?: number
    requiredGroundingScore?: number
    requireExpectedEvidence?: boolean
  }
}

export interface GraphVersion {
  id: string
  graph_id: string
  version_number: number
  definition: GraphVersionDefinition
  instructions_version: string | null
  created_by: string | null
  created_at: string
  activated_at: string | null
}

export type GraphRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'terminated'

// Every graph run records why it stopped. 'unscored' (distinct from
// 'success') covers the no-judge/no-golden-evidence case -- the graph ran
// once and stopped because there was nothing to score against, which must
// never be conflated with an actual accepted evaluation in a comparison UI.
export type GraphTerminationReason =
  | 'success'
  | 'unscored'
  | 'max_iterations'
  | 'non_retryable_failure'
  | 'provider_error'
  | 'invalid_configuration'
  | 'manual_termination'

export interface GraphRun {
  id: string
  graph_id: string
  graph_version_id: string
  project_id: string | null
  eval_run_id: string | null
  eval_case_id: string | null
  // Milestone 5B -- set when this run was produced by an Agent (either a
  // live answerQuestion() call or an Agent's evaluation suite run), null
  // for a bare graph-mode run with no Agent involved. Both null/both set,
  // never one without the other.
  agent_id: string | null
  agent_version_id: string | null
  status: GraphRunStatus
  initial_input: Record<string, unknown>
  final_output: Record<string, unknown> | null
  iteration_count: number
  started_at: string | null
  completed_at: string | null
  termination_reason: GraphTerminationReason | null
  error_code: string | null
  error_message: string | null
  created_by: string | null
  created_at: string
}

export type GraphStepStatus = 'completed' | 'failed'
export type GraphNodeName = 'retrieve' | 'generate' | 'evaluate' | 'diagnose' | 'rewrite_query'

export interface GraphStep {
  id: string
  graph_run_id: string
  sequence_number: number
  node_name: GraphNodeName
  iteration: number
  input_snapshot: Record<string, unknown> | null
  output_snapshot: Record<string, unknown> | null
  transition_to: string | null
  status: GraphStepStatus
  latency_ms: number | null
  ai_operation_log_id: string | null
  error_code: string | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

// ============================================
// Agent Framework (Milestone 5A foundation slice + 5B)
// ============================================
// agent_templates (reusable, mutable defaults) -> agents (stable identity,
// optionally created from a template) -> agent_versions (immutable,
// executes THROUGH the Graph Runtime above -- graph_runs.agent_id/
// agent_version_id link an execution back to the Agent that produced it,
// there is no separate agent_runs table). See
// docs/CURRENT-ARCHITECTURE.md's Agent Framework section for the full
// model, including why no tool-calling/authorization framework exists yet.

export type AgentType = 'knowledge' | 'research' | 'evaluation' | 'engineering' | 'governance' | 'learning'
export type AgentStatus = 'draft' | 'active' | 'archived'
export type AgentTemplateStatus = 'active' | 'archived'

export interface AgentSourcePolicy {
  evidenceSource: EvidenceSource
  topK: number
  threshold?: number
}

export interface AgentGuardrails {
  noUnsupportedClaims?: boolean
  projectKnowledgeBoundary?: boolean
  maxRetries?: number
}

export interface AgentTerminationPolicy {
  maxIterations?: number
  successTerminationReasons?: GraphTerminationReason[]
}

// Reserved for future per-tool policy toggles -- see docs/CURRENT-ARCHITECTURE.md.
export type AgentToolPolicy = Record<string, unknown>

// Ordinary mutable table -- a template has no runs of its own, only Agents
// created from it do. "Template changes don't mutate existing Agent
// versions" holds because these defaults are COPIED into an agent_versions
// row at creation time (src/lib/agent/create.ts), never read live.
export interface AgentTemplate {
  id: string
  name: string
  slug: string
  description: string | null
  agent_type: AgentType
  default_graph_version_id: string
  default_purpose: string
  default_instructions: string
  default_source_policy: AgentSourcePolicy
  default_tool_policy: AgentToolPolicy
  default_guardrails: AgentGuardrails
  default_termination_policy: AgentTerminationPolicy
  default_generation_provider_id: string | null
  default_generation_model_id: string | null
  default_embedding_provider_id: string | null
  default_embedding_model_id: string | null
  default_evaluator_provider_id: string | null
  default_evaluator_model_id: string | null
  status: AgentTemplateStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Agent {
  id: string
  name: string
  slug: string
  description: string | null
  agent_type: AgentType
  template_id: string | null
  project_id: string | null
  active_version_id: string | null
  status: AgentStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

// No AgentVersionUpdate -- agent_versions is insert-only (see the migration
// comment: no UPDATE RLS policy exists at all, same immutability mechanism
// as graph_versions/wiki_versions).
export interface AgentVersion {
  id: string
  agent_id: string
  version_number: number
  purpose: string
  instructions: string
  graph_version_id: string
  generation_provider_id: string
  generation_model_id: string
  embedding_provider_id: string
  embedding_model_id: string
  evaluator_provider_id: string | null
  evaluator_model_id: string | null
  source_policy: AgentSourcePolicy
  tool_policy: AgentToolPolicy
  guardrails: AgentGuardrails
  termination_policy: AgentTerminationPolicy
  metadata: Record<string, unknown>
  created_by: string | null
  created_at: string
  activated_at: string | null
}

export type ExternalAgentProtocol = 'mcp' | 'https'
export type ExternalAgentStatus = 'draft' | 'active' | 'archived'
export type ExternalAgentCertificationStatus =
  | 'experimental'
  | 'sandbox_tested'
  | 'security_reviewed'
  | 'outlet_accepted'
  | 'production_approved'
  | 'deprecated'
  | 'suspended'
// What's being registered -- Advanced Builder Integrations Phase A
// (docs/design-notes/concept-paper-advanced-builder-integrations.md).
// Deliberately narrower than the concept paper's five concepts: knowledge
// connectors and webhook receivers have a different lifecycle shape (batch
// sync correctness / nothing exists yet to receive into) and stay out of
// this table for now; REST APIs are never independently registered.
export type BuilderIntegrationKind = 'external_agent' | 'mcp_server'
// Version-level, not integration-level -- risk can change between versions.
// Operationalizes "treat read and write differently"; this is what Phase C
// (Ember actually calling one) will gate tool exposure on.
export type BuilderIntegrationRiskClassification = 'read_only' | 'reversible_write' | 'consequential_write' | 'administrative'

// Registers agents and MCP servers that run OUTSIDE KB Sandbox (a builder's
// capability on Sandz or customer infrastructure) so KB Sandbox can govern
// them -- distinct from Agent/AgentVersion above, which are KBS-native
// graph-based agents Ember runs itself. Formerly `external_agents`, renamed
// here since MCP-server rows no longer make that name accurate. See
// supabase/migrations/20260831100001_builder_integrations_registry.sql.
export interface BuilderIntegration {
  id: string
  name: string
  slug: string
  purpose: string
  kind: BuilderIntegrationKind
  protocol: ExternalAgentProtocol
  endpoint_url: string | null
  project_id: string | null
  active_version_id: string | null
  status: ExternalAgentStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

// Immutable except for certification_status/approved_by/approved_at (staff-
// only, see the migration's dedicated update policy). "Approval applies to a
// specific version" -- a new version always starts back at 'experimental'.
export interface BuilderIntegrationVersion {
  id: string
  builder_integration_id: string
  version_number: number
  skills: { name: string; description: string; provider?: string }[]
  credentials_policy: Record<string, unknown>
  spending_limits: { perOrderMax?: number; dailyMax?: number; currency?: string }
  approval_policy: { requiresHumanConfirmation?: boolean; confirmationFields?: string[] }
  permitted_scope: { projectIds?: string[]; userIds?: string[] }
  risk_classification: BuilderIntegrationRiskClassification
  auth_method: string | null
  certification_status: ExternalAgentCertificationStatus
  notes: string | null
  created_by: string | null
  created_at: string
  approved_by: string | null
  approved_at: string | null
}

// Real Project-scoping mechanism -- replaces permitted_scope.projectIds
// (inert JSON nothing ever read). Phase C's "Ember discovers only tools
// permitted for the current Project" needs a real join to query.
export interface BuilderIntegrationProjectAvailability {
  id: string
  builder_integration_id: string
  project_id: string
  granted_by: string | null
  created_at: string
}

// Builder Capability Promotion (docs/dev-request-builder-capability-
// promotion-evaluation-templates.md) -- one evidence row per template per
// version. See 20260906110001_capability_evaluations_schema.sql.
export type CapabilityEvaluationTemplateId =
  | 'scope_evidence'
  | 'functional_contract'
  | 'identity_permissions'
  | 'human_decision'
  | 'customer_acceptance'
  | 'production_readiness'
export type CapabilityEvaluationStatus = 'draft' | 'ready_for_review' | 'pass' | 'conditional_pass' | 'fail' | 'not_applicable'

export interface CapabilityEvaluation {
  id: string
  builder_integration_version_id: string
  template_id: CapabilityEvaluationTemplateId
  status: CapabilityEvaluationStatus
  evidence_notes: string | null
  rationale: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// Agent Gateway, Milestone 1 -- audit trail AND pending-confirmation state
// machine for one attempted call to a registered integration's tool. A
// read-only call goes straight to 'executed'; a gated (reversible_write+)
// call sits at 'proposed' until a human confirms via
// confirmGatewayInvocationAction. See supabase/migrations/
// 20260831110001_builder_integration_invocations.sql.
export type BuilderIntegrationInvocationStatus = 'proposed' | 'confirmed' | 'executed' | 'failed' | 'cancelled'

export interface BuilderIntegrationInvocation {
  id: string
  builder_integration_id: string
  builder_integration_version_id: string
  project_id: string
  conversation_id: string | null
  actor_id: string | null
  tool_name: string
  risk_classification: BuilderIntegrationRiskClassification
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  status: BuilderIntegrationInvocationStatus
  error: string | null
  correlated_amount: number | null
  created_at: string
  confirmed_at: string | null
  confirmed_by: string | null
  executed_at: string | null
}

export type ProfileInsert = Omit<Profile, 'created_at' | 'updated_at'>
export type ProfileUpdate = Partial<Omit<Profile, 'id' | 'created_at'>>

export type DocumentInsert = Omit<
  Document,
  'id' | 'upload_date' | 'created_at' | 'updated_at' | 'approved_chunks' | 'rejected_chunks'
> &
  Partial<Pick<Document, 'approved_chunks' | 'rejected_chunks'>>
export type DocumentUpdate = Partial<Omit<Document, 'id' | 'upload_date' | 'created_at'>>

export type KnowledgeSourceInsert = Omit<KnowledgeSource, 'id' | 'created_at' | 'updated_at' | 'current_version_id'> &
  Partial<Pick<KnowledgeSource, 'current_version_id'>>
export type KnowledgeSourceUpdate = Partial<Omit<KnowledgeSource, 'id' | 'created_at'>>

export type ChunkInsert = Omit<DocumentChunk, 'id' | 'created_at'>
export type ChunkUpdate = Partial<Omit<DocumentChunk, 'id' | 'document_id' | 'chunk_index' | 'created_at'>>

export type KBVectorInsert = Omit<KBVector, 'id' | 'approved_date' | 'last_updated'>
export type KBVectorUpdate = Partial<Omit<KBVector, 'id' | 'chunk_id' | 'document_id' | 'approved_date'>>

export type WikiArticleInsert = Omit<
  WikiArticle,
  'id' | 'created_at' | 'updated_at' | 'current_version_id' | 'is_public' | 'visibility_scope'
> &
  Partial<Pick<WikiArticle, 'current_version_id' | 'is_public' | 'visibility_scope'>>
export type WikiArticleUpdate = Partial<Omit<WikiArticle, 'id' | 'created_at'>>

export type ProjectWikiArticleInsert = Omit<ProjectWikiArticle, 'id' | 'attached_at'> & Partial<Pick<ProjectWikiArticle, 'attached_at'>>
export type ProjectWikiArticleUpdate = Partial<Omit<ProjectWikiArticle, 'id' | 'project_id' | 'wiki_article_id'>>

export type ProjectKnowledgeBaseInsert = Omit<ProjectKnowledgeBase, 'id' | 'attached_at'> &
  Partial<Pick<ProjectKnowledgeBase, 'attached_at'>>
export type ProjectKnowledgeBaseUpdate = Partial<Omit<ProjectKnowledgeBase, 'id' | 'project_id' | 'knowledge_base_id'>>

export type WorkstreamKnowledgeBaseInsert = Omit<WorkstreamKnowledgeBase, 'id' | 'attached_at'> &
  Partial<Pick<WorkstreamKnowledgeBase, 'attached_at'>>
export type WorkstreamKnowledgeBaseUpdate = never

export type WikiVersionInsert = Omit<WikiVersion, 'id' | 'created_at' | 'promoted_from_trending_item_id'> &
  Partial<Pick<WikiVersion, 'promoted_from_trending_item_id'>>
export type WikiVersionUpdate = Partial<Pick<WikiVersion, 'approved_by' | 'approved_at'>>

export type WikiSourceInsert = Omit<WikiSource, 'id' | 'created_at'>

export type WikiRelationInsert = Omit<WikiRelation, 'id' | 'created_at'>

export type WikiVectorInsert = Omit<WikiVector, 'id' | 'created_at'>

export type EvalDatasetInsert = Omit<EvalDataset, 'id' | 'created_at' | 'updated_at'>
export type EvalDatasetUpdate = Partial<Omit<EvalDataset, 'id' | 'created_at'>>

export type EvalCaseInsert = Omit<EvalCase, 'id' | 'created_at' | 'updated_at'>
export type EvalCaseUpdate = Partial<Omit<EvalCase, 'id' | 'dataset_id' | 'created_at'>>

export type EvalRunInsert = Omit<EvalRun, 'id' | 'created_at' | 'workstream_id'> & Partial<Pick<EvalRun, 'workstream_id'>>
export type EvalRunUpdate = Partial<Omit<EvalRun, 'id' | 'dataset_id' | 'created_at'>>

export type EvalResultInsert = Omit<EvalResult, 'id' | 'created_at'>
export type EvalResultUpdate = Partial<Omit<EvalResult, 'id' | 'eval_run_id' | 'eval_case_id' | 'created_at'>>

// visibility/public_slug/public_profile/published_at/published_by are all
// optional at insert time -- a plain project creation never touches
// publication state, only publishProjectAction does.
export type ProjectInsert = Omit<
  Project,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'visibility'
  | 'public_slug'
  | 'public_profile'
  | 'published_at'
  | 'published_by'
  | 'goal'
  | 'starter_prompt'
  | 'portfolio_category'
  | 'discoverability'
  | 'is_organization_home'
  | 'public_full_detail'
  | 'information_sensitivity'
  | 'created_via'
  | 'assistant_prompt_version'
  | 'assistant_conversation_id'
  | 'cloned_from_project_id'
  | 'approval_status'
  | 'approval_decided_by'
  | 'approval_decided_at'
  | 'approval_decision_reason'
  | 'pending_members'
> &
  Partial<
    Pick<
      Project,
      | 'visibility'
      | 'public_slug'
      | 'public_profile'
      | 'published_at'
      | 'published_by'
      | 'goal'
      | 'starter_prompt'
      | 'portfolio_category'
      | 'public_full_detail'
      | 'information_sensitivity'
      | 'created_via'
      | 'assistant_prompt_version'
      | 'assistant_conversation_id'
      | 'cloned_from_project_id'
      | 'approval_status'
      | 'pending_members'
    >
  >
export type ProjectUpdate = Partial<Omit<Project, 'id' | 'created_at'>>

export type ProjectMemberInsert = Omit<
  ProjectMember,
  'id' | 'created_at' | 'updated_at' | 'business_function' | 'function_notes'
> &
  Partial<Pick<ProjectMember, 'business_function' | 'function_notes'>>
export type ProjectMemberUpdate = Partial<Omit<ProjectMember, 'id' | 'project_id' | 'user_id' | 'created_at'>>

export type ProjectApprovalPolicyInsert = Omit<ProjectApprovalPolicy, 'id' | 'created_at' | 'updated_at'>
export type ProjectApprovalPolicyUpdate = Partial<Omit<ProjectApprovalPolicy, 'id' | 'project_id' | 'created_at'>>

export type ProjectAuthorityAssignmentInsert = Omit<ProjectAuthorityAssignment, 'id' | 'created_at' | 'updated_at'>
export type ProjectAuthorityAssignmentUpdate = Partial<Omit<ProjectAuthorityAssignment, 'id' | 'project_id' | 'created_at'>>

export type ProjectAccessGroupInsert = Omit<ProjectAccessGroup, 'id' | 'created_at' | 'updated_at'>
export type ProjectAccessGroupUpdate = Partial<Omit<ProjectAccessGroup, 'id' | 'project_id' | 'created_at'>>

export type ProjectAccessGroupMemberInsert = Omit<ProjectAccessGroupMember, 'id'>
export type ProjectAccessGroupMemberUpdate = Partial<Omit<ProjectAccessGroupMember, 'id' | 'project_access_group_id' | 'project_member_id'>>

export type ResourceAccessPolicyInsert = Omit<ResourceAccessPolicy, 'id' | 'created_at' | 'updated_at' | 'information_sensitivity'> &
  Partial<Pick<ResourceAccessPolicy, 'information_sensitivity'>>
export type ResourceAccessPolicyUpdate = Partial<Omit<ResourceAccessPolicy, 'id' | 'project_id' | 'resource_type' | 'resource_id' | 'created_at'>>

export type AiProviderSensitivityEligibilityInsert = Omit<AiProviderSensitivityEligibility, 'updated_at'> &
  Partial<Pick<AiProviderSensitivityEligibility, 'updated_at'>>
export type AiProviderSensitivityEligibilityUpdate = Partial<Omit<AiProviderSensitivityEligibility, 'provider_id'>>

export type ResourceAccessGrantInsert = Omit<ResourceAccessGrant, 'id'>
export type ResourceAccessGrantUpdate = Partial<Omit<ResourceAccessGrant, 'id' | 'resource_access_policy_id'>>

export type ResourceAccessAuditLogEntryInsert = Omit<ResourceAccessAuditLogEntry, 'id' | 'created_at'>

export type ResourceAccessRequestInsert = Omit<
  ResourceAccessRequest,
  'id' | 'created_at' | 'status' | 'note_id' | 'outcome_note_id' | 'decided_by' | 'decision_reason' | 'decided_at'
> &
  Partial<Pick<ResourceAccessRequest, 'status' | 'note_id' | 'outcome_note_id' | 'decided_by' | 'decision_reason' | 'decided_at'>>
export type ResourceAccessRequestUpdate = Partial<
  Omit<ResourceAccessRequest, 'id' | 'project_id' | 'resource_type' | 'resource_id' | 'requester_id' | 'created_at'>
>

export type ProjectJoinRequestInsert = Omit<
  ProjectJoinRequest,
  'id' | 'created_at' | 'status' | 'note_id' | 'outcome_note_id' | 'decided_by' | 'decision_reason' | 'decided_at'
> &
  Partial<Pick<ProjectJoinRequest, 'status' | 'note_id' | 'outcome_note_id' | 'decided_by' | 'decision_reason' | 'decided_at'>>
export type ProjectJoinRequestUpdate = Partial<Omit<ProjectJoinRequest, 'id' | 'project_id' | 'requester_id' | 'created_at'>>

export type ProjectSourceSubmissionInsert = Omit<
  ProjectSourceSubmission,
  | 'id'
  | 'created_at'
  | 'document_id'
  | 'workstream_artifact_id'
  | 'working_knowledge_item_id'
  | 'status'
  | 'decision_reason'
  | 'decided_by'
  | 'decided_at'
> &
  Partial<
    Pick<
      ProjectSourceSubmission,
      'document_id' | 'workstream_artifact_id' | 'working_knowledge_item_id' | 'status' | 'decision_reason' | 'decided_by' | 'decided_at'
    >
  >
export type ProjectSourceSubmissionUpdate = Partial<
  Omit<ProjectSourceSubmission, 'id' | 'project_id' | 'knowledge_base_id' | 'source_kind' | 'title' | 'submitted_by' | 'created_at'>
>

export type ProjectStatusHistoryEntryInsert = Omit<ProjectStatusHistoryEntry, 'id' | 'created_at'>

export type WorkstreamPromotionInsert = Omit<
  WorkstreamPromotion,
  | 'id'
  | 'created_at'
  | 'status'
  | 'decision_reason'
  | 'decided_by'
  | 'decided_at'
  | 'created_project_id'
  | 'client_emails'
  | 'proposed_fee_amount'
  | 'proposed_fee_currency'
  | 'proposed_fee_period'
> &
  Partial<
    Pick<
      WorkstreamPromotion,
      | 'status'
      | 'decision_reason'
      | 'decided_by'
      | 'decided_at'
      | 'created_project_id'
      | 'client_emails'
      | 'proposed_fee_amount'
      | 'proposed_fee_currency'
      | 'proposed_fee_period'
    >
  >
export type WorkstreamPromotionUpdate = Partial<Omit<WorkstreamPromotion, 'id' | 'workstream_id' | 'submitted_by' | 'created_at'>>

export type BuilderProgressUpdateInsert = Omit<BuilderProgressUpdate, 'id' | 'created_at' | 'updated_at' | 'status'> &
  Partial<Pick<BuilderProgressUpdate, 'status'>>
export type BuilderProgressUpdateUpdate = Partial<
  Omit<BuilderProgressUpdate, 'id' | 'workstream_id' | 'submitted_by' | 'created_at'>
>

export type ClientProjectFeeInsert = Omit<ClientProjectFee, 'created_at' | 'updated_at'>
export type ClientProjectFeeUpdate = Partial<Omit<ClientProjectFee, 'project_id' | 'created_at'>>

export type AgencyBuilderInsert = Omit<AgencyBuilder, 'created_at' | 'updated_at'>
export type AgencyBuilderUpdate = Partial<Omit<AgencyBuilder, 'builder_id' | 'created_at'>>

export type BuilderAiAllowanceInsert = Omit<BuilderAiAllowance, 'created_at' | 'updated_at'> &
  Partial<Pick<BuilderAiAllowance, 'monthly_allowance_usd' | 'warning_threshold_pct' | 'stop_at_allowance' | 'current_period_start'>>
export type BuilderAiAllowanceUpdate = Partial<Omit<BuilderAiAllowance, 'builder_id' | 'created_at'>>

export type BuilderCreditGrantInsert = Omit<BuilderCreditGrant, 'id' | 'created_at'>
export type BuilderCreditGrantUpdate = never

export type BuilderLlmCredentialInsert = Omit<BuilderLlmCredential, 'created_at' | 'updated_at' | 'is_active'> &
  Partial<Pick<BuilderLlmCredential, 'is_active'>>
export type BuilderLlmCredentialUpdate = Partial<Omit<BuilderLlmCredential, 'builder_id' | 'created_at'>>

// Owner Roadmap and Ember Feedback Board, Phase 1 (docs/dev-request-owner-
// roadmap-and-ember-feedback-board.md). Authorization is a hardcoded
// two-identity allowlist (platform_owners), deliberately independent of
// UserRole -- "platform admin status alone does not grant owner-board
// access."
export interface PlatformOwner {
  user_id: string
  email: string
  added_by: string | null
  added_at: string
}

export type FeedbackType = 'bug' | 'improvement' | 'feature_request' | 'usability' | 'documentation'
export type FeedbackStatus = 'new' | 'triaged' | 'accepted' | 'deferred' | 'declined' | 'in_progress' | 'ready_to_verify' | 'resolved'
export type FeedbackClassification = 'standard' | 'confidential_security'
export type FeedbackSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface FeedbackReport {
  id: string
  report_number: number
  reporter_id: string
  source_conversation_id: string | null
  type: FeedbackType
  title: string
  description: string
  expected_result: string | null
  actual_result: string | null
  impact: string | null
  reproduction_steps: string | null
  severity: FeedbackSeverity | null
  status: FeedbackStatus
  classification: FeedbackClassification
  current_page: string | null
  project_id: string | null
  application_version: string | null
  environment: string | null
  duplicate_of: string | null
  owner_decision: string | null
  owner_decision_rationale: string | null
  affected_version: string | null
  fixed_version: string | null
  deployed_version: string | null
  assignee_id: string | null
  roadmap_ref: string | null
  created_at: string
  updated_at: string
}

export interface FeedbackReportStatusHistoryEntry {
  id: string
  feedback_report_id: string
  from_status: FeedbackStatus | null
  to_status: FeedbackStatus
  changed_by: string | null
  reason: string | null
  created_at: string
}

export type FeedbackReportInsert = Omit<
  FeedbackReport,
  'id' | 'report_number' | 'status' | 'classification' | 'created_at' | 'updated_at'
> &
  Partial<Pick<FeedbackReport, 'status' | 'classification'>>
export type FeedbackReportUpdate = Partial<Omit<FeedbackReport, 'id' | 'report_number' | 'reporter_id' | 'created_at'>>

export type FeedbackReportStatusHistoryEntryInsert = Omit<FeedbackReportStatusHistoryEntry, 'id' | 'created_at'>

// Owner Roadmap register, in-app (see 20260825130001_roadmap_register.sql's
// own comment) -- the tabular OR-XXX register from docs/commercial/
// ROADMAP.md, moved into an authenticated, owner-editable, exportable
// record. The Markdown file's longer prose detail sections stay where they
// are; this is specifically the register table.
export type RoadmapStatus = 'captured' | 'assessing' | 'proposed' | 'approved' | 'in_progress' | 'validate' | 'done' | 'deferred' | 'declined' | 'superseded'

export interface RoadmapItem {
  id: string
  item_ref: string
  title: string
  item_type: string
  public_milestone: string | null
  priority: string | null
  status: RoadmapStatus
  pilot_position: string | null
  decision_next_action: string | null
  created_at: string
  updated_at: string
}

export type RoadmapItemInsert = Omit<RoadmapItem, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<RoadmapItem, 'status'>>
export type RoadmapItemUpdate = Partial<Omit<RoadmapItem, 'id' | 'item_ref' | 'created_at'>>

export type ProjectWorkstreamInsert = Omit<
  ProjectWorkstream,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'created_via'
  | 'assistant_prompt_version'
  | 'assistant_conversation_id'
  | 'operational_status'
  | 'cloned_from_workstream_id'
  | 'derived_from_method_id'
> &
  Partial<
    Pick<
      ProjectWorkstream,
      | 'created_via'
      | 'assistant_prompt_version'
      | 'assistant_conversation_id'
      | 'operational_status'
      | 'cloned_from_workstream_id'
      | 'derived_from_method_id'
    >
  >
export type ProjectWorkstreamUpdate = Partial<Omit<ProjectWorkstream, 'id' | 'project_id' | 'created_at'>>

export type ProjectObjectInsert = Omit<ProjectObject, 'id' | 'created_at' | 'updated_at'>
export type ProjectObjectUpdate = Partial<Omit<ProjectObject, 'id' | 'project_id' | 'created_at'>>

export type WorkstreamObjectLinkInsert = Omit<WorkstreamObjectLink, 'id' | 'created_at' | 'updated_at'>
export type WorkstreamObjectLinkUpdate = Partial<Omit<WorkstreamObjectLink, 'id' | 'workstream_id' | 'object_id' | 'created_at'>>

export type WorkstreamFlowEdgeInsert = Omit<WorkstreamFlowEdge, 'id' | 'created_at'>
export type WorkstreamFlowEdgeUpdate = never

export type MethodInsert = Omit<
  Method,
  'id' | 'created_at' | 'updated_at' | 'status' | 'published_by' | 'published_at' | 'derived_from_wiki_article_id'
> &
  Partial<Pick<Method, 'status' | 'published_by' | 'published_at' | 'derived_from_wiki_article_id'>>
export type MethodUpdate = Partial<Omit<Method, 'id' | 'derived_from_workstream_id' | 'created_by' | 'created_at'>>

export type PresentationInsert = Omit<
  Presentation,
  'id' | 'created_at' | 'updated_at' | 'status' | 'review_deadline' | 'scheduled_open_at' | 'current_version_id'
> &
  Partial<Pick<Presentation, 'status' | 'review_deadline' | 'scheduled_open_at' | 'current_version_id'>>
// Every transition goes through transitionPresentationStatus -- the other
// fields ever updated in place outside that are current_version_id
// (generatePresentation, right after inserting a new version) and
// scheduled_open_at/review_deadline (scheduleReviewOpen/
// cancelScheduledReviewOpen, and openPresentationReview clearing the
// schedule when a curator opens early).
export type PresentationUpdate = Partial<Pick<Presentation, 'status' | 'review_deadline' | 'scheduled_open_at' | 'current_version_id'>>

export type PresentationVersionInsert = Omit<PresentationVersion, 'id' | 'created_at'>
// Immutable once written -- no update path at all (matches the migration's
// own "no update/delete policy" comment).
export type PresentationVersionUpdate = never

export type PresentationStatusHistoryEntryInsert = Omit<PresentationStatusHistoryEntry, 'id' | 'created_at'>

export type PresentationSlideCommentInsert = Omit<
  PresentationSlideComment,
  'id' | 'created_at' | 'classification' | 'builder_reply' | 'builder_reply_by' | 'builder_reply_at'
> &
  Partial<Pick<PresentationSlideComment, 'classification' | 'builder_reply' | 'builder_reply_by' | 'builder_reply_at'>>
// classifyPendingComments only ever sets classification; replyToComment
// only ever sets the three builder_reply* fields together.
export type PresentationSlideCommentUpdate = Partial<
  Pick<PresentationSlideComment, 'classification' | 'builder_reply' | 'builder_reply_by' | 'builder_reply_at'>
>

export type PresentationActionInsert = Omit<PresentationAction, 'id' | 'created_at' | 'updated_at' | 'status' | 'evidence'> &
  Partial<Pick<PresentationAction, 'status' | 'evidence'>>
export type PresentationActionUpdate = Partial<Pick<PresentationAction, 'status' | 'evidence'>>

// Every descriptive field stays immutable (still an evidence trail) -- OL-010
// added exactly one narrow update path, reviewArtifact(), which only ever
// touches status/validation_notes/reviewed_by/reviewed_at (see
// WorkstreamArtifactUpdate below and workstream_artifacts_update_review_curator).
export type WorkstreamArtifactInsert = Omit<
  WorkstreamArtifact,
  'id' | 'created_at' | 'created_via' | 'assistant_prompt_version' | 'assistant_conversation_id' | 'status' | 'validation_notes' | 'reviewed_by' | 'reviewed_at'
> &
  Partial<Pick<WorkstreamArtifact, 'created_via' | 'assistant_prompt_version' | 'assistant_conversation_id' | 'status' | 'validation_notes'>>
export type WorkstreamArtifactUpdate = Pick<WorkstreamArtifact, 'status'> &
  Partial<Pick<WorkstreamArtifact, 'validation_notes' | 'reviewed_by' | 'reviewed_at'>>

export type AIProviderInsert = Omit<AIProviderRow, 'id' | 'created_at' | 'updated_at'>
export type AIProviderUpdate = Partial<Omit<AIProviderRow, 'id' | 'created_at'>>

export type AIModelInsert = Omit<AIModelRow, 'id' | 'created_at' | 'updated_at'>
export type AIModelUpdate = Partial<Omit<AIModelRow, 'id' | 'provider_id' | 'created_at'>>

// active_version_id is optional at insert time -- a graph is created before
// its first version exists, then activated via a separate UPDATE.
export type GraphInsert = Omit<Graph, 'id' | 'created_at' | 'updated_at' | 'active_version_id'> &
  Partial<Pick<Graph, 'active_version_id'>>
export type GraphUpdate = Partial<Omit<Graph, 'id' | 'created_at'>>

// No GraphVersionUpdate -- graph_versions is insert-only (see the migration
// comment: no UPDATE RLS policy exists at all, same immutability mechanism
// as wiki_versions).
export type GraphVersionInsert = Omit<GraphVersion, 'id' | 'created_at'>

export type GraphRunInsert = Omit<GraphRun, 'id' | 'created_at'>
export type GraphRunUpdate = Partial<Omit<GraphRun, 'id' | 'graph_id' | 'graph_version_id' | 'created_at'>>

export type GraphStepInsert = Omit<GraphStep, 'id'>
export type GraphStepUpdate = Partial<Omit<GraphStep, 'id' | 'graph_run_id' | 'started_at'>>

// agent_templates is an ordinary mutable table (see the interface comment
// above) -- both Insert and Update exist, unlike agent_versions below.
export type AgentTemplateInsert = Omit<AgentTemplate, 'id' | 'created_at' | 'updated_at'>
export type AgentTemplateUpdate = Partial<Omit<AgentTemplate, 'id' | 'created_at'>>

// active_version_id is optional at insert time -- an agent is created
// before its first version exists, then activated via a separate UPDATE,
// same convention as GraphInsert.
export type AgentInsert = Omit<Agent, 'id' | 'created_at' | 'updated_at' | 'active_version_id'> &
  Partial<Pick<Agent, 'active_version_id'>>
export type AgentUpdate = Partial<Omit<Agent, 'id' | 'created_at'>>

// No AgentVersionUpdate -- agent_versions is insert-only (see the migration
// comment: no UPDATE RLS policy exists at all, same immutability mechanism
// as graph_versions/wiki_versions).
export type AgentVersionInsert = Omit<AgentVersion, 'id' | 'created_at'>

export type BuilderIntegrationInsert = Omit<BuilderIntegration, 'id' | 'created_at' | 'updated_at' | 'active_version_id'> &
  Partial<Pick<BuilderIntegration, 'active_version_id'>>
export type BuilderIntegrationUpdate = Partial<Omit<BuilderIntegration, 'id' | 'created_at'>>

export type BuilderIntegrationVersionInsert = Omit<
  BuilderIntegrationVersion,
  'id' | 'created_at' | 'certification_status' | 'approved_by' | 'approved_at' | 'risk_classification' | 'auth_method'
> &
  Partial<Pick<BuilderIntegrationVersion, 'certification_status' | 'risk_classification' | 'auth_method'>>
// Only certification changes go through UPDATE -- every other field is
// immutable once created (a material change means a new version).
export type BuilderIntegrationVersionUpdate = Pick<BuilderIntegrationVersion, 'certification_status'> &
  Partial<Pick<BuilderIntegrationVersion, 'approved_by' | 'approved_at'>>

export type BuilderIntegrationProjectAvailabilityInsert = Omit<BuilderIntegrationProjectAvailability, 'id' | 'created_at'>

export type CapabilityEvaluationInsert = Omit<
  CapabilityEvaluation,
  'id' | 'created_at' | 'updated_at' | 'status' | 'rationale' | 'reviewed_by' | 'reviewed_at'
> &
  Partial<Pick<CapabilityEvaluation, 'status' | 'rationale' | 'reviewed_by' | 'reviewed_at'>>
export type CapabilityEvaluationUpdate = Partial<
  Omit<CapabilityEvaluation, 'id' | 'builder_integration_version_id' | 'template_id' | 'created_by' | 'created_at'>
>

export type BuilderIntegrationInvocationInsert = Omit<
  BuilderIntegrationInvocation,
  'id' | 'created_at' | 'confirmed_at' | 'confirmed_by' | 'executed_at' | 'status' | 'output' | 'error' | 'correlated_amount'
> &
  Partial<Pick<BuilderIntegrationInvocation, 'status' | 'output' | 'error' | 'correlated_amount'>>
export type BuilderIntegrationInvocationUpdate = Partial<Omit<BuilderIntegrationInvocation, 'id' | 'created_at'>>

// @supabase/postgrest-js requires every table to carry a `Relationships`
// array and the schema to declare `Views`, even when empty -- omitting them
// doesn't error, it silently collapses every Row/Insert/Update type to
// `never` throughout the app, which is exactly what happened here once.
export interface Database {
  __InternalSupabase: {
    PostgrestVersion: '12'
  }
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: ProfileInsert; Update: ProfileUpdate; Relationships: [] }
      knowledge_bases: {
        Row: KnowledgeBase
        Insert: Omit<KnowledgeBase, 'created_at' | 'updated_at'>
        Update: Partial<KnowledgeBase>
        Relationships: []
      }
      curation_queue: {
        Row: CurationQueueItem
        Insert: Omit<CurationQueueItem, 'id' | 'created_at'>
        Update: Partial<CurationQueueItem>
        Relationships: []
      }
      documents: { Row: Document; Insert: DocumentInsert; Update: DocumentUpdate; Relationships: [] }
      knowledge_sources: {
        Row: KnowledgeSource
        Insert: KnowledgeSourceInsert
        Update: KnowledgeSourceUpdate
        Relationships: []
      }
      document_chunks: { Row: DocumentChunk; Insert: ChunkInsert; Update: ChunkUpdate; Relationships: [] }
      kb_vectors: { Row: KBVector; Insert: KBVectorInsert; Update: KBVectorUpdate; Relationships: [] }
      settings: { Row: Setting; Insert: Setting; Update: Partial<Setting>; Relationships: [] }
      ai_operation_logs: {
        Row: AIOperationLog
        Insert: Omit<AIOperationLog, 'id' | 'created_at' | 'applied_method_id'> & Partial<Pick<AIOperationLog, 'applied_method_id'>>
        Update: Partial<AIOperationLog>
        Relationships: []
      }
      wiki_categories: {
        Row: WikiCategory
        Insert: Omit<WikiCategory, 'created_at'>
        Update: Partial<WikiCategory>
        Relationships: []
      }
      wiki_articles: { Row: WikiArticle; Insert: WikiArticleInsert; Update: WikiArticleUpdate; Relationships: [] }
      project_wiki_articles: {
        Row: ProjectWikiArticle
        Insert: ProjectWikiArticleInsert
        Update: ProjectWikiArticleUpdate
        Relationships: []
      }
      project_knowledge_bases: {
        Row: ProjectKnowledgeBase
        Insert: ProjectKnowledgeBaseInsert
        Update: ProjectKnowledgeBaseUpdate
        Relationships: []
      }
      workstream_knowledge_bases: {
        Row: WorkstreamKnowledgeBase
        Insert: WorkstreamKnowledgeBaseInsert
        Update: WorkstreamKnowledgeBaseUpdate
        Relationships: []
      }
      wiki_versions: { Row: WikiVersion; Insert: WikiVersionInsert; Update: WikiVersionUpdate; Relationships: [] }
      wiki_sources: { Row: WikiSource; Insert: WikiSourceInsert; Update: Partial<WikiSource>; Relationships: [] }
      wiki_relations: {
        Row: WikiRelation
        Insert: WikiRelationInsert
        Update: Partial<WikiRelation>
        Relationships: []
      }
      wiki_vectors: { Row: WikiVector; Insert: WikiVectorInsert; Update: Partial<WikiVector>; Relationships: [] }
      trending_items: { Row: TrendingItem; Insert: TrendingItemInsert; Update: TrendingItemUpdate; Relationships: [] }
      blog_posts: { Row: BlogPost; Insert: BlogPostInsert; Update: BlogPostUpdate; Relationships: [] }
      blog_relations: { Row: BlogRelation; Insert: BlogRelationInsert; Update: Partial<BlogRelation>; Relationships: [] }
      trending_comments: { Row: TrendingComment; Insert: TrendingCommentInsert; Update: Partial<TrendingComment>; Relationships: [] }
      trending_wiki_links: { Row: TrendingWikiLink; Insert: TrendingWikiLinkInsert; Update: Partial<TrendingWikiLink>; Relationships: [] }
      project_notes: { Row: ProjectNote; Insert: ProjectNoteInsert; Update: ProjectNoteUpdate; Relationships: [] }
      project_note_replies: { Row: ProjectNoteReply; Insert: ProjectNoteReplyInsert; Update: Partial<ProjectNoteReply>; Relationships: [] }
      working_knowledge_items: {
        Row: WorkingKnowledgeItem
        Insert: WorkingKnowledgeItemInsert
        Update: WorkingKnowledgeItemUpdate
        Relationships: []
      }
      working_knowledge_sources: { Row: WorkingKnowledgeSource; Insert: WorkingKnowledgeSourceInsert; Update: Partial<WorkingKnowledgeSource>; Relationships: [] }
      working_knowledge_shares: {
        Row: WorkingKnowledgeShare
        Insert: WorkingKnowledgeShareInsert
        Update: WorkingKnowledgeShareUpdate
        Relationships: []
      }
      eval_datasets: { Row: EvalDataset; Insert: EvalDatasetInsert; Update: EvalDatasetUpdate; Relationships: [] }
      eval_cases: { Row: EvalCase; Insert: EvalCaseInsert; Update: EvalCaseUpdate; Relationships: [] }
      eval_runs: { Row: EvalRun; Insert: EvalRunInsert; Update: EvalRunUpdate; Relationships: [] }
      eval_results: { Row: EvalResult; Insert: EvalResultInsert; Update: EvalResultUpdate; Relationships: [] }
      projects: { Row: Project; Insert: ProjectInsert; Update: ProjectUpdate; Relationships: [] }
      project_members: { Row: ProjectMember; Insert: ProjectMemberInsert; Update: ProjectMemberUpdate; Relationships: [] }
      project_approval_policies: {
        Row: ProjectApprovalPolicy
        Insert: ProjectApprovalPolicyInsert
        Update: ProjectApprovalPolicyUpdate
        Relationships: []
      }
      project_authority_assignments: {
        Row: ProjectAuthorityAssignment
        Insert: ProjectAuthorityAssignmentInsert
        Update: ProjectAuthorityAssignmentUpdate
        Relationships: []
      }
      project_access_groups: { Row: ProjectAccessGroup; Insert: ProjectAccessGroupInsert; Update: ProjectAccessGroupUpdate; Relationships: [] }
      project_access_group_members: {
        Row: ProjectAccessGroupMember
        Insert: ProjectAccessGroupMemberInsert
        Update: ProjectAccessGroupMemberUpdate
        Relationships: []
      }
      resource_access_policies: {
        Row: ResourceAccessPolicy
        Insert: ResourceAccessPolicyInsert
        Update: ResourceAccessPolicyUpdate
        Relationships: []
      }
      resource_access_grants: { Row: ResourceAccessGrant; Insert: ResourceAccessGrantInsert; Update: ResourceAccessGrantUpdate; Relationships: [] }
      resource_access_audit_log: { Row: ResourceAccessAuditLogEntry; Insert: ResourceAccessAuditLogEntryInsert; Update: never; Relationships: [] }
      resource_access_requests: {
        Row: ResourceAccessRequest
        Insert: ResourceAccessRequestInsert
        Update: ResourceAccessRequestUpdate
        Relationships: []
      }
      project_join_requests: {
        Row: ProjectJoinRequest
        Insert: ProjectJoinRequestInsert
        Update: ProjectJoinRequestUpdate
        Relationships: []
      }
      project_source_submissions: {
        Row: ProjectSourceSubmission
        Insert: ProjectSourceSubmissionInsert
        Update: ProjectSourceSubmissionUpdate
        Relationships: []
      }
      workstream_promotions: {
        Row: WorkstreamPromotion
        Insert: WorkstreamPromotionInsert
        Update: WorkstreamPromotionUpdate
        Relationships: []
      }
      builder_progress_updates: {
        Row: BuilderProgressUpdate
        Insert: BuilderProgressUpdateInsert
        Update: BuilderProgressUpdateUpdate
        Relationships: []
      }
      client_project_fees: {
        Row: ClientProjectFee
        Insert: ClientProjectFeeInsert
        Update: ClientProjectFeeUpdate
        Relationships: []
      }
      agency_builders: {
        Row: AgencyBuilder
        Insert: AgencyBuilderInsert
        Update: AgencyBuilderUpdate
        Relationships: []
      }
      builder_ai_allowances: {
        Row: BuilderAiAllowance
        Insert: BuilderAiAllowanceInsert
        Update: BuilderAiAllowanceUpdate
        Relationships: []
      }
      builder_credit_grants: {
        Row: BuilderCreditGrant
        Insert: BuilderCreditGrantInsert
        Update: BuilderCreditGrantUpdate
        Relationships: []
      }
      builder_llm_credentials: {
        Row: BuilderLlmCredential
        Insert: BuilderLlmCredentialInsert
        Update: BuilderLlmCredentialUpdate
        Relationships: []
      }
      ai_provider_sensitivity_eligibility: {
        Row: AiProviderSensitivityEligibility
        Insert: AiProviderSensitivityEligibilityInsert
        Update: AiProviderSensitivityEligibilityUpdate
        Relationships: []
      }
      project_status_history: { Row: ProjectStatusHistoryEntry; Insert: ProjectStatusHistoryEntryInsert; Update: never; Relationships: [] }
      platform_owners: { Row: PlatformOwner; Insert: PlatformOwner; Update: never; Relationships: [] }
      feedback_reports: { Row: FeedbackReport; Insert: FeedbackReportInsert; Update: FeedbackReportUpdate; Relationships: [] }
      feedback_report_status_history: {
        Row: FeedbackReportStatusHistoryEntry
        Insert: FeedbackReportStatusHistoryEntryInsert
        Update: never
        Relationships: []
      }
      roadmap_items: { Row: RoadmapItem; Insert: RoadmapItemInsert; Update: RoadmapItemUpdate; Relationships: [] }
      project_workstreams: { Row: ProjectWorkstream; Insert: ProjectWorkstreamInsert; Update: ProjectWorkstreamUpdate; Relationships: [] }
      project_objects: { Row: ProjectObject; Insert: ProjectObjectInsert; Update: ProjectObjectUpdate; Relationships: [] }
      workstream_object_links: {
        Row: WorkstreamObjectLink
        Insert: WorkstreamObjectLinkInsert
        Update: WorkstreamObjectLinkUpdate
        Relationships: []
      }
      workstream_flow: { Row: WorkstreamFlowEdge; Insert: WorkstreamFlowEdgeInsert; Update: WorkstreamFlowEdgeUpdate; Relationships: [] }
      methods: { Row: Method; Insert: MethodInsert; Update: MethodUpdate; Relationships: [] }
      workstream_artifacts: { Row: WorkstreamArtifact; Insert: WorkstreamArtifactInsert; Update: WorkstreamArtifactUpdate; Relationships: [] }
      presentations: { Row: Presentation; Insert: PresentationInsert; Update: PresentationUpdate; Relationships: [] }
      presentation_versions: { Row: PresentationVersion; Insert: PresentationVersionInsert; Update: PresentationVersionUpdate; Relationships: [] }
      presentation_status_history: {
        Row: PresentationStatusHistoryEntry
        Insert: PresentationStatusHistoryEntryInsert
        Update: never
        Relationships: []
      }
      presentation_slide_comments: {
        Row: PresentationSlideComment
        Insert: PresentationSlideCommentInsert
        Update: PresentationSlideCommentUpdate
        Relationships: []
      }
      presentation_actions: { Row: PresentationAction; Insert: PresentationActionInsert; Update: PresentationActionUpdate; Relationships: [] }
      system_assessments: { Row: SystemAssessment; Insert: SystemAssessmentInsert; Update: SystemAssessmentUpdate; Relationships: [] }
      system_assessment_versions: { Row: SystemAssessmentVersion; Insert: SystemAssessmentVersionInsert; Update: Partial<SystemAssessmentVersion>; Relationships: [] }
      system_assessment_questions: { Row: SystemAssessmentQuestion; Insert: SystemAssessmentQuestionInsert; Update: Partial<SystemAssessmentQuestion>; Relationships: [] }
      assessment_responses: { Row: AssessmentResponse; Insert: AssessmentResponseInsert; Update: AssessmentResponseUpdate; Relationships: [] }
      assessment_answers: { Row: AssessmentAnswer; Insert: AssessmentAnswerInsert; Update: AssessmentAnswerUpdate; Relationships: [] }
      ai_providers: { Row: AIProviderRow; Insert: AIProviderInsert; Update: AIProviderUpdate; Relationships: [] }
      ai_models: { Row: AIModelRow; Insert: AIModelInsert; Update: AIModelUpdate; Relationships: [] }
      graphs: { Row: Graph; Insert: GraphInsert; Update: GraphUpdate; Relationships: [] }
      graph_versions: { Row: GraphVersion; Insert: GraphVersionInsert; Update: never; Relationships: [] }
      graph_runs: { Row: GraphRun; Insert: GraphRunInsert; Update: GraphRunUpdate; Relationships: [] }
      agent_templates: { Row: AgentTemplate; Insert: AgentTemplateInsert; Update: AgentTemplateUpdate; Relationships: [] }
      agents: { Row: Agent; Insert: AgentInsert; Update: AgentUpdate; Relationships: [] }
      agent_versions: { Row: AgentVersion; Insert: AgentVersionInsert; Update: never; Relationships: [] }
      builder_integrations: { Row: BuilderIntegration; Insert: BuilderIntegrationInsert; Update: BuilderIntegrationUpdate; Relationships: [] }
      builder_integration_versions: {
        Row: BuilderIntegrationVersion
        Insert: BuilderIntegrationVersionInsert
        Update: BuilderIntegrationVersionUpdate
        Relationships: []
      }
      builder_integration_project_availability: {
        Row: BuilderIntegrationProjectAvailability
        Insert: BuilderIntegrationProjectAvailabilityInsert
        Update: never
        Relationships: []
      }
      capability_evaluations: {
        Row: CapabilityEvaluation
        Insert: CapabilityEvaluationInsert
        Update: CapabilityEvaluationUpdate
        Relationships: []
      }
      builder_integration_invocations: {
        Row: BuilderIntegrationInvocation
        Insert: BuilderIntegrationInvocationInsert
        Update: BuilderIntegrationInvocationUpdate
        Relationships: []
      }
      graph_steps: { Row: GraphStep; Insert: GraphStepInsert; Update: GraphStepUpdate; Relationships: [] }
      conversations: { Row: Conversation; Insert: ConversationInsert; Update: ConversationUpdate; Relationships: [] }
      chat_messages: { Row: ChatMessageRow; Insert: ChatMessageInsert; Update: never; Relationships: [] }
    }
    Views: Record<string, never>
    Functions: {
      is_admin: { Args: { uid: string }; Returns: boolean }
      is_curator_or_admin: { Args: { uid: string }; Returns: boolean }
      increment_approved_chunks: { Args: { doc_id: string }; Returns: void }
      increment_rejected_chunks: { Args: { doc_id: string }; Returns: void }
      match_documents: {
        Args: {
          query_embedding: number[]
          match_threshold?: number
          match_count?: number
          filter_doc_type?: string
          filter_use_cases?: string[]
        }
        Returns: { id: string; chunk_id: string; content: string; similarity: number; metadata: Record<string, unknown> }[]
      }
      match_wiki_vectors: {
        Args: {
          query_embedding: number[]
          match_threshold?: number
          match_count?: number
        }
        Returns: {
          id: string
          wiki_version_id: string
          wiki_article_id: string
          content: string
          similarity: number
          article_slug: string
          article_title: string
        }[]
      }
    }
  }
}
