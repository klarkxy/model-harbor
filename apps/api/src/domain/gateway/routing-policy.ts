import {
  PROTOCOL_BY_PROVIDER,
  requiredCapabilities,
  requestRequiresAdvancedCrossProtocol,
  type ProviderType,
  type RequiredCapabilities,
  type SourceProtocol,
} from '@manageyourllm/shared';

export type QuotaPeriod = 'hour' | 'day' | 'week' | 'month' | 'total';

export type EndpointProtocolCompatibility = 'native' | 'convertible' | 'unsupported';

export interface UpstreamEndpoint {
  protocol: SourceProtocol;
  baseUrl: string;
  providerType: ProviderType;
  apiPath?: string;
  defaultHeaders?: Record<string, string>;
  extraHeaders?: Record<string, string>;
  extraParams?: Record<string, unknown>;
}

export function parseUpstreamEndpoints(endpointsJson: unknown): UpstreamEndpoint[] {
  if (!Array.isArray(endpointsJson)) return [];
  return endpointsJson.filter(isUpstreamEndpoint);
}

function isUpstreamEndpoint(value: unknown): value is UpstreamEndpoint {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.baseUrl === 'string' &&
    typeof e.providerType === 'string' &&
    typeof e.protocol === 'string'
  );
}

export function endpointProtocolCompatibility(
  endpointProtocol: SourceProtocol,
  sourceProtocol: SourceProtocol,
): EndpointProtocolCompatibility {
  if (endpointProtocol === sourceProtocol) return 'native';
  // OpenAI 与 Codex 共享同一套 wire format/adapter，可互相转换。
  const openaiFamily: SourceProtocol[] = ['openai', 'codex'];
  if (openaiFamily.includes(endpointProtocol) && openaiFamily.includes(sourceProtocol)) {
    return 'convertible';
  }
  // Anthropic Messages 与 OpenAI Chat Completions 之间可进行非流式转换。
  const convertiblePairs: Array<[SourceProtocol, SourceProtocol]> = [
    ['anthropic', 'openai'],
    ['openai', 'anthropic'],
  ];
  if (
    convertiblePairs.some(
      ([a, b]) =>
        (a === endpointProtocol && b === sourceProtocol) ||
        (b === endpointProtocol && a === sourceProtocol),
    )
  ) {
    return 'convertible';
  }
  return 'unsupported';
}

export type RoutingProviderType =
  | 'openai_compatible'
  | 'anthropic_compatible'
  | 'coze'
  | 'codex'
  | 'openrouter'
  | 'groq'
  | 'fireworks'
  | 'together'
  | 'deepseek'
  | 'moonshot'
  | 'moonshot_cn'
  | 'minimax'
  | 'minimax_cn'
  | 'opencode_go'
  | 'opencode_zen';

export function periodBounds(
  period: Exclude<QuotaPeriod, 'total'>,
  now: Date,
): { startedAt: Date; endsAt: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const hours = now.getUTCHours();

  switch (period) {
    case 'hour': {
      const startedAt = new Date(Date.UTC(year, month, date, hours, 0, 0, 0));
      return { startedAt, endsAt: new Date(startedAt.getTime() + 60 * 60 * 1000) };
    }
    case 'day': {
      const startedAt = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
      return { startedAt, endsAt: new Date(startedAt.getTime() + 24 * 60 * 60 * 1000) };
    }
    case 'week': {
      const day = now.getUTCDay();
      const diff = day === 0 ? 6 : day - 1; // 周一为周起点
      const startedAt = new Date(Date.UTC(year, month, date - diff, 0, 0, 0, 0));
      return { startedAt, endsAt: new Date(startedAt.getTime() + 7 * 24 * 60 * 60 * 1000) };
    }
    case 'month': {
      const startedAt = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      return { startedAt, endsAt: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)) };
    }
  }
}

export function providerSupportsCapability(
  providerType: RoutingProviderType,
  capability: keyof RequiredCapabilities,
): boolean {
  const openaiFamily = new Set<RoutingProviderType>([
    'openai_compatible',
    'coze',
    'codex',
    'openrouter',
    'groq',
    'fireworks',
    'together',
    'opencode_go',
    'opencode_zen',
  ]);
  const anthropicFamily = new Set<RoutingProviderType>([
    'anthropic_compatible',
    'deepseek',
    'moonshot',
    'moonshot_cn',
    'minimax',
    'minimax_cn',
    'opencode_zen',
  ]);

  switch (capability) {
    case 'streaming':
      return true;
    case 'tools':
    case 'toolChoice':
    case 'jsonMode':
      return openaiFamily.has(providerType) || anthropicFamily.has(providerType);
    case 'vision':
      return openaiFamily.has(providerType) || providerType === 'anthropic_compatible';
    case 'thinking':
      return (
        providerType === 'anthropic_compatible' ||
        providerType === 'codex' ||
        providerType === 'opencode_zen'
      );
    default:
      return false;
  }
}

export { requiredCapabilities, requestRequiresAdvancedCrossProtocol };
export type { RequiredCapabilities, SourceProtocol };

export function protocolForProviderType(providerType: RoutingProviderType): SourceProtocol {
  return PROTOCOL_BY_PROVIDER[providerType];
}
