# ModelHarbor MVP

## Goal

The MVP proves that an administrator can configure ModelHarbor entirely through the dashboard and that clients can call Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses API through a routed upstream key.

The MVP is complete when:

- Admin can log in locally.
- Admin can create upstream keys, public models, model groups, apps, and consumer keys.
- Consumer keys can be granted access to selected models or groups.
- `/v1/messages` works in non-stream and stream modes.
- `/v1/chat/completions` works in non-stream and stream modes.
- `/v1/responses` works in non-stream and stream modes.
- Sticky routing reuses `upstreamKeyId + realModelName` while the candidate remains available.
- Upstream-key quotas can freeze and restore route availability.
- Usage records appear in the dashboard by app, consumer key, requested target, upstream key, and real model.

## Milestone 0: Repository Foundation

Deliverables:

- Monorepo structure.
- pnpm workspace.
- TypeScript configuration.
- Fastify API app.
- Vue 3, Vite, Naive UI web app.
- Shared package for schemas and protocol types.
- Lint, typecheck, test, and build scripts.
- AGPL license file.

Acceptance:

- `pnpm install` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test` succeeds with placeholder tests.
- `pnpm build` builds API and web packages.

## Milestone 1: Database And Local Admin

Deliverables:

- Drizzle setup.
- SQLite database.
- Initial migrations.
- Local admin user table.
- Password hashing.
- Session or signed cookie authentication.
- Admin login API.
- Minimal login page.

Acceptance:

- A fresh database can be initialized.
- Admin can log in and out.
- Invalid credentials are rejected.
- Admin-only APIs reject unauthenticated requests.

## Milestone 2: Control Plane Objects

Deliverables:

- Upstream key CRUD.
- Public model CRUD.
- Public model candidate management.
- Model group CRUD.
- Model group membership management.
- App CRUD.
- Consumer key create, revoke, and rotate.
- Consumer key access grants for public models and groups.

Acceptance:

- Admin can create a complete route without editing files.
- Public model and model group names are globally unique.
- Raw upstream API keys are not returned after creation.
- Raw consumer keys are shown only once at creation or rotation.

## Milestone 3: Provider Adapter Foundation

Deliverables:

- Provider adapter interface.
- Anthropic-compatible adapter.
- OpenAI-compatible adapter.
- Codex adapter.
- Fake upstream server test utilities.
- Internal chat request representation.
- Request and response conversion for non-stream calls.

Acceptance:

- Anthropic Messages requests can be converted to internal request shape.
- OpenAI Chat Completions requests can be converted to internal request shape.
- OpenAI Responses API requests can be converted to internal request shape.
- Internal request shape can be sent through Anthropic-compatible, OpenAI-compatible, and Codex fake upstreams.
- Provider errors are normalized.

## Milestone 4: Gateway Routing

Deliverables:

- `POST /v1/messages`.
- `POST /v1/chat/completions`.
- `POST /v1/responses`.
- `GET /v1/models`.
- Consumer-key authentication.
- Target resolution for public models and groups.
- Access checks.
- Candidate expansion and filtering.
- Initial routing policy.

Acceptance:

- Valid consumer key can call authorized targets.
- Unauthorized target returns 403.
- Unknown target returns a model-not-found style error.
- Frozen or disabled upstream keys are skipped.
- No available upstream returns 503.

## Milestone 5: Streaming

Deliverables:

- Anthropic-compatible streaming.
- OpenAI-compatible SSE streaming.
- Codex streaming.
- Stream event conversion.
- Stream failure metadata.
- Client disconnect handling where possible.

Acceptance:

- `/v1/messages` streams multiple events from a fake upstream.
- `/v1/chat/completions` streams multiple SSE chunks from a fake upstream.
- Streaming responses preserve event order.
- Stream completion writes usage when usage is available.
- Mid-stream failure records error metadata.

## Milestone 6: Quotas And Sticky Routing

Deliverables:

- Upstream-key quota counters.
- Request, input token, output token, and total token limits.
- Freeze and unfreeze behavior.
- Period reset behavior.
- Conversation fingerprint.
- Sticky binding lookup, reuse, invalidation, and update.

Acceptance:

- A first routed request creates a sticky binding.
- A repeated request with the same stable message prefix reuses the same upstream key and real model.
- Frozen, cooled-down, disabled, or over-quota upstream keys invalidate stickiness.
- Upstream key quota exhaustion freezes the key.
- Period reset or manual unfreeze restores route availability.

## Milestone 7: Usage And Observability

Deliverables:

- Usage records.
- Dashboard summaries by app, consumer key, target, upstream key, and real model.
- Sticky hit rate.
- Failure rate.
- Latency.
- Token usage.
- Recent request table.

Acceptance:

- Every gateway request writes one usage record.
- Dashboard shows app-level usage aggregation.
- Dashboard shows upstream-key quota and usage.
- Failed requests are visible without exposing secrets.
- Prompt and completion bodies are not stored by default.

## MVP Non-Goals

- Pricing.
- Billing.
- Recharge.
- Payment.
- Customer resale.
- App-level quotas.
- Consumer-key-level quotas.
- OIDC.
- Kubernetes deployment.
- Live provider tests by default.
- Image, audio, and advanced multimodal requests.
- Full compatibility with every provider-specific option.
