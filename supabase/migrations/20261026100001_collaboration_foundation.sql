-- Additive development migration. Do not apply to the shared live backend
-- until the local authorization/concurrency checks and deployment review pass.
create table public.shared_conversations (
  id uuid primary key,
  project_id uuid not null references public.projects(id),
  host_id uuid not null references public.profiles(id),
  guest_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  invitation_expires_at timestamptz not null default (now() + interval '1 day'),
  accepted_at timestamptz,
  check (host_id <> guest_id)
);
create table public.workspace_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.shared_conversations(id),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  revision integer not null default 0,
  generation integer not null default 0,
  controller_id uuid not null references public.profiles(id),
  requested_by uuid references public.profiles(id),
  host_connection uuid,
  guest_connection uuid,
  host_seen_at timestamptz,
  guest_seen_at timestamptz,
  workstream_id uuid references public.project_workstreams(id)
);
create unique index workspace_sessions_one_active on public.workspace_sessions(conversation_id) where ended_at is null;
create table public.workspace_session_events (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.shared_conversations(id),
  session_id uuid references public.workspace_sessions(id),
  actor_id uuid not null references public.profiles(id),
  event text not null,
  revision integer,
  generation integer,
  created_at timestamptz not null default now()
);
create index shared_conversations_host on public.shared_conversations(host_id, created_at desc);
create index shared_conversations_guest on public.shared_conversations(guest_id, created_at desc);
alter table public.shared_conversations enable row level security;
alter table public.workspace_sessions enable row level security;
alter table public.workspace_session_events enable row level security;
-- No direct client writes or table reads: authenticated RPCs return minimal DTOs.
revoke all on public.shared_conversations, public.workspace_sessions from anon, authenticated;
revoke all on public.workspace_session_events from anon, authenticated;

create function public.collaboration_member(pid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members m join public.profiles p on p.id=m.user_id
    where m.project_id=pid and m.user_id=uid and m.status='active' and p.is_active);
$$;
revoke all on function public.collaboration_member(uuid,uuid) from public, anon, authenticated;

create function public.collaboration_command(
  p_command text, p_id uuid default null, p_project uuid default null,
  p_guest uuid default null, p_connection uuid default null,
  p_revision integer default null, p_generation integer default null,
  p_workstream uuid default null, p_session uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  c public.shared_conversations;
  s public.workspace_sessions;
  mine uuid;
  seen timestamptz;
  online boolean;
  result jsonb;
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and is_active) then
    raise exception 'Collaboration access denied' using errcode='42501';
  end if;
  if p_command='history' then
    select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'project_id',h.project_id,
      'project_name',p.name,'host_id',h.host_id,'guest_id',h.guest_id,
      'other_name',coalesce(pr.full_name,'Project member'),'accepted_at',h.accepted_at,
      'invitation_expires_at',h.invitation_expires_at) order by h.created_at desc),'[]'::jsonb)
      into result from public.shared_conversations h join public.projects p on p.id=h.project_id
      join public.profiles pr on pr.id=case when h.host_id=actor then h.guest_id else h.host_id end
      where actor in(h.host_id,h.guest_id)
      and public.collaboration_member(h.project_id,h.host_id) and public.collaboration_member(h.project_id,h.guest_id);
    return result;
  end if;
  if p_command='invite' then
    if p_id is null or p_guest=actor or not public.collaboration_member(p_project,actor)
      or not public.collaboration_member(p_project,p_guest) then
      raise exception 'Both participants must be active Project members' using errcode='42501';
    end if;
    insert into public.shared_conversations(id,project_id,host_id,guest_id)
      values(p_id,p_project,actor,p_guest) on conflict(id) do nothing;
  end if;
  -- Serializes all transitions, including accept/resume and connection ownership.
  select * into c from public.shared_conversations where id=p_id for update;
  if not found or actor not in(c.host_id,c.guest_id)
    or not public.collaboration_member(c.project_id,c.host_id)
    or not public.collaboration_member(c.project_id,c.guest_id) then
    raise exception 'Collaboration access denied' using errcode='42501';
  end if;
  if p_command='invite' and (c.host_id<>actor or c.project_id<>p_project or c.guest_id<>p_guest) then
    raise exception 'Invitation identifier already used';
  end if;
  if p_command='accept' and c.accepted_at is null then
    if actor<>c.guest_id or c.invitation_expires_at<=clock_timestamp() then
      raise exception 'Invitation is not available';
    end if;
    update public.shared_conversations set accepted_at=clock_timestamp() where id=c.id returning * into c;
    insert into public.workspace_sessions(conversation_id,controller_id) values(c.id,c.host_id);
  end if;
  select * into s from public.workspace_sessions where conversation_id=c.id and ended_at is null for update;
  if p_command='resume' and s.id is null then
    if c.accepted_at is null then raise exception 'Accept the invitation first'; end if;
    insert into public.workspace_sessions(conversation_id,controller_id) values(c.id,c.host_id) returning * into s;
  end if;
  if p_command not in('history','invite','snapshot','accept','resume','join','heartbeat','request','grant','decline','reclaim','navigate','leave','end') then
    raise exception 'Unsupported collaboration command';
  end if;
  if p_command in('join','heartbeat','request','grant','decline','reclaim','navigate','leave','end') then
    if s.id is null or p_connection is null then raise exception 'Join a live session first'; end if;
    if p_session is distinct from s.id then raise exception 'Session changed; reopen the conversation' using errcode='40001'; end if;
    mine := case when actor=c.host_id then s.host_connection else s.guest_connection end;
    seen := case when actor=c.host_id then s.host_seen_at else s.guest_seen_at end;
    if p_command='join' then
      if mine is distinct from p_connection and seen>clock_timestamp()-interval '20 seconds' then
        raise exception 'This account is already joined in another browser tab';
      end if;
      if mine is not null and (mine is distinct from p_connection or seen is null or seen<=clock_timestamp()-interval '20 seconds') then
        s.generation:=s.generation+1;
        s.requested_by:=null;
      end if;
      if actor=c.host_id then
        s.host_connection:=p_connection; s.host_seen_at:=clock_timestamp();
      else
        s.guest_connection:=p_connection; s.guest_seen_at:=clock_timestamp();
      end if;
    else
      if mine is distinct from p_connection or seen is null or seen<=clock_timestamp()-interval '20 seconds' then
        raise exception 'Connection expired; rejoin the session';
      end if;
      if p_command='heartbeat' then
        if actor=c.host_id then s.host_seen_at:=clock_timestamp(); else s.guest_seen_at:=clock_timestamp(); end if;
      elsif p_command='leave' then
        if actor=c.host_id then s.host_seen_at:=null; s.host_connection:=null;
        else s.guest_seen_at:=null; s.guest_connection:=null; end if;
        s.generation:=s.generation+1; s.requested_by:=null;
      else
        if p_revision is distinct from s.revision or p_generation is distinct from s.generation then
          raise exception 'Workspace changed; refresh before retrying' using errcode='40001';
        end if;
        online := coalesce(s.host_seen_at>clock_timestamp()-interval '20 seconds'
          and s.guest_seen_at>clock_timestamp()-interval '20 seconds',false);
        if p_command='end' then
          if actor<>c.host_id then raise exception 'Only the host may end the session'; end if;
          s.ended_at:=clock_timestamp(); s.generation:=s.generation+1;
        else
          if not online then raise exception 'Both participants must be connected'; end if;
          if p_command='request' then
            if actor=s.controller_id then raise exception 'You already have control'; end if;
            s.requested_by:=actor;
          elsif p_command='grant' then
            if actor<>s.controller_id or s.requested_by is null then raise exception 'No control request to grant'; end if;
            s.controller_id:=s.requested_by; s.requested_by:=null; s.generation:=s.generation+1;
          elsif p_command='decline' then
            if actor<>s.controller_id then raise exception 'Only the controller may decline a request'; end if;
            s.requested_by:=null;
          elsif p_command='reclaim' then
            if actor<>c.host_id then raise exception 'Only the host may reclaim control'; end if;
            s.controller_id:=actor; s.requested_by:=null; s.generation:=s.generation+1;
          elsif p_command='navigate' then
            if actor<>s.controller_id then raise exception 'Request control before navigating'; end if;
            if p_workstream is not null and not exists(select 1 from public.project_workstreams where id=p_workstream and project_id=c.project_id) then
              raise exception 'Workstream is outside this Project';
            end if;
            s.workstream_id:=p_workstream;
          end if;
        end if;
        s.revision:=s.revision+1;
      end if;
    end if;
    update public.workspace_sessions set host_connection=s.host_connection,guest_connection=s.guest_connection,
      host_seen_at=s.host_seen_at,guest_seen_at=s.guest_seen_at,controller_id=s.controller_id,
      requested_by=s.requested_by,generation=s.generation,revision=s.revision,
      workstream_id=s.workstream_id,ended_at=s.ended_at where id=s.id;
  end if;
  if p_command not in('snapshot','heartbeat') then
    insert into public.workspace_session_events(conversation_id,session_id,actor_id,event,revision,generation)
      values(c.id,s.id,actor,p_command,s.revision,s.generation);
  end if;
  return jsonb_build_object('id',c.id,'project_id',c.project_id,'host_id',c.host_id,'guest_id',c.guest_id,
    'accepted_at',c.accepted_at,'invitation_expires_at',c.invitation_expires_at,
    'project_name',(select name from public.projects where id=c.project_id),
    'host_name',(select coalesce(full_name,'Project member') from public.profiles where id=c.host_id),
    'guest_name',(select coalesce(full_name,'Project member') from public.profiles where id=c.guest_id),
    'workstreams',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb)
      from public.project_workstreams where project_id=c.project_id),
    'session',case when s.id is null or s.ended_at is not null then null else
      jsonb_build_object('id',s.id,'revision',s.revision,'generation',s.generation,
        'controller_id',s.controller_id,'requested_by',s.requested_by,'workstream_id',s.workstream_id,
        'host_online',coalesce(s.host_seen_at>clock_timestamp()-interval '20 seconds',false),
        'guest_online',coalesce(s.guest_seen_at>clock_timestamp()-interval '20 seconds',false),
        'joined',coalesce(p_connection=case when actor=c.host_id then s.host_connection else s.guest_connection end
          and case when actor=c.host_id then s.host_seen_at else s.guest_seen_at end>clock_timestamp()-interval '20 seconds',false)) end);
end;
$$;
revoke all on function public.collaboration_command(text,uuid,uuid,uuid,uuid,integer,integer,uuid,uuid) from public,anon;
grant execute on function public.collaboration_command(text,uuid,uuid,uuid,uuid,integer,integer,uuid,uuid) to authenticated;
