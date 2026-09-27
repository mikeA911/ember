// Brings every source (file) from the old "Cebu ng911" Project
// (import-cebu-ng911.mjs) into the new "cebu-ng911" Project
// (seed-cebu-ng911-project.mjs).
//
// A Project's sources are the knowledge_sources/documents of the knowledge
// bases attached to it (listSourcesForKnowledgeBases, src/lib/projects/
// queries.ts), and project_knowledge_bases is many-to-many -- so this
// attaches the old Project's knowledge bases to the new one rather than
// re-uploading or duplicating any file. Same documents, same versions, same
// approval state and provenance.
//
// A project_private knowledge base is by definition attached to one Project
// only (attachKnowledgeBase refuses it in the UI); sharing one with a second
// Project is exactly what selected_projects is for, so such a knowledge base
// is re-scoped to selected_projects before being attached. That widens its
// audience to the new Project's active members -- the output says so.
//
// Not moved, only reported: workstream artifacts, pending source
// submissions and Working Knowledge notebooks. Those aren't sources yet,
// and submitArtifactSource deliberately refuses an artifact from another
// Project -- submit them as sources on the old Project instead (they then
// reach the new one through the shared knowledge base).
//
// Dry run by default; pass --apply to write.
// Usage: node --env-file=.env.local scripts/copy-cebu-ng911-sources.mjs [--apply]
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const OLD_PROJECT_NAME = 'Cebu ng911'
const NEW_PROJECT_NAME = 'cebu-ng911'
const ACTOR_EMAIL = 'mike.aguilar@gmail.com'
const apply = process.argv.includes('--apply')

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function requireOneProject(name) {
  const { data, error } = await admin.from('projects').select('id, name').eq('name', name)
  if (error) throw error
  if (data.length !== 1) throw new Error(`Expected exactly one project named "${name}", found ${data.length}`)
  return data[0]
}

const oldProject = await requireOneProject(OLD_PROJECT_NAME)
const newProject = await requireOneProject(NEW_PROJECT_NAME)
const { data: actor, error: actorError } = await admin.from('profiles').select('id').eq('email', ACTOR_EMAIL).single()
if (actorError || !actor) throw actorError ?? new Error(`${ACTOR_EMAIL} profile not found`)

console.log(`${apply ? 'APPLYING' : 'DRY RUN (pass --apply to write)'}: "${oldProject.name}" (${oldProject.id}) -> "${newProject.name}" (${newProject.id})\n`)

// -- Knowledge bases (the sources themselves) -----------------------------
const { data: oldLinks, error: oldLinksError } = await admin
  .from('project_knowledge_bases')
  .select('knowledge_base_id, purpose')
  .eq('project_id', oldProject.id)
if (oldLinksError) throw oldLinksError

const { data: newLinks, error: newLinksError } = await admin
  .from('project_knowledge_bases')
  .select('knowledge_base_id')
  .eq('project_id', newProject.id)
if (newLinksError) throw newLinksError
const alreadyAttached = new Set(newLinks.map((l) => l.knowledge_base_id))

const kbIds = oldLinks.map((l) => l.knowledge_base_id)
const { data: kbs, error: kbError } =
  kbIds.length > 0
    ? await admin.from('knowledge_bases').select('id, name, visibility_scope').in('id', kbIds)
    : { data: [], error: null }
if (kbError) throw kbError

const { data: sources, error: sourceError } =
  kbIds.length > 0
    ? await admin.from('knowledge_sources').select('knowledge_base_id, title, lifecycle_status').in('knowledge_base_id', kbIds).order('title')
    : { data: [], error: null }
if (sourceError) throw sourceError

if (kbs.length === 0) console.log('The old project has no attached knowledge bases -- no sources to bring over.')

let attached = 0
for (const kb of kbs) {
  const kbSources = sources.filter((s) => s.knowledge_base_id === kb.id)
  console.log(`Knowledge base "${kb.name}" (${kb.id}, ${kb.visibility_scope}): ${kbSources.length} source(s)`)
  for (const s of kbSources) console.log(`  - ${s.title}${s.lifecycle_status ? ` [${s.lifecycle_status}]` : ''}`)

  if (alreadyAttached.has(kb.id)) {
    console.log('  already attached to the new project, skipping\n')
    continue
  }
  if (apply) {
    const { error } = await admin.from('project_knowledge_bases').insert({
      project_id: newProject.id,
      knowledge_base_id: kb.id,
      purpose: oldLinks.find((l) => l.knowledge_base_id === kb.id)?.purpose ?? null,
      attached_by: actor.id,
    })
    // project_knowledge_bases_require_active_kb rejects an inactive KB --
    // report it and carry on with the rest rather than aborting halfway.
    if (error) {
      console.log(`  NOT attached: ${error.message}\n`)
      continue
    }
  }
  // Only after the attach succeeded, so a failed attach never widens scope.
  if (kb.visibility_scope === 'project_private') {
    console.log('  project_private -> selected_projects, so it can be shared with the new project (its members gain access)')
    if (apply) {
      const { error } = await admin.from('knowledge_bases').update({ visibility_scope: 'selected_projects' }).eq('id', kb.id)
      if (error) throw error
    }
  }
  attached++
  console.log(`  ${apply ? 'attached' : 'would attach'} to the new project\n`)
}

// -- Report-only: project content that isn't a source yet ------------------
const { data: workstreams, error: wsError } = await admin.from('project_workstreams').select('id, name').eq('project_id', oldProject.id)
if (wsError) throw wsError
const wsIds = workstreams.map((w) => w.id)
const { data: artifacts, error: artifactError } =
  wsIds.length > 0
    ? await admin.from('workstream_artifacts').select('workstream_id, title, artifact_type, status, external_url').in('workstream_id', wsIds)
    : { data: [], error: null }
if (artifactError) throw artifactError

const { data: pending, error: pendingError } = await admin
  .from('project_source_submissions')
  .select('title, source_kind')
  .eq('project_id', oldProject.id)
  .eq('status', 'pending')
if (pendingError) throw pendingError

const { data: notebooks, error: notebookError } = await admin.from('working_knowledge_items').select('title').eq('project_id', oldProject.id)
if (notebookError) console.error(`(Could not list Working Knowledge notebooks: ${notebookError.message})`)

if (artifacts.length + pending.length + (notebooks?.length ?? 0) > 0) {
  console.log('Not moved -- not sources yet (submit them as sources on the OLD project; they reach the new one through the shared knowledge base):')
  for (const a of artifacts) {
    const ws = workstreams.find((w) => w.id === a.workstream_id)?.name
    console.log(`  - artifact "${a.title}" (${a.artifact_type}, ${a.status}${a.external_url ? ', link' : ''}) in workstream ${ws}`)
  }
  for (const p of pending) console.log(`  - pending ${p.source_kind} submission "${p.title}" (approve it on the old project)`)
  for (const n of notebooks ?? []) console.log(`  - Working Knowledge notebook "${n.title}"`)
}

console.log(`\n${apply ? 'Attached' : 'Would attach'} ${attached} knowledge base(s), ${sources.length} source(s) in total across the old project's knowledge.`)
