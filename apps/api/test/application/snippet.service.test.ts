import { describe, it, expect } from 'vitest';
import { SnippetService } from '../../src/application/snippet.service.js';
import type { AdminSettingsRow } from '../../src/infrastructure/db/schema.js';

function makeSettings(publicBaseUrl?: string): AdminSettingsRow {
  return {
    id: 'settings',
    circuitBreakerEnabled: true,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerBaseCooldownMs: 1000,
    circuitBreakerMaxCooldownMs: 60000,
    circuitBreakerHalfOpenSuccessCount: 3,
    endpointHealthProbeEnabled: true,
    endpointHealthProbeIntervalMs: 3600000,
    endpointHealthProbeTimeoutMs: 10000,
    endpointHealthProbeDegradedLatencyMs: 5000,
    firstTokenTimeoutMs: 15000,
    contentLogEnabled: false,
    contentLogExpiresAt: null,
    contentLogMaxRows: 1000,
    contentLogRetentionDays: 7,
    contentLogMaxPayloadBytes: 100000,
    publicEndpointsBasePath: '/v1',
    publicBaseUrl: publicBaseUrl ?? null,
    defaultRequestTimeoutMs: 30000,
    defaultRetries: 0,
    enableStickySession: true,
    enableCircuitBreaker: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('SnippetService', () => {
  const service = new SnippetService();

  it('renders generic_openai snippet with url, key and model', () => {
    const result = service.generate({
      client: 'generic_openai',
      model: 'gpt-5',
      apiKey: 'sk-test',
      gatewayUrl: 'https://myllm.example.com/v1',
    });
    expect(result.content).toContain('https://myllm.example.com/v1/chat/completions');
    expect(result.content).toContain('sk-test');
    expect(result.content).toContain('"model": "gpt-5"');
  });

  it('renders codex_cli snippet', () => {
    const result = service.generate({
      client: 'codex_cli',
      model: 'coder',
      apiKey: 'sk-test',
      gatewayUrl: 'https://myllm.example.com/v1',
    });
    expect(result.content).toContain('OPENAI_BASE_URL="https://myllm.example.com/v1"');
    expect(result.content).toContain('codex --model "coder"');
  });

  it('builds gateway url from public base url', () => {
    const url = service.buildGatewayUrl(makeSettings('https://myllm.example.com'));
    expect(url).toBe('https://myllm.example.com/v1');
  });

  it('normalizes trailing and missing slashes when building gateway url', () => {
    const url = service.buildGatewayUrl(makeSettings('https://myllm.example.com/'));
    expect(url).toBe('https://myllm.example.com/v1');
  });

  it('returns empty gateway url when public base url is not configured', () => {
    const url = service.buildGatewayUrl(makeSettings());
    expect(url).toBe('');
  });
});
