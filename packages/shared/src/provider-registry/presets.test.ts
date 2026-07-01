import { describe, it, expect } from 'vitest';
import { listProviderDescriptors, getProviderDescriptor } from './presets.js';

describe('provider presets', () => {
  it('includes domestic official providers', () => {
    const ids = listProviderDescriptors().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'zhipu',
        'qwen',
        'stepfun',
        'doubao',
        'baichuan',
        'yi',
        'spark',
        'sensenova',
        'hunyuan',
        'siliconflow',
        'modelscope',
        'moonshot',
        'moonshot_cn',
        'minimax',
        'minimax_cn',
        'deepseek',
      ]),
    );
  });

  it('uses Chinese display names and emoji icons for built-in presets', () => {
    for (const preset of listProviderDescriptors()) {
      expect(preset.metadata.displayName.length).toBeGreaterThan(0);
      expect(preset.branding?.icon?.length).toBeGreaterThan(0);
    }
    expect(getProviderDescriptor('zhipu')?.metadata.displayName).toBe('智谱 GLM');
    expect(getProviderDescriptor('qwen')?.metadata.displayName).toBe('阿里百炼 / 通义千问');
  });

  it('keeps only OpenCode Go/Zen as multi-endpoint presets', () => {
    const multi = listProviderDescriptors().filter((p) => p.endpoints.length > 1);
    expect(multi.map((p) => p.id).sort()).toEqual(['opencode_go', 'opencode_zen'].sort());
  });

  it('uses official single endpoint for common providers', () => {
    expect(getProviderDescriptor('deepseek')?.endpoints).toEqual([
      expect.objectContaining({
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        providerType: 'openai_compatible',
      }),
    ]);
    expect(getProviderDescriptor('zhipu')?.endpoints).toEqual([
      expect.objectContaining({
        protocol: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        providerType: 'openai_compatible',
      }),
    ]);
    expect(getProviderDescriptor('qwen')?.endpoints).toEqual([
      expect.objectContaining({
        protocol: 'openai',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        providerType: 'openai_compatible',
      }),
    ]);
    expect(getProviderDescriptor('moonshot_cn')?.endpoints).toEqual([
      expect.objectContaining({
        protocol: 'openai',
        baseUrl: 'https://api.moonshot.cn/v1',
        providerType: 'openai_compatible',
      }),
    ]);
  });

  it('does not maintain model examples or guide urls', () => {
    for (const preset of listProviderDescriptors()) {
      expect(preset.modelExamples).toBeUndefined();
      expect(preset.guideUrl).toBeUndefined();
      expect(preset.defaultModel).toBeUndefined();
    }
  });

  it('exposes OpenCode Go as a dual-protocol endpoint', () => {
    const opencode = getProviderDescriptor('opencode_go');
    expect(opencode).toBeDefined();
    expect(opencode!.endpoints).toHaveLength(2);
    expect(opencode!.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: 'openai',
          baseUrl: 'https://opencode.ai/zen/go',
          providerType: 'openai_compatible',
        }),
        expect.objectContaining({
          protocol: 'anthropic',
          baseUrl: 'https://opencode.ai/zen/go',
          providerType: 'anthropic_compatible',
        }),
      ]),
    );
  });

  it('exposes OpenCode Zen as a triple-protocol endpoint excluding Gemini', () => {
    const opencodeZen = getProviderDescriptor('opencode_zen');
    expect(opencodeZen).toBeDefined();
    expect(opencodeZen!.endpoints).toHaveLength(3);
    expect(opencodeZen!.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: 'codex',
          baseUrl: 'https://opencode.ai/zen',
          providerType: 'codex',
        }),
        expect.objectContaining({
          protocol: 'anthropic',
          baseUrl: 'https://opencode.ai/zen',
          providerType: 'anthropic_compatible',
        }),
        expect.objectContaining({
          protocol: 'openai',
          baseUrl: 'https://opencode.ai/zen',
          providerType: 'openai_compatible',
        }),
      ]),
    );
  });
});
