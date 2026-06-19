// Upstream endpoint latency probing and health tracking.
//
// Each enabled upstream key is probed periodically by sending a lightweight
// HEAD request to every distinct endpoint base URL. The measured delay and any
// transport error are persisted in `upstream_endpoint_health`. The gateway can
// then prefer lower-latency endpoints and avoid degraded ones without relying
// on a hard failure first.

import { eq, inArray, sql } from 'drizzle-orm';
import { generateId, type ProviderType, type SourceProtocol } from '@modelharbor/shared';
import {
  type Db,
  type UpstreamEndpointHealthRow,
  type UpstreamKeyRow,
  upstreamEndpointHealth,
  upstreamKeys,
} from '../db/index.js';
interface ProbeResponse {
  status: number;
  ttfbMs: number;
}
import { resolveAuthorizationHeader } from '../providers/auth/index.js';
import { getCircuitBreakerSettings } from '../router/circuit-breaker.js';

export interface EndpointHealthProbeOptions {
  timeoutMs?: number;
  degradedLatencyMs?: number;
}

export interface EndpointProbeResult {
  delayMs: number | null;
  degraded: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface UpstreamEndpointHealthProbeSummary {
  checked: number;
  degraded: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_DEGRADED_LATENCY_MS = 5_000;

interface EndpointTarget {
  upstreamKeyId: string;
  baseUrl: string;
  providerType: ProviderType;
}

function parseEndpointsJson(
  json: string | null,
): Array<{ protocol: SourceProtocol; baseUrl: string; providerType: ProviderType; apiPath?: string }> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return null;
    const endpoints: Array<{
      protocol: SourceProtocol;
      baseUrl: string;
      providerType: ProviderType;
      apiPath?: string;
    }> = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { protocol?: unknown }).protocol === 'string' &&
        typeof (item as { baseUrl?: unknown }).baseUrl === 'string' &&
        typeof (item as { providerType?: unknown }).providerType === 'string'
      ) {
        endpoints.push(
          item as { protocol: SourceProtocol; baseUrl: string; providerType: ProviderType; apiPath?: string },
        );
      }
    }
    return endpoints.length > 0 ? endpoints : null;
  } catch {
    return null;
  }
}

export function listEndpointTargetsForKey(key: UpstreamKeyRow): EndpointTarget[] {
  const endpoints = parseEndpointsJson(key.endpointsJson);
  if (endpoints) {
    const seen = new Set<string>();
    const targets: EndpointTarget[] = [];
    for (const ep of endpoints) {
      if (seen.has(ep.baseUrl)) continue;
      seen.add(ep.baseUrl);
      targets.push({ upstreamKeyId: key.id, baseUrl: ep.baseUrl, providerType: ep.providerType });
    }
    return targets;
  }
  return [{ upstreamKeyId: key.id, baseUrl: key.baseUrl, providerType: key.providerType }];
}

async function sendProbe(
  db: Db,
  secretKey: string,
  target: EndpointTarget,
  options: EndpointHealthProbeOptions,
): Promise<EndpointProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const degradedLatencyMs = options.degradedLatencyMs ?? DEFAULT_DEGRADED_LATENCY_MS;

  const key = await db.select().from(upstreamKeys).where(eq(upstreamKeys.id, target.upstreamKeyId)).get();
  if (!key) {
    return { delayMs: null, degraded: true, errorCode: 'UPSTREAM_KEY_GONE', errorMessage: 'upstream key was deleted' };
  }

  let authHeader: string | undefined;
  try {
    authHeader = await resolveAuthorizationHeader({
      row: key,
      secretKey,
      baseUrl: target.baseUrl,
      db,
    });
  } catch {
    // Probing without auth is still useful for reachability; auth failures will
    // surface as 401/403 which we treat as reachable.
  }

  const headers: Record<string, string> = {};
  if (authHeader) {
    headers['authorization'] = authHeader;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const start = performance.now();
  try {
    const res = await fetch(target.baseUrl, {
      method: 'HEAD',
      headers,
      signal: controller.signal,
    });
    const ttfbMs = Math.round(performance.now() - start);
    const response: ProbeResponse = { status: res.status, ttfbMs };
    const delayMs = response.ttfbMs;
    const degraded = response.status >= 500 || delayMs > degradedLatencyMs;
    const errorCode = response.status >= 500 ? `HTTP_${response.status}` : null;
    const errorMessage = response.status >= 500 ? `upstream returned ${response.status}` : null;
    return { delayMs, degraded, errorCode, errorMessage };
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string } };
    const name = e.name === 'AbortError' ? 'timeout' : (e.name ?? 'error');
    const code = e.cause?.code ?? (e.name === 'AbortError' ? 'ETIMEDOUT' : undefined);
    return {
      delayMs: null,
      degraded: true,
      errorCode: code ?? name,
      errorMessage: e.message ?? String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function upsertEndpointHealth(
  db: Db,
  target: EndpointTarget,
  result: EndpointProbeResult,
  now: Date,
): Promise<void> {
  const existing = await db
    .select()
    .from(upstreamEndpointHealth)
    .where(
      sql`${upstreamEndpointHealth.upstreamKeyId} = ${target.upstreamKeyId} AND ${upstreamEndpointHealth.endpointBaseUrl} = ${target.baseUrl}`,
    )
    .get();

  const delayMs = result.delayMs ?? null;
  if (existing) {
    await db
      .update(upstreamEndpointHealth)
      .set({
        delayMs,
        lastCheckedAt: now,
        degraded: result.degraded,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        updatedAt: now,
      })
      .where(eq(upstreamEndpointHealth.id, existing.id));
  } else {
    await db.insert(upstreamEndpointHealth).values({
      id: generateId('endpointHealth'),
      upstreamKeyId: target.upstreamKeyId,
      endpointBaseUrl: target.baseUrl,
      delayMs,
      lastCheckedAt: now,
      degraded: result.degraded,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      createdAt: now,
      updatedAt: now,
    });
  }
}

const DEFAULT_PROBE_INTERVAL_MS = 60 * 60 * 1000;

export async function runEndpointHealthProbe(
  db: Db,
  secretKey: string,
  now: Date = new Date(),
  options: EndpointHealthProbeOptions = {},
): Promise<UpstreamEndpointHealthProbeSummary> {
  const settings = await getCircuitBreakerSettings(db);
  if (!settings.endpointHealthProbeEnabled) {
    return { checked: 0, degraded: 0 };
  }
  const probeIntervalMs = Math.max(60_000, settings.endpointHealthProbeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS);
  const probeOptions: EndpointHealthProbeOptions = {
    timeoutMs: options.timeoutMs ?? settings.endpointHealthProbeTimeoutMs,
    degradedLatencyMs: options.degradedLatencyMs ?? settings.endpointHealthProbeDegradedLatencyMs,
  };

  const keys = await db.select().from(upstreamKeys).where(eq(upstreamKeys.enabled, true)).all();
  const targets = keys.flatMap(listEndpointTargetsForKey);

  const existingRows = await db.select().from(upstreamEndpointHealth).all();
  const existingByEndpoint = new Map<string, UpstreamEndpointHealthRow>();
  for (const r of existingRows) {
    existingByEndpoint.set(`${r.upstreamKeyId}|${r.endpointBaseUrl}`, r);
  }

  let checked = 0;
  let degraded = 0;
  for (const target of targets) {
    const existing = existingByEndpoint.get(`${target.upstreamKeyId}|${target.baseUrl}`);
    const lastChecked = existing?.lastCheckedAt?.getTime() ?? 0;
    if (now.getTime() - lastChecked < probeIntervalMs) {
      continue;
    }
    try {
      const result = await sendProbe(db, secretKey, target, probeOptions);
      await upsertEndpointHealth(db, target, result, now);
      checked += 1;
      if (result.degraded) degraded += 1;
    } catch {
      // Best-effort: a single failed probe must not stop the sweep.
    }
  }
  try {
    await pruneOrphanEndpointHealth(db);
  } catch {
    // Best-effort cleanup; next run will retry.
  }
  return { checked, degraded };
}

export async function listUpstreamEndpointHealth(
  db: Db,
  args: { upstreamKeyId?: string } = {},
): Promise<UpstreamEndpointHealthRow[]> {
  if (args.upstreamKeyId) {
    return await db
      .select()
      .from(upstreamEndpointHealth)
      .where(eq(upstreamEndpointHealth.upstreamKeyId, args.upstreamKeyId))
      .all();
  }
  return await db.select().from(upstreamEndpointHealth).all();
}

export async function getEndpointHealthForUpstreamKeyIds(
  db: Db,
  upstreamKeyIds: string[],
): Promise<UpstreamEndpointHealthRow[]> {
  if (upstreamKeyIds.length === 0) return [];
  return await db
    .select()
    .from(upstreamEndpointHealth)
    .where(inArray(upstreamEndpointHealth.upstreamKeyId, upstreamKeyIds))
    .all();
}

export async function pruneOrphanEndpointHealth(db: Db): Promise<number> {
  const healthRows = await db.select().from(upstreamEndpointHealth).all();
  const keys = await db.select().from(upstreamKeys).all();
  const validEndpoints = new Set<string>();
  for (const key of keys) {
    for (const target of listEndpointTargetsForKey(key)) {
      validEndpoints.add(`${target.upstreamKeyId}|${target.baseUrl}`);
    }
  }
  const orphanIds = healthRows
    .filter((h) => !validEndpoints.has(`${h.upstreamKeyId}|${h.endpointBaseUrl}`))
    .map((h) => h.id);
  if (orphanIds.length === 0) return 0;
  await db.delete(upstreamEndpointHealth).where(inArray(upstreamEndpointHealth.id, orphanIds));
  return orphanIds.length;
}

export function sortCandidatesByLatency<
  T extends { upstreamKeyId: string; endpointBaseUrl: string; priority: number; weight: number },
>(candidates: T[], healthRows: UpstreamEndpointHealthRow[]): T[] {
  const healthByEndpoint = new Map<string, UpstreamEndpointHealthRow>();
  for (const h of healthRows) {
    healthByEndpoint.set(`${h.upstreamKeyId}|${h.endpointBaseUrl}`, h);
  }

  return [...candidates].sort((a, b) => {
    const ha = healthByEndpoint.get(`${a.upstreamKeyId}|${a.endpointBaseUrl}`);
    const hb = healthByEndpoint.get(`${b.upstreamKeyId}|${b.endpointBaseUrl}`);

    const degradedA = ha?.degraded ? 1 : 0;
    const degradedB = hb?.degraded ? 1 : 0;
    if (degradedA !== degradedB) return degradedA - degradedB;

    const delayA = ha?.delayMs ?? Number.POSITIVE_INFINITY;
    const delayB = hb?.delayMs ?? Number.POSITIVE_INFINITY;
    if (delayA !== delayB) return delayA - delayB;

    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.weight - a.weight;
  });
}
