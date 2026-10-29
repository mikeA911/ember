// Sets up an Ember SLI organisation (ADR-0005) on an instance, idempotently:
// the organisation, its SLI settings, departments and Trigger types, and the
// owner's membership (Discovery team lead, sponsor). With --synthetic it also
// adds a few fictional Triggers, only if the organisation has none yet.
//
//   node --env-file=.env.local scripts/sli-setup.mjs --owner you@example.com [--synthetic]
//
// Options (defaults are Sandz's): --name "Sandz" --slug sandz
//   --product "Ember Sandz" --byline "Solution Lifecycle Intelligence"
//   --visibility all_members|own
// The owner must already have an account (a profiles row). Synthetic data
// only: never put real customer, staff or partner details in --synthetic.
import { createClient } from '@supabase/supabase-js'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const ownerEmail = arg('owner', process.env.SLI_OWNER_EMAIL)
if (!ownerEmail) throw new Error('Give the owner with --owner <email> (or SLI_OWNER_EMAIL)')

const org = {
  name: arg('name', 'Sandz'),
  slug: arg('slug', 'sandz'),
  product: arg('product', 'Ember Sandz'),
  byline: arg('byline', 'Solution Lifecycle Intelligence'),
  visibility: arg('visibility', 'all_members'),
}

const DEPARTMENTS = [
  { code: 'discovery', name: 'Discovery team', is_discovery_team: true, accepts_handoffs: false },
  { code: 'marketing', name: 'Marketing', is_discovery_team: false, accepts_handoffs: true },
  { code: 'sales', name: 'Sales', is_discovery_team: false, accepts_handoffs: true },
  { code: 'presales', name: 'Presales', is_discovery_team: false, accepts_handoffs: true },
  { code: 'engineering', name: 'Engineering', is_discovery_team: false, accepts_handoffs: true },
  { code: 'delivery', name: 'Project Delivery', is_discovery_team: false, accepts_handoffs: true },
  { code: 'support', name: 'Maintenance & Support', is_discovery_team: false, accepts_handoffs: false },
]

const TRIGGER_TYPES = [
  ['management_idea', 'Management idea'],
  ['market_event', 'Market event'],
  ['customer_problem', 'Customer problem'],
  ['technology', 'Technology development'],
  ['partner_offering', 'Partner offering'],
  ['employee_suggestion', 'Employee suggestion'],
  ['downstream_lesson', 'Lesson from a later stage'],
]

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

const owner = must(await db.from('profiles').select('id, email').ilike('email', ownerEmail).maybeSingle(), 'Find owner')
if (!owner) throw new Error(`No account for ${ownerEmail}. Create it first (scripts/create-mike-admin.mjs or the Admin page).`)

const orgRow = must(
  await db.from('organizations').upsert({ slug: org.slug, name: org.name }, { onConflict: 'slug' }).select('id').single(),
  'Organisation'
)
const orgId = orgRow.id

must(
  await db
    .from('sli_settings')
    .upsert({ organization_id: orgId, product_name: org.product, byline: org.byline, trigger_visibility: org.visibility }, { onConflict: 'organization_id' }),
  'Settings'
)

const departments = must(
  await db
    .from('sli_departments')
    .upsert(DEPARTMENTS.map((d, i) => ({ ...d, organization_id: orgId, sort_order: i + 1 })), { onConflict: 'organization_id,code' })
    .select('id, code'),
  'Departments'
)
const deptId = Object.fromEntries(departments.map((d) => [d.code, d.id]))

must(
  await db
    .from('sli_trigger_types')
    .upsert(TRIGGER_TYPES.map(([code, label], i) => ({ organization_id: orgId, code, label, sort_order: i + 1 })), { onConflict: 'organization_id,code' }),
  'Trigger types'
)

const hasDefault = must(await db.from('organization_members').select('organization_id').eq('user_id', owner.id).eq('is_default', true), 'Default org')
must(
  await db.from('organization_members').upsert(
    { organization_id: orgId, user_id: owner.id, role: 'owner', status: 'active', is_default: hasDefault.length === 0 || hasDefault[0].organization_id === orgId },
    { onConflict: 'organization_id,user_id' }
  ),
  'Owner membership'
)
must(
  await db.from('sli_department_members').upsert(
    { organization_id: orgId, department_id: deptId.discovery, user_id: owner.id, role: 'lead', can_sponsor: true, status: 'active' },
    { onConflict: 'department_id,user_id' }
  ),
  'Owner department'
)

console.log(`Organisation "${org.name}" (${org.slug}) ready: ${DEPARTMENTS.length} departments, ${TRIGGER_TYPES.length} Trigger types.`)
console.log(`${owner.email} is its owner and leads the Discovery team.`)

if (flag('synthetic')) {
  const existing = must(await db.from('sli_triggers').select('id', { count: 'exact', head: false }).eq('organization_id', orgId).limit(1), 'Existing Triggers')
  if (existing.length > 0) {
    console.log('Synthetic Triggers skipped: the organisation already has Triggers.')
  } else {
    // Fictional examples, following the worked examples in
    // docs/dev-request-sandz-sli-discovery-and-triggers.md §10 and §10b.
    const SAMPLES = [
      {
        title: 'VMware licensing changes: migration opportunity',
        trigger_type: 'market_event',
        stage: 'researching',
        sponsored: true,
        summary:
          'After the acquisition, VMware licensing moved to subscription bundles and many customers report much higher renewal costs. Companies running VMware on our storage may want a migration path and a cost assessment.',
        event_reference: 'Synthetic example',
        strategic_objective: 'Grow managed cloud revenue',
        path: ['researching'],
      },
      {
        title: 'AI warehouse monitoring on partner GPU infrastructure',
        trigger_type: 'management_idea',
        stage: 'concept',
        sponsored: true,
        summary: 'Computer vision for warehouse safety and stock monitoring, running on partner GPU capacity. Target: logistics and warehousing.',
        strategic_objective: 'Expand the AI solutions business',
        path: ['researching', 'concept'],
      },
      {
        title: 'Stricter data residency expectations for banks',
        trigger_type: 'market_event',
        stage: 'new',
        sponsored: false,
        summary: 'Fictional: a regulator circular suggests banks keep more workloads in-country. Could favour local cloud capacity.',
        path: [],
      },
      {
        title: 'Campaign prospects asking for disaster recovery',
        trigger_type: 'downstream_lesson',
        stage: 'new',
        sponsored: false,
        summary: 'Fictional: several prospects in the VMware campaign also asked about disaster recovery as a service.',
        path: [],
        sourceIndex: 0,
      },
    ]
    const created = []
    for (const [i, s] of SAMPLES.entries()) {
      const code = `TRG-${String(i + 1).padStart(3, '0')}`
      const row = must(
        await db
          .from('sli_triggers')
          .insert({
            organization_id: orgId,
            code,
            title: s.title,
            trigger_type: s.trigger_type,
            source_department_id: deptId.discovery,
            raised_by: owner.id,
            sponsor_id: s.sponsored ? owner.id : null,
            summary: s.summary,
            event_reference: s.event_reference ?? null,
            strategic_objective: s.strategic_objective ?? null,
            stage: s.stage,
            source_trigger_id: s.sourceIndex !== undefined ? created[s.sourceIndex] : null,
          })
          .select('id')
          .single(),
        `Trigger ${code}`
      )
      created.push(row.id)
      let from = 'new'
      const history = [{ organization_id: orgId, trigger_id: row.id, event: 'raised', from_stage: null, to_stage: 'new', changed_by: owner.id, reason: 'Synthetic example' }]
      for (const to of s.path) {
        history.push({ organization_id: orgId, trigger_id: row.id, event: 'stage_change', from_stage: from, to_stage: to, changed_by: owner.id, reason: null })
        from = to
      }
      must(await db.from('sli_trigger_stage_history').insert(history), `History ${code}`)
    }
    must(await db.from('sli_settings').update({ next_trigger_number: SAMPLES.length + 1 }).eq('organization_id', orgId), 'Counter')
    console.log(`Added ${SAMPLES.length} synthetic Triggers (TRG-001 to TRG-${String(SAMPLES.length).padStart(3, '0')}).`)
  }
}
