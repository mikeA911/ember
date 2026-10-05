# KB Sandbox

KB Sandbox is an AI engineering workbench: a place to curate knowledge, build with it, evaluate the result against evidence, and keep a human in the loop the whole way through.

## Knowledge → Intelligence → Engineering → Governance → Learning

Every project starts with curated **Knowledge** — documents and source material a human has reviewed and approved, not raw scraped text. That knowledge becomes usable **Intelligence** when AI can retrieve and reason over it reliably, whether from source chunks, a curated Wiki, or a combination of both. Building on top of that intelligence — RAG pipelines, prompts, graphs, and agents — is the **Engineering** layer. **Governance** is the evaluation and review discipline that keeps the engineering honest: every claim that "this works better" is backed by an eval run, not a hunch. And because every run, review, and finding is recorded with provenance, the whole loop becomes a **Learning** system — each project makes the next one better.

- **Intelligence** = usable, retrievable, reasonable knowledge, not "the Wiki".
- **Governance** = evaluation + controls + review.
- **Evals** = measure AI configurations, not only retrieval-generation pipelines.

### Projects

A Project is a scoped piece of AI engineering work — a learning exercise, an experiment, a client engagement, an internal transformation, or a knowledge-building effort. It has its own knowledge, its own evaluation benchmark, and its own team, isolated from every other project.

### Evals

Evals run a benchmark dataset against a configured AI setup — a single-pass pipeline, a bounded retry graph, or an Agent — and score the result: recall, grounding, latency, cost. That means a change to a prompt, a chunking strategy, a model, or a graph can be judged on evidence instead of impression, and two different configurations can be compared on the same benchmark.

### Why provenance and human review matter

Every chunk, Wiki article, and eval result in KB Sandbox traces back to a source and, for anything that becomes canonical, a human approval. AI assistance drafts; a person still reviews. That trail is what makes the system trustworthy enough to build on, and honest enough to teach from — which is also why KB Sandbox works as a training ground for AI consulting: the method is visible, not just the output.

## Roadmap

KB Sandbox is being built in milestones, each one a working capability layered on top of the last rather than a phase that gets thrown away.

| # | Milestone | Description | Status |
|---|---|---|---|
| M1 | Curate | Turn sources into approved evidence. | Live |
| M2 | Organize | Turn evidence into structured knowledge. | Live |
| M3 | Evaluate | Measure whether AI actually works. | Live |
| M4 | Orchestrate | Build controlled iterative workflows. | Live |
| M5 | Apply | Agents + consulting workstreams. | Live |
| M6 | Deploy | Cloud / local / private / hybrid. | Planned |
| M7 | Govern | Risk + controls + guardrails + approvals. | Planned |
| M8 | Communicate | Findings + executive reports. | Planned |
| M9 | Teach | Consultant learning paths. | Planned |
| M10 | Research | Advanced retrieval / knowledge / autonomy. | Planned |

See [docs/ROADMAP.md](docs/ROADMAP.md) for the detailed, up-to-date status of each milestone.

## Tech stack

- **Framework:** Next.js (App Router, Server Actions, Server Components)
- **Database / auth / storage:** Supabase (Postgres, pgvector, row-level security)
- **AI providers:** OpenAI, Google Gemini, Groq, DeepSeek, and xAI Grok, behind a single provider-agnostic interface (`src/lib/ai/`) — which provider/model handles conversation, structured output, and embeddings is admin-configurable, not hard-coded.
- **Testing:** Vitest

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your Supabase project's URL/keys, plus the API key for at least one AI provider (only the key for a provider you actually enable in the admin AI Config page is required).

3. Apply the database schema: the SQL files under `supabase/migrations/` are the source of truth. On a fresh project, paste `supabase/combined_migration.sql` (every migration in order, in one transaction) into the Supabase SQL Editor, then run `supabase/migration_status_check.sql` there to confirm each migration's objects exist. Both files are generated — run `npm run db:build-sql` after adding a migration. For an existing project, apply only the new files in order via the SQL Editor or `scripts/run-migrations.mjs`, then run `supabase/migration_status_check_recent.sql`: the same check for only the last 10 migrations, short enough to load quickly in the SQL Editor.

4. Run the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

### Other useful scripts

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test         # vitest run
```

## License

See [LICENSE](LICENSE). All rights reserved unless a separate written agreement states otherwise.
