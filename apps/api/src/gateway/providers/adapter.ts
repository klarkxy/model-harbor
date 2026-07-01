import type { ChatRequestIR, NormalizedChatResponse, SourceProtocol } from '@manageyourllm/shared';
import type { NormalizedError } from '@manageyourllm/shared';
import type { ProviderAccountRow } from '../../infrastructure/db/schema.js';

export interface BuildRequestContext {
  providerAccount: ProviderAccountRow;
  endpointUrl: string;
  endpointProtocol: SourceProtocol;
  endpointPath: string | null;
  realModelName: string;
  ir: ChatRequestIR;
  authHeaders: Record<string, string>;
}

export interface NormalizeResponseContext {
  providerAccount: ProviderAccountRow;
  realModelName: string;
  sourceProtocol: SourceProtocol;
  endpointProtocol: SourceProtocol;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface NormalizeErrorContext {
  providerAccount: ProviderAccountRow;
  realModelName: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ProviderAdapter {
  buildRequest(ctx: BuildRequestContext): ProviderHttpRequest;
  normalizeResponse(ctx: NormalizeResponseContext): NormalizedChatResponse;
  normalizeError(ctx: NormalizeErrorContext): NormalizedError;
  supportsStreaming(sourceProtocol: SourceProtocol, endpointProtocol: SourceProtocol): boolean;
}
