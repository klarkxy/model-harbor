# ModelHarbor Plan

## Summary

ModelHarbor is a lightweight LLM API routing service with an admin dashboard. It aggregates upstream provider keys, exposes administrator-controlled public models and model groups, and records application-level usage.

The project should stay closer to a resource router than a commercial API platform. It does not include pricing, billing, recharge, payment, distribution, or customer resale workflows.

The product name is `ModelHarbor`; the Chinese name is `模型港`; the repository name should be `model-harbor` when renamed or created publicly.

## Product Model

### UpstreamKey

`UpstreamKey` is the actual routable provider instance.

It includes:

- Provider type, such as Anthropic-compatible or OpenAI-compatible.
- Base URL.
- API key.
- Supported real model names.
- Request and token quotas.
- Enabled, frozen, and cooldown state.
- Health status and recent error information.

All quota and rate limiting lives on `UpstreamKey`. Applications and consumer keys do not set quotas or rate limits.

### PublicModel

`PublicModel` is a model name exposed to clients, such as `ds-v4-flash`.

It maps to one or more candidates:

```text
UpstreamKey + realModelName
```

The administrator can enable, disable, order, or weight candidates through the dashboard.

### ModelGroup

`ModelGroup` is **administrator-defined and starts empty by default**. It is not tied to any provider or vendor. The intended use is **functional grouping** — for example `coder`, `planner`, `write`, `fast`, `cheap`, `auto` — where each group contains public models that serve a similar purpose or role, regardless of which upstream provider they come from.

Clients request a group exactly like a model:

```json
{
  "model": "coder",
  "messages": []
}
```

Model group names and public model names must be globally unique. The system must reject a new model or group if its name conflicts with an existing target.

**First version recommendation:**

- Groups contain `PublicModel` entries, not raw upstream keys. This keeps the admin model clean.
- **No model groups are created automatically.** When a new upstream key is added, its models are exposed as individual public models only. Administrators manually create groups and assign public models to them through the dashboard.
- The routing policy within a group is **linear priority fallback** (`priority`-only). The first available candidate (lowest `priority` number) is tried; if it fails with a recoverable error, the next candidate is tried.

### App

`App` is the application-level tenant boundary.

Apps are used for:

- Ownership of consumer keys.
- Permission grouping.
- Usage aggregation.
- Dashboard statistics.

Apps do not have quotas or rate limits.

### ConsumerKey

`ConsumerKey` belongs to an App and authenticates client requests.

It is used for:

- Gateway authentication.
- Access control for public models and model groups.
- Usage attribution.

Consumer keys do not have quotas or rate limits.

### StickyBinding

Sticky routing is used to improve upstream cache hit rates. It is a weak guarantee and can be broken when availability requires it.

The binding target is:

```text
upstreamKeyId + realModelName
```

The sticky key is derived internally. Clients do not need to pass special headers or metadata.

Recommended fields:

```text
StickyBinding
- id
- appId
- consumerKeyId
- requestedTargetName
- conversationFingerprint
- upstreamKeyId
- realModelName
- hitCount
- lastUsedAt
- expiresAt
```

The `conversationFingerprint` should be computed from:

```text
appId + consumerKeyId + requestedTargetName + stable prefix of messages
```

The stable prefix can include the system message, the first user message, and the first few role/content pairs.

## Routing Behavior

For every gateway request:

1. Authenticate the request and resolve the `ConsumerKey`.
2. Resolve the owning `App`.
3. Read the requested `model` name.
4. Resolve the name as a `PublicModel` or `ModelGroup`.
5. Check access permissions for the consumer key.
6. Build the candidate list of `UpstreamKey + realModelName`.
7. Compute the conversation fingerprint.
8. Reuse an existing sticky binding if the bound upstream key and real model are still valid candidates and the key is enabled, not frozen, not cooled down, and not over quota.
9. Otherwise choose a new candidate by **linear priority fallback** (lowest `priority` first) and write or update the sticky binding.
10. Convert the request through the selected provider adapter.
11. Stream or return the upstream response.
12. Record usage metadata, token counts, latency, status, and selected upstream key.
13. Freeze or cool down the upstream key when quota or failure rules require it.

Availability wins over stickiness. If the previously selected upstream key is unavailable, the router may rebind.

## Quotas And Limits

Only upstream keys have quotas and rate limits.

Supported quota dimensions:

- Request count.
- Input tokens.
- Output tokens.
- Total tokens.
- Periodic limits, such as day, month, or total.

**RPM and TPM tracking are not implemented in the current milestone.** Upstream-reported rate limits trigger cooldowns, not local RPM/TPM counters.

When an upstream key reaches its quota:

- Mark it frozen.
- Skip it during routing.
- Restore it automatically on period reset or manually through the dashboard.

If a provider exposes a reliable quota or balance API, a future provider adapter may implement automatic quota syncing. Otherwise, the administrator sets quota manually and ModelHarbor tracks local usage.

No price, cost, billing, or model price table should be implemented.

## Protocol And Provider Scope

ModelHarbor is Anthropic-first while also supporting OpenAI-compatible clients.

MVP external APIs:

- `POST /v1/messages`, compatible with Anthropic Messages.
- `POST /v1/chat/completions`, compatible with OpenAI Chat Completions.
- `POST /v1/responses`, compatible with OpenAI Responses API (Codex / GPT-5.5+).
- Streaming support for all three protocols.
- `GET /v1/models` for accessible public models and model groups.

MVP provider adapters:

- Anthropic-compatible.
- OpenAI-compatible.
- Codex.

Future provider adapters can be added per provider:

```text
providers/
  anthropic-compatible
  openai-compatible
  deepseek
  qwen
  openrouter
  vertex
  custom
```

Each provider adapter owns:

- Authentication.
- URL construction.
- Request conversion.
- Response conversion.
- Streaming event conversion.
- Error normalization.
- Usage extraction.
- Capability declarations.

The router core must not assume that every provider supports the same protocol.

## Admin Dashboard

The dashboard should be organized by administrator workflow, not database tables.

Recommended sections:

1. Upstream Keys
   - Add and edit provider keys.
   - Configure provider type, base URL, API key, supported models, quota, and limits.
   - View health, frozen state, cooldown state, and remaining quota.

2. Public Models
   - Create public model names.
   - Attach upstream key and real model candidates.
   - Configure enablement, priority, and routing behavior.

3. Model Groups
   - Create administrator-defined groups.
   - Add public models to groups.
   - Configure group routing behavior.
   - Enforce global name uniqueness against public models.

4. Apps
   - Create applications.
   - View application usage.
   - Manage application consumer keys.

5. Consumer Keys
   - Create and revoke keys.
   - Assign accessible public models and groups.
   - Attribute usage to the owning app.

6. Observability
   - Request counts.
   - Input, output, and total token usage.
   - Failure rates.
   - Latency.
   - Sticky hit rates.
   - Routing distribution by upstream key, real model, public model, group, app, and consumer key.

Default logging must store metadata and statistics only. Full prompt and response body logging should be optional and controlled by the administrator.

## Technical Stack

Backend:

- Node.js.
- Fastify.
- TypeScript.
- Drizzle ORM.
- SQLite first, Postgres later.

Frontend:

- Vue 3.
- Vite.
- TypeScript.
- Naive UI.
- Pinia.
- Vue Router.

Frontend styling rule:

- Prefer Naive UI components, props, layout primitives, and theme overrides.
- Avoid hand-written CSS except for minimal shell layout and necessary responsive constraints.
- Do not hand-roll common controls that Naive UI already provides.

Deployment:

- First version is a single service.
- One Docker image serves both gateway APIs and the admin dashboard.
- Code should still separate control-plane and data-plane logic so the gateway can be split out later if needed.

Suggested monorepo structure:

```text
apps/
  api/
  web/
packages/
  shared/
```

## Explicit Non-Goals

- No YAML-first configuration as the primary admin experience.
- No pricing.
- No billing.
- No recharge.
- No payment integration.
- No customer resale workflows.
- No affiliate or distribution platform features.
- No app-level quota.
- No consumer-key-level quota.
- No fixed built-in group list.
- No requirement that users know or select upstream providers.

## License

Use `AGPL-3.0-or-later`.

The project is a network service, so AGPL protects the community from closed-source modified hosted versions while still allowing self-hosting and modification.
