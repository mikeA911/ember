// What an AI call was for, recorded on every ai_operation_logs row
// (20261010100001_ai_operation_logs_task.sql) so cost can be reported per
// task, and later so each task can be given its own model. Separate from
// ai_operation_logs.operation, which records the kind of call (chat,
// structured output, embedding): evals and agent runs share one provider
// instance across several kinds of call, so they're one task each and the
// operation tells their calls apart.
export const AI_TASKS = {
  chat: 'Ember chat',
  conversation_summary: 'Conversation summary',
  knowledge_search: 'Project knowledge search (in chat)',
  knowledge_gap_grouping: 'Knowledge gap grouping',
  chunk_enrichment: 'Chunk enrichment',
  chunk_embedding: 'Chunk embedding',
  wiki_draft: 'Wiki draft',
  wiki_embedding: 'Wiki embedding',
  blog_export: 'Blog export (Substack)',
  journal: 'Work journal',
  presentation: 'Presentation',
  presentation_review: 'Presentation review comments',
  ontology_suggestions: 'Ontology suggestions',
  mcp_search: 'Connected AI app search (MCP)',
  eval_run: 'Evaluation run',
  agent_run: 'Agent run',
} as const

export type AITask = keyof typeof AI_TASKS
