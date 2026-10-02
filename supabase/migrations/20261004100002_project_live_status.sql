-- Live status (2026-10-02, Mike). After a project is Approved ('completed')
-- it waits for the client's approval -- normally given through the
-- workstream presentation -- and then goes Live: in production and in
-- maintenance. Pipeline: draft -> active -> review -> completed -> live.
-- A Live project stays Live: bug fixes and new features are new workstreams
-- inside it. An Approved project can be reopened to Working on it. Safe to re-run.
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check
  check (status = any (array['draft'::text, 'active'::text, 'review'::text, 'completed'::text, 'live'::text, 'archived'::text]));
