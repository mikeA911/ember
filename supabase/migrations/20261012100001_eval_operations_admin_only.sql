-- Ember Readiness, Stage 1 (docs/dev-request-ember-readiness-and-knowledge-
-- gaps.md): running evaluations, marking a baseline and recording human
-- review become platform-admin work. AI evaluation is evidence that Ember
-- understands a Project before it suggests anything -- a platform decision,
-- alongside choosing the default model -- so it moves to the admin
-- dashboard.
--
-- What changes:
--   eval_runs     insert/update: curator/admin + own-run consultant -> admin
--   eval_results  insert/update: curator/admin + consultant          -> admin
--
-- What deliberately does NOT change:
--   * eval_datasets / eval_cases: platform curators and Project curators
--     still create datasets and author draft cases -- they know the correct
--     answers for their Project. Draft-only case mutation stays enforced by
--     20260809110004_eval_rls.sql.
--   * Every select policy: reading runs and results is unchanged here; the
--     run pages themselves are admin-only in the app. Stage 2's readiness
--     section shows the measured score to Project members.
--   * graph_runs / graph_steps: Agents' "Ask a question" still creates
--     graph_runs as consultants; an admin's graph-mode eval run is already
--     covered by graph_runs_insert_staff.

drop policy if exists "eval_runs_insert_staff" on eval_runs;
drop policy if exists "eval_runs_update_staff" on eval_runs;
drop policy if exists "eval_runs_insert_active_consultant" on eval_runs;
drop policy if exists "eval_runs_update_own_consultant" on eval_runs;

create policy "eval_runs_insert_admin" on eval_runs
  for insert with check (is_admin(auth.uid()));

-- executeEvalRun's status transitions and markBaselineAction both update
-- eval_runs in the caller's session.
create policy "eval_runs_update_admin" on eval_runs
  for update using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists "eval_results_insert_staff" on eval_results;
drop policy if exists "eval_results_update_staff" on eval_results;
drop policy if exists "eval_results_insert_active_consultant" on eval_results;

create policy "eval_results_insert_admin" on eval_results
  for insert with check (is_admin(auth.uid()));

-- Human review (human_* columns) is the only in-place update of a result.
create policy "eval_results_update_admin" on eval_results
  for update using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
