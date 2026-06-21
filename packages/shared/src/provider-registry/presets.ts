import type {
  ProviderDescriptor,
  ProviderDescriptorAuthStrategies,
  ProviderDescriptorCapabilities,
  ProviderDescriptorEndpoint,
} from './descriptor.js';

function capabilities(endpoints: ProviderDescriptorEndpoint[]): ProviderDescriptorCapabilities {
  const protocols = Array.from(new Set(endpoints.map((e) => e.protocol)));
  return {
    protocols,
    supportsTools: false,
    supportsToolChoice: false,
    supportsVision: false,
    supportsJsonMode: false,
    supportsThinking: false,
  };
}

function preset(desc: Omit<ProviderDescriptor, 'capabilities'>): ProviderDescriptor {
  return {
    ...desc,
    capabilities: capabilities(desc.endpoints),
  };
}

const MODELHARBOR_USER_AGENT = 'ModelHarbor/0.1';

export const PROVIDER_PRESETS: readonly ProviderDescriptor[] = [
  preset({
    id: 'agnes-ai',
    metadata: { displayName: 'Agnes AI' },
    branding: { icon: '✨' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://apihub.agnes-ai.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/agnes-ai.md',
  }),
  preset({
    id: 'anthropic',
    metadata: {
      displayName: 'Anthropic',
      docsUrl: 'https://docs.anthropic.com',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys',
      statusPageUrl: 'https://status.anthropic.com',
    },
    branding: { icon: '🟣', color: '#D4A574' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        providerType: 'anthropic_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/anthropic.md',
    defaultModel: 'claude-3-5-sonnet-20241022',
    modelExamples: [
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
    ],
  }),
  preset({
    id: 'baichuan',
    metadata: { displayName: 'Baichuan' },
    branding: { icon: '🌊' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.baichuan-ai.com',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/baichuan.md',
  }),
  preset({
    id: 'bytedance',
    metadata: { displayName: 'ByteDance Volcano Ark' },
    branding: { icon: '🌋' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://ark.cn-beijing.volces.com/api',
        providerType: 'openai_compatible',
        apiPath: '/v3/chat/completions',
      },
    ],
    guideUrl: '/docs/provider-guides/bytedance.md',
  }),
  preset({
    id: 'cerebras',
    metadata: { displayName: 'Cerebras' },
    branding: { icon: '🧠' },
    endpoints: [
      { protocol: 'openai', baseUrl: 'https://api.cerebras.ai', providerType: 'openai_compatible' },
    ],
    guideUrl: '/docs/provider-guides/cerebras.md',
  }),
  preset({
    id: 'codex',
    metadata: {
      displayName: 'OpenAI Codex',
      docsUrl: 'https://platform.openai.com/docs',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
    },
    branding: { icon: '⌨️' },
    endpoints: [{ protocol: 'codex', baseUrl: 'https://api.openai.com', providerType: 'codex' }],
    authStrategies: {
      default: 'codex_oauth',
      available: ['codex_oauth', 'pat'],
    } as ProviderDescriptorAuthStrategies,
    guideUrl: '/docs/provider-guides/codex.md',
    defaultModel: 'codex-mini-latest',
  }),
  preset({
    id: 'coze',
    metadata: { displayName: 'Coze' },
    branding: { icon: '🤖' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.coze.cn',
        providerType: 'coze',
        apiPath: '/v3/chat',
      },
    ],
    authStrategies: {
      default: 'coze_oauth_jwt',
      available: ['coze_oauth_jwt', 'pat'],
    } as ProviderDescriptorAuthStrategies,
    guideUrl: '/docs/provider-guides/coze.md',
  }),
  preset({
    id: 'deepseek',
    metadata: {
      displayName: 'DeepSeek',
      docsUrl: 'https://api-docs.deepseek.com',
      apiKeyUrl: 'https://platform.deepseek.com',
    },
    branding: { icon: '🐋' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.deepseek.com/anthropic',
        providerType: 'anthropic_compatible',
      },
      {
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/deepseek.md',
    defaultModel: 'deepseek-chat',
    modelExamples: ['deepseek-chat', 'deepseek-reasoner'],
  }),
  preset({
    id: 'fireworks',
    metadata: { displayName: 'Fireworks AI' },
    branding: { icon: '🎆' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.fireworks.ai/inference',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/fireworks.md',
  }),
  preset({
    id: 'groq',
    metadata: { displayName: 'Groq' },
    branding: { icon: '⚡' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.groq.com/openai',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/groq.md',
  }),
  preset({
    id: 'hunyuan',
    metadata: { displayName: 'Tencent Hunyuan' },
    branding: { icon: '🐧' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/hunyuan.md',
  }),
  preset({
    id: 'kimi-code',
    metadata: { displayName: 'Kimi Code' },
    branding: { icon: '💻' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.kimi.com/coding',
        providerType: 'anthropic_compatible',
      },
    ],
    defaultExtraHeaders: { 'User-Agent': MODELHARBOR_USER_AGENT },
    guideUrl: '/docs/provider-guides/kimi-code.md',
  }),
  preset({
    id: 'minimax-intl',
    metadata: { displayName: 'MiniMax (International)' },
    branding: { icon: 'Ⓜ️' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.minimax.io/anthropic',
        providerType: 'anthropic_compatible',
      },
      { protocol: 'openai', baseUrl: 'https://api.minimax.io', providerType: 'openai_compatible' },
    ],
    guideUrl: '/docs/provider-guides/minimax-intl.md',
  }),
  preset({
    id: 'minimax',
    metadata: { displayName: 'MiniMax (China)' },
    branding: { icon: 'Ⓜ️' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.minimaxi.com/anthropic',
        providerType: 'anthropic_compatible',
      },
      {
        protocol: 'openai',
        baseUrl: 'https://api.minimaxi.com',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/minimax.md',
  }),
  preset({
    id: 'moonshot-cn',
    metadata: { displayName: 'Moonshot (Kimi) (China)' },
    branding: { icon: '🌙' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.moonshot.cn/anthropic',
        providerType: 'anthropic_compatible',
      },
      { protocol: 'openai', baseUrl: 'https://api.moonshot.cn', providerType: 'openai_compatible' },
    ],
    guideUrl: '/docs/provider-guides/moonshot-cn.md',
    defaultModel: 'moonshot-v1-8k',
  }),
  preset({
    id: 'moonshot',
    metadata: { displayName: 'Moonshot (Kimi) (International)' },
    branding: { icon: '🌙' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://api.moonshot.ai/anthropic',
        providerType: 'anthropic_compatible',
      },
      { protocol: 'openai', baseUrl: 'https://api.moonshot.ai', providerType: 'openai_compatible' },
    ],
    guideUrl: '/docs/provider-guides/moonshot.md',
    defaultModel: 'moonshot-v1-8k',
  }),
  preset({
    id: 'openai',
    metadata: {
      displayName: 'OpenAI',
      docsUrl: 'https://platform.openai.com/docs',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      statusPageUrl: 'https://status.openai.com',
    },
    branding: { icon: '🤖', color: '#10A37F' },
    endpoints: [
      { protocol: 'openai', baseUrl: 'https://api.openai.com', providerType: 'openai_compatible' },
    ],
    guideUrl: '/docs/provider-guides/openai.md',
    defaultModel: 'gpt-4o-mini',
    modelExamples: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  }),
  preset({
    id: 'opencode-go',
    metadata: { displayName: 'OpenCode Go', docsUrl: 'https://opencode.ai/docs/zh-cn/go' },
    branding: { icon: '🐙' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://opencode.ai/zen/go',
        providerType: 'openai_compatible',
      },
      {
        protocol: 'anthropic',
        baseUrl: 'https://opencode.ai/zen/go',
        providerType: 'anthropic_compatible',
      },
    ],
    defaultExtraHeaders: { 'User-Agent': MODELHARBOR_USER_AGENT },
    modelSyncUrl: 'https://opencode.ai/zen/go/v1/models',
    guideUrl: '/docs/provider-guides/opencode-go.md',
    defaultModel: 'deepseek-v4-flash',
    modelExamples: ['deepseek-v4-flash', 'kimi-k2.7-code', 'minimax-m3', 'qwen3.7-plus'],
  }),
  preset({
    id: 'opencode-zen',
    metadata: { displayName: 'OpenCode Zen' },
    branding: { icon: '🐙' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://opencode.ai/zen/v1',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/opencode-zen.md',
  }),
  preset({
    id: 'openrouter',
    metadata: { displayName: 'OpenRouter' },
    branding: { icon: '🌐' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://openrouter.ai/api',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/openrouter.md',
  }),
  preset({
    id: 'qianfan',
    metadata: { displayName: 'Baidu Qianfan' },
    branding: { icon: '🌾' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://qianfan.baidubce.com',
        providerType: 'openai_compatible',
        apiPath: '/v2/chat/completions',
      },
    ],
    guideUrl: '/docs/provider-guides/qianfan.md',
  }),
  preset({
    id: 'qwen-intl',
    metadata: { displayName: 'Alibaba Qwen (DashScope International)' },
    branding: { icon: '🌸' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/qwen-intl.md',
  }),
  preset({
    id: 'qwen',
    metadata: { displayName: 'Alibaba Qwen (DashScope China)' },
    branding: { icon: '🌸' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/qwen.md',
  }),
  preset({
    id: 'siliconflow',
    metadata: { displayName: 'SiliconFlow' },
    branding: { icon: '💧' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.siliconflow.cn/v1',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/siliconflow.md',
  }),
  preset({
    id: 'stepfun',
    metadata: { displayName: 'StepFun' },
    branding: { icon: '⬆️' },
    endpoints: [
      { protocol: 'openai', baseUrl: 'https://api.stepfun.com', providerType: 'openai_compatible' },
    ],
    guideUrl: '/docs/provider-guides/stepfun.md',
  }),
  preset({
    id: 'together',
    metadata: { displayName: 'Together AI' },
    branding: { icon: '🤝' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.together.xyz',
        providerType: 'openai_compatible',
      },
    ],
    guideUrl: '/docs/provider-guides/together.md',
  }),
  preset({
    id: 'xai',
    metadata: { displayName: 'xAI (Grok)' },
    branding: { icon: '🚀' },
    endpoints: [
      { protocol: 'openai', baseUrl: 'https://api.x.ai', providerType: 'openai_compatible' },
    ],
    guideUrl: '/docs/provider-guides/xai.md',
  }),
  preset({
    id: 'zhipu-coding',
    metadata: { displayName: 'Zhipu GLM Coding Plan' },
    branding: { icon: '🧬' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        providerType: 'anthropic_compatible',
      },
      {
        protocol: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas',
        providerType: 'openai_compatible',
        apiPath: '/v4/chat/completions',
      },
    ],
    guideUrl: '/docs/provider-guides/zhipu-coding.md',
  }),
  preset({
    id: 'zhipu',
    metadata: { displayName: 'Zhipu GLM' },
    branding: { icon: '🧬' },
    endpoints: [
      {
        protocol: 'anthropic',
        baseUrl: 'https://open.bigmodel.cn/api/anthropic',
        providerType: 'anthropic_compatible',
      },
      {
        protocol: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas',
        providerType: 'openai_compatible',
        apiPath: '/v4/chat/completions',
      },
    ],
    guideUrl: '/docs/provider-guides/zhipu.md',
  }),
].sort((a, b) => a.metadata.displayName.localeCompare(b.metadata.displayName));

const PRESETS_BY_ID: Readonly<Record<string, ProviderDescriptor>> = Object.fromEntries(
  PROVIDER_PRESETS.map((d) => [d.id, d]),
);

export function getProviderDescriptor(id: string): ProviderDescriptor | undefined {
  return PRESETS_BY_ID[id];
}

export function listProviderDescriptors(): readonly ProviderDescriptor[] {
  return PROVIDER_PRESETS;
}
