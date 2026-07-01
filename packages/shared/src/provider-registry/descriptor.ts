import type { ProviderType, SourceProtocol } from '../protocols.js';

export interface ProviderMetadata {
  // 人类可读名称。没有 i18n 翻译时使用它。
  displayName: string;
  // 官方 API 文档链接。
  docsUrl?: string;
  // 公开状态页链接（例如 Statuspage.io）。
  statusPageUrl?: string;
  // 管理员获取 API key 的链接。
  apiKeyUrl?: string;
}

export interface ProviderBranding {
  // Emoji、SVG 文件名或前端能理解的任何标识符。
  icon?: string;
  // 主品牌色，hex/rgb 字符串，用于 UI 强调色。
  color?: string;
}

export interface ProviderDescriptorCapabilities {
  // 该 provider 可通过端点服务的下游协议。
  protocols: readonly SourceProtocol[];
  supportsTools: boolean;
  supportsToolChoice: boolean;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  supportsThinking: boolean;
}

export interface ProviderDescriptorAuthStrategies {
  // 使用预设时默认选中的策略。
  default: string;
  // 该 provider 支持的所有策略。
  available: string[];
}

export interface ProviderDescriptorEndpoint {
  // 该端点服务的下游协议。
  protocol: SourceProtocol;
  // 该端点的上游 base URL。
  baseUrl: string;
  // 与该端点通信使用的 adapter。
  providerType: ProviderType;
  // 可选的完整请求路径覆盖。
  apiPath?: string;
}

export interface ProviderDescriptor {
  // 稳定标识符。用作 i18n 键 `providers.{id}` 和 DB preset id。
  id: string;
  metadata: ProviderMetadata;
  branding?: ProviderBranding;
  // 用于路由/过滤的静态能力声明。
  capabilities: ProviderDescriptorCapabilities;
  endpoints: ProviderDescriptorEndpoint[];
  // 每个请求额外发送的 header（例如 anthropic-version）。
  defaultHeaders?: Record<string, string>;
  // 默认额外 header / body 参数。
  defaultExtraHeaders?: Record<string, string>;
  defaultExtraParams?: Record<string, unknown>;
  // 支持的认证策略。
  authStrategies?: ProviderDescriptorAuthStrategies;
  // Web 应用里的设置指南链接。
  guideUrl?: string;
  // 模型列表同步用的相对或绝对 URL。
  // 省略时，同步任务会回退到 OpenAI-compatible 端点的 `/v1/models`。
  modelSyncUrl?: string;
  // ping / 健康检查使用的默认模型名。
  defaultModel?: string;
  // 管理 UI 中展示的示例模型名。
  modelExamples?: string[];
}

export function descriptorDefaultEndpoint(
  descriptor: ProviderDescriptor,
): ProviderDescriptorEndpoint {
  if (descriptor.endpoints.length === 0) {
    throw new Error(`provider descriptor ${descriptor.id} has no endpoints`);
  }
  return descriptor.endpoints[0]!;
}

export function descriptorDiscoveryEndpoint(
  descriptor: ProviderDescriptor,
): ProviderDescriptorEndpoint {
  // 优先使用 OpenAI-compatible 端点进行 `/v1/models` 模型发现。
  const openaiEndpoint = descriptor.endpoints.find((e) => e.providerType === 'openai_compatible');
  return openaiEndpoint ?? descriptorDefaultEndpoint(descriptor);
}
