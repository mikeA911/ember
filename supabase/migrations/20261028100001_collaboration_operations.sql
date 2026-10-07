-- Shared workspace sessions, Phase 4: operating it -- an administrators'
-- overview and recovery actions (docs/dev-request-shared-workspace-sessions.md).
--
-- collaboration_admin_overview gives platform administrators the state of
-- live sessions and recent problems (failed or stalled Ember turns, notes
-- stuck while sending, sessions past their deadline) and counts for a
-- recent period, so a pilot's trouble shows instead of passing silently.
-- It returns names and statuses, never message or draft text.
--
-- Recovery actions, each a status change recorded in collaboration_events
-- with the administrator as actor -- nothing is deleted:
-- - end a live session (reason "ended_by_admin": both bars say so);
-- - cancel an Ember turn that is waiting or running;
-- - reset a proposed note stuck "sending" to "failed", so the pair can
--   check the Project's notes and send it again if it never arrived;
-- - settle every live session that is past its deadline or lost access.
--
-- Platform admins only (is_admin), and never from an external MCP client.
-- Changes one existing rule: collaboration_sessions.end_reason also allows
-- 'ended_by_admin' (the constraint is replaced; every existing value stays
-- valid). Safe to re-run. Requires 20261027100001.

alter table collaboration_sessions drop constraint if exists collaboration_sessions_end_reason_check;
alter table collaboration_sessions add constraint collaboration_sessions_end_reason_check
  check (end_reason in ('ended_by_host', 'everyone_left', 'inactive', 'participant_inactive', 'expired', 'access_revoked', 'ended_by_admin'));

-- The calling administrator (refuses everyone else and MCP tokens).
create or replace function collaboration_admin()
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
begin
  if not is_admin(v_actor) then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function collaboration_admin_log(p_session uuid, p_actor uuid, p_event text, p_subject uuid default null)
returns void
language sql security definer set search_path = public as $$
  insert into collaboration_events(session_id, conversation_id, actor_id, subject_id, event, control_generation)
  select s.id, s.conversation_id, p_actor, p_subject, p_event, s.control_generation from collaboration_sessions s where s.id = p_session;
$$;

revoke all on function collaboration_admin() from public, anon, authenticated;
revoke all on function collaboration_admin_log(uuid, uuid, text, uuid) from public, anon, authenticated;

-- The overview. p_hours: the period the counts and recent problems cover
-- (1 to 720 hours).
create or replace function collaboration_admin_overview(p_hours integer default 24)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  v_since timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 720)));
begin
  perform v_admin;
  return jsonb_build_object(
    'since', v_since,
    'live', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'conversationId', s.conversation_id, 'projectId', s.project_id,
        'projectName', (select name from projects where id = s.project_id),
        'hostName', collaboration_display_name(s.host_id), 'guestName', collaboration_display_name(s.guest_id),
        'controllerName', collaboration_display_name(s.controller_id),
        'startedAt', s.started_at,
        'hostPresent', coalesce(collaboration_is_present(h), false), 'guestPresent', coalesce(collaboration_is_present(g), false),
        'hostAway', collaboration_is_away(h, s.started_at), 'guestAway', collaboration_is_away(g, s.started_at),
        'endsAt', d.ends_at, 'overdue', d.ends_at <= now(), 'endingReason', d.reason,
        'watching', (select count(*) from collaboration_watchers w where w.session_id = s.id and w.stopped_at is null
                     and w.last_seen_at > now() - collaboration_presence_window())::int,
        'turnsWaiting', (select count(*) from collaboration_turns t where t.session_id = s.id and t.status = 'queued')::int,
        'turnRunning', exists (select 1 from collaboration_turns t where t.session_id = s.id and t.status = 'running'),
        'openDrafts', (select count(*) from collaboration_drafts r where r.session_id = s.id and r.status = 'open')::int
      ) order by s.started_at desc)
      from (select * from collaboration_sessions where status = 'active' order by started_at desc limit 100) s
      join collaboration_participants h on h.session_id = s.id and h.user_id = s.host_id
      join collaboration_participants g on g.session_id = s.id and g.user_id = s.guest_id
      cross join lateral collaboration_deadline(s.id) d
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'invitations', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select case when status = 'pending' and expires_at <= now() then 'expired' else status end as status, count(*) as n
        from collaboration_invitations where created_at > v_since group by 1) x),
      'sessionsStarted', (select count(*) from collaboration_sessions where started_at > v_since)::int,
      'sessionsEnded', (select coalesce(jsonb_object_agg(end_reason, n), '{}'::jsonb) from (
        select end_reason, count(*) as n from collaboration_sessions where ended_at > v_since group by 1) x),
      'controlChanges', (select count(*) from collaboration_events where created_at > v_since
        and event in ('control_granted', 'control_reclaimed', 'control_taken_while_away', 'control_passed_on_leave'))::int,
      'saves', (select count(*) from collaboration_saves where created_at > v_since)::int,
      'draftsAbandoned', (select count(*) from collaboration_drafts where status = 'abandoned' and updated_at > v_since)::int,
      'turns', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status, count(*) as n from collaboration_turns where created_at > v_since group by 1) x),
      'turnsRetried', (select count(*) from collaboration_turns where created_at > v_since and attempts > 1)::int,
      'answerSecondsMedian', (select percentile_cont(0.5) within group (order by extract(epoch from finished_at - started_at))
        from collaboration_turns where status = 'done' and finished_at > v_since),
      'answerSecondsP90', (select percentile_cont(0.9) within group (order by extract(epoch from finished_at - started_at))
        from collaboration_turns where status = 'done' and finished_at > v_since),
      'comments', (select count(*) from collaboration_messages where kind = 'comment' and created_at > v_since)::int,
      'summaries', (select count(*) from collaboration_summaries where created_at > v_since)::int,
      'notesSent', (select count(*) from collaboration_proposal_uses where status = 'sent' and updated_at > v_since)::int
    ),
    'problems', jsonb_build_object(
      -- Running past its lease, or waiting over 2 minutes with nothing running.
      'stalledTurns', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'conversationId', t.conversation_id,
          'projectName', (select p.name from collaboration_conversations c join projects p on p.id = c.project_id where c.id = t.conversation_id),
          'requestedByName', collaboration_display_name(t.requested_by), 'createdAt', t.created_at, 'attempts', t.attempts,
          'leaseExpiresAt', t.lease_expires_at) order by t.created_at)
        from collaboration_turns t
        where (t.status = 'running' and t.lease_expires_at <= now())
           or (t.status = 'queued' and t.created_at < now() - interval '2 minutes'
               and not exists (select 1 from collaboration_turns r where r.conversation_id = t.conversation_id and r.status = 'running'))
      ), '[]'::jsonb),
      'failedTurns', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'conversationId', t.conversation_id,
          'projectName', (select p.name from collaboration_conversations c join projects p on p.id = c.project_id where c.id = t.conversation_id),
          'requestedByName', collaboration_display_name(t.requested_by), 'error', t.error, 'attempts', t.attempts, 'finishedAt', t.finished_at)
          order by t.finished_at desc)
        from (select * from collaboration_turns where status = 'failed' and finished_at > v_since order by finished_at desc limit 50) t
      ), '[]'::jsonb),
      'stuckNotes', coalesce((
        select jsonb_agg(jsonb_build_object('messageId', u.message_id, 'index', u.idx, 'byName', collaboration_display_name(u.by_user),
          'since', u.updated_at, 'conversationId', m.conversation_id))
        from collaboration_proposal_uses u join collaboration_messages m on m.id = u.message_id
        where u.status = 'sending' and u.updated_at < now() - interval '5 minutes'
      ), '[]'::jsonb),
      'overdueSessions', (select count(*) from collaboration_sessions s cross join lateral collaboration_deadline(s.id) d
        where s.status = 'active' and d.ends_at <= now())::int
    )
  );
end;
$$;

-- Ends a live session. Unsaved drafts are kept as abandoned, as on any end.
create or replace function collaboration_admin_end_session(p_session uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  s collaboration_sessions;
begin
  select * into s from collaboration_sessions where id = p_session for update;
  if not found then
    raise exception 'Unknown session' using errcode = 'EC001';
  end if;
  if s.status <> 'active' then
    return jsonb_build_object('status', s.status, 'endReason', s.end_reason);
  end if;
  perform collaboration_end_session(s.id, 'ended_by_admin', v_admin);
  select * into s from collaboration_sessions where id = p_session;
  return jsonb_build_object('status', s.status, 'endReason', s.end_reason);
end;
$$;

-- Cancels an Ember turn that is waiting or running. A run still in progress
-- can't record its answer afterwards (its lease is gone).
create or replace function collaboration_admin_cancel_turn(p_turn uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  t collaboration_turns;
begin
  select * into t from collaboration_turns where id = p_turn;
  if not found then
    raise exception 'Unknown turn' using errcode = 'EC001';
  end if;
  perform 1 from collaboration_conversations where id = t.conversation_id for update;
  select * into t from collaboration_turns where id = p_turn for update;
  if t.status not in ('queued', 'running') then
    return jsonb_build_object('status', t.status);
  end if;
  update collaboration_turns
    set status = 'cancelled', error = 'Cancelled by an administrator.', lease_id = null, lease_expires_at = null,
        finished_at = now(), updated_at = now()
    where id = t.id;
  perform collaboration_admin_log(t.session_id, v_admin, 'admin_cancelled_turn');
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- A proposed note stuck "sending" (the send never finished) becomes
-- "failed", so either of the pair can try again. It may have been sent:
-- the pair should check the Project's notes first (the message says so).
create or replace function collaboration_admin_release_note(p_message uuid, p_index integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  u collaboration_proposal_uses;
begin
  select * into u from collaboration_proposal_uses where message_id = p_message and idx = p_index for update;
  if not found or u.status <> 'sending' then
    return jsonb_build_object('status', coalesce(u.status, 'none'));
  end if;
  update collaboration_proposal_uses
    set status = 'failed', updated_at = now(),
        result = jsonb_build_object('error', 'reset by an administrator -- check the Project notes before sending it again')
    where message_id = p_message and idx = p_index;
  perform collaboration_admin_log(m.session_id, v_admin, 'admin_released_note', u.by_user)
    from collaboration_messages m where m.id = p_message;
  return jsonb_build_object('status', 'failed');
end;
$$;

-- Settles every live session past its deadline or without access, as the
-- next poll would. Returns how many ended.
create or replace function collaboration_admin_settle_all()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  v_session uuid;
  v_ended integer := 0;
begin
  perform v_admin;
  for v_session in select id from collaboration_sessions where status = 'active' order by id for update loop
    if collaboration_settle(v_session) then
      v_ended := v_ended + 1;
    end if;
  end loop;
  return v_ended;
end;
$$;

revoke all on function collaboration_admin_overview(integer) from public, anon;
revoke all on function collaboration_admin_end_session(uuid) from public, anon;
revoke all on function collaboration_admin_cancel_turn(uuid) from public, anon;
revoke all on function collaboration_admin_release_note(uuid, integer) from public, anon;
revoke all on function collaboration_admin_settle_all() from public, anon;
grant execute on function collaboration_admin_overview(integer) to authenticated;
grant execute on function collaboration_admin_end_session(uuid) to authenticated;
grant execute on function collaboration_admin_cancel_turn(uuid) to authenticated;
grant execute on function collaboration_admin_release_note(uuid, integer) to authenticated;
grant execute on function collaboration_admin_settle_all() to authenticated;

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
