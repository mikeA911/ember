// Central, fail-fast environment validation. Import this (not process.env directly)
// wherever a required var is needed, so a missing key fails at startup / first
// import rather than deep inside an async call.

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  // No trailing slash. Falls back to localhost so sitemap/robots/canonical
  // URLs still work in local dev without this set.
  siteUrl: () => (optional('NEXT_PUBLIC_SITE_URL') ?? 'http://localhost:3000').replace(/\/$/, ''),
  openaiApiKey: () => optional('OPENAI_API_KEY'),
  groqApiKey: () => optional('GROQ_API_KEY'),
  // Ember's search_web tool (pre-sales/competitive web research). The tool
  // is simply omitted from Ember's tool list when this is unset -- see
  // src/lib/chat/loop.ts's tools-array assembly.
  tavilyApiKey: () => optional('TAVILY_API_KEY'),
  // Generic lookup for openai_compatible provider rows, whose env var name
  // is admin-configured (ai_providers.api_key_env_var) rather than known at
  // build time.
  byName: (envVarName: string) => optional(envVarName),
  // KB Sandbox Builder (docs/dev-request-kb-sandbox-builder-product.md) --
  // a deployment-level mode switch, never user-selectable. One deployment
  // runs in exactly one mode for its whole lifetime; this is not a per-
  // request or per-user toggle.
  productMode: () => (optional('KB_SANDBOX_PRODUCT_MODE') === 'builder' ? 'builder' : 'enterprise') as 'enterprise' | 'builder',
  // Builder AI Usage Metering + BYOLLM: encrypts a builder-supplied provider
  // credential (builder_llm_credentials.encrypted_api_key) at rest -- the
  // first real secret value this app stores. Optional because a deployment
  // that never enables BYOLLM doesn't need it; src/lib/ai/credential-crypto.ts
  // throws a clear error only when encryption/decryption is actually attempted
  // without it set.
  builderCredentialKey: () => optional('BUILDER_CREDENTIAL_ENCRYPTION_KEY'),
  // Workstream Presentation & Review's scheduled-open cron
  // (src/app/api/cron/presentations/route.ts). Vercel Cron auto-injects
  // `Authorization: Bearer <value>` on requests it sends to a cron path
  // whenever an env var literally named CRON_SECRET is set -- naming it
  // exactly this is what makes that automatic, not a convention we chose.
  cronSecret: () => required('CRON_SECRET'),
  // External MCP server (docs/dev-request-ember-external-mcp-server.md) --
  // off unless literally 'true'. When off, /api/mcp answers 503 and the OAuth
  // consent page refuses every request.
  mcpEnabled: () => optional('EMBER_MCP_ENABLED') === 'true',
}
