# Phase 5 TODO: Observability & Cost

目标：完成日常自用需要的排障、用量、成本、套餐、模型参考榜单和客户端配置助手。

## Usage APIs

- [ ] P5-001 Implement usage totals API
  - Depends on: P3-081
  - Deliverables: totals for today/24h/7d
  - Acceptance: tests cover success count, error count, tokens, sticky rate.

- [ ] P5-002 Implement usage breakdown APIs
  - Depends on: P5-001
  - Deliverables: by app, consumer key, upstream, target
  - Acceptance: seeded usage rows aggregate correctly.

- [ ] P5-003 Implement recent usage API
  - Depends on: P3-081
  - Deliverables: recent request list with trace id
  - Acceptance: pagination/limit works and no secret fields returned.

- [ ] P5-004 Implement daily consumption stats API
  - Depends on: P1-036, P3-081
  - Deliverables: per day/provider/model stats
  - Acceptance: successful requests upsert daily rows.

## Trace APIs and UI

- [ ] P5-010 Implement trace list API
  - Depends on: P3-080
  - Deliverables: recent trace summaries
  - Acceptance: summaries include target, app/key ids, outcome, created time.

- [ ] P5-011 Implement trace detail API
  - Depends on: P5-010
  - Deliverables: ordered trace timeline
  - Acceptance: returns all steps by trace id in order.

- [ ] P5-012 Implement trace detail UI
  - Depends on: P5-011
  - Deliverables: timeline component
  - Acceptance: shows filter reasons, attempts, final result.

- [ ] P5-013 Add trace navigation links
  - Depends on: P5-012
  - Deliverables: links from trace to upstream/public model/consumer key where possible
  - Acceptance: links resolve to existing admin pages.

## Usage UI

- [ ] P5-020 Implement Usage overview page
  - Depends on: P5-001, P5-002, P5-003
  - Deliverables: cards, breakdown tables, recent requests
  - Acceptance: mocked API test renders key stats.

- [ ] P5-021 Implement consumption stats table
  - Depends on: P5-004
  - Deliverables: per upstream/model/day table
  - Acceptance: table supports filtering by upstream/day.

- [ ] P5-022 Add trace entry from recent requests
  - Depends on: P5-012, P5-020
  - Deliverables: button/link to trace detail
  - Acceptance: click opens correct trace.

## Temporary Debug Content Logs

- [x] P5-030 Implement debug content settings API
  - Depends on: P1-036, P4-062
  - Deliverables: enable for duration/max rows, disable, status
  - Acceptance: enabling stores expiry and max row settings.

- [x] P5-031 Implement redaction and truncation
  - Depends on: P5-030
  - Deliverables: redact mh_, sk-, Bearer, auth headers; max bytes truncation
  - Acceptance: tests verify secrets do not persist.

- [x] P5-032 Implement debug content write path
  - Depends on: P5-031, P3-070, P4-020
  - Deliverables: non-stream and stream summary writes when enabled
  - Acceptance: disabled mode writes nothing; expired mode writes nothing.

- [x] P5-033 Implement debug content UI
  - Depends on: P5-030, P5-032
  - Deliverables: banner, enable/disable controls, recent debug rows
  - Acceptance: UI clearly indicates active recording.

## Cost Ledger Backend

- [ ] P5-040 Implement model pricing API
  - Depends on: P1-037
  - Deliverables: CRUD model/provider pricing
  - Acceptance: validation rejects negative costs.

- [ ] P5-041 Implement cost calculation service
  - Depends on: P5-040, P3-081
  - Deliverables: calculate request cost from usage and pricing
  - Acceptance: tests cover input/output/cache tokens and missing pricing.

- [ ] P5-042 Wire cost into usage writes
  - Depends on: P5-041
  - Deliverables: usage records/daily stats include estimated cost fields or joined cost view
  - Acceptance: request with known pricing records cost.

- [ ] P5-043 Implement token/coding plan API
  - Depends on: P1-037
  - Deliverables: CRUD plans, purchase/expiry dates, quota notes, remaining manual amount
  - Acceptance: tests cover active, expired, expiring soon.

- [ ] P5-044 Implement renewal reminders
  - Depends on: P5-043
  - Deliverables: query upcoming renewals and warnings
  - Acceptance: reminder appears for plan within warning window.

## Cost Ledger UI

- [ ] P5-050 Implement Cost & Plans page
  - Depends on: P5-040, P5-043, P5-044
  - Deliverables: pricing table, plan table, summary cards
  - Acceptance: mocked API test covers add/edit plan.

- [ ] P5-051 Add cost stats to Usage page
  - Depends on: P5-042, P5-020
  - Deliverables: cost totals and breakdowns
  - Acceptance: missing pricing displays as unpriced, not zero-cost if ambiguous.

- [ ] P5-052 Add renewal warning widget
  - Depends on: P5-044, P5-050
  - Deliverables: overview/settings warning component
  - Acceptance: expiring plan visible in UI.

## Model Reference Board

- [ ] P5-060 Implement fixed source fetcher
  - Depends on: P1-038
  - Deliverables: source client for chosen fixed model reference source
  - Acceptance: fixture fetch normalizes entries.

- [ ] P5-061 Implement model reference refresh service
  - Depends on: P5-060
  - Deliverables: refresh, TTL/status, error capture
  - Acceptance: failed refresh keeps old data and records error.

- [ ] P5-062 Implement model reference API
  - Depends on: P5-061
  - Deliverables: list/filter/sort/refresh endpoints
  - Acceptance: API returns scores, price, context, speed, latency.

- [ ] P5-063 Implement Model Reference page
  - Depends on: P5-062
  - Deliverables: filterable table/board
  - Acceptance: mocked API test covers filter and refresh.

- [ ] P5-064 Implement recommendation draft service
  - Depends on: P5-062, P2-040, P2-050
  - Deliverables: draft public model/model group suggestions
  - Acceptance: service returns draft only; no DB writes before confirmation.

- [ ] P5-065 Implement recommendation confirmation UI
  - Depends on: P5-064, P5-063
  - Deliverables: review modal and apply action
  - Acceptance: user must confirm before public model/group creation.

## Client Configuration Snippets

- [ ] P5-070 Define client templates
  - Depends on: P2-071
  - Deliverables: templates for Claude Code, Codex, OpenCode, Hermes, Cherry Studio, generic OpenAI
  - Acceptance: templates render with base URL, API key placeholder, model.

- [ ] P5-071 Implement snippet API
  - Depends on: P5-070, P2-061
  - Deliverables: endpoint to generate snippets for selected client/key/model
  - Acceptance: raw key display is opt-in and only available immediately after create/rotate where applicable.

- [ ] P5-072 Implement snippet UI
  - Depends on: P5-071
  - Deliverables: copyable snippets in setup wizard and Apps page
  - Acceptance: UI does not claim to auto-write config files.

## Documentation and Deployment

- [ ] P5-080 Write Docker deployment guide
  - Depends on: P0-053, P2-070
  - Deliverables: docs for volume layout, env vars, reverse proxy, HTTPS
  - Acceptance: guide includes backup directory and secret key warnings.

- [ ] P5-081 Write backup/restore guide
  - Depends on: P2-070
  - Deliverables: docs for full DB backup and non-sensitive export
  - Acceptance: guide explains same-secret requirement.

- [ ] P5-082 Write client setup guide
  - Depends on: P5-070
  - Deliverables: docs for supported clients
  - Acceptance: docs match snippet templates.

- [ ] P5-083 Write troubleshooting guide
  - Depends on: P5-012, P5-020
  - Deliverables: trace-based troubleshooting guide
  - Acceptance: guide maps common errors to UI locations.

## Phase 5 Closure

- [ ] P5-090 Add daily-use e2e scenario
  - Depends on: P5-020, P5-050, P5-063, P5-072
  - Deliverables: e2e covering usage, trace, cost, model reference, snippets
  - Acceptance: e2e passes.

- [ ] P5-091 Run full verification
  - Depends on: P5-090
  - Deliverables: typecheck/test/lint/e2e results
  - Acceptance: all checks pass.

