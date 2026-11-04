import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Real PostgreSQL, in memory: the SLI migrations run against a small
// stand-in for the Core objects they reference (profiles, is_admin,
// set_updated_at, auth). Never reads .env.local or contacts Supabase.
const MIGRATIONS = [
  'supabase/migrations/20261101100001_sli_organizations_and_departments.sql',
  'supabase/migrations/20261101100002_sli_triggers.sql',
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
    truncate sli_admin_access_log, sli_trigger_stage_history, sli_triggers, sli_trigger_types, sli_department_members,
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
