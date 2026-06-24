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

function bytesToBase64Url(bytes: Uint8Array): string {
  // 使用 Web Crypto 的 getRandomValues，兼容浏览器和 Node 22+ 的 globalThis.crypto。
  const binString = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const base64 = btoa(binString);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateId(kind: IdKind, byteLength = 16): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  return `${PREFIXES[kind]}_${bytesToBase64Url(bytes)}`;
}
