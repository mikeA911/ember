-- SQL Editor version of seed-cebu-ng911-project.mjs -- paste into Supabase
-- Dashboard -> SQL Editor and Run. Creates the "cebu-ng911" draft consulting
-- Project owned by test-consultant (projects_create_owner_membership adds the
-- owner row), stages mike.aguilar@gmail.com as Project curator, and adds one
-- presales Workstream per integration. Idempotent: safe to run again; it
-- reuses the Project and only fills in what's missing. Changes no password
-- or platform role.
do $$
declare
  v_owner uuid;
  v_curator uuid;
  v_project uuid;
begin
  select id into v_owner from profiles where email = 'test-consultant@kbsandbox.local';
  if v_owner is null then
    raise exception 'test-consultant@kbsandbox.local profile not found -- seed the test users first';
  end if;
  select id into v_curator from profiles where email = 'mike.aguilar@gmail.com';
  if v_curator is null then
    raise exception 'mike.aguilar@gmail.com profile not found';
  end if;

  select id into v_project from projects where name = 'cebu-ng911';
  if v_project is null then
    insert into projects (name, project_type, objective, status, notes, details, owner_id)
    values (
      'cebu-ng911',
      'consulting',
      $t$Scope and validate the system integrations for the Cebu NG911 and Safe City modernization (Sandz / KabatOne): Motorola radio, Mitel PBX and KabatOne K-Safety.$t$,
      'draft',
      null,
      jsonb_build_object(
        'business_problem',
        $t$Cebu's emergency call intake is fragmented and analog (the city's NGA-based 911 center under CCDRRMO has been costly to maintain), field radio, telephony and situational-awareness systems are not connected, and there is no unified GIS operational map across incidents, units and infrastructure. No Cebu-specific call-answer or response-time data is published.$t$,
        'target_outcome',
        $t$A validated integration design for each system (radio AVL and dispatch, PBX call handling, K-Safety situational awareness), with vendor claims checked against evidence and data-privacy obligations (Data Privacy Act) for caller-location and CCTV data tracked.$t$
      ),
      v_owner
    )
    returning id into v_project;

    insert into project_status_history (project_id, from_status, to_status, actor_id)
    values (v_project, null, 'draft', v_owner);
  end if;

  insert into project_members (project_id, user_id, role, status)
  values (v_project, v_curator, 'curator', 'active')
  on conflict (project_id, user_id) do update set role = 'curator', status = 'active';

  insert into project_workstreams
    (project_id, parent_workstream_id, name, slug, status, repository_scope, goal, deliverables, lifecycle_stage, created_by)
  select v_project, null, w.name, w.slug, 'draft', '{}', w.goal, w.deliverables, 'presales', v_owner
  from (values
    (
      'CCTO Motorola Radio Integration',
      'ccto-motorola-radio-integration',
      $t$Integrate the city's Motorola radio fleet with the NG911 platform so field units appear on the operational map and dispatch can reach them from the command center. Confirm radio model, protocol (e.g. DMR/P25), the GPS/AVL reporting format and the available gateway or console APIs. Validate whether K-Safety's AVL engine supports that protocol for real-time tracking (open item on the K-Safety evaluation checklist). Ownership needs confirming: the ontology records the 5-channel Motorola network as operated by CCDRRMO, not CCTO.$t$,
      '[{"label": "Radio fleet and channel inventory (models, protocol, GPS capability)", "completed": false},
        {"label": "AVL / gateway interface specification", "completed": false},
        {"label": "K-Safety AVL protocol compatibility finding", "completed": false},
        {"label": "Integration design and test plan", "completed": false}]'::jsonb
    ),
    (
      'Mitel PBX Integration',
      'mitel-pbx-integration',
      $t$Integrate the Mitel PBX with the NG911 call-handling flow: SIP trunking to carriers (NG911 Phase 1 SIP connectivity), call-taker ACD/queues and CTI so a 911 call opens a K-Dispatch incident with caller number and location. Confirm the PBX model and software release, SIP/CTI interfaces, and call-location data (ANI/ALI or device-based location), and cover call recording, TDoS protection and the handoff between the city center and the BFP-run Visayas regional hub.$t$,
      '[{"label": "PBX inventory and interface summary (SIP, CTI, recording)", "completed": false},
        {"label": "Call flow: carrier -> PBX -> call-taker -> K-Dispatch incident", "completed": false},
        {"label": "Caller-location and data-privacy handling notes", "completed": false},
        {"label": "Integration design and test plan", "completed": false}]'::jsonb
    ),
    (
      'KabatOne K-Safety Integration',
      'kabatone-k-safety-integration',
      $t$Integrate KabatOne K-Safety as the situational-awareness layer: unified GIS operational map, AVL, sensor fusion and alerting, and dispatch recommendations fed from K-Dispatch and K-Video. Validate the vendor's claims (currently unverified) against Cebu's needs: REST/WebSocket mapping to the DILG Region VII hub gateway, NENA i3 conformance, MQTT/CoAP sensor ingestion, ONVIF camera bridging, and offline caching of base maps and GIS layers on edge servers for typhoon connectivity loss.$t$,
      '[{"label": "Validated K-Safety capability matrix (vendor claim vs. evidence)", "completed": false},
        {"label": "DILG hub gateway API mapping", "completed": false},
        {"label": "Offline map-caching / edge resilience finding", "completed": false},
        {"label": "Integration design and test plan", "completed": false}]'::jsonb
    )
  ) as w(name, slug, goal, deliverables)
  on conflict (project_id, slug) do nothing;
end $$;

-- Result: the project, its members and its workstreams.
select p.id as project_id, p.name, p.status, pr.email, pm.role as project_role
from projects p
join project_members pm on pm.project_id = p.id
join profiles pr on pr.id = pm.user_id
where p.name = 'cebu-ng911';

select w.name, w.lifecycle_stage, w.status
from project_workstreams w
join projects p on p.id = w.project_id
where p.name = 'cebu-ng911'
order by w.name;
