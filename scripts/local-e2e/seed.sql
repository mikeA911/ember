-- Two members of one Project (Hana owns it, Gil is a viewer), an account
-- that isn't a member, and two workstreams. Local e2e databases only.
alter role authenticator with login password 'local-only';
insert into auth.users(id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'hana@e2e.local'),
  ('a0000000-0000-4000-8000-000000000002', 'gil@e2e.local'),
  ('a0000000-0000-4000-8000-000000000003', 'olu@e2e.local');
insert into profiles(id, email, full_name, role) values
  ('a0000000-0000-4000-8000-000000000001', 'hana@e2e.local', 'Hana Host', 'member'),
  ('a0000000-0000-4000-8000-000000000002', 'gil@e2e.local', 'Gil Guest', 'member'),
  ('a0000000-0000-4000-8000-000000000003', 'olu@e2e.local', 'Olu Outsider', 'member')
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
insert into projects(id, name, project_type, owner_id, objective, approval_status, status)
  values ('b0000000-0000-4000-8000-000000000001', 'Harbour Dispatch Upgrade', 'consulting', 'a0000000-0000-4000-8000-000000000001',
          'Replace the CAD system at the harbour dispatch centre', 'approved', 'active');
insert into project_members(project_id, user_id, role)
  values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'viewer') on conflict do nothing;
insert into project_workstreams(id, project_id, name, slug) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Call intake', 'call-intake'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'Radio integration', 'radio-integration');
