// Ember SLI (docs/architecture-decisions/ADR-0002-ember-sandz-as-a-domain-module.md)
// is off unless the deployment sets EMBER_SLI_ENABLED=true. Server-only, so
// changing it needs a redeploy but no rebuild of client code. Off means no
// SLI shell, no /sli routes and no SLI links.
export function sliEnabled(): boolean {
  return process.env.EMBER_SLI_ENABLED === 'true'
}
