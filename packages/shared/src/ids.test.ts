import { describe, it, expect } from 'vitest';
import { generateId, type IdKind } from './ids.js';

describe('generateId', () => {
  const cases: [IdKind, string][] = [
    ['admin', 'adm_'],
    ['app', 'app_'],
    ['consumerKey', 'ck_'],
    ['providerAccount', 'pa_'],
    ['providerAccountQuota', 'paq_'],
    ['providerAccountCounter', 'pac_'],
    ['endpoint', 'ep_'],
    ['model', 'mdl_'],
    ['modelCandidate', 'mdlc_'],
    ['channel', 'chn_'],
    ['channelMember', 'chnm_'],
    ['stickyBinding', 'sb_'],
    ['stickySession', 'ss_'],
    ['session', 'sess_'],
    ['usageRecord', 'usr_'],
    ['auditEvent', 'ae_'],
    ['trace', 'tr_'],
    ['circuitBreaker', 'cb_'],
    ['contentLog', 'cl_'],
    ['modelReference', 'mr_'],
  ];

  it.each(cases)('%s starts with %s', (kind, prefix) => {
    expect(generateId(kind).startsWith(prefix)).toBe(true);
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('client')));
    expect(ids.size).toBe(100);
  });
});
