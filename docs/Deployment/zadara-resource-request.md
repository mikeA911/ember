# Zadara Resource Request — Ember, Ember Sandz and Future Supabase Apps

**Status:** Planning figures, v0.1, 23 October 2026  
**Decision record:** [ADR-0003](../architecture-decisions/ADR-0003-source-hosting-and-zadara-deployment.md)  
**Related:** [Ember on self-hosted Supabase](../guides/ember-on-self-hosted-supabase.md), [Moving guide](../guides/moving-to-gitlab-and-zadara.md)

These are starting figures to request capacity. They are estimates, not measurements. Check real use one month after go-live (§6) and resize from the numbers.

## 1. Assumptions

- **Users:** internal staff, tens of people, up to about 50 active at once. This is not a public-facing high-traffic app.
- **Apps:** Ember with the Ember Sandz module is the first app. Plan for **two more Supabase-based apps in year one**.
- **AI:** inference runs on external providers (OpenAI, Gemini and others) or a future GPU host. No AI models run on these VMs. Most AI-heavy requests (evaluation runs, assistant turns) spend their time waiting on the provider, not using local CPU.
- **Files** (uploaded documents, branding, artifacts) are stored in Zadara S3, not on VM disks.
- **Database growth** comes mostly from vector embeddings: about 6 KB per approved chunk plus index, so 100,000 chunks is about 1–1.5 GB. Postgres is fastest when vector indexes fit in RAM.
- **Each Supabase stack** (Postgres, Auth, REST, Storage API, Realtime, gateway, Studio) uses about 2–3 GB of RAM when idle.
- **Builds** run on GitLab.com shared runners at first. The ops VM runner only deploys.

## 2. Production

### Day one: Ember and Ember Sandz only

| VM | Role | vCPU | RAM | SSD | Public IP |
|---|---|---|---|---|---|
| `prod-app-01` | Caddy (TLS and routing), Ember container (2 instances), cron | 4 | 8 GB | 80 GB | Yes (443 only) |
| `prod-data-01` | Supabase stack `ember-prod` | 4 | 16 GB | 150 GB | No |
| `prod-ops-01` | Monitoring, logs, GitLab runner (deploy only), backup checks | 2 | 4 GB | 100 GB | No (VPN or bastion) |
| **Total** | | **10** | **28 GB** | **330 GB** | |

### Year one: plus two more apps

| VM | Change | vCPU | RAM | SSD |
|---|---|---|---|---|
| `prod-app-01` | Two more app containers | 8 | 16 GB | 120 GB |
| `prod-data-01` | Two more Supabase stacks | 8 | 32 GB | 300 GB |
| `prod-ops-01` | Runner also builds images; longer log retention | 4 | 8 GB | 150 GB |
| **Total** | | **20** | **56 GB** | **570 GB** |

**Recommendation:** request the **year-one quota** now and provision the **day-one sizes**, if Zadara allows resizing a VM with a reboot. Otherwise provision the year-one sizes for `prod-data-01` from the start, because the database is the hardest VM to move later.

### Why these numbers

**`prod-app-01`**

- Each Next.js server process uses about 300–600 MB at steady state. Document parsing (PDF, Word) and image processing (`sharp`) cause short CPU and memory spikes during uploads. Two Ember instances at roughly 1.5 GB each, with headroom, fit in 8 GB beside Caddy and the OS.
- Each additional app is about 1–2 GB.
- Disk holds container images and logs only.

**`prod-data-01`**

- `ember-prod` is budgeted at about 8 GB: about 3 GB idle stack plus Postgres shared buffers and cache, with room for vector indexes into the low hundreds of thousands of chunks.
- 16 GB on day one leaves room for growth and for the pgvector index build memory (`maintenance_work_mem`).
- `ember-on-self-hosted-supabase.md` lists 4 vCPU / 8 GB / 100 GB for an Ember-only prod stack. That remains the minimum. 16 GB is recommended because Ember Sandz adds CRM data to the same database and the VM will later host more stacks.
- Each extra stack is about 4–6 GB including its Postgres cache. Two more bring the VM to about 24 GB used, so 32 GB keeps roughly 25% headroom.
- Disk covers Postgres and indexes, Supabase images (about 10–15 GB per release, shared across stacks), WAL, and three days of local dumps per stack. Grow the volume rather than the VM when it reaches 80%.

**`prod-ops-01`**

- Prometheus or a similar tool, Grafana, a log store (Loki) with 30 days' retention, an uptime checker and a GitLab runner fit in 4 GB.
- If the runner also builds container images (`next build` needs about 4 GB and several minutes of CPU), use 4 vCPU / 8 GB.

## 3. Lab

One VM runs everything: Caddy, app containers, and a lab Supabase stack per app.

| VM | Day one | Year one |
|---|---|---|
| `lab-01` | 4 vCPU, 16 GB, 200 GB | 8 vCPU, 32 GB, 300 GB |

Lab can also host per-merge-request preview deployments, replacing Vercel previews.

## 4. Object storage (Zadara S3)

| Bucket | Day one | Notes |
|---|---|---|
| `<app>-prod-storage` (per app) | 100 GB | Uploaded files. Turn on **versioning**. |
| `prod-backups` | 300 GB | Daily compressed database dumps for every prod stack, 30-day retention, plus weekly copies for 3 months. Dumps are roughly 20–40% of database size. |
| `<app>-lab-storage` and `lab-backups` | 100 GB total | 7-day dump retention |
| **Total** | **about 500 GB**, growing with documents | |

Keep backups in a different bucket, and ideally a different Zadara site or account, from the data they protect.

## 5. Network

| Need | Detail |
|---|---|
| Private network | Between `prod-app-01`, `prod-data-01` and `prod-ops-01`. Supabase ports (8000+) and Postgres (5432) are reachable only on it. |
| Public inbound | 443 (and 80 for ACME redirects) on `prod-app-01` and `lab-01` only. |
| Admin access | SSH through VPN or a bastion. Supabase Studio restricted to office or VPN addresses. |
| Outbound | HTTPS to AI providers (OpenAI, Google Gemini and others in use), SMTP provider, GitLab.com and its container registry, OS and Docker package mirrors. **Test AI provider access from the Zadara Philippines zone before cut-over.** |
| DNS | `ember.<domain>`, `api.ember.<domain>`, plus a pair per future app and per lab environment. |

## 6. One-month check

Run on each data VM, and resize from these numbers:

```sql
select pg_size_pretty(pg_database_size('postgres'));
select pg_size_pretty(pg_total_relation_size('kb_vectors')) as kb_vectors,
       pg_size_pretty(pg_total_relation_size('wiki_vectors')) as wiki_vectors;
select count(*) from kb_vectors;
```

```bash
free -h; df -h; docker stats --no-stream
```

Resize triggers:

- **Data VM:** sustained memory above 70%, or the vector tables larger than about a quarter of RAM. Add RAM; at about 500,000 `kb_vectors` rows, budget 16 GB for the Ember stack alone.
- **App VM:** CPU above 70% during working hours, or out-of-memory restarts. Add vCPU or a second app VM behind the proxy.
- **Any disk:** above 80%. Grow the volume.

## 7. Not included

- **GPU for a self-hosted LLM.** Size separately when chosen (`docs/guides/ember-self-hosted-llm-integration.md`).
- **High availability** (a standby database, a second app VM, a load balancer). Decide after recovery objectives are agreed (ADR-0003, open questions).
- **Self-managed GitLab.** Add at least 4 vCPU / 8 GB / 100 GB if adopted.

## 8. Summary to paste into a request

> **Production (day one):** 3 VMs — 10 vCPU, 28 GB RAM, 330 GB SSD. App VM 4 vCPU / 8 GB / 80 GB (public 443); data VM 4 vCPU / 16 GB / 150 GB (private); ops VM 2 vCPU / 4 GB / 100 GB (private).  
> **Lab:** 1 VM — 4 vCPU / 16 GB / 200 GB.  
> **Object storage:** about 500 GB S3 with versioning.  
> **Year-one quota to reserve:** 28 vCPU, 88 GB RAM, 870 GB SSD across production and lab, plus storage growth.  
> **Network:** private network between production VMs, public IP on app and lab VMs only, VPN or bastion for administration. Ubuntu 24.04 LTS.
