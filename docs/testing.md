# ModelHarbor Testing Plan

## Goals

Testing should prove that ModelHarbor routes correctly, preserves client protocol behavior, enforces upstream-key quotas, and keeps the admin dashboard safe to operate.

The test suite should avoid live provider dependencies by default. Live-provider tests can exist later as explicit, opt-in smoke tests.

## Test Stack

Recommended tools:

- Vitest for TypeScript unit and integration tests.
- Fastify injection for HTTP route tests.
- Fake upstream servers for provider and streaming tests.
- Playwright for admin dashboard end-to-end tests.
- Drizzle migrations tested against SQLite in CI.

Tests should run locally without real API keys.

## Test Layers

### Unit Tests

Cover pure logic with no database or network.

Required areas:

- Model and group name uniqueness validation.
- Target resolution from requested `model`.
- Candidate expansion for public models and groups.
- Candidate filtering for disabled, frozen, cooled-down, over-quota, and incompatible upstream keys.
- Routing policy selection.
- Conversation fingerprint generation.
- Sticky binding reuse and invalidation.
- Quota counter updates.
- Quota reset calculation.
- Provider capability matching.
- Error normalization.
- Anthropic request to internal request conversion.
- OpenAI request to internal request conversion.

### Database Tests

Cover schema constraints and repository behavior.

Required areas:

- Consumer keys are stored as hashes.
- Public model names and group names cannot conflict.
- Upstream keys can be frozen and unfrozen.
- Soft-deleted or disabled records are excluded from routing.
- Sticky bindings persist across process restart.
- Usage records preserve app, consumer key, requested target, upstream key, and token fields.
- Quota counters are scoped only to upstream keys.
- Apps and consumer keys have no quota or rate-limit fields.

### HTTP Integration Tests

Use Fastify injection for admin and gateway APIs.

Required gateway scenarios:

- `POST /v1/messages` rejects missing or invalid consumer key.
- `POST /v1/chat/completions` rejects missing or invalid consumer key.
- Unknown model or group returns a compatible error.
- Consumer key cannot access an unauthorized public model.
- Consumer key cannot access an unauthorized group.
- A public model routes to one valid upstream candidate.
- A model group routes through its member public models.
- Frozen upstream keys are skipped.
- Over-quota upstream keys are skipped.
- No available candidates returns 503.
- Successful calls write usage records.
- Failed calls write usage records with error metadata.

Required admin scenarios:

- Admin login succeeds with valid local credentials.
- Admin login fails with invalid credentials.
- Admin can create an upstream key without exposing the raw key after creation.
- Admin can create a public model.
- Admin cannot create a group with an existing public model name.
- Admin can create an app.
- Admin can create, revoke, and rotate a consumer key.
- Admin can assign allowed models and groups to a consumer key.

### Provider Adapter Tests

Use fake upstream servers.

Required Anthropic-compatible scenarios:

- Builds correct request path and headers.
- Converts Anthropic Messages input to upstream request.
- Converts non-stream response back to Anthropic-compatible response.
- Converts stream events back to Anthropic-compatible events.
- Extracts token usage when present.
- Normalizes provider error responses.

Required OpenAI-compatible scenarios:

- Builds correct request path and headers.
- Converts OpenAI Chat Completions input to upstream request.
- Converts non-stream response back to OpenAI-compatible response.
- Converts SSE stream chunks back to OpenAI-compatible chunks.
- Extracts token usage when present.
- Normalizes provider error responses.

### Streaming Tests

Streaming must be tested separately because many regressions only appear after headers are sent.

Required scenarios:

- Anthropic streaming response forwards multiple events in order.
- OpenAI SSE response forwards multiple chunks in order.
- Stream completion records final usage.
- Stream failure records partial failure metadata.
- Client disconnect aborts the upstream request when possible.
- Provider timeout returns or records the correct normalized error.

### Routing And Sticky Tests

Required scenarios:

- First request creates a sticky binding.
- Repeated request with the same stable message prefix reuses the same upstream key and real model.
- A changed requested target invalidates stickiness when the previous real model is not in the new target.
- A frozen upstream key invalidates stickiness and rebinding occurs.
- A cooled-down upstream key invalidates stickiness and rebinding occurs.
- An over-quota upstream key invalidates stickiness and rebinding occurs.
- Sticky hit and miss are recorded in usage metadata.

### Quota Tests

Required scenarios:

- Upstream request quota is incremented after a call.
- Input, output, and total token counters are incremented when usage is available.
- Requests are blocked or skipped when an upstream key reaches quota.
- Period reset restores availability.
- Manual unfreeze restores availability when quota policy allows it.
- App and consumer key usage is aggregated but never blocks requests by quota.

### Frontend Tests

Use component tests for critical forms and Playwright for full admin workflows.

Required component scenarios:

- Upstream key form validates required fields.
- Public model form prevents duplicate target names.
- Model group form prevents duplicate target names.
- Consumer key access selector handles models and groups.
- Status tags render enabled, frozen, cooldown, and disabled states clearly.

Required Playwright scenarios:

- Admin logs in.
- Admin creates an upstream key.
- Admin creates a public model.
- Admin creates a model group.
- Admin creates an app.
- Admin creates a consumer key and assigns access.
- Admin views usage after a fake gateway request.

The frontend should verify layout at desktop and narrow widths. Text must not overlap or overflow controls.

## Smoke Tests

MVP smoke path:

1. Start the API and web app with a temporary SQLite database.
2. Log in as the local admin.
3. Create one fake Anthropic-compatible upstream key.
4. Create one public model.
5. Create one model group.
6. Create one app.
7. Create one consumer key.
8. Call `/v1/messages` with the group name.
9. Call `/v1/chat/completions` with the same group name.
10. Confirm usage appears under the app and upstream key.

Smoke tests should use fake upstream servers, not paid provider calls.

## Acceptance Criteria For MVP

MVP is not considered ready unless:

- `POST /v1/messages` works in non-stream and stream modes.
- `POST /v1/chat/completions` works in non-stream and stream modes.
- Admin can configure a working route without editing files.
- Consumer keys can be authorized for selected models and groups.
- Upstream-key quotas can freeze and restore availability.
- Sticky routing reuses the same upstream key and real model when available.
- Usage is recorded by app, consumer key, public model or group, upstream key, and real model.
- Tests run without real provider API keys.

## Out Of Scope For MVP Tests

Do not require tests for:

- Billing.
- Pricing.
- Payment.
- Recharge.
- App-level quotas.
- Consumer-key-level quotas.
- Live provider correctness.
- OIDC.
- Kubernetes deployment.
- Image, audio, and advanced multimodal requests.

## CI Gates

Recommended initial gates:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

When Playwright is added:

```text
pnpm e2e
```

Live provider tests must be opt-in and skipped by default.
