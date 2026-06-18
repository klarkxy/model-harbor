# Provider Adapter Guide

## Purpose

Provider adapters isolate upstream-provider differences from the router core.

The router decides:

- Which target the client requested.
- Which consumer key and app are calling.
- Which upstream key and real model should be used.
- Whether sticky routing, quota, cooldown, and permissions allow the route.

The provider adapter decides:

- How to authenticate to the upstream provider.
- Which URL and path to call.
- How to convert the internal request into provider format.
- How to convert provider responses and stream events back to the client protocol.
- How to normalize provider errors.
- How to extract token usage.

## MVP Adapters

MVP adapters:

- `anthropic_compatible`
- `openai_compatible`
- `codex` (OpenAI Responses API / GPT-5.5+)

Official provider presets are kept in `apps/api/src/modules/providers/presets.ts`. Each preset can declare one or more endpoints, so a single upstream key can serve both Anthropic- and OpenAI-protocol clients. Presets cover mainstream international and China-region providers such as OpenAI, Anthropic, DeepSeek, Moonshot, MiniMax, OpenRouter, OpenCode Go, OpenCode Zen, Groq, Together, Cerebras, Fireworks, xAI, Qwen, Zhipu, Baichuan, ByteDance Volcano Ark, Tencent Hunyuan, Baidu Qianfan, StepFun, and SiliconFlow (硅基流动).

Presets no longer ship hardcoded model lists. They only declare endpoints, display metadata, and optional default headers. The legacy `modelMappings` field on `GET /api/admin/provider-presets` is kept empty for API compatibility. Admins discover available models by calling `POST /api/admin/upstream-keys/discover-models`, which probes the upstream `/v1/models` endpoint and returns `{ realName, publicName }` pairs with `publicName` defaulting to `realName`.

The admin UI consumes presets through `GET /api/admin/provider-presets` and uses the preset `id` as an i18n key under `providers.{id}` in `apps/web/src/locales/*.ts`. Each preset may also declare an `icon` (emoji or future SVG identifier) that the UI renders next to the localized display name.

When an admin selects a preset while creating an upstream key, the form auto-fills the endpoint details and the model mapping list. The model mappings are editable in the UI: each row is `{ realName (required) -> publicName (optional) }`, with add/remove/toggle controls. The preset's computed `modelMappings` become the default template, but the admin can override, disable, or extend them before submitting. The finalized list is sent as `modelMappings` on `POST /api/admin/upstream-keys` and drives automatic model onboarding.

The create drawer also offers a **Fetch models** button. After entering the base URL and API key, the admin can call `POST /api/admin/upstream-keys/discover-models`, which probes the upstream `/v1/models` endpoint, normalizes the response, and returns discovered `{ realName, publicName }` pairs. The UI appends any new real names to the editable mapping list without removing existing rows. Discovery is optional and failures are surfaced so the admin can still proceed with a manually entered mapping list.

Future adapters can be added without changing the router core:

- `vertex`
- `gemini`
- `custom`

## Adapter Contract

Recommended TypeScript shape:

```ts
export interface ProviderAdapter {
  type: ProviderType;
  capabilities: ProviderCapabilities;

  buildRequest(context: ProviderRequestContext): Promise<ProviderHttpRequest>;
  normalizeResponse(context: ProviderResponseContext): Promise<ClientResponse>;
  normalizeStreamEvent(context: ProviderStreamEventContext): ProviderStreamEventResult;
  normalizeError(error: unknown): NormalizedProviderError;
  extractUsage(context: ProviderUsageContext): ProviderUsage | null;
}
```

The final implementation can adjust names, but the separation should remain.

## Capabilities

Each adapter must declare capabilities so the router can filter incompatible candidates before sending traffic.

Initial capabilities:

```text
ProviderCapabilities
- protocols
- supportsStreaming
- supportsSystemPrompt
- supportsTools
- supportsToolChoice
- supportsVision
- supportsJsonMode
- supportsThinking
- usageAvailability
```

MVP only requires:

- Text messages.
- System prompt where supported.
- Non-stream and stream response.
- Usage extraction when provider returns usage.

Unsupported request features should fail clearly or be ignored only when safe and documented.

## Request Context

The router passes resolved state to adapters.

Recommended fields:

```text
ProviderRequestContext
- sourceProtocol
- targetProtocol
- upstreamKey
- realModelName
- requestIr
- clientRequestId
- timeoutMs
```

The adapter should not perform routing, permission checks, quota checks, or sticky-binding decisions.

## URL Construction

Adapters own URL construction.

Defaults:

- Anthropic-compatible: `POST {baseUrl}/v1/messages`
- OpenAI-compatible: `POST {baseUrl}/v1/chat/completions`

Administrators should enter a base URL without the version segment. The adapter appends the known endpoint path. When a provider uses a non-standard path (e.g. Zhipu GLM uses `/v4/chat/completions`, ByteDance Ark uses `/v3/chat/completions`, Baidu Qianfan uses `/v2/chat/completions`), a preset endpoint can specify `apiPath` to override the default path entirely.

## Authentication

Adapters own upstream authentication.

Examples:

- Anthropic-compatible: `x-api-key`.
- OpenAI-compatible: `Authorization: Bearer`.

Upstream API keys must never be logged or returned in API responses.

## Streaming

Adapters must convert provider stream events into the client-facing protocol requested by the caller.

**Same-protocol streaming is supported:**

- Anthropic-compatible upstream → Anthropic client stream.
- OpenAI-compatible upstream → OpenAI client stream.
- Codex upstream → Codex client stream.

**Cross-protocol streaming is not yet supported.** If a cross-protocol route is selected (e.g. an OpenAI client routes to an Anthropic-compatible upstream), the gateway returns a clear `unsupported-route` error for stream requests. Non-stream requests handle cross-protocol conversion through the adapter's `normalizeResponse`.

## Usage Extraction

Adapters should extract:

- Input tokens.
- Output tokens.
- Total tokens.

If usage is unavailable:

- Store null usage fields.
- Still record request count, latency, status, selected upstream key, and real model.
- Do not guess token counts in MVP unless a tokenizer strategy is explicitly added later.

## Error Normalization

Adapters convert provider-specific failures into normalized errors.

Initial normalized categories:

```text
provider_authentication
provider_permission
provider_rate_limit
provider_quota
provider_timeout
provider_overloaded
provider_model_not_found
provider_bad_request
provider_stream_error
provider_unknown
```

Router behavior can then decide whether to retry, cool down, freeze, or return the error.

## Adding A New Provider

Checklist:

1. Add a provider preset in `apps/api/src/modules/providers/presets.ts` with the correct `baseUrl`, `providerType`, optional `apiPath`, and model mappings. If the provider has distinct China and international endpoints, add separate presets.
2. If the provider needs a new transport or request/response shape, add a provider type and implement the adapter contract.
3. Declare capabilities.
4. Add admin dashboard preset labels and help text.
5. Add fake upstream tests.
6. Add non-stream gateway integration tests.
7. Add stream tests if streaming is supported.
8. Add usage extraction tests.
9. Add error normalization tests.
10. Document any unsupported capabilities.

Do not add provider-specific logic to the router core.
