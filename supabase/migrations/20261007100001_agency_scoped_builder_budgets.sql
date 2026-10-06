-- Agencies see and control their own builders' AI budgets (2026-10-04,
-- Mike). With the Builder/Enterprise modes merged, an enterprise running its
-- own Ember is the agency and wants the same control over its employees'
-- AI spend that a builder agency has over its builders.
--
-- Until now any curator could read or change any builder's allowance,
-- credit grants and BYOLLM credential (is_curator_or_admin), so on a
-- deployment shared by several agencies one agency could manage another's
-- builders. Scope all three to the builder themselves, their own agency
-- (agency_builders, via is_builder_agency) and the platform admin. A
-- builder on no agency's roster is managed by the admin alone -- same set
-- the agency dashboard (/agency) shows each viewer.
create or replace function can_manage_builder_budget(builder uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(uid) or is_builder_agency(builder, uid);
$$;

drop policy if exists "builder_ai_allowances_select_own_or_operator" on builder_ai_allowances;
drop policy if exists "builder_ai_allowances_select_own_agency_or_admin" on builder_ai_allowances;
create policy "builder_ai_allowances_select_own_agency_or_admin" on builder_ai_allowances
  for select using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));

-- A builder still cannot raise their own cap.
drop policy if exists "builder_ai_allowances_manage_staff" on builder_ai_allowances;
drop policy if exists "builder_ai_allowances_manage_agency_or_admin" on builder_ai_allowances;
create policy "builder_ai_allowances_manage_agency_or_admin" on builder_ai_allowances
  for all
  using (can_manage_builder_budget(builder_id, auth.uid()))
  with check (can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_credit_grants_select_own_or_operator" on builder_credit_grants;
drop policy if exists "builder_credit_grants_select_own_agency_or_admin" on builder_credit_grants;
create policy "builder_credit_grants_select_own_agency_or_admin" on builder_credit_grants
  for select using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_credit_grants_insert_staff" on builder_credit_grants;
drop policy if exists "builder_credit_grants_insert_agency_or_admin" on builder_credit_grants;
create policy "builder_credit_grants_insert_agency_or_admin" on builder_credit_grants
  for insert to authenticated
  with check (granted_by = auth.uid() and can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_llm_credentials_select_own_or_operator" on builder_llm_credentials;
drop policy if exists "builder_llm_credentials_select_own_agency_or_admin" on builder_llm_credentials;
create policy "builder_llm_credentials_select_own_agency_or_admin" on builder_llm_credentials
  for select using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_llm_credentials_manage_own_or_staff" on builder_llm_credentials;
drop policy if exists "builder_llm_credentials_manage_own_agency_or_admin" on builder_llm_credentials;
create policy "builder_llm_credentials_manage_own_agency_or_admin" on builder_llm_credentials
  for all
  using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()))
  with check (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));
