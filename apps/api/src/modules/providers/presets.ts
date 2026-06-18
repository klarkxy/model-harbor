import type { ProviderType, SourceProtocol } from '@modelharbor/shared';

export interface ProviderPresetEndpoint {
  // Client protocol this endpoint serves.
  protocol: SourceProtocol;
  // Upstream base URL for this endpoint (e.g. "https://api.minimaxi.com/anthropic").
  baseUrl: string;
  // Adapter used to talk to this endpoint (anthropic_compatible / openai_compatible).
  providerType: ProviderType;
  // Optional full request path override. When omitted the adapter appends its
  // default protocol path ("/v1/messages" or "/v1/chat/completions"). Use this
  // for providers whose endpoint path does not include the standard /v1 segment,
  // e.g. Zhipu GLM uses "/v4/chat/completions".
  apiPath?: string;
}

export interface ProviderPreset {
  id: string;
  // English display name. The frontend should use the preset id as an i18n key
  // (providers.{id}) and fall back to this name when no translation exists.
  name: string;
  // Optional icon hint for the admin UI. This can be an emoji, an SVG filename,
  // or any identifier the frontend understands. Official provider SVGs can be
  // dropped into apps/web/public/icons/providers/{id}.svg and referenced here.
  icon?: string;
  endpoints: ProviderPresetEndpoint[];
  // Extra headers to send on every request (e.g. anthropic-version).
  defaultHeaders?: Record<string, string>;
}

export interface ModelMapping {
  publicName: string;
  realName: string;
}

// Presets no longer ship hardcoded model lists. The legacy modelMappings view is
// kept empty for API compatibility while models are discovered from upstream.
export function getModelMappings(_preset: ProviderPreset): ModelMapping[] {
  return [];
}

// ---------------------------------------------------------------------------
// International providers
// ---------------------------------------------------------------------------

const OPENAI_PRESET: ProviderPreset = {
  id: 'openai',
  icon: '🤖',
  name: 'OpenAI',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.openai.com',
      providerType: 'openai_compatible',
    },
  ],
};

const ANTHROPIC_PRESET: ProviderPreset = {
  id: 'anthropic',
  icon: '🟣',
  name: 'Anthropic',
  endpoints: [
    {
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      providerType: 'anthropic_compatible',
    },
  ],
};

const DEEPSEEK_PRESET: ProviderPreset = {
  id: 'deepseek',
  icon: '🐋',
  name: 'DeepSeek',
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
};

const MOONSHOT_PRESET: ProviderPreset = {
  id: 'moonshot',
  icon: '🌙',
  name: 'Moonshot (Kimi) - International',
  endpoints: [
    {
      protocol: 'anthropic',
      baseUrl: 'https://api.moonshot.ai/anthropic',
      providerType: 'anthropic_compatible',
    },
    {
      protocol: 'openai',
      baseUrl: 'https://api.moonshot.ai',
      providerType: 'openai_compatible',
    },
  ],
};

const MINIMAX_INTL_PRESET: ProviderPreset = {
  id: 'minimax-intl',
  icon: 'Ⓜ️',
  name: 'MiniMax - International',
  endpoints: [
    {
      protocol: 'anthropic',
      baseUrl: 'https://api.minimax.io/anthropic',
      providerType: 'anthropic_compatible',
    },
    {
      protocol: 'openai',
      baseUrl: 'https://api.minimax.io',
      providerType: 'openai_compatible',
    },
  ],
};

const OPENROUTER_PRESET: ProviderPreset = {
  id: 'openrouter',
  icon: '🌐',
  name: 'OpenRouter',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://openrouter.ai/api',
      providerType: 'openai_compatible',
    },
  ],
  // Public model names are kept provider-agnostic so they can be shared with
  // official-provider presets (e.g. "gpt-4o" also exists under OpenAI). The
  // overrides carry the OpenRouter slug required by the upstream endpoint.
};

const OPENCODE_GO_PRESET: ProviderPreset = {
  id: 'opencode-go',
  icon: '🐙',
  name: 'OpenCode Go',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      providerType: 'openai_compatible',
    },
  ],
};

const OPENCODE_ZEN_PRESET: ProviderPreset = {
  id: 'opencode-zen',
  icon: '🐙',
  name: 'OpenCode Zen',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://opencode.ai/zen/v1',
      providerType: 'openai_compatible',
    },
  ],
};

const GROQ_PRESET: ProviderPreset = {
  id: 'groq',
  icon: '⚡',
  name: 'Groq',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.groq.com/openai',
      providerType: 'openai_compatible',
    },
  ],
};

const TOGETHER_PRESET: ProviderPreset = {
  id: 'together',
  icon: '🤝',
  name: 'Together AI',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.together.xyz',
      providerType: 'openai_compatible',
    },
  ],
};

const CEREBRAS_PRESET: ProviderPreset = {
  id: 'cerebras',
  icon: '🧠',
  name: 'Cerebras',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.cerebras.ai',
      providerType: 'openai_compatible',
    },
  ],
};

const FIREWORKS_PRESET: ProviderPreset = {
  id: 'fireworks',
  icon: '🎆',
  name: 'Fireworks AI',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.fireworks.ai/inference',
      providerType: 'openai_compatible',
    },
  ],
};

const XAI_PRESET: ProviderPreset = {
  id: 'xai',
  icon: '🚀',
  name: 'xAI (Grok)',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.x.ai',
      providerType: 'openai_compatible',
    },
  ],
};

// ---------------------------------------------------------------------------
// China domestic providers
// ---------------------------------------------------------------------------

const QWEN_PRESET: ProviderPreset = {
  id: 'qwen',
  icon: '🌸',
  name: 'Alibaba Qwen (DashScope - China)',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
      providerType: 'openai_compatible',
    },
  ],
};

const QWEN_INTL_PRESET: ProviderPreset = {
  id: 'qwen-intl',
  icon: '🌸',
  name: 'Alibaba Qwen (DashScope - International)',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode',
      providerType: 'openai_compatible',
    },
  ],
};

const ZHIPU_PRESET: ProviderPreset = {
  id: 'zhipu',
  icon: '🧬',
  name: 'Zhipu GLM',
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
};

const ZHIPU_CODING_PRESET: ProviderPreset = {
  id: 'zhipu-coding',
  icon: '🧬',
  name: 'Zhipu GLM Coding Plan',
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
};

const MOONSHOT_CN_PRESET: ProviderPreset = {
  id: 'moonshot-cn',
  icon: '🌙',
  name: 'Moonshot (Kimi) - China',
  endpoints: [
    {
      protocol: 'anthropic',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      providerType: 'anthropic_compatible',
    },
    {
      protocol: 'openai',
      baseUrl: 'https://api.moonshot.cn',
      providerType: 'openai_compatible',
    },
  ],
};

const MINIMAX_PRESET: ProviderPreset = {
  id: 'minimax',
  icon: 'Ⓜ️',
  name: 'MiniMax',
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
};

const SILICONFLOW_PRESET: ProviderPreset = {
  id: 'siliconflow',
  icon: '💧',
  name: 'SiliconFlow (硅基流动)',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1',
      providerType: 'openai_compatible',
    },
  ],
};

const BAICHUAN_PRESET: ProviderPreset = {
  id: 'baichuan',
  icon: '🌊',
  name: 'Baichuan',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.baichuan-ai.com',
      providerType: 'openai_compatible',
    },
  ],
};

const BYTEDANCE_PRESET: ProviderPreset = {
  id: 'bytedance',
  icon: '🌋',
  name: 'ByteDance Volcano Ark',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://ark.cn-beijing.volces.com/api',
      providerType: 'openai_compatible',
      apiPath: '/v3/chat/completions',
    },
  ],
};

const HUNYUAN_PRESET: ProviderPreset = {
  id: 'hunyuan',
  icon: '🐧',
  name: 'Tencent Hunyuan',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.hunyuan.cloud.tencent.com',
      providerType: 'openai_compatible',
    },
  ],
};

const QIANFAN_PRESET: ProviderPreset = {
  id: 'qianfan',
  icon: '🌾',
  name: 'Baidu Qianfan',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://qianfan.baidubce.com',
      providerType: 'openai_compatible',
      apiPath: '/v2/chat/completions',
    },
  ],
};

const STEPFUN_PRESET: ProviderPreset = {
  id: 'stepfun',
  icon: '⬆️',
  name: 'StepFun',
  endpoints: [
    {
      protocol: 'openai',
      baseUrl: 'https://api.stepfun.com',
      providerType: 'openai_compatible',
    },
  ],
};

const PRESETS_BY_ID: Readonly<Record<string, ProviderPreset>> = {
  [OPENAI_PRESET.id]: OPENAI_PRESET,
  [ANTHROPIC_PRESET.id]: ANTHROPIC_PRESET,
  [DEEPSEEK_PRESET.id]: DEEPSEEK_PRESET,
  [MOONSHOT_PRESET.id]: MOONSHOT_PRESET,
  [MINIMAX_INTL_PRESET.id]: MINIMAX_INTL_PRESET,
  [OPENROUTER_PRESET.id]: OPENROUTER_PRESET,
  [OPENCODE_GO_PRESET.id]: OPENCODE_GO_PRESET,
  [OPENCODE_ZEN_PRESET.id]: OPENCODE_ZEN_PRESET,
  [GROQ_PRESET.id]: GROQ_PRESET,
  [TOGETHER_PRESET.id]: TOGETHER_PRESET,
  [CEREBRAS_PRESET.id]: CEREBRAS_PRESET,
  [FIREWORKS_PRESET.id]: FIREWORKS_PRESET,
  [XAI_PRESET.id]: XAI_PRESET,
  [QWEN_PRESET.id]: QWEN_PRESET,
  [QWEN_INTL_PRESET.id]: QWEN_INTL_PRESET,
  [ZHIPU_PRESET.id]: ZHIPU_PRESET,
  [ZHIPU_CODING_PRESET.id]: ZHIPU_CODING_PRESET,
  [MOONSHOT_CN_PRESET.id]: MOONSHOT_CN_PRESET,
  [MINIMAX_PRESET.id]: MINIMAX_PRESET,
  [SILICONFLOW_PRESET.id]: SILICONFLOW_PRESET,
  [BAICHUAN_PRESET.id]: BAICHUAN_PRESET,
  [BYTEDANCE_PRESET.id]: BYTEDANCE_PRESET,
  [HUNYUAN_PRESET.id]: HUNYUAN_PRESET,
  [QIANFAN_PRESET.id]: QIANFAN_PRESET,
  [STEPFUN_PRESET.id]: STEPFUN_PRESET,
};

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PRESETS_BY_ID[id];
}

export function listProviderPresets(): ProviderPreset[] {
  return Object.values(PRESETS_BY_ID);
}
