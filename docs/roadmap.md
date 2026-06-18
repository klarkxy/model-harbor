# Roadmap

## MVP

MVP focus:

- Local admin login.
- Dashboard-first configuration.
- Upstream keys.
- Public models.
- Model groups.
- Apps and consumer keys.
- Anthropic Messages endpoint.
- OpenAI Chat Completions endpoint.
- Streaming for both protocols.
- Upstream-key quotas and rate limits.
- Sticky routing by `upstreamKeyId + realModelName`.
- Usage records and dashboard summaries.

## Post-MVP: Provider Expansion

Add provider adapters as real needs appear.

Candidates:

- DeepSeek-specific preset.
- Qwen-compatible preset.
- OpenRouter.
- Gemini.
- Vertex.
- Custom HTTP-compatible adapter.

Each provider must include fake upstream tests and clear capability declarations.

## Post-MVP: Data And Scale

Potential additions:

- Postgres support.
- Redis-backed quota counters.
- Redis-backed cooldown state.
- Redis-backed sticky bindings.
- Multiple gateway instances.
- Split admin and gateway services.

These should not complicate the MVP single-node path.

## Post-MVP: Protocols And Capabilities

Potential additions:

- OpenAI Responses API (Codex / GPT-5.5+).
- Tool calling compatibility improvements.
- Vision inputs.
- JSON mode.
- Thinking or reasoning options.
- Provider-specific cache controls.
- More complete usage extraction.

Add capabilities through adapter declarations, not router-core conditionals.

## Post-MVP: Security And Admin

Potential additions:

- OIDC admin login.
- Multiple admin users and roles.
- Content logging with redaction.
- Retention policies.
- External secret manager support.
- Backup and restore UI.

MVP keeps one local admin role.

## Continuing Non-Goals

Unless the product direction changes, avoid:

- Pricing.
- Billing.
- Recharge.
- Payment.
- API resale workflows.
- Affiliate or distribution platform features.
- App-level quotas.
- Consumer-key-level quotas.
- YAML-first administration.

These exclusions are part of ModelHarbor's lightweight product identity.
