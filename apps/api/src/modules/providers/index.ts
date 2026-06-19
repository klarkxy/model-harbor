export * from './types.js';
export * from './errors.js';
export * from './anthropic-compatible.js';
export * from './openai-compatible.js';
export * from './coze.js';
export * from './codex-adapter.js';
export * from './registry.js';
export * from './ir-converters.js';
export { providerGuideUrl } from './guide-url.js';

import type { ProviderType } from '@modelharbor/shared';
import type {
  ProviderAdapter,
  ProviderHttpRequest,
  ProviderModule,
  ProviderPreset,
  ProviderRequestContext,
  ModelMapping,
} from './types.js';
import { getAdapter } from './registry.js';

import openai from './openai.js';
import anthropic from './anthropic.js';
import agnesAi from './agnes-ai.js';
import deepseek from './deepseek.js';
import moonshot from './moonshot.js';
import minimaxIntl from './minimax-intl.js';
import openrouter from './openrouter.js';
import opencodeGo from './opencode-go.js';
import opencodeZen from './opencode-zen.js';
import groq from './groq.js';
import together from './together.js';
import cerebras from './cerebras.js';
import fireworks from './fireworks.js';
import xai from './xai.js';
import qwen from './qwen.js';
import qwenIntl from './qwen-intl.js';
import zhipu from './zhipu.js';
import zhipuCoding from './zhipu-coding.js';
import moonshotCn from './moonshot-cn.js';
import minimax from './minimax.js';
import siliconflow from './siliconflow.js';
import baichuan from './baichuan.js';
import bytedance from './bytedance.js';
import hunyuan from './hunyuan.js';
import qianfan from './qianfan.js';
import stepfun from './stepfun.js';
import kimiCode from './kimi-code.js';
import coze from './coze-preset.js';
import codex from './codex.js';

const MODULES: readonly ProviderModule[] = [
  openai,
  anthropic,
  agnesAi,
  deepseek,
  moonshot,
  minimaxIntl,
  openrouter,
  opencodeGo,
  opencodeZen,
  groq,
  together,
  cerebras,
  fireworks,
  xai,
  qwen,
  qwenIntl,
  zhipu,
  zhipuCoding,
  moonshotCn,
  minimax,
  siliconflow,
  baichuan,
  bytedance,
  hunyuan,
  qianfan,
  stepfun,
  kimiCode,
  coze,
  codex,
].sort((a, b) => a.preset.name.localeCompare(b.preset.name));

const MODULES_BY_ID: Readonly<Record<string, ProviderModule>> = Object.fromEntries(
  MODULES.map((m) => [m.id, m]),
);

export function getProviderModule(id: string): ProviderModule | undefined {
  return MODULES_BY_ID[id];
}

export function listProviderModules(): readonly ProviderModule[] {
  return MODULES;
}

export function getProviderPreset(id: string) {
  return getProviderModule(id)?.preset;
}

export function listProviderPresets() {
  return MODULES.map((m) => m.preset);
}

export function getModelMappings(_preset: ProviderPreset): ModelMapping[] {
  return [];
}

function wrapAdapter(module: ProviderModule, base: ProviderAdapter): ProviderAdapter {
  const transform = module.transformRequest;
  if (!transform) return base;
  return {
    get type() {
      return base.type;
    },
    get capabilities() {
      return base.capabilities;
    },
    buildRequest(context: ProviderRequestContext): ProviderHttpRequest {
      const req = base.buildRequest(context);
      return transform(context, req);
    },
    normalizeResponse(context) {
      return base.normalizeResponse(context);
    },
    normalizeStreamEvent(context) {
      return base.normalizeStreamEvent(context);
    },
    normalizeError(context) {
      return base.normalizeError(context);
    },
    extractUsage(context) {
      return base.extractUsage(context);
    },
  };
}

export function getProviderAdapter(candidate: {
  providerType: ProviderType;
  providerPresetId: string | null;
}): ProviderAdapter {
  const module = candidate.providerPresetId
    ? getProviderModule(candidate.providerPresetId)
    : undefined;
  const base = module?.createAdapter ? module.createAdapter() : getAdapter(candidate.providerType);
  return module ? wrapAdapter(module, base) : base;
}
