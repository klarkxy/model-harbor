# ModelHarbor Decisions

This document records decisions that have already been made.

## Product

- Product name: `ModelHarbor`.
- Chinese name: `模型港`.
- Preferred public repository name: `model-harbor`.
- The project is a lightweight LLM routing dashboard, not a commercial API resale platform.
- New API is too heavy for this project because it includes many commercial platform features.
- uni-api is useful as a routing and key-pool reference, but its YAML-first product shape is not acceptable for the target admin experience.

## License

- License: `AGPL-3.0-or-later`.

## Frontend

- Use Vue 3, Vite, TypeScript, and Naive UI.
- Prefer Naive UI native components and avoid hand-written CSS where possible.

## Backend

- Use Node.js, Fastify, and TypeScript.
- Use Drizzle ORM.
- Use SQLite first, with a path to Postgres later.
- First version should be a single deployable service.

## Multi-Tenancy

- Multi-tenancy is application-level.
- Use `App` or `Project` as the boundary, not customer-style SaaS tenants.
- Apps are for ownership, permissions, and statistics.
- Apps do not set quotas or rate limits.

## Consumer Keys

- Consumer keys belong to apps.
- Consumer keys authenticate client requests and define accessible models or groups.
- Consumer keys do not set quotas or rate limits.

## Quotas

- Do not implement price, cost, billing, recharge, or payment.
- Only consider quota and availability.
- Quotas and rate limits exist only on upstream keys.
- Each upstream key is treated as an actual provider instance because quota is tracked separately per key.

## Models And Groups

- Administrators can create and manage model groups.
- Group examples like `free`, `flash`, `pro`, `max`, and `auto` are not fixed.
- Clients request groups with `model=groupName`.
- Public model names and group names must be globally unique.

## Sticky Routing

- Sticky routing exists to improve upstream provider cache hit rate.
- Sticky routing is a weak guarantee and may be broken by availability, quota, cooldown, or group membership changes.
- Sticky routing should be transparent to users.
- The sticky target is `upstreamKeyId + realModelName`.
- The router should infer the conversation fingerprint from stable message prefixes instead of requiring users to pass explicit headers.

## Protocols

- The project supports Anthropic, OpenAI, and OpenAI Responses (Codex) protocols.
- MVP external APIs:
  - `POST /v1/messages`.
  - `POST /v1/chat/completions`.
  - `POST /v1/responses`.
  - Streaming for all three protocols.
  - `GET /v1/models`.
- Provider behavior should be implemented through provider adapters.
- MVP provider adapters:
  - Anthropic-compatible.
  - OpenAI-compatible.
  - Codex.

## Admin Authentication

- First version uses local administrator username and password.
- OIDC can be considered later.
