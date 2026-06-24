import { randomBytes } from 'node:crypto';

const PREFIXES = {
  admin: 'adm',
  app: 'app',
  consumerKey: 'ck',
  consumerKeyAccess: 'cka',
  upstreamKey: 'uk',
  upstreamKeyQuota: 'ukq',
  upstreamKeyCounter: 'ukc',
  upstreamEndpointHealth: 'ueh',
  publicModel: 'pm',
  publicModelCandidate: 'pmc',
  modelGroup: 'mg',
  modelGroupMember: 'mgm',
  providerPreset: 'pp',
  pricingEntry: 'pe',
  plan: 'plan',
  backup: 'bak',
  stickyBinding: 'sb',
  stickySession: 'ss',
  session: 'sess',
  usageRecord: 'usr',
  auditEvent: 'ae',
  loginAttempt: 'la',
  trace: 'tr',
  circuitBreaker: 'cb',
  contentLog: 'cl',
  modelReference: 'mr',
} as const;

export type IdKind = keyof typeof PREFIXES;

export function generateId(kind: IdKind, byteLength = 16): string {
  return `${PREFIXES[kind]}_${randomBytes(byteLength).toString('base64url')}`;
}
