# Ember integration — section for "Self-Hosted LLM on a Sandz Lab VM — Setup Guide"

This section replaces **Step 3's "Connecting Ember (first consumer)"** in the setup guide (Mike Aguilar, 3 October 2026). It also adds items to Step 4, Step 5, the operations rules, the acceptance checklist and the open questions. The rest of the guide (model, vLLM, hardware, Steps 1–2) stands as written.

It describes how Ember works as of October 2026. The code it relies on (Sandz-hosted AI for Live client Projects, the AI policy gate and local embeddings) is in `main` (PR #33), and the `ai_providers.is_self_hosted` migration has been applied.

---

## Step 3 (replacement): Connecting Ember

### How Ember calls a model

Ember's chat does not run in the browser or on the Supabase VM. It runs **server-side on Vercel** (`src/lib/chat/loop.ts`), and that server code does more than forward a prompt:

- runs the tool loop (up to 8 model calls per turn: knowledge search, notes, Workstreams and so on);
- searches Project knowledge, applying Project membership and restricted-source access first;
- checks the request's **information sensitivity** against the model's approved ceiling before anything reaches the model;
- stores the conversation, recording which provider and model produced each answer.

A Supabase Edge Function in front of vLLM would skip all of that. **Do not build the `llm-chat` Edge Function.** Instead, register vLLM as a provider in Ember's AI registry. Ember already supports any OpenAI-compatible server, including tool calls and JSON output, through `OpenAICompatibleProvider`.

### Network path: relay through the Supabase VM

Vercel is outside the Zadara network and its outbound IP addresses change, so it cannot reach the model's private IP directly or be allow-listed. Keep the model VM private and relay through Caddy on Ember's Supabase VM, which is already public on 443 with a valid certificate:

```text
Vercel (Ember) ──HTTPS──▶ Caddy on Ember's Supabase VM ──private network──▶ vLLM <llm-private-ip>:8000
                          https://<api-domain>/llm/v1/*                       /v1/*
```

Caddyfile block, inside the existing `<api-domain>` site (a Caddyfile change, so get Mike's sign-off first):

```caddy
handle_path /llm/* {
	reverse_proxy <llm-private-ip>:8000
}
```

This keeps Step 4's rule intact: only Ember's Supabase VM can reach port 8000. vLLM's own `--api-key` still authenticates every request.

**Alternatives,** if the relay is not acceptable: Vercel Secure Compute (fixed egress IPs, Enterprise plan), or running Ember's Next.js app on Zadara as well (see "Where prompts travel" below).

### Register the model in Ember

1. In Vercel, add an environment variable holding the key, for example `SANDZ_LLM_API_KEY=<Ember's vLLM key>`, for Production (and Preview if lab has its own model). Redeploy.
2. In Ember, **Admin → AI Config → Add provider**:

   | Field | Value |
   |---|---|
   | Type | OpenAI-compatible |
   | Name | `sandz-llm` |
   | Base URL | `https://<api-domain>/llm/v1` |
   | API key environment variable | `SANDZ_LLM_API_KEY` |

3. **Add model** on that provider:

   | Field | Value |
   |---|---|
   | Model ID | the vLLM `--served-model-name`, e.g. `qwen3.8-27b-fp8-2608` (see "Model version" below) |
   | Type | generation |
   | Capabilities | tools ✔, structured output ✔ |
   | Context window | match `--max-model-len` (65536, or 32768 if you lowered it) |

4. **Set the sensitivity ceiling** for `sandz-llm` (Admin → AI Config → provider → maximum sensitivity):
   - **Confidential** while the hop from the Supabase VM to the model VM is unencrypted;
   - **Restricted** once that hop has TLS (Step 4 already lists TLS as a prerequisite for client data).

   Keep cloud providers at **Internal**. Ember then refuses to send Confidential or Restricted material to them.

**Done when:** in a Project chat, picking `sandz-llm` in the model selector gets an answer, the reply's **Details** show `sandz-llm` as the model, and a question that needs knowledge search completes (proves tool calling works through the relay).

### Live client Projects use Sandz-hosted AI only (Builder mode)

Which AI a Project may use follows its lifecycle:

| Project | AI allowed |
|---|---|
| Builder workspace (presales proposals) | Any approved model, within the builder's budget |
| Client Project before it goes Live | Any approved model, within the builder's budget |
| Internal or foundation Project (Supabase stacks, hosting, Public Pages, presentations), Live or not | Any approved model |
| **Client Project once Live** | **Sandz-hosted models only**, for chat, conversation summaries, Wiki drafts, presentations and ontology suggestions |

- **What counts as a client Project:** one created when an agency approves an accepted proposal. That step records the client fee (`client_project_fees`). Changing a Project's portfolio category doesn't change this.
- **Switching is automatic.** On a Live client Project, the chat model picker offers only Sandz-hosted models, a "Live: Sandz-hosted AI only" badge shows in the chat header, and any other selection is replaced by a Sandz-hosted model. The builder's own LLM isn't used there.
- **If no Sandz-hosted model is enabled,** chat on that Project replies "This project is live, so it can only use Sandz-hosted AI…" instead of calling any model. Presentations and Wiki drafts show the same message.
- **Not affected:** document enrichment and embeddings (foundational, any model), and web search.
- **Enterprise mode** is on hold and has no lifecycle restriction.

To set it up, tick **Sandz-hosted** on the `sandz-llm` provider (Admin → AI Config → provider). Give its models the needed capabilities: **tools** for chat, **structured output** for summaries, drafts and presentations. To keep Sandz-hosted calls from counting against builders' allowances, set the models' prices to 0. The allowance meter prices every call from the registry.

### Thinking mode

One Ember turn can make up to 8 model calls, and Qwen3.8 thinks before each by default. That multiplies response time and can hit Vercel function timeouts. Until Ember can switch thinking off per call (planned with the Quick/Deep modes), measure turn times in Step 5. If they are too slow, start vLLM with thinking disabled by default and enable it per request later.

### Embeddings

Ember needs an **embedding model** as well as the chat model. Embeddings index every approved document chunk and every search question. Today they come from OpenAI (`text-embedding-3-small`, 1536 dimensions), so even with Qwen answering, document text and questions still leave Zadara for indexing.

To keep embeddings on Zadara:

1. Serve an embedding model with a second vLLM process on the same GPU. Give it a small share of GPU memory, and lower the chat model's `--gpu-memory-utilization` to make room. Choose a model that can output **1536 dimensions** (for example a Qwen3-Embedding model with its output size set to 1536), so Ember's existing `vector(1536)` columns don't change.
2. Relay it like the chat model, for example `https://<api-domain>/llm-embed/v1`.
3. In Ember, add it as a model of type **embedding** with dimensions 1536, and make it the **default embedding model**.
4. **Re-embed everything.** Vectors from different embedding models cannot be searched together, so every approved chunk and Wiki version must be re-embedded with the new model. Do this on lab first and compare search quality before prod.

Rule: **one embedding model per Ember deployment.**

### What Ember records for every call (Step 3.4)

Already recorded today:

| Guide asks for | Where Ember records it |
|---|---|
| User | `ai_operation_logs.requested_by`; conversation owner |
| Project | Conversation's Project binding |
| Model name | `ai_operation_logs.provider` / `model`; each assistant message's provider and model |
| Prompt and answer | `chat_messages` (the full conversation, including tool calls and results) |
| Token counts | `ai_operation_logs.input_tokens` / `output_tokens` |
| Time taken | `ai_operation_logs.latency_ms` |

Not yet recorded:

- **Model version.** Put the version in `--served-model-name` (for example `qwen3.8-27b-fp8-2608` for the August 2026 FP8 build), so every log row and message shows exactly which build answered. Change the name whenever the weights change.
- **Permission tag** (`internal / client-approved / do-not-train`). This is new Ember work. Proposal: default it from the Project's information sensitivity (Restricted → do-not-train), plus an explicit per-Project "may be used for training" setting that only the Project owner can turn on.

### Where prompts travel

The guide says prompts and documents "never leave our infrastructure". With Ember on Vercel, that is not yet true:

1. **Every prompt passes through Vercel** (region `sin1`) on its way to the model. That already applies to all Ember data, including Project content.
2. **Other AI calls besides chat** use the platform's default models, which are cloud providers today. Ember splits them in two:
   - **Content calls** (presentation generation and Wiki AI drafts) now check sensitivity, so Confidential or Restricted material is **blocked** from cloud models instead of sent.
   - **Foundational calls** (document enrichment on upload and all embeddings) may use **any model** by Sandz policy. Document text from a Restricted Project still goes to the default enrichment and embedding models. To keep it on Zadara, either make the local models those defaults, or set `EMBER_GATE_FOUNDATIONAL_AI=true` on the deployment so these calls are checked too.

   Nothing is **routed** to the local model automatically yet; a blocked call fails with the policy message.
3. **Web search** (Tavily) stays available in every Project. The model may put only public names and topics in a query, and each query is shown under the reply.

For internal lab material, (1) is acceptable. For client data such as NG911 incident records, decide before loading data:

- **accept Vercel as a processor**, if the client's data rules allow it; or
- **run Ember's app on Zadara** next to Supabase. It is a standard Next.js app and fits the "every app ships as a portable container" rule.

If the agency says incident data may not leave its environment, Ember on Vercel must not process it. Ember then holds only Project management material for that client.

## Step 4 additions

- Add the Caddy relay route to the Supabase VM's Caddyfile (above). The model VM's security group still allows 8000 only from the Supabase VM's private IP.
- The external check from a non-approved machine should also confirm that `https://<api-domain>/llm/v1/models` **without** the API key is refused (401 from vLLM).

## Step 5 additions: benchmark with Ember's evaluation engine

The curl checks are a good smoke test. Record the baseline with **Ember's evaluation engine**, which reruns the same cases against any model and stores scored, comparable results:

1. Create an evaluation dataset (Ember → **Evals**) of real lab tasks with known good answers. This is the guide's "small fixed evaluation set". Include:
   - knowledge questions with expected source documents;
   - **multi-step tool use** (smaller models have failed Ember's tool loop before);
   - Tagalog and Hiligaynon (Bacolod), plus Khmer if the team uses it.
2. Run it against the current cloud default, then against `sandz-llm`, with the same retrieval settings.
3. Mark the cloud run as the **baseline**. Every later stage (new vLLM version, new model, fine-tune) runs the same dataset and is compared against it.

Also time **a full Ember turn that uses tools**, not just single completions. Turn time is what users feel.

## Operations additions

- **Outages.** Ember has no automatic failover between providers. If the model VM is down, chat with `sandz-llm` fails with a provider error, and Confidential/Restricted material cannot fall back to a cloud model. That is intended. Tell users, and keep the health-check alert.
- **Changing models.** Add the new model as a second model on `sandz-llm`, run the Step 5 dataset against it in Ember, compare with the baseline, then make it the default. Keep the old model registered until the new one has proven itself.
- **Key gateway (LiteLLM) later.** Point the `sandz-llm` provider's base URL at the gateway. Nothing else in Ember changes.

## Acceptance checklist additions

- ☐ `sandz-llm` registered in Ember with tools and structured output enabled; sensitivity ceiling set (Confidential until TLS, then Restricted)
- ☐ Caddy relay route live; `/llm/v1/models` refuses requests without the key
- ☐ A Project chat on `sandz-llm` completes a knowledge-search question (tool calling through the relay)
- ☐ Served model name includes the version
- ☐ Step 5 dataset run in Ember against cloud and `sandz-llm`; cloud run marked baseline
- ☐ A Wiki AI draft or presentation for a Restricted Project is **blocked** on a cloud model and succeeds on `sandz-llm`
- ☐ Decision recorded per deployment: `EMBER_GATE_FOUNDATIONAL_AI` on or off (off = document enrichment and embeddings may use any model)
- ☐ `sandz-llm` marked **Sandz-hosted**; on a test client Project marked Live, chat shows the badge, offers only Sandz-hosted models and answers with `sandz-llm`; a Live internal Project still offers every model
- ☐ (when embeddings move) local embedding model is the default and everything has been re-embedded

## Open questions to add

- ☐ Is Vercel acceptable as a processor for each client's data, or must Ember's app also run on Zadara?
- ☐ TLS on the Supabase VM → model VM hop: who sets it up, and when (gates the Restricted ceiling)?
- ☐ Which embedding model, and when to move the deployment's default embedding model to it?
- ☐ The do-not-train tag: default from Project sensitivity, plus a per-Project opt-in?

## Before the first client Project goes Live

The code and the `20261006100001_ai_provider_self_hosted.sql` migration are already in place. What remains is configuration:

1. The self-hosted model is live and registered in Ember (this step).
2. `sandz-llm` is marked **Sandz-hosted**, with tools and structured output enabled. Until then, a Live client Project gets the "Sandz-hosted AI isn't available" message instead of AI.
3. Sensitivity ceilings are set on every provider. Unset providers count as Internal.
4. Knowledge sources and Projects that hold Confidential/Restricted material are classified.
5. A decision on which models are the deployment's defaults for structured output (enrichment, Wiki drafts, presentations) and embeddings. Anything above a default model's ceiling is blocked rather than sent.
