# Admin UI Information Architecture

## Principles

The dashboard should feel like a lightweight control panel, not a configuration editor.

Rules:

- Use Vue 3 and Naive UI.
- Prefer Naive UI components over hand-written CSS.
- Organize by administrator workflow.
- Avoid YAML or raw JSON as the primary interaction model.
- Use clear state labels for enabled, disabled, frozen, cooldown, and over-quota.
- Keep provider-specific complexity behind presets and adapter labels.

## Navigation

Recommended primary navigation:

```text
Overview
Upstream Keys
Public Models
Model Groups
Apps
Usage
Settings
```

Consumer keys should be managed inside app detail pages, with an optional global search later.

## Overview

Purpose:

- Show system health at a glance.

Cards:

- Total requests today.
- Total tokens today.
- Active upstream keys.
- Frozen upstream keys.
- Recent failures.
- Sticky hit rate.

Tables:

- Recent gateway requests.
- Upstream keys needing attention.

## Upstream Keys

Purpose:

- Manage actual provider instances.

Table columns:

- Name.
- Provider type.
- Base URL.
- Supported models count.
- Enabled.
- Frozen.
- Cooldown.
- Remaining quota.
- Last used.
- Last error.
- Endpoint latency / degraded status (from background HEAD probes).

Actions:

- Add key.
- Edit.
- Rotate secret.
- Freeze.
- Unfreeze.
- Disable.

Form fields:

- Name.
- Provider type.
- Base URL.
- API key.
- Supported models.
- Endpoints (multi-endpoint preset override).
- Request limit.
- Input token limit.
- Output token limit.
- Total token limit.
- RPM.
- TPM.
- Period.

Raw API key should only be accepted as input and never displayed again.

Endpoint health detail:

- List each endpoint base URL.
- Show latest probe delay, degraded flag, error code, and last checked time.
- Aggregate best / degraded counts per upstream key.

## Public Models

Purpose:

- Define client-facing model names.

Table columns:

- Name.
- Display name.
- Enabled.
- Candidate count.
- Healthy candidates.
- Last used.

Detail tabs:

- Overview.
- Candidates.
- Usage.

Candidate editor:

- Upstream key.
- Real model name.
- Priority.
- Weight.
- Enabled.

Validation:

- Name cannot conflict with any model group name.

## Model Groups

Purpose:

- Let administrators create custom route groups.

Table columns:

- Name.
- Display name.
- Enabled.
- Member public models.
- Routing policy.
- Last used.

Form fields:

- Name.
- Display name.
- Description.
- Routing policy.
- Member public models.
- Priority and weight per member.

Validation:

- Name cannot conflict with any public model name.

## Apps

Purpose:

- Represent different user applications and aggregate their usage.

Table columns:

- Name.
- Enabled.
- Consumer keys count.
- Requests today.
- Tokens today.
- Failures today.
- Last used.

Detail tabs:

- Overview.
- Consumer Keys.
- Access.
- Usage.

Apps must not show quota or rate-limit configuration.

## Consumer Keys

Consumer keys are managed under each app.

Table columns:

- Name.
- Prefix.
- Enabled or revoked.
- Accessible targets.
- Last used.
- Created.

Actions:

- Create key.
- Rotate key.
- Revoke key.
- Edit access.

Create response:

- Show raw key once.
- Provide copy button.
- Warn that it will not be shown again.

Consumer keys must not show quota or rate-limit configuration.

## Usage

Purpose:

- Inspect routing and consumption.

Filters:

- Time range.
- App.
- Consumer key.
- Public model or group.
- Upstream key.
- Status.

Summary:

- Request count.
- Input tokens.
- Output tokens.
- Total tokens.
- Failure rate.
- Average latency.
- Sticky hit rate.

Tables:

- Recent requests.
- Usage by app.
- Usage by upstream key.
- Usage by target.

No prompt or completion content should be displayed by default.

## Settings

MVP settings:

- Admin profile.
- Change password.
- Instance information.
- Circuit Breaker: enable/disable, failure threshold, base/max cooldown, half-open success count.
- Endpoint Health Probe: enable/disable, probe interval, probe timeout, degraded latency threshold.
- Streaming: first-token timeout (`firstTokenTimeoutMs`, `0` disables failover).
- Logging settings placeholder.

Future settings:

- OIDC.
- Postgres/Redis status.
- Content logging controls.
- Backup hints.

## Naive UI Component Guidance

Use:

- `n-layout` and `n-menu` for app shell.
- `n-data-table` for object lists.
- `n-form` for create and edit forms.
- `n-drawer` for side edits.
- `n-modal` for confirmations and one-time key display.
- `n-tabs` for detail pages.
- `n-tag` for status.
- `n-statistic` for summary metrics.
- `n-alert` for warnings.
- `n-button` with icons where appropriate.

Avoid:

- Hand-rolled tables.
- Hand-rolled modal styles.
- Custom button systems.
- YAML textareas as the main configuration path.
- Large decorative marketing sections.
