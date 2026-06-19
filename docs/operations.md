# Operations And Deployment

## MVP Deployment Shape

ModelHarbor MVP deploys as one service:

- Fastify API server.
- Built Vue admin dashboard.
- SQLite database.
- Gateway endpoints and admin endpoints on the same origin.

It should not require Kubernetes.

## Environment Variables

Recommended variables:

```text
MODELHARBOR_HOST=0.0.0.0
MODELHARBOR_PORT=5420
MODELHARBOR_DATABASE_URL=file:/data/modelharbor.sqlite
MODELHARBOR_SECRET_KEY=change-me
MODELHARBOR_ADMIN_USERNAME=admin
MODELHARBOR_ADMIN_PASSWORD=change-me-on-first-run
MODELHARBOR_LOG_LEVEL=info
```

Production should require changing the default secret and admin password.

## Data Directory

Recommended container mount:

```text
/data
```

Contains:

- SQLite database.
- Optional local logs.
- Optional backup files.

Do not store temporary provider responses or prompt logs by default.

## First Run

First-run behavior should:

1. Create database tables through migrations.
2. Create the initial local admin if no admin exists.
3. Require a configured admin password or setup token.
4. Refuse insecure defaults in production mode.

## Backup And Restore

SQLite backup guidance:

- Stop the service or use SQLite online backup support.
- Copy the database file from `/data`.
- Store `MODELHARBOR_SECRET_KEY` securely with the backup if upstream keys are encrypted.

Restore guidance:

- Restore the database file.
- Restore the same secret key.
- Start the service.
- Run migrations if needed.

If the secret key is lost, encrypted upstream keys cannot be recovered.

## Migrations

Use Drizzle migrations.

Rules:

- Migrations must be committed.
- Migrations should be forward-only for MVP.
- Additive migrations are preferred.
- Destructive migrations require explicit release notes.

## Health Checks

Recommended endpoints:

```text
GET /healthz
GET /readyz
```

`/healthz`:

- Process is alive.

`/readyz`:

- Database is reachable.
- Required migrations are applied.

Do not include secret values or sensitive configuration in health responses.

## Routing Resilience

The gateway uses the following resilience mechanisms:

- **Circuit breaker**: tracked per `(upstreamKeyId, realModelName)`. When open, the candidate is skipped until the cooldown elapses and half-open probing succeeds.
- **Endpoint health probes**: a background task sends lightweight `HEAD` requests to each upstream endpoint base URL. Probe delay and degraded state are persisted in `upstream_endpoint_health` and used to sort candidates before selection.
- **First-token timeout**: for streaming requests with multiple candidates, the gateway races the first SSE event against `firstTokenTimeoutMs`. On timeout it cancels the slow upstream body reader and fails over to the next candidate, preserving the captured first event in the returned stream.

All three are configurable via `GET /api/admin/settings` and `PUT /api/admin/settings`.

## Logging

Recommended logs:

- Server startup.
- Admin login success and failure.
- Admin resource changes.
- Gateway request summary.
- Provider failures after secret redaction.
- Quota freeze and unfreeze events.
- Cooldown events.

Default logs must not contain:

- Raw consumer keys.
- Raw upstream API keys.
- Full prompts.
- Full completions.

## Upgrades

Upgrade flow:

1. Back up database and secret key.
2. Pull new image.
3. Start service.
4. Run migrations automatically or through an explicit migration command.
5. Verify `/readyz`.
6. Verify dashboard login.
7. Verify one fake or low-risk gateway request.

## Future Production Options

Potential future features:

- Postgres database.
- Redis for counters, cooldown, sticky state, and rate limiting.
- Split admin and gateway services.
- Multiple gateway replicas.
- OIDC admin login.
- External secret manager.

These are not MVP requirements.
