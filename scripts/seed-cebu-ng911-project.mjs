// Creates the "cebu-ng911" Project the same way the /projects/new wizard's
// createProject (src/lib/workbench/projects.ts) would: a draft consulting
// Project owned by a test consultant (the projects_create_owner_membership
// trigger adds the owner's project_members row), mike.aguilar@gmail.com
// staged as Project curator, and one presales Workstream per system
// integration (CCTO Motorola radio, Mitel PBX, KabatOne K-Safety).
//
// Idempotent: an existing "cebu-ng911" Project is reused, and only its
// missing curator membership / workstreams are added. It never touches
// "Cebu ng911" (import-cebu-ng911.mjs's ontology import) and never changes
// any account's password or platform role.
//
// Usage: node --env-file=.env.local scripts/seed-cebu-ng911-project.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const PROJECT_NAME = 'cebu-ng911'
const OWNER_EMAIL = 'test-consultant@kbsandbox.local'
const CURATOR_EMAIL = 'mike.aguilar@gmail.com'

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function requireProfile(email, hint) {
  const { data, error } = await admin.from('profiles').select('id, email, role').eq('email', email).maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`${email} profile not found -- ${hint}`)
  return data
}

const owner = await requireProfile(OWNER_EMAIL, 'run npm run db:seed-users first')
const curator = await requireProfile(CURATOR_EMAIL, 'that account must sign up (or be created) before it can be staged')

// Every workstream is presales: the integrations are still being scoped and
// the vendor claims behind them validated -- nothing is deployed yet.
const workstreams = [
  {
    name: 'CCTO Motorola Radio Integration',
    slug: 'ccto-motorola-radio-integration',
    goal:
      "Integrate the city's Motorola radio fleet with the NG911 platform so field units appear on the operational map and dispatch can reach them from the command center. " +
      'Confirm radio model, protocol (e.g. DMR/P25), the GPS/AVL reporting format and the available gateway or console APIs. ' +
      "Validate whether K-Safety's AVL engine supports that protocol for real-time tracking (open item on the K-Safety evaluation checklist). " +
      'Ownership needs confirming: the ontology records the 5-channel Motorola network as operated by CCDRRMO, not CCTO.',
    deliverables: [
      'Radio fleet and channel inventory (models, protocol, GPS capability)',
      'AVL / gateway interface specification',
      'K-Safety AVL protocol compatibility finding',
      'Integration design and test plan',
    ],
  },
  {
    name: 'Mitel PBX Integration',
    slug: 'mitel-pbx-integration',
    goal:
      "Integrate the Mitel PBX with the NG911 call-handling flow: SIP trunking to carriers (NG911 Phase 1 SIP connectivity), call-taker ACD/queues and CTI so a 911 call opens a K-Dispatch incident with caller number and location. " +
      'Confirm the PBX model and software release, SIP/CTI interfaces, and call-location data (ANI/ALI or device-based location), ' +
      'and cover call recording, TDoS protection and the handoff between the city center and the BFP-run Visayas regional hub.',
    deliverables: [
      'PBX inventory and interface summary (SIP, CTI, recording)',
      'Call flow: carrier -> PBX -> call-taker -> K-Dispatch incident',
      'Caller-location and data-privacy handling notes',
      'Integration design and test plan',
    ],
  },
  {
    name: 'KabatOne K-Safety Integration',
    slug: 'kabatone-k-safety-integration',
    goal:
      "Integrate KabatOne K-Safety as the situational-awareness layer: unified GIS operational map, AVL, sensor fusion and alerting, and dispatch recommendations fed from K-Dispatch and K-Video. " +
      "Validate the vendor's claims (currently unverified) against Cebu's needs: REST/WebSocket mapping to the DILG Region VII hub gateway, NENA i3 conformance, " +
      'MQTT/CoAP sensor ingestion, ONVIF camera bridging, and offline caching of base maps and GIS layers on edge servers for typhoon connectivity loss.',
    deliverables: [
      'Validated K-Safety capability matrix (vendor claim vs. evidence)',
      'DILG hub gateway API mapping',
      'Offline map-caching / edge resilience finding',
      'Integration design and test plan',
    ],
  },
]

let projectId
const { data: existing, error: existingError } = await admin.from('projects').select('id, owner_id').eq('name', PROJECT_NAME).maybeSingle()
if (existingError) throw existingError

if (existing) {
  projectId = existing.id
  console.log(`Project "${PROJECT_NAME}" already exists (${projectId}) -- filling in anything missing.`)
} else {
  const { data: project, error } = await admin
    .from('projects')
    .insert({
      name: PROJECT_NAME,
      project_type: 'consulting',
      objective:
        'Scope and validate the system integrations for the Cebu NG911 and Safe City modernization (Sandz / KabatOne): Motorola radio, Mitel PBX and KabatOne K-Safety.',
      status: 'draft',
      notes: null,
      details: {
        business_problem:
          "Cebu's emergency call intake is fragmented and analog (the city's NGA-based 911 center under CCDRRMO has been costly to maintain), field radio, telephony and situational-awareness systems are not connected, and there is no unified GIS operational map across incidents, units and infrastructure. No Cebu-specific call-answer or response-time data is published.",
        target_outcome:
          'A validated integration design for each system (radio AVL and dispatch, PBX call handling, K-Safety situational awareness), with vendor claims checked against evidence and data-privacy obligations (Data Privacy Act) for caller-location and CCTV data tracked.',
      },
      owner_id: owner.id,
    })
    .select('id')
    .single()
  if (error || !project) throw error ?? new Error('Failed to create project')
  projectId = project.id
  console.log(`Created project "${PROJECT_NAME}" (${projectId}) owned by ${OWNER_EMAIL}`)

  const { error: historyError } = await admin
    .from('project_status_history')
    .insert({ project_id: projectId, from_status: null, to_status: 'draft', actor_id: owner.id })
  if (historyError) console.error('Failed to log initial status (non-fatal):', historyError.message)
}

// Staged the same way the wizard stages members -- an active project_members
// row. Upsert so a re-run also repairs a missing or lapsed curator row.
const { error: memberError } = await admin
  .from('project_members')
  .upsert({ project_id: projectId, user_id: curator.id, role: 'curator', status: 'active' }, { onConflict: 'project_id,user_id' })
if (memberError) throw memberError
console.log(`${CURATOR_EMAIL} is an active curator of the project`)

const { data: existingWorkstreams, error: wsListError } = await admin
  .from('project_workstreams')
  .select('slug')
  .eq('project_id', projectId)
if (wsListError) throw wsListError
const existingSlugs = new Set(existingWorkstreams.map((w) => w.slug))

for (const w of workstreams) {
  if (existingSlugs.has(w.slug)) {
    console.log(`Workstream "${w.name}" already exists, skipping`)
    continue
  }
  const { data, error } = await admin
    .from('project_workstreams')
    .insert({
      project_id: projectId,
      parent_workstream_id: null,
      name: w.name,
      slug: w.slug,
      status: 'draft',
      repository_scope: [],
      goal: w.goal,
      deliverables: w.deliverables.map((label) => ({ label, completed: false })),
      lifecycle_stage: 'presales',
      created_by: owner.id,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error(`Failed to create workstream ${w.name}`)
  console.log(`Created workstream "${w.name}" (${data.id})`)
}

console.log(`\nDone. Open ${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsandbox.tech'}/projects/${projectId}`)
