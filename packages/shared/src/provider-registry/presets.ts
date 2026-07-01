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

export const PROVIDER_PRESETS: readonly ProviderDescriptor[] = [
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
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'baichuan',
    metadata: {
      displayName: '百川智能',
      docsUrl: 'https://platform.baichuan-ai.com/docs/api',
      apiKeyUrl: 'https://platform.baichuan-ai.com/console/apikey',
    },
    branding: { icon: '🌊' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.baichuan-ai.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'codex',
    metadata: {
      displayName: 'OpenAI Codex',
      docsUrl: 'https://platform.openai.com/docs',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
    },
    branding: { icon: '⌨️' },
    endpoints: [
      {
        protocol: 'codex',
        baseUrl: 'https://api.openai.com',
        providerType: 'codex',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
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
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'doubao',
    metadata: {
      displayName: '豆包 / 火山方舟',
      docsUrl: 'https://www.volcengine.com/docs/82379',
      apiKeyUrl: 'https://console.volcengine.com/ark/',
    },
    branding: { icon: '🌋' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'fireworks',
    metadata: {
      displayName: 'Fireworks AI',
      docsUrl: 'https://docs.fireworks.ai',
      apiKeyUrl: 'https://app.fireworks.ai/users/settings/api-keys',
    },
    branding: { icon: '🎆' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.fireworks.ai/inference/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'groq',
    metadata: {
      displayName: 'Groq',
      docsUrl: 'https://console.groq.com/docs',
      apiKeyUrl: 'https://console.groq.com/keys',
    },
    branding: { icon: '⚡' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'hunyuan',
    metadata: {
      displayName: '腾讯混元',
      docsUrl: 'https://cloud.tencent.com/document/product/1729',
      apiKeyUrl: 'https://console.cloud.tencent.com/hunyuan/',
    },
    branding: { icon: '🐧' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'minimax',
    metadata: {
      displayName: 'MiniMax 国际站',
      docsUrl: 'https://platform.minimax.io/docs',
      apiKeyUrl: 'https://platform.minimax.io',
    },
    branding: { icon: 'Ⓜ️' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.minimax.io/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'minimax_cn',
    metadata: {
      displayName: 'MiniMax 中国站',
      docsUrl: 'https://platform.minimaxi.com/docs',
      apiKeyUrl: 'https://platform.minimaxi.com',
    },
    branding: { icon: 'Ⓜ️' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.minimaxi.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'modelscope',
    metadata: {
      displayName: '魔搭社区',
      docsUrl: 'https://modelscope.cn/docs',
      apiKeyUrl: 'https://modelscope.cn/',
    },
    branding: { icon: '🧩' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'moonshot',
    metadata: {
      displayName: 'Moonshot (Kimi) 国际站',
      docsUrl: 'https://platform.moonshot.ai/docs',
      apiKeyUrl: 'https://platform.moonshot.ai',
    },
    branding: { icon: '🌙' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.moonshot.ai/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'moonshot_cn',
    metadata: {
      displayName: 'Moonshot (Kimi) 中国站',
      docsUrl: 'https://platform.moonshot.cn/docs',
      apiKeyUrl: 'https://platform.moonshot.cn',
    },
    branding: { icon: '🌙' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.moonshot.cn/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
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
      {
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'opencode_go',
    metadata: {
      displayName: 'OpenCode Go',
      docsUrl: 'https://opencode.ai/docs/zh-cn/go',
      apiKeyUrl: 'https://opencode.ai',
    },
    branding: { icon: '🔷' },
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
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'opencode_zen',
    metadata: {
      displayName: 'OpenCode Zen',
      docsUrl: 'https://opencode.ai/docs/zh-cn/zen',
      apiKeyUrl: 'https://opencode.ai',
    },
    branding: { icon: '🔷' },
    endpoints: [
      {
        protocol: 'codex',
        baseUrl: 'https://opencode.ai/zen',
        providerType: 'codex',
      },
      {
        protocol: 'anthropic',
        baseUrl: 'https://opencode.ai/zen',
        providerType: 'anthropic_compatible',
      },
      {
        protocol: 'openai',
        baseUrl: 'https://opencode.ai/zen',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'openrouter',
    metadata: {
      displayName: 'OpenRouter',
      docsUrl: 'https://openrouter.ai/docs',
      apiKeyUrl: 'https://openrouter.ai/keys',
    },
    branding: { icon: '🌐' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'qwen',
    metadata: {
      displayName: '阿里百炼 / 通义千问',
      docsUrl: 'https://help.aliyun.com/zh/model-studio/',
      apiKeyUrl: 'https://bailian.console.aliyun.com',
    },
    branding: { icon: '🧧' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'sensenova',
    metadata: {
      displayName: '商汤日日新',
      docsUrl: 'https://platform.sensenova.cn',
      apiKeyUrl: 'https://platform.sensenova.cn',
    },
    branding: { icon: '🔵' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://token.sensenova.cn/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'siliconflow',
    metadata: {
      displayName: '硅基流动',
      docsUrl: 'https://docs.siliconflow.cn',
      apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    },
    branding: { icon: '💧' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.siliconflow.cn/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'spark',
    metadata: {
      displayName: '讯飞星火',
      docsUrl: 'https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html',
      apiKeyUrl: 'https://console.xfyun.cn',
    },
    branding: { icon: '🔥' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://spark-api-open.xf-yun.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'stepfun',
    metadata: {
      displayName: '阶跃星辰',
      docsUrl: 'https://platform.stepfun.com',
      apiKeyUrl: 'https://platform.stepfun.com',
    },
    branding: { icon: '⭐' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.stepfun.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'together',
    metadata: {
      displayName: 'Together AI',
      docsUrl: 'https://docs.together.ai',
      apiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    },
    branding: { icon: '🤝' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.together.xyz/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'yi',
    metadata: {
      displayName: '零一万物',
      docsUrl: 'https://platform.lingyiwanwu.com/docs',
      apiKeyUrl: 'https://platform.lingyiwanwu.com/apikeys',
    },
    branding: { icon: '🌿' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://api.lingyiwanwu.com/v1',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
  }),
  preset({
    id: 'zhipu',
    metadata: {
      displayName: '智谱 GLM',
      docsUrl: 'https://docs.bigmodel.cn',
      apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    },
    branding: { icon: '🔷' },
    endpoints: [
      {
        protocol: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        providerType: 'openai_compatible',
      },
    ],
    authStrategies: {
      default: 'pat',
      available: ['pat'],
    } as ProviderDescriptorAuthStrategies,
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
