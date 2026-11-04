import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Real PostgreSQL, in memory: the SLI migrations run against a small
// stand-in for the Core objects they reference (profiles, is_admin,
// set_updated_at, auth, and Projects with their approval and owner
// membership rules as in 20261004100001 and 20260810120001). Never reads .env.local or contacts Supabase.
const MIGRATIONS = [
  'supabase/migrations/20261101100001_sli_organizations_and_departments.sql',
  'supabase/migrations/20261101100002_sli_triggers.sql',
  'supabase/migrations/20261102100001_sli_trigger_research_projects.sql',
  'supabase/migrations/20261103100001_sli_research_fit_check_prompt.sql',
  'supabase/migrations/20261105100001_sli_concept_and_feasibility_methods.sql',
  'supabase/migrations/20261107100001_sli_recommendations_and_decisions.sql',
  'supabase/migrations/20261108100001_sli_handoffs.sql',
  'supabase/migrations/20261109100001_sli_customers_and_candidates.sql',
  'supabase/migrations/20261110100001_sli_assistant_proposals.sql',
]
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
// Sandz: md and cto are Discovery sponsors, analyst is on the Discovery
// team without sponsoring, isr is in Marketing, idle is an org member
// with no department. Other Co: rival. admin: platform admin, no tenant.
const md = id(1), cto = id(2), analyst = id(3), isr = id(4), idle = id(5), rival = id(6), admin = id(7), inactive = id(8)
const sandz = id(100), other = id(101)
const discovery = id(110), marketing = id(111), otherDept = id(112)

let db: PGlite
// The functions return JSON DTOs; tests read into them freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function as(user: string, jwt: Record<string, unknown> = {}) {
  await db.query("select set_config('test.actor', $1, false), set_config('test.jwt', $2, false)", [user, JSON.stringify(jwt)])
}
async function call<T = Json>(fn: string, ...args: unknown[]): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await db.query<{ r: T }>(`select public.${fn}(${params}) as r`, args)
  return rows[0].r
}
async function errorOf(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p
  } catch (e) {
    return e as { code?: string; message: string }
  }
  throw new Error('expected an error')
}
async function raise(user: string, title = 'VMware licensing changes', type = 'market_event'): Promise<{ id: string; code: string }> {
  await as(user)
  return call('sli_raise_trigger', title, type, 'Renewal costs rising after the acquisition', null, null, null, null)
}
async function move(user: string, trigger: string, to: string, reason: string | null = null) {
  await as(user)
  return call('sli_transition_trigger', trigger, to, reason)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to authenticated;
    create table profiles(id uuid primary key, email text not null, full_name text, is_active boolean not null default true, role text not null default 'member');
    create function is_admin(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from profiles where id = uid and role = 'admin' and is_active) $$;
    create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
    create function is_curator_or_admin(uid uuid) returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from profiles where id = uid and role in ('curator', 'admin') and is_active) $$;
    create table projects(id uuid primary key default gen_random_uuid(), name text not null, project_type text not null, objective text,
      status text not null default 'draft', owner_id uuid references profiles(id), visibility text not null default 'private',
      discoverability text not null default 'members_only', information_sensitivity text, portfolio_category text not null default 'other',
      details jsonb not null default '{}', approval_status text not null default 'approved', approval_decided_by uuid,
      approval_decided_at timestamptz, approval_decision_reason text, pending_members jsonb not null default '[]', starter_prompt text);
    create table project_members(id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade,
      user_id uuid not null references profiles(id), role text not null, status text not null default 'active', unique (project_id, user_id));
    create table project_workstreams(id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade,
      name text not null, slug text not null, status text not null default 'draft', goal text, created_by uuid,
      guardrail text, deliverables jsonb not null default '[]', derived_from_method_id uuid, unique (project_id, slug));
    create table workstream_artifacts(id uuid primary key default gen_random_uuid(), workstream_id uuid not null references project_workstreams(id) on delete cascade,
      artifact_type text not null default 'findings', title text not null, content text, external_url text, notes text, created_by uuid,
      created_at timestamptz not null default now());
    create table methods(id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, description text,
      requirements text, evidence text, deliverables text, guardrails text, review_points text, status text not null default 'draft',
      published_at timestamptz);
    -- Replaced by the SLI migration (which adds the reservation exemption).
    create function enforce_project_approval() returns trigger language plpgsql as $$ begin return new; end; $$;
    create trigger projects_enforce_approval before insert or update on projects for each row execute function enforce_project_approval();
    create function enforce_project_approval_membership() returns trigger language plpgsql security definer set search_path = public as $$
    declare p record;
    begin
      if new.status <> 'active' then return new; end if;
      select approval_status, owner_id into p from projects where id = new.project_id;
      if found and p.approval_status <> 'approved' and new.user_id is distinct from p.owner_id then
        raise exception 'This project is awaiting approval -- members can be added once a curator or admin approves it';
      end if;
      return new;
    end; $$;
    create trigger project_members_enforce_approval before insert or update on project_members for each row execute function enforce_project_approval_membership();
    create function create_owner_membership() returns trigger language plpgsql security definer set search_path = public as $$
    begin
      if new.owner_id is not null then
        insert into project_members (project_id, user_id, role, status) values (new.id, new.owner_id, 'owner', 'active')
        on conflict (project_id, user_id) do nothing;
      end if;
      return new;
    end; $$;
    create trigger projects_create_owner_membership after insert on projects for each row execute function create_owner_membership();
    create table conversations(id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade);
    create table chat_messages(id uuid primary key default gen_random_uuid(), conversation_id uuid not null references conversations(id) on delete cascade,
      user_id uuid not null, role text not null, content text, tool_call_id text, tool_name text);
  `)
  for (const file of MIGRATIONS) {
    const migration = readFileSync(file, 'utf8')
    await db.exec(migration)
    // Safe to re-run.
    await db.exec(migration)
  }
}, 60000)

beforeEach(async () => {
  await db.exec(`
    reset role;
    alter table sli_trigger_stage_history disable trigger sli_trigger_stage_history_append_only;
    update sli_departments set workspace_project_id = null;
    truncate sli_assistant_proposals, chat_messages, conversations, sli_trigger_candidate_customers, sli_customer_technologies, sli_customer_rankings, sli_customer_assignments, sli_customers,
      sli_handoff_package_items, sli_handoffs, sli_decision_evidence, sli_decisions, sli_recommendations, sli_decision_authorities, workstream_artifacts,
      sli_project_reservations, sli_trigger_contributors, project_members, project_workstreams, projects,
      sli_admin_access_log, sli_trigger_stage_history, sli_triggers, sli_trigger_types, sli_department_members,
      sli_departments, sli_settings, organization_members, organizations, profiles cascade;
    alter table sli_trigger_stage_history enable trigger sli_trigger_stage_history_append_only;
    insert into profiles(id, email, full_name, role, is_active) values
      ('${md}', 'md@example.test', 'Maria Director', 'member', true),
      ('${cto}', 'cto@example.test', 'Carlos Tech', 'member', true),
      ('${analyst}', 'analyst@example.test', 'Ana Lyst', 'member', true),
      ('${isr}', 'isr@example.test', 'Ivy Rep', 'member', true),
      ('${idle}', 'idle@example.test', null, 'member', true),
      ('${rival}', 'rival@example.test', 'Rex Rival', 'member', true),
      ('${admin}', 'admin@example.test', 'Ada Admin', 'admin', true),
      ('${inactive}', 'gone@example.test', 'Gone Person', 'member', false);
    insert into organizations(id, slug, name) values ('${sandz}', 'sandz', 'Sandz'), ('${other}', 'other-co', 'Other Co');
    insert into sli_settings(organization_id, product_name, byline, trigger_visibility) values
      ('${sandz}', 'Ember Sandz', 'Solution Lifecycle Intelligence', 'all_members'), ('${other}', 'Ember SLI', '', 'own');
    insert into organization_members(organization_id, user_id, role) values
      ('${sandz}', '${md}', 'owner'), ('${sandz}', '${cto}', 'member'), ('${sandz}', '${analyst}', 'member'),
      ('${sandz}', '${isr}', 'member'), ('${sandz}', '${idle}', 'member'), ('${sandz}', '${inactive}', 'member'),
      ('${other}', '${rival}', 'owner');
    insert into sli_departments(id, organization_id, code, name, is_discovery_team, sort_order) values
      ('${discovery}', '${sandz}', 'discovery', 'Discovery team', true, 1),
      ('${marketing}', '${sandz}', 'marketing', 'Marketing', false, 2),
      ('${otherDept}', '${other}', 'discovery', 'Discovery team', true, 1);
    insert into sli_department_members(organization_id, department_id, user_id, role, can_sponsor) values
      ('${sandz}', '${discovery}', '${md}', 'lead', true), ('${sandz}', '${discovery}', '${cto}', 'member', true),
      ('${sandz}', '${discovery}', '${analyst}', 'member', false), ('${sandz}', '${marketing}', '${isr}', 'member', false),
      ('${sandz}', '${marketing}', '${inactive}', 'member', false), ('${other}', '${otherDept}', '${rival}', 'lead', true);
    insert into sli_trigger_types(organization_id, code, label, sort_order) values
      ('${sandz}', 'market_event', 'Market event', 1), ('${sandz}', 'management_idea', 'Management idea', 2),
      ('${other}', 'market_event', 'Market event', 1);
    set role authenticated;
  `)
})

afterAll(async () => {
  await db?.close()
})

describe('tenant and departments', () => {
  it('keeps the tables away from API roles', async () => {
    await as(md)
    for (const table of ['organizations', 'organization_members', 'sli_departments', 'sli_triggers', 'sli_trigger_stage_history']) {
      expect((await errorOf(db.query(`select * from ${table}`))).code, table).toBe('42501')
    }
    expect((await errorOf(db.query(`select sli_is_org_member('${sandz}', '${md}')`))).code).toBe('42501')
  })

  it('describes the caller’s organisation and roles', async () => {
    await as(cto)
    const ctx = await call('sli_context')
    expect(ctx).toMatchObject({ organizationId: sandz, productName: 'Ember Sandz', isDiscoveryMember: true, canSponsor: true, isPlatformAdmin: false })
    expect(ctx.departments.map((d: Json) => d.code)).toEqual(['discovery'])
    await as(isr)
    expect(await call('sli_context')).toMatchObject({ isDepartmentMember: true, isDiscoveryMember: false, canSponsor: false })
    await as(rival)
    expect(await call('sli_context')).toMatchObject({ organizationId: other, productName: 'Ember SLI' })
  })

  it('returns no context for someone outside every organisation, and refuses inactive profiles', async () => {
    await db.exec(`reset role; insert into profiles(id, email) values ('${id(9)}', 'nobody@example.test'); set role authenticated;`)
    await as(id(9))
    expect(await call('sli_context')).toBeNull()
    await as(inactive)
    expect((await errorOf(call('sli_context'))).code).toBe('42501')
  })

  it('shows a platform admin with no membership the first organisation, flagged', async () => {
    await as(admin)
    expect(await call('sli_context')).toMatchObject({ organizationId: sandz, isMember: false, isPlatformAdmin: true })
  })

  it('cannot put a person in another organisation’s department', async () => {
    await db.exec('reset role')
    const err = await errorOf(
      db.query(`insert into sli_department_members(organization_id, department_id, user_id) values ('${other}', '${otherDept}', '${md}')`)
    )
    expect(err.code).toBe('23503')
    await db.exec('set role authenticated')
  })
})

describe('raising Triggers', () => {
  it('lets any department member raise one, numbered per organisation', async () => {
    const first = await raise(isr)
    const second = await raise(analyst, 'Board idea', 'management_idea')
    expect([first.code, second.code]).toEqual(['TRG-001', 'TRG-002'])
    const rivals = await raise(rival)
    expect(rivals.code).toBe('TRG-001')
    await as(isr)
    const t = await call('sli_get_trigger', 'TRG-001')
    expect(t).toMatchObject({ stage: 'new', raisedByMe: true, sourceDepartment: 'Marketing', access: 'raiser', informationSensitivity: 'confidential' })
    expect(t.history).toEqual([expect.objectContaining({ event: 'raised', toStage: 'new', changedByName: 'Ivy Rep' })])
  })

  it('refuses people without a department, unknown types and short titles', async () => {
    expect((await errorOf(raise(idle))).code).toBe('42501')
    expect((await errorOf(raise(admin))).code).toBe('42501')
    expect((await errorOf(raise(isr, 'VMware', 'not_a_type'))).message).toMatch(/Choose a Trigger type/)
    expect((await errorOf(raise(isr, 'ab'))).message).toMatch(/at least three/)
    // A type from another organisation doesn't count.
    await db.exec(`reset role; insert into sli_trigger_types(organization_id, code, label) values ('${other}', 'rival_only', 'Rival'); set role authenticated;`)
    expect((await errorOf(raise(isr, 'Something', 'rival_only'))).message).toMatch(/Choose a Trigger type/)
  })

  it('takes the source department only from the caller’s own', async () => {
    await as(isr)
    const err = await errorOf(call('sli_raise_trigger', 'Some idea', 'market_event', '', null, null, null, discovery))
    expect(err.message).toMatch(/your own departments/)
  })

  it('refuses writes from an external client token', async () => {
    await as(isr, { client_id: 'chatbot' })
    expect((await errorOf(call('sli_raise_trigger', 'Some idea', 'market_event', '', null, null, null, null))).code).toBe('42501')
  })
})

describe('visibility', () => {
  it('shows summaries to the raiser and the Discovery team, titles only to other members when shared', async () => {
    await raise(isr)
    await as(analyst)
    expect((await call('sli_list_triggers'))[0]).toMatchObject({ code: 'TRG-001', access: 'full', summary: expect.any(String) })
    const mine = await raise(cto, 'Private board idea', 'management_idea')
    await as(isr)
    const seen = await call<Json[]>('sli_list_triggers')
    const other = seen.find((t) => t.code === mine.code)
    expect(other).toMatchObject({ access: 'summary', title: 'Private board idea' })
    expect(other).not.toHaveProperty('summary')
    const detail = await call('sli_get_trigger', mine.code)
    expect(detail.history).toEqual([])
    expect(detail.allowedActions).toEqual([])
  })

  it('hides other people’s Triggers when the organisation keeps them private', async () => {
    await raise(cto)
    await db.exec(`reset role; update sli_settings set trigger_visibility = 'own' where organization_id = '${sandz}'; set role authenticated;`)
    await as(isr)
    expect(await call('sli_list_triggers')).toEqual([])
    expect(await call('sli_get_trigger', 'TRG-001')).toBeNull()
    await as(analyst)
    expect(await call('sli_list_triggers')).toHaveLength(1)
  })

  it('never shows one organisation’s Triggers to another', async () => {
    await raise(isr)
    await as(rival)
    expect(await call('sli_list_triggers')).toEqual([])
    expect(await call('sli_get_trigger', 'TRG-001')).toBeNull()
    const { id: sandzTrigger } = await raise(md)
    expect((await errorOf(move(rival, sandzTrigger, 'researching'))).code).toBe('42501')
  })

  it('hides Triggers from an org member with no department', async () => {
    await raise(isr)
    await as(idle)
    expect(await call('sli_list_triggers')).toEqual([])
  })

  it('searches code, title and readable summaries', async () => {
    await raise(isr, 'VMware licensing changes')
    await raise(cto, 'Warehouse monitoring', 'management_idea')
    await as(analyst)
    expect((await call<Json[]>('sli_list_triggers', false, 'warehouse')).map((t) => t.code)).toEqual(['TRG-002'])
    expect((await call<Json[]>('sli_list_triggers', false, 'renewal')).map((t) => t.code)).toEqual(['TRG-002', 'TRG-001'])
    await as(isr)
    // The isr can't read TRG-002's summary, so a summary-only match is hidden.
    expect((await call<Json[]>('sli_list_triggers', false, 'renewal')).map((t) => t.code)).toEqual(['TRG-001'])
  })

  it('logs a platform admin opening a Trigger outside the Discovery team', async () => {
    await raise(isr)
    await as(admin)
    expect(await call('sli_get_trigger', 'trg-001')).toMatchObject({ access: 'full' })
    await as(md)
    await call('sli_get_trigger', 'TRG-001')
    await db.exec('reset role')
    const { rows } = await db.query<{ user_id: string }>('select user_id from sli_admin_access_log')
    expect(rows.map((r) => r.user_id)).toEqual([admin])
    await db.exec('set role authenticated')
  })
})

describe('stages', () => {
  it('runs New → Researching → Concept → Feasibility → Under review, with history', async () => {
    const t = await raise(isr)
    await move(cto, t.id, 'researching')
    await move(cto, t.id, 'concept')
    await move(cto, t.id, 'feasibility')
    expect(await move(cto, t.id, 'under_review')).toMatchObject({ stage: 'under_review' })
    await as(cto)
    const detail = await call('sli_get_trigger', t.code)
    expect(detail).toMatchObject({ sponsorName: 'Carlos Tech', sponsoredByMe: true, stage: 'under_review' })
    expect(detail.history.map((h: Json) => [h.fromStage, h.toStage])).toEqual([
      [null, 'new'], ['new', 'researching'], ['researching', 'concept'], ['concept', 'feasibility'], ['feasibility', 'under_review'],
    ])
  })

  it('lets only a Discovery sponsor accept or decline, and requires a reason to decline', async () => {
    const t = await raise(isr)
    expect((await errorOf(move(analyst, t.id, 'researching'))).message).toMatch(/Discovery team sponsor/)
    expect((await errorOf(move(isr, t.id, 'researching'))).code).toBe('42501')
    expect((await errorOf(move(md, t.id, 'declined'))).message).toMatch(/reason/)
    expect(await move(md, t.id, 'declined', 'Not our market')).toMatchObject({ stage: 'declined' })
    await as(isr)
    // The raiser sees why.
    expect((await call('sli_get_trigger', t.code)).history.at(-1)).toMatchObject({ toStage: 'declined', reason: 'Not our market' })
  })

  it('lets only the sponsor advance, step back and withdraw', async () => {
    const t = await raise(isr)
    await move(cto, t.id, 'researching')
    expect((await errorOf(move(md, t.id, 'concept'))).message).toMatch(/sponsor/)
    await move(cto, t.id, 'concept')
    expect((await errorOf(move(cto, t.id, 'researching'))).message).toMatch(/reason/)
    await move(cto, t.id, 'researching', 'Need more market data')
    await move(cto, t.id, 'concept')
    await move(cto, t.id, 'feasibility')
    await move(cto, t.id, 'under_review')
    expect(await move(cto, t.id, 'feasibility', 'Costs to recheck')).toMatchObject({ stage: 'feasibility' })
  })

  it('refuses transitions that skip stages or need a decision', async () => {
    const t = await raise(isr)
    expect((await errorOf(move(md, t.id, 'concept'))).message).toMatch(/can't move from new to concept/)
    await move(md, t.id, 'researching')
    expect((await errorOf(move(md, t.id, 'under_review'))).message).toMatch(/can't move/)
    await move(md, t.id, 'concept')
    await move(md, t.id, 'feasibility')
    await move(md, t.id, 'under_review')
    for (const to of ['approved', 'deferred', 'rejected', 'promoted']) {
      expect((await errorOf(move(md, t.id, to))).message).toMatch(/management decision/)
    }
  })

  it('lets the Discovery team revisit a Deferred Trigger with a reason', async () => {
    const t = await raise(isr)
    await move(md, t.id, 'researching')
    await db.exec(`reset role; update sli_triggers set stage = 'deferred' where id = '${t.id}'; set role authenticated;`)
    expect((await errorOf(move(isr, t.id, 'researching', 'Try again'))).code).toBe('42501')
    expect((await errorOf(move(analyst, t.id, 'concept'))).message).toMatch(/reason/)
    expect(await move(analyst, t.id, 'concept', 'Market changed')).toMatchObject({ stage: 'concept' })
  })

  it('lets a platform admin make any allowed transition', async () => {
    const t = await raise(isr)
    expect(await move(admin, t.id, 'researching')).toMatchObject({ stage: 'researching' })
    expect(await move(admin, t.id, 'concept')).toMatchObject({ stage: 'concept' })
  })

  it('offers each person only the actions they can take', async () => {
    const t = await raise(isr)
    await as(md)
    const actions = (await call('sli_get_trigger', t.code)).allowedActions.map((a: Json) => a.action + ':' + (a.toStage ?? ''))
    expect(actions).toEqual(['accept:researching', 'decline:declined', 'archive:'])
    await as(analyst)
    expect((await call('sli_get_trigger', t.code)).allowedActions.map((a: Json) => a.action)).toEqual(['archive'])
    await move(cto, t.id, 'researching')
    await as(cto)
    expect((await call('sli_get_trigger', t.code)).allowedActions.map((a: Json) => a.action + ':' + (a.toStage ?? ''))).toEqual([
      'advance:concept', 'archive:',
    ])
  })

  it('keeps history append-only', async () => {
    await raise(isr)
    await db.exec('reset role')
    expect((await errorOf(db.query('update sli_trigger_stage_history set reason = $1', ['edited']))).message).toMatch(/append-only/)
    expect((await errorOf(db.query('delete from sli_trigger_stage_history'))).message).toMatch(/append-only/)
    await db.exec('set role authenticated')
  })
})

describe('archiving', () => {
  it('hides archived Triggers from active lists, keeps the stage, and blocks stage changes until unarchived', async () => {
    const t = await raise(isr)
    await move(md, t.id, 'researching')
    expect((await errorOf(call('sli_set_trigger_archived', t.id, true, null))).message).toMatch(/reason/)
    await as(analyst)
    await call('sli_set_trigger_archived', t.id, true, 'Duplicate of another idea')
    expect(await call('sli_list_triggers')).toEqual([])
    expect(await call('sli_list_triggers', true)).toEqual([expect.objectContaining({ code: t.code, archived: true, stage: 'researching' })])
    expect((await errorOf(move(md, t.id, 'concept'))).message).toMatch(/archived/)
    await as(md)
    expect((await call('sli_get_trigger', t.code)).allowedActions.map((a: Json) => a.action)).toEqual(['unarchive'])
    await call('sli_set_trigger_archived', t.id, false, null)
    expect(await move(md, t.id, 'concept')).toMatchObject({ stage: 'concept' })
    const events = (await call('sli_get_trigger', t.code)).history.map((h: Json) => h.event)
    expect(events).toEqual(['raised', 'stage_change', 'archived', 'unarchived', 'stage_change'])
  })

  it('lets only the Discovery team archive', async () => {
    const t = await raise(isr)
    await as(isr)
    expect((await errorOf(call('sli_set_trigger_archived', t.id, true, 'Mine anyway'))).code).toBe('42501')
  })
})

async function members(projectId: string): Promise<Record<string, string>> {
  await db.exec('reset role')
  const { rows } = await db.query<{ user_id: string; role: string; status: string }>(
    'select user_id, role, status from project_members where project_id = $1',
    [projectId]
  )
  await db.exec('set role authenticated')
  return Object.fromEntries(rows.map((r) => [r.user_id, r.status === 'active' ? r.role : 'inactive']))
}

describe('research spaces', () => {
  it('gives an accepted Trigger its own private, approved Project and Research Workstream', async () => {
    const t = await raise(isr)
    await move(cto, t.id, 'researching')
    await as(cto)
    const detail = await call('sli_get_trigger', t.code)
    expect(detail.projectId).toEqual(expect.any(String))
    expect(detail.workstreamId).toEqual(expect.any(String))
    await db.exec('reset role')
    const { rows } = await db.query<Json>('select * from projects where id = $1', [detail.projectId])
    expect(rows[0]).toMatchObject({
      approval_status: 'approved', visibility: 'private', information_sensitivity: 'confidential', owner_id: cto, portfolio_category: 'sandz',
    })
    expect(rows[0].name).toBe('TRG-001 · VMware licensing changes')
    // The research conversation offers the fit check first.
    expect(rows[0].starter_prompt).toMatch(/^Run a fit check on this Trigger\./)
    expect(rows[0].starter_prompt).toMatch(/Findings artifact titled "Fit check" in the Research workstream/)
    const ws = await db.query<Json>('select name, slug, status, project_id from project_workstreams where id = $1', [detail.workstreamId])
    expect(ws.rows[0]).toMatchObject({ name: 'Research', slug: 'research', status: 'active', project_id: detail.projectId })
    await db.exec('set role authenticated')
    expect(await members(detail.projectId)).toEqual({ [cto]: 'owner', [md]: 'curator', [analyst]: 'curator' })
  })

  it('still sends an ordinary Project created by a member for approval', async () => {
    await db.exec('reset role')
    await as(isr)
    const { rows } = await db.query<{ approval_status: string }>(
      "insert into projects (name, project_type) values ('Side project', 'experiment') returning approval_status"
    )
    await db.exec('set role authenticated')
    // The migration's version of the approval rule exempts reserved Projects only.
    expect(rows[0].approval_status).toBe('pending')
  })

  it('creates the space once, however often the Trigger moves', async () => {
    const t = await raise(isr)
    await move(cto, t.id, 'researching')
    await move(cto, t.id, 'concept')
    await move(cto, t.id, 'researching', 'More data needed')
    await db.exec('reset role')
    const { rows } = await db.query<{ n: number }>('select count(*)::int as n from projects')
    const ws = await db.query<{ n: number }>('select count(*)::int as n from project_workstreams')
    await db.exec('set role authenticated')
    // One Project; the Research workstream plus the Concept stage's own.
    expect([rows[0].n, ws.rows[0].n]).toEqual([1, 2])
  })

  it('keeps the Discovery team in step with every Trigger Project', async () => {
    const t = await raise(isr)
    await move(cto, t.id, 'researching')
    await as(cto)
    const { projectId } = await call('sli_get_trigger', t.code)
    await db.exec(`reset role;
      insert into sli_department_members(organization_id, department_id, user_id, role, can_sponsor) values ('${sandz}', '${discovery}', '${idle}', 'member', false);
      update sli_department_members set status = 'inactive' where department_id = '${discovery}' and user_id = '${analyst}';
      set role authenticated;`)
    expect(await members(projectId)).toEqual({ [cto]: 'owner', [md]: 'curator', [idle]: 'curator', [analyst]: 'inactive' })
  })
})

describe('contributors', () => {
  async function researching() {
    const t = await raise(md, 'Warehouse monitoring', 'management_idea')
    await move(cto, t.id, 'researching')
    await as(cto)
    const detail = await call('sli_get_trigger', t.code)
    return { ...t, projectId: detail.projectId as string }
  }

  it('lets the sponsor invite someone from another department to one Trigger only', async () => {
    const t = await researching()
    const other = await raise(cto, 'Another idea', 'management_idea')
    await move(cto, other.id, 'researching')
    await as(cto)
    expect((await call<Json[]>('sli_list_contributor_candidates', t.id)).map((c) => c.userId)).toEqual([isr])
    expect(await call('sli_set_trigger_contributor', t.id, isr, true)).toMatchObject({ changed: true })

    await as(isr)
    const seen = await call('sli_get_trigger', t.code)
    expect(seen).toMatchObject({ access: 'contributor', projectId: t.projectId, summary: expect.any(String), allowedActions: [] })
    expect(seen.contributors).toEqual([expect.objectContaining({ userId: isr, isMe: true, departments: 'Marketing' })])
    expect(seen.history.at(-1)).toMatchObject({ event: 'contributor_added', reason: 'Ivy Rep' })
    expect(await members(t.projectId)).toMatchObject({ [isr]: 'consultant' })
    // The other Trigger's research stays out of reach.
    const notMine = await call('sli_get_trigger', other.code)
    expect(notMine).toMatchObject({ access: 'summary' })
    expect(notMine).not.toHaveProperty('projectId')
  })

  it('removes a contributor and their Project access, keeping the record', async () => {
    const t = await researching()
    await as(analyst)
    await call('sli_set_trigger_contributor', t.id, isr, true)
    await call('sli_set_trigger_contributor', t.id, isr, false)
    expect(await members(t.projectId)).toMatchObject({ [isr]: 'inactive' })
    await as(isr)
    expect(await call('sli_get_trigger', 'TRG-001')).toMatchObject({ access: 'summary' })
    await as(analyst)
    const events = (await call('sli_get_trigger', 'TRG-001')).history.map((h: Json) => h.event)
    expect(events.slice(-2)).toEqual(['contributor_added', 'contributor_removed'])
  })

  it('refuses invitations from outsiders, to the wrong people, or before research starts', async () => {
    const t = await researching()
    await as(isr)
    expect((await errorOf(call('sli_set_trigger_contributor', t.id, idle, true))).code).toBe('42501')
    await as(cto)
    expect((await errorOf(call('sli_set_trigger_contributor', t.id, analyst, true))).message).toMatch(/already sees every Trigger/)
    expect((await errorOf(call('sli_set_trigger_contributor', t.id, idle, true))).message).toMatch(/departments can be invited/)
    expect((await errorOf(call('sli_set_trigger_contributor', t.id, rival, true))).message).toMatch(/departments can be invited/)
    const fresh = await raise(isr, 'Not yet accepted')
    await as(cto)
    expect((await errorOf(call('sli_set_trigger_contributor', fresh.id, isr, true))).message).toMatch(/Accept the Trigger/)
    await as(rival)
    expect((await errorOf(call('sli_set_trigger_contributor', t.id, isr, true))).code).toBe('42501')
  })

  it('offers contributor management only to those who may use it', async () => {
    const t = await researching()
    await as(cto)
    expect((await call('sli_get_trigger', t.code)).canManageContributors).toBe(true)
    await call('sli_set_trigger_contributor', t.id, isr, true)
    await as(isr)
    expect((await call('sli_get_trigger', t.code)).canManageContributors).toBe(false)
  })
})

describe('concept and feasibility', () => {
  async function workstreams(projectId: string) {
    await db.exec('reset role')
    const { rows } = await db.query<Json>(
      `select w.slug, w.name, w.status, w.guardrail, w.deliverables, m.slug as method from project_workstreams w
       left join methods m on m.id = w.derived_from_method_id where w.project_id = $1 order by w.slug`,
      [projectId]
    )
    const prompt = await db.query<{ starter_prompt: string }>('select starter_prompt from projects where id = $1', [projectId])
    await db.exec('set role authenticated')
    return { rows, prompt: prompt.rows[0].starter_prompt }
  }

  it('starts each stage from its Method and points the conversation at its paper', async () => {
    const t = await raise(isr)
    await move(cto, t.id, 'researching')
    await as(cto)
    const { projectId } = await call('sli_get_trigger', t.code)
    expect((await workstreams(projectId)).prompt).toMatch(/^Run a fit check/)

    await move(cto, t.id, 'concept')
    let state = await workstreams(projectId)
    expect(state.rows.map((w: Json) => [w.slug, w.method])).toEqual([['concept', 'sli-concept-development'], ['research', null]])
    const concept = state.rows.find((w: Json) => w.slug === 'concept')
    expect(concept).toMatchObject({ name: 'Concept', status: 'active', deliverables: [{ label: 'Concept paper', completed: false }] })
    expect(concept.guardrail).toMatch(/^Write the concept paper with these sections/)
    expect(state.prompt).toMatch(/^Draft the concept paper.*"Concept paper" in the Concept workstream\.$/)

    await move(cto, t.id, 'feasibility')
    state = await workstreams(projectId)
    expect(state.rows.map((w: Json) => w.slug)).toEqual(['concept', 'feasibility', 'research'])
    expect(state.rows.find((w: Json) => w.slug === 'feasibility').guardrail).toMatch(/Recommendation: approve, revise, defer or reject/)
    expect(state.prompt).toMatch(/^Draft the feasibility assessment/)
  })

  it('reuses stage Workstreams and restores the fit check when research reopens', async () => {
    const t = await raise(isr)
    await move(cto, t.id, 'researching')
    await move(cto, t.id, 'concept')
    await move(cto, t.id, 'researching', 'Need more evidence')
    await as(cto)
    const { projectId } = await call('sli_get_trigger', t.code)
    let state = await workstreams(projectId)
    expect(state.prompt).toMatch(/^Run a fit check/)
    await move(cto, t.id, 'concept')
    state = await workstreams(projectId)
    expect(state.rows.map((w: Json) => w.slug)).toEqual(['concept', 'research'])
    expect(state.prompt).toMatch(/^Draft the concept paper/)
  })

  it('publishes the two Methods once', async () => {
    await db.exec('reset role')
    const { rows } = await db.query<{ slug: string; status: string }>("select slug, status from methods where slug like 'sli-%' order by slug")
    await db.exec('set role authenticated')
    expect(rows).toEqual([
      { slug: 'sli-concept-development', status: 'published' },
      { slug: 'sli-feasibility-assessment', status: 'published' },
    ])
  })
})

describe('recommendations and decisions', () => {
  // md decides (the MD); analyst is a dated delegate in some tests.
  async function underReview(sponsor = cto) {
    await db.exec(`reset role;
      update sli_departments set accepts_handoffs = true where id = '${marketing}';
      insert into sli_decision_authorities(organization_id, user_id, kind) values ('${sandz}', '${md}', 'decider') on conflict do nothing;
      set role authenticated;`)
    const t = await raise(isr)
    await move(sponsor, t.id, 'researching')
    await move(sponsor, t.id, 'concept')
    await move(sponsor, t.id, 'feasibility')
    await move(sponsor, t.id, 'under_review')
    return t
  }
  async function decide(user: string, trigger: string, outcome: string, opts: Partial<Record<string, unknown>> = {}) {
    await as(user)
    return call(
      'sli_record_decision',
      trigger,
      outcome,
      opts.rationale ?? 'Strong fit with existing Zadara customers',
      opts.destination ?? null,
      opts.returnTo ?? null,
      opts.conditions ?? null,
      opts.evidence ?? [],
      opts.share ?? false
    )
  }
  async function info(user: string, code: string) {
    await as(user)
    return (await call('sli_get_trigger', code)).decisionInfo
  }

  it('lets the Discovery team recommend, keeping the latest per person current', async () => {
    const t = await underReview()
    await as(cto)
    await call('sli_record_recommendation', t.id, 'revise', null, 'Costs unclear')
    await call('sli_record_recommendation', t.id, 'approve', marketing, 'Costs now checked')
    await as(analyst)
    await call('sli_record_recommendation', t.id, 'defer', marketing, null)
    const recs = (await info(md, t.code)).recommendations
    expect(recs.map((r: Json) => [r.by, r.recommendation, r.destination, r.current])).toEqual([
      ['Carlos Tech', 'revise', null, false],
      ['Carlos Tech', 'approve', 'Marketing', true],
      // A destination only counts with an approval.
      ['Ana Lyst', 'defer', null, true],
    ])
  })

  it('refuses recommendations from the decider, outsiders, or before review', async () => {
    const t = await underReview()
    await as(md)
    expect((await errorOf(call('sli_record_recommendation', t.id, 'approve', marketing, null))).message).toMatch(/records a decision/)
    await as(isr)
    expect((await errorOf(call('sli_record_recommendation', t.id, 'approve', marketing, null))).code).toBe('42501')
    const early = await raise(isr, 'Early idea')
    await as(cto)
    expect((await errorOf(call('sli_record_recommendation', early.id, 'approve', null, null))).message).toMatch(/under review/)
  })

  it('records an approval with its destination, conditions and evidence', async () => {
    const t = await underReview()
    await as(cto)
    const { projectId } = await call('sli_get_trigger', t.code)
    await db.exec('reset role')
    const ws = await db.query<{ id: string }>("select id from project_workstreams where project_id = $1 and slug = 'feasibility'", [projectId])
    const art = await db.query<{ id: string }>(
      "insert into workstream_artifacts (workstream_id, title) values ($1, 'Feasibility assessment') returning id",
      [ws.rows[0].id]
    )
    await db.exec('set role authenticated')
    const result = await decide(md, t.id, 'approve', { destination: marketing, conditions: 'Start with existing customers', evidence: [art.rows[0].id] })
    expect(result).toMatchObject({ stage: 'approved' })
    const d = (await info(md, t.code)).decisions[0]
    expect(d).toMatchObject({
      outcome: 'approve', destination: 'Marketing', conditions: 'Start with existing customers', decidedBy: 'Maria Director',
      decidedAs: 'authority', superseded: false, evidence: [{ id: art.rows[0].id, title: 'Feasibility assessment' }],
    })
    await as(md)
    const history = (await call('sli_get_trigger', t.code)).history.at(-1)
    expect(history).toMatchObject({ fromStage: 'under_review', toStage: 'approved', reason: 'Management decision: approve' })
  })

  it('checks what each outcome needs', async () => {
    const t = await underReview()
    expect((await errorOf(decide(md, t.id, 'approve'))).message).toMatch(/where the approved Trigger goes/)
    expect((await errorOf(decide(md, t.id, 'revise'))).message).toMatch(/stage to revise in/)
    expect((await errorOf(decide(md, t.id, 'reject', { rationale: '' }))).message).toMatch(/rationale/)
    expect((await errorOf(decide(md, t.id, 'defer', { evidence: [id(999)] }))).message).toMatch(/this Trigger's research/)
    expect((await errorOf(decide(cto, t.id, 'reject'))).code).toBe('42501')
  })

  it('sends a revision back to a stage, and a new decision supersedes the old one', async () => {
    const t = await underReview()
    await decide(md, t.id, 'revise', { returnTo: 'concept', rationale: 'Target market too broad' })
    await as(cto)
    const { projectId, stage } = await call('sli_get_trigger', t.code)
    expect(stage).toBe('concept')
    await db.exec('reset role')
    const prompt = await db.query<{ starter_prompt: string }>('select starter_prompt from projects where id = $1', [projectId])
    await db.exec('set role authenticated')
    expect(prompt.rows[0].starter_prompt).toMatch(/^Draft the concept paper/)
    await move(cto, t.id, 'feasibility')
    await move(cto, t.id, 'under_review')
    await decide(md, t.id, 'reject', { rationale: 'Margins too thin' })
    const decisions = (await info(md, t.code)).decisions
    expect(decisions.map((d: Json) => [d.outcome, d.superseded])).toEqual([['revise', true], ['reject', false]])
  })

  it('lets a dated delegate decide, but not a Trigger they sponsor or outside their dates', async () => {
    const t = await underReview(cto)
    await as(md)
    await call('sli_set_decision_delegate', cto, '2000-01-01', '2999-12-31')
    expect((await errorOf(decide(cto, t.id, 'reject'))).message).toMatch(/Trigger you sponsor/)
    await as(md)
    await call('sli_set_decision_delegate', analyst, '2000-01-01', '2000-12-31')
    expect((await errorOf(decide(analyst, t.id, 'reject'))).code).toBe('42501')
    await as(md)
    await call('sli_set_decision_delegate', analyst, '2000-01-01', '2999-12-31')
    expect(await decide(analyst, t.id, 'defer', { rationale: 'Wait for the partner roadmap' })).toMatchObject({ stage: 'deferred' })
    expect((await info(md, t.code)).decisions[0]).toMatchObject({ decidedAs: 'delegate', decidedBy: 'Ana Lyst' })
  })

  it('lets only the decider or an owner name a delegate, from the Discovery team', async () => {
    await underReview()
    await as(cto)
    expect((await errorOf(call('sli_set_decision_delegate', analyst, '2000-01-01', '2999-12-31'))).code).toBe('42501')
    await as(md)
    expect((await errorOf(call('sli_set_decision_delegate', isr, '2000-01-01', '2999-12-31'))).message).toMatch(/Discovery team/)
    expect((await errorOf(call('sli_set_decision_delegate', analyst, '2000-02-01', '2000-01-01'))).message).toMatch(/dates/)
    await call('sli_set_decision_delegate', analyst, '2000-01-01', '2999-12-31')
    const settings = await call('sli_decision_settings')
    expect(settings).toMatchObject({ myRole: 'authority', canSetDelegate: true, decider: { isMe: true }, delegate: { name: 'Ana Lyst', activeToday: true } })
    expect(settings.waitingForMe).toEqual([{ code: 'TRG-001', title: 'VMware licensing changes' }])
    await call('sli_set_decision_delegate', null, null, null)
    expect((await call('sli_decision_settings')).delegate).toBeNull()
  })

  it('shows the raiser the outcome, and the rationale only when shared; contributors see neither', async () => {
    const t = await underReview()
    await as(cto)
    await call('sli_set_trigger_contributor', t.id, isr, false)
    await decide(md, t.id, 'reject', { rationale: 'Not our market' })
    let raiser = await info(isr, t.code)
    expect(raiser.decisions).toEqual([expect.objectContaining({ outcome: 'reject', rationale: null })])
    expect(raiser).not.toHaveProperty('recommendations')
    await db.exec(`reset role; update sli_decisions set share_rationale_with_raiser = true; set role authenticated;`)
    raiser = await info(isr, t.code)
    expect(raiser.decisions[0].rationale).toBe('Not our market')

    const other = await underReview()
    await as(cto)
    await call('sli_set_trigger_contributor', other.id, isr, true)
    // isr raised it too, but contributor access takes precedence: no decision details.
    await db.exec(`reset role; update sli_triggers set raised_by = '${analyst}' where id = '${other.id}'; set role authenticated;`)
    await decide(md, other.id, 'reject', { rationale: 'Confidential reasoning' })
    expect(await info(isr, other.code)).toEqual({})
  })
})

describe('handoffs', () => {
  // isr leads Marketing here; md decides; cto sponsors.
  async function approved() {
    await db.exec(`reset role;
      update sli_departments set accepts_handoffs = true where id = '${marketing}';
      update sli_department_members set role = 'lead' where department_id = '${marketing}' and user_id = '${isr}';
      insert into sli_decision_authorities(organization_id, user_id, kind) values ('${sandz}', '${md}', 'decider') on conflict do nothing;
      set role authenticated;`)
    const t = await raise(analyst, 'VMware exit offer')
    for (const stage of ['researching', 'concept', 'feasibility', 'under_review']) await move(cto, t.id, stage)
    await as(cto)
    const { projectId } = await call('sli_get_trigger', t.code)
    await db.exec('reset role')
    const ws = await db.query<{ id: string }>("select id from project_workstreams where project_id = $1 and slug = 'concept'", [projectId])
    const art = await db.query<{ id: string }>(
      "insert into workstream_artifacts (workstream_id, title, content) values ($1, 'Concept paper', 'Exit VMware to Zadara') returning id",
      [ws.rows[0].id]
    )
    const secret = await db.query<{ id: string }>(
      "insert into workstream_artifacts (workstream_id, title, content) values ($1, 'Pricing notes', 'Confidential margins') returning id",
      [ws.rows[0].id]
    )
    await db.exec('set role authenticated')
    await as(md)
    await call('sli_record_decision', t.id, 'approve', 'Strong fit', marketing, null, 'Start with existing customers', [], false)
    return { ...t, projectId, artifact: art.rows[0].id, secret: secret.rows[0].id }
  }
  async function propose(t: { id: string; artifact: string }, user = cto) {
    await as(user)
    return call('sli_propose_handoff', t.id, 'Campaign to Tier 1 first', [t.artifact], 'Banking, logistics', 'Assessment is free')
  }
  async function handoffs(user: string, code: string) {
    await as(user)
    return (await call('sli_get_trigger', code)).handoffInfo
  }

  it('lets only the sponsor propose the approved handoff, with only this Trigger’s research', async () => {
    const t = await approved()
    await as(analyst)
    expect((await errorOf(call('sli_propose_handoff', t.id, null, [], null, null))).code).toBe('42501')
    await as(cto)
    expect((await errorOf(call('sli_propose_handoff', t.id, null, [id(999)], null, null))).message).toMatch(/saved research/)
    await propose(t)
    expect((await errorOf(propose(t))).message).toMatch(/already waiting/)
    const info = await handoffs(cto, t.code)
    expect(info.handoffs[0]).toMatchObject({
      kind: 'promote', status: 'proposed', destination: 'Marketing', conditions: 'Start with existing customers',
      targetIndustries: 'Banking, logistics', approvedClaims: 'Assessment is free', items: [{ title: 'Concept paper', copiedArtifactId: null }],
    })
    expect(info.canPropose).toBe(false)
  })

  it('shows the receiving department the package, not the research or deliberations', async () => {
    const t = await approved()
    await propose(t)
    await as(isr)
    const seen = await call('sli_get_trigger', t.code)
    expect(seen).toMatchObject({ access: 'destination', summary: expect.any(String), history: [], decisionInfo: {} })
    expect(seen).not.toHaveProperty('projectId')
    expect(seen.handoffInfo.handoffs[0]).toMatchObject({ canDecide: true, canWithdraw: false })
  })

  it('accepts: copies the package into the department workspace and promotes the Trigger', async () => {
    const t = await approved()
    await propose(t)
    await as(analyst)
    const notLead = await errorOf(call('sli_decide_handoff', (await handoffs(cto, t.code)).handoffs[0].id, true, null))
    expect(notLead.code).toBe('42501')
    const handoffId = (await handoffs(cto, t.code)).handoffs[0].id
    await as(isr)
    const result = await call('sli_decide_handoff', handoffId, true, null)
    expect(result).toMatchObject({ status: 'accepted', workstreamId: expect.any(String) })
    await db.exec('reset role')
    const ws = await db.query<Json>(
      `select w.name, w.project_id, p.name as project, p.approval_status, p.owner_id from project_workstreams w join projects p on p.id = w.project_id where w.id = $1`,
      [result.workstreamId]
    )
    const copies = await db.query<Json>('select title, content, notes from workstream_artifacts where workstream_id = $1', [result.workstreamId])
    const members = await db.query<Json>('select user_id, role, status from project_members where project_id = $1', [ws.rows[0].project_id])
    const ref = await db.query<Json>('select workspace_project_id from sli_departments where id = $1', [marketing])
    await db.exec('set role authenticated')
    expect(ws.rows[0]).toMatchObject({ name: 'TRG-001 · VMware exit offer', project: 'Sandz · Marketing workspace', approval_status: 'approved', owner_id: isr })
    expect(ref.rows[0].workspace_project_id).toBe(ws.rows[0].project_id)
    // Only the package: the concept paper, not the pricing notes.
    expect(copies.rows).toEqual([{ title: 'Concept paper', content: 'Exit VMware to Zadara', notes: 'Copied from TRG-001 (Discovery) when the handoff was accepted.' }])
    expect(members.rows.map((m: Json) => [m.user_id, m.role, m.status])).toEqual([[isr, 'owner', 'active']])
    await as(cto)
    const after = await call('sli_get_trigger', t.code)
    expect(after.stage).toBe('promoted')
    expect(after.handoffInfo.handoffs[0]).toMatchObject({ status: 'accepted', decidedBy: 'Ivy Rep', destinationWorkstreamId: result.workstreamId })
  })

  it('returns with a reason, keeps the Trigger approved, and links the next proposal', async () => {
    const t = await approved()
    await propose(t)
    const first = (await handoffs(cto, t.code)).handoffs[0].id
    await as(isr)
    expect((await errorOf(call('sli_decide_handoff', first, false, null))).message).toMatch(/why you are returning/)
    await call('sli_decide_handoff', first, false, 'Value proposition too vague')
    await as(cto)
    const t2 = await call('sli_get_trigger', t.code)
    expect(t2.stage).toBe('approved')
    expect(t2.history.at(-1)).toMatchObject({ event: 'handoff_returned', reason: 'Marketing: Value proposition too vague' })
    expect(t2.handoffInfo.canPropose).toBe(true)
    await propose(t)
    await db.exec('reset role')
    const { rows } = await db.query<{ previous_handoff_id: string }>("select previous_handoff_id from sli_handoffs where status = 'proposed'")
    await db.exec('set role authenticated')
    expect(rows[0].previous_handoff_id).toBe(first)
  })

  it('lets the sponsor withdraw an open proposal', async () => {
    const t = await approved()
    await propose(t)
    const h = (await handoffs(cto, t.code)).handoffs[0].id
    await as(isr)
    expect((await errorOf(call('sli_withdraw_handoff', h, null))).code).toBe('42501')
    await as(cto)
    await call('sli_withdraw_handoff', h, 'Package needs the feasibility assessment')
    expect((await handoffs(cto, t.code)).handoffs[0].status).toBe('withdrawn')
  })

  it('sends back: the department asks, the sponsor accepts, the Trigger reopens and the approval is superseded', async () => {
    const t = await approved()
    await propose(t)
    const promoteId = (await handoffs(cto, t.code)).handoffs[0].id
    await as(isr)
    const { workstreamId } = await call('sli_decide_handoff', promoteId, true, null)
    await as(cto)
    expect((await errorOf(call('sli_raise_send_back', t.id, 'feasibility', 'customer_feedback', 'Prospects want DR too', 'pause'))).code).toBe('42501')
    await as(isr)
    expect((await errorOf(call('sli_raise_send_back', t.id, 'feasibility', 'whim', 'x x x', 'pause'))).message).toMatch(/why it is being sent back/)
    await call('sli_raise_send_back', t.id, 'feasibility', 'solution_inadequate', 'Prospects need features Zadara lacks', 'close')
    const sendBack = (await handoffs(cto, t.code)).handoffs.find((h: Json) => h.kind === 'send_back')
    expect(sendBack).toMatchObject({ status: 'proposed', canDecide: true, toStage: 'feasibility', downstreamAction: 'close' })
    await as(isr)
    expect((await errorOf(call('sli_decide_send_back', sendBack.id, true, null))).code).toBe('42501')
    await as(cto)
    expect(await call('sli_decide_send_back', sendBack.id, true, null)).toMatchObject({ stage: 'feasibility' })
    const after = await call('sli_get_trigger', t.code)
    expect(after.decisionInfo.decisions[0]).toMatchObject({ superseded: true, supersededReason: 'Sent back: Prospects need features Zadara lacks' })
    await db.exec('reset role')
    const ws = await db.query<{ status: string }>('select status from project_workstreams where id = $1', [workstreamId])
    await db.exec('set role authenticated')
    expect(ws.rows[0].status).toBe('archived')
    // A new decision is needed again.
    await move(cto, t.id, 'under_review')
    await as(md)
    await call('sli_record_decision', t.id, 'approve', 'Revised: add DR', marketing, null, null, [], false)
    await as(cto)
    const decisions = (await call('sli_get_trigger', t.code)).decisionInfo.decisions
    expect(decisions.map((d: Json) => d.superseded)).toEqual([true, false])
  })

  it('declines a send-back with a reason, and lists what waits for whom', async () => {
    const t = await approved()
    await propose(t)
    await as(isr)
    expect((await call('sli_handoff_inbox')).toAnswer).toEqual([{ code: 'TRG-001', title: 'VMware exit offer', kind: 'promote', department: 'Marketing' }])
    const promoteId = (await handoffs(cto, t.code)).handoffs[0].id
    await as(isr)
    await call('sli_decide_handoff', promoteId, true, null)
    expect((await call('sli_handoff_inbox')).received).toEqual([expect.objectContaining({ code: 'TRG-001', department: 'Marketing', stage: 'promoted' })])
    await call('sli_raise_send_back', t.id, 'concept', 'market_changed', 'A competitor cut prices', 'pause')
    await as(md)
    expect((await call('sli_handoff_inbox')).toAnswer).toEqual([expect.objectContaining({ kind: 'send_back' })])
    const sendBack = (await handoffs(md, t.code)).handoffs.find((h: Json) => h.kind === 'send_back')
    expect((await errorOf(call('sli_decide_send_back', sendBack.id, false, null))).message).toMatch(/why you are declining/)
    await call('sli_decide_send_back', sendBack.id, false, 'Our pricing still wins on total cost')
    await as(cto)
    expect((await call('sli_get_trigger', t.code)).stage).toBe('promoted')
  })
})

describe('customers and candidates', () => {
  const rep = id(12)
  const sales = id(113), presales = id(114)
  async function setup() {
    await db.exec(`reset role;
      insert into profiles(id, email, full_name) values ('${rep}', 'rep@example.test', 'Rita Rep') on conflict do nothing;
      insert into organization_members(organization_id, user_id) values ('${sandz}', '${rep}') on conflict do nothing;
      insert into sli_departments(id, organization_id, code, name, accepts_handoffs, sort_order) values
        ('${sales}', '${sandz}', 'sales', 'Sales', true, 3), ('${presales}', '${sandz}', 'presales', 'Presales', true, 4) on conflict do nothing;
      update sli_departments set accepts_handoffs = true, requires_candidates = true where id = '${marketing}';
      insert into sli_department_members(organization_id, department_id, user_id, role) values
        ('${sandz}', '${sales}', '${rep}', 'member'), ('${sandz}', '${sales}', '${md}', 'lead') on conflict do nothing;
      insert into sli_decision_authorities(organization_id, user_id, kind) values ('${sandz}', '${md}', 'decider') on conflict do nothing;
      set role authenticated;`)
  }
  async function company(user: string, name: string, website: string | null = null, phone: string | null = null, reason: string | null = null) {
    await as(user)
    return (await call<{ id: string }>('sli_save_customer', null, name, website, phone, 'Manufacturing', null, null, null, null, null, reason)).id
  }

  it('normalises names, domains and phone numbers', async () => {
    const { rows } = await db.query<Json>(
      "select sli_normalize_name('ABC Holdings, Inc. (Philippines)') n, sli_normalize_domain('https://www.Example.com/about') d, sli_normalize_phone('+63 2 8888 1234') p"
    )
    expect(rows[0]).toEqual({ n: 'abc holdings', d: 'example.com', p: '0288881234' })
  })

  it('lets Marketing, Sales and Discovery create companies, and blocks duplicate domains', async () => {
    await setup()
    await company(isr, 'Acme Logistics Inc.', 'https://acme.ph', '(02) 8888 1234')
    await as(idle)
    expect((await errorOf(call('sli_save_customer', null, 'Other Co', null, null, null, null, null, null, null, null, null))).code).toBe('42501')
    expect((await errorOf(company(analyst, 'Acme Logistics Corp', 'www.acme.ph/contact'))).message).toMatch(/already uses this website/)
    expect((await errorOf(company(analyst, 'Acme Freight', null, '+63 2 8888 1234'))).message).toMatch(/same main phone number/)
    await company(analyst, 'Acme Freight', null, '+63 2 8888 1234', 'Shared switchboard with its sister company')
    await as(rep)
    const matches = await call<Json[]>('sli_find_customer_duplicates', 'ACME Logistics Philippines', null, null, null)
    expect(matches.map((m) => [m.name, m.strength])).toEqual([['Acme Logistics Inc.', 'possible']])
  })

  it('assigns account reps from Sales by a Sales lead, keeping history', async () => {
    await setup()
    const acme = await company(isr, 'Acme Logistics', 'acme.ph')
    await as(isr)
    expect((await errorOf(call('sli_assign_customer', acme, 'account_rep', rep))).code).toBe('42501')
    await as(md)
    expect((await errorOf(call('sli_assign_customer', acme, 'account_rep', isr))).message).toMatch(/member of sales/)
    await call('sli_assign_customer', acme, 'account_rep', rep)
    await call('sli_assign_customer', acme, 'account_rep', md)
    const c = await call('sli_get_customer', acme)
    expect(c.accountRep).toBe('Maria Director')
    expect(c.assignments.map((a: Json) => [a.name, a.to === null])).toEqual([['Maria Director', true], ['Rita Rep', false]])
  })

  it('keeps rankings with the Discovery team and finds companies by what they run', async () => {
    await setup()
    const acme = await company(isr, 'Acme Logistics', 'acme.ph')
    const beta = await company(isr, 'Beta Foods', 'beta.ph')
    await as(isr)
    expect((await errorOf(call('sli_record_customer_ranking', acme, 'top1000', 120, null, null, null))).code).toBe('42501')
    await as(analyst)
    await call('sli_record_customer_ranking', acme, 'top1000', 120, '2026-06-01', 'BusinessWorld', null)
    await call('sli_save_customer_technology', acme, null, 'virtualisation', 'VMware', 'vSphere', 'in_use', false, '60 VMs', '2027-03-31', null, false)
    await call('sli_save_customer_technology', beta, null, 'storage', 'Zadara', null, 'in_use', true, '200 TB', null, null, false)
    expect((await call<Json[]>('sli_list_customers', null, 'vmware', 100)).map((c) => [c.name, c.top1000, c.technologies])).toEqual([
      ['Acme Logistics', 120, ['VMware vSphere']],
    ])
    expect((await call<Json[]>('sli_list_customers', 'beta', null, 100)).map((c) => c.name)).toEqual(['Beta Foods'])
  })

  it('builds the candidate list in Targeting; Marketing needs one, Presales does not', async () => {
    await setup()
    const acme = await company(isr, 'Acme Logistics', 'acme.ph')
    await as(md)
    await call('sli_assign_customer', acme, 'account_rep', rep)
    const t = await raise(analyst, 'VMware exit offer')
    for (const stage of ['researching', 'concept', 'feasibility', 'under_review']) await move(cto, t.id, stage)
    await as(md)
    await call('sli_record_decision', t.id, 'approve', 'Go ahead', marketing, null, null, [], false)
    await move(cto, t.id, 'targeting')
    await as(cto)
    expect((await errorOf(call('sli_propose_handoff', t.id, null, [], null, null))).message).toMatch(/needs at least one accepted candidate/)
    await as(isr)
    expect((await errorOf(call('sli_add_candidate_customer', t.id, acme, 'existing_customer', 'Runs VMware on 60 VMs', 'strong', 'high', null, null, null, null))).code).toBe('42501')
    await as(analyst)
    await call('sli_add_candidate_customer', t.id, acme, 'existing_customer', 'Runs VMware on 60 VMs, renewal in March', 'strong', 'high', null, 'Logistics', null, null)
    const list = await call('sli_list_candidate_customers', t.id)
    expect(list.candidates[0]).toMatchObject({ name: 'Acme Logistics', tier: 'existing_customer', accountRep: 'Rita Rep', status: 'accepted' })
    expect((await errorOf(call('sli_set_candidate_status', list.candidates[0].candidateId, 'removed', null))).message).toMatch(/why it is being trimmed/)

    await as(cto)
    const info = (await call('sli_get_trigger', t.code)).handoffInfo
    expect(info.proposeTo).toMatchObject({ name: 'Marketing', requiresCandidates: true, acceptedCandidates: 1 })
    await call('sli_propose_handoff', t.id, 'Tier 1 first', [], null, null)
    const h = (await call('sli_get_trigger', t.code)).handoffInfo.handoffs[0]
    expect(h.candidates).toEqual([expect.objectContaining({ name: 'Acme Logistics', accountRep: 'Rita Rep', fitRationale: 'Runs VMware on 60 VMs, renewal in March' })])

    // One customer, straight to Presales: candidates optional.
    const single = await raise(analyst, 'Acme DR proof of concept')
    for (const stage of ['researching', 'concept', 'feasibility', 'under_review']) await move(cto, single.id, stage)
    await as(md)
    await call('sli_record_decision', single.id, 'approve', 'Go ahead', presales, null, null, [], false)
    await as(cto)
    expect(await call('sli_propose_handoff', single.id, null, [], null, null)).toMatchObject({ code: single.code })
  })

  it('offers Targeting to the sponsor after approval, and back with a reason', async () => {
    await setup()
    const t = await raise(analyst, 'Idea')
    for (const stage of ['researching', 'concept', 'feasibility', 'under_review']) await move(cto, t.id, stage)
    await as(md)
    await call('sli_record_decision', t.id, 'approve', 'Go ahead', marketing, null, null, [], false)
    await as(cto)
    expect((await call('sli_get_trigger', t.code)).allowedActions.map((a: Json) => a.action + ':' + (a.toStage ?? ''))).toEqual([
      'start_targeting:targeting', 'archive:',
    ])
    await move(cto, t.id, 'targeting')
    expect((await errorOf(move(cto, t.id, 'approved'))).message).toMatch(/reason/)
    expect(await move(cto, t.id, 'approved', 'Wait for Marketing’s answers')).toMatchObject({ stage: 'approved' })
  })
})

describe('proposals Ember makes and the person confirms', () => {
  async function conversation(user: string, toolCall: string) {
    await db.exec('reset role')
    const { rows } = await db.query<{ id: string }>('insert into conversations(user_id) values ($1) returning id', [user])
    await db.query("insert into chat_messages(conversation_id, user_id, role, content, tool_call_id, tool_name) values ($1, $2, 'tool', '{}', $3, 'sli_propose_trigger')", [
      rows[0].id, user, toolCall,
    ])
    await db.exec('set role authenticated')
    return rows[0].id
  }

  it('raises a Trigger only when the person confirms, and tells the conversation', async () => {
    const conv = await conversation(analyst, 'call-1')
    await as(analyst)
    const p = await call('sli_create_proposal', 'raise_trigger', { title: 'Hyperscaler price rise', triggerType: 'market_event', summary: 'Cloud prices up 12%' }, conv, 'call-1', null)
    expect(p).toMatchObject({ status: 'proposed', summary: expect.stringMatching(/Raise “Hyperscaler price rise”/) })
    expect((await call<Json[]>('sli_list_triggers', false, null)).length).toBe(0)
    expect((await call<Json[]>('sli_list_pending_proposals', null)).map((x) => x.id)).toEqual([p.id])

    await as(md)
    expect((await errorOf(call('sli_confirm_proposal', p.id))).code).toBe('42501')
    expect(await call<Json[]>('sli_get_proposals', [p.id])).toEqual([])

    await as(analyst)
    const done = await call('sli_confirm_proposal', p.id)
    expect(done).toMatchObject({ status: 'confirmed', result: { code: 'TRG-001' } })
    expect(await call('sli_confirm_proposal', p.id)).toMatchObject({ status: 'confirmed' })
    expect((await call<Json[]>('sli_list_triggers', false, null)).map((t) => t.code)).toEqual(['TRG-001'])
    await db.exec('reset role')
    const { rows } = await db.query<{ content: string }>("select content from chat_messages where tool_call_id = 'call-1'")
    expect(JSON.parse(rows[0].content)).toMatchObject({ status: 'confirmed', result: { code: 'TRG-001' } })
  })

  it('checks what it can up front, and records a refusal at confirmation as failed', async () => {
    await as(analyst)
    expect((await errorOf(call('sli_create_proposal', 'raise_trigger', { title: 'X y z', triggerType: 'nope' }, null, null, null))).message).toMatch(/Unknown Trigger type. Use one of: .*market_event/)
    await as(idle)
    expect((await errorOf(call('sli_create_proposal', 'raise_trigger', { title: 'Idea', triggerType: 'market_event' }, null, null, null))).message).toMatch(/department/)
    await as(rival)
    const conv = await conversation(analyst, 'call-2')
    await as(rival)
    expect((await errorOf(call('sli_create_proposal', 'raise_trigger', { title: 'Idea', triggerType: 'market_event' }, conv, null, null))).code).toBe('42501')

    await as(analyst)
    const p = await call('sli_create_proposal', 'raise_trigger', { title: 'Idea', triggerType: 'market_event' }, null, null, null)
    await db.exec(`reset role; delete from sli_department_members where user_id = '${analyst}'; set role authenticated;`)
    await as(analyst)
    const failed = await call('sli_confirm_proposal', p.id)
    expect(failed).toMatchObject({ status: 'failed', error: expect.stringMatching(/Only members of an SLI department/) })
    expect((await errorOf(call('sli_cancel_proposal', id(999)))).code).toBe('42501')
  })

  it('adds a candidate, a new company and a recommendation on the Trigger in the conversation', async () => {
    await db.exec(`reset role;
      update sli_departments set accepts_handoffs = true where id = '${marketing}';
      set role authenticated;`)
    const t = await raise(analyst, 'VMware exit offer')
    await move(cto, t.id, 'researching')
    await as(isr)
    const acme = (await call<{ id: string }>('sli_save_customer', null, 'Acme Logistics', 'acme.ph', null, null, null, null, null, null, null, null)).id

    await as(isr)
    expect((await errorOf(call('sli_create_proposal', 'add_candidate', { customerId: acme, tier: 'existing_customer', fitRationale: 'Runs VMware' }, null, null, t.id))).code).toBe('42501')
    await as(analyst)
    expect((await errorOf(call('sli_create_proposal', 'add_candidate', { customerId: 'not-a-uuid', tier: 'existing_customer', fitRationale: 'Runs VMware' }, null, null, t.id))).message).toMatch(/Unknown company/)
    const c = await call('sli_create_proposal', 'add_candidate', { customerId: acme, tier: 'existing_customer', fitRationale: 'Runs VMware' }, null, null, t.id)
    expect(c.summary).toBe(`Add Acme Logistics to ${t.code}’s candidate customers (existing customer)`)
    expect((await call<Json[]>('sli_list_pending_proposals', t.id)).length).toBe(1)
    await call('sli_confirm_proposal', c.id)
    expect((await call('sli_list_candidate_customers', t.id)).candidates[0]).toMatchObject({ name: 'Acme Logistics', createdVia: 'assistant' })

    expect((await errorOf(call('sli_create_proposal', 'create_customer', { name: 'ACME Logistics Inc.' }, null, null, t.id))).message).toMatch(/already in the registry/)
    const n = await call('sli_create_proposal', 'create_customer', { name: 'Beta Foods', website: 'beta.ph', candidate: { tier: 'new_prospect', fitRationale: 'Expanding to Cebu' } }, null, null, t.id)
    expect(n.summary).toMatch(/registry and to .*candidate customers \(new prospect\)/)
    expect(await call('sli_confirm_proposal', n.id)).toMatchObject({ status: 'confirmed', result: { customerId: expect.any(String), code: t.code } })
    expect((await call('sli_list_candidate_customers', t.id)).candidates.map((x: Json) => x.name)).toEqual(['Acme Logistics', 'Beta Foods'])

    expect((await errorOf(call('sli_create_proposal', 'record_recommendation', { recommendation: 'approve' }, null, null, t.id))).message).toMatch(/under review/)
    for (const stage of ['concept', 'feasibility', 'under_review']) await move(cto, t.id, stage)
    await as(analyst)
    expect((await errorOf(call('sli_create_proposal', 'record_recommendation', { recommendation: 'approve', destination: 'Nowhere' }, null, null, t.id))).message).toMatch(/Use one of: Marketing/)
    const r = await call('sli_create_proposal', 'record_recommendation', { recommendation: 'approve', destination: 'marketing', comments: 'Strong fit' }, null, null, t.id)
    expect(r.summary).toBe(`Record your recommendation on ${t.code}: approve, hand to Marketing`)
    const cancelled = await call('sli_cancel_proposal', r.id)
    expect(cancelled.status).toBe('cancelled')
    expect((await call('sli_confirm_proposal', r.id)).status).toBe('cancelled')
  })

  it('finds the Trigger behind a research Project for people with full access', async () => {
    const t = await raise(analyst, 'VMware exit offer')
    await move(cto, t.id, 'researching')
    await db.exec('reset role')
    const { rows } = await db.query<{ project_id: string }>('select project_id from sli_triggers where id = $1', [t.id])
    await db.exec('set role authenticated')
    await as(analyst)
    expect(await call('sli_trigger_for_project', rows[0].project_id)).toMatchObject({ code: t.code, stage: 'researching' })
    await as(rival)
    expect(await call('sli_trigger_for_project', rows[0].project_id)).toBeNull()
  })
})
