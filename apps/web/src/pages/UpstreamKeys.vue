<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  NButton,
  NCard,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NList,
  NListItem,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  NPopconfirm,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  providerPresetsApi,
  upstreamEndpointHealthApi,
  upstreamKeysApi,
  type DiscoverModelsPayload,
  type OAuthInitPayload,
  type ProviderPreset,
  type UpstreamEndpointHealth,
  type UpstreamKey,
  type UpstreamKeyCandidate,
  type UpstreamKeyCreatePayload,
  type UpstreamKeyPingResult,
} from '../api/admin.js';
import ModelMappingEditor, { type ModelMappingItem } from '../components/ModelMappingEditor.vue';
import KeyValueEditor, { type KeyValueItem } from '../components/KeyValueEditor.vue';

const router = useRouter();
const message = useMessage();
const { t } = useI18n();

const items = ref<UpstreamKey[]>([]);
const loading = ref(false);
const drawerOpen = ref(false);
const submitting = ref(false);
const editingId = ref<string | null>(null);
const isEdit = computed(() => Boolean(editingId.value));

const presets = ref<ProviderPreset[]>([]);
const presetsLoading = ref(false);
const selectedPresetId = ref<string | null>(null);

const form = ref<UpstreamKeyCreatePayload>({
  name: '',
  providerType: 'anthropic_compatible',
  baseUrl: '',
  apiKey: '',
});
const authType = ref<string>('pat');
const cozeAuthConfig = ref({
  appId: '',
  kid: '',
  privateKey: '',
  durationSeconds: 900,
});
const cozePkceConfig = ref({
  clientId: '',
  redirectUri: `${window.location.origin}/oauth/callback`,
});
const codexAuthConfig = ref({
  refreshToken: '',
  clientId: '',
  tokenUrl: '',
  // OpenAI's public Codex OAuth app is registered to this fixed redirect URI.
  redirectUri: 'http://localhost:1455/auth/callback',
});
const oauthInProgress = ref(false);
const workspaceId = ref('');
const modelMappings = ref<ModelMappingItem[]>([]);
const extraHeaders = ref<KeyValueItem[]>([]);
const extraParams = ref<KeyValueItem[]>([]);
const fetchingModels = ref(false);
const togglingIds = ref<Set<string>>(new Set());
const endpointHealthRows = ref<UpstreamEndpointHealth[]>([]);

const pingOpen = ref(false);
const pingKey = ref<UpstreamKey | null>(null);
const pingCandidates = ref<UpstreamKeyCandidate[]>([]);
const pingLoading = ref<Set<string>>(new Set());
const pingResults = ref<Record<string, UpstreamKeyPingResult>>({});

const healthOpen = ref(false);
const healthKey = ref<UpstreamKey | null>(null);
const healthRows = ref<UpstreamEndpointHealth[]>([]);
const healthLoading = ref(false);

function resetForm() {
  form.value = {
    name: '',
    providerType: 'anthropic_compatible',
    baseUrl: '',
    apiKey: '',
  };
  authType.value = 'pat';
  cozeAuthConfig.value = {
    appId: '',
    kid: '',
    privateKey: '',
    durationSeconds: 900,
  };
  cozePkceConfig.value = {
    clientId: '',
    redirectUri: `${window.location.origin}/oauth/callback`,
  };
  codexAuthConfig.value = {
    refreshToken: '',
    clientId: '',
    tokenUrl: '',
    redirectUri: 'http://localhost:1455/auth/callback',
  };
  workspaceId.value = '';
  selectedPresetId.value = null;
  modelMappings.value = [];
  extraHeaders.value = [];
  extraParams.value = [];
  editingId.value = null;
}

async function refresh() {
  loading.value = true;
  presetsLoading.value = true;
  try {
    const [keysRes, presetsRes, healthRes] = await Promise.all([
      upstreamKeysApi.list(),
      providerPresetsApi.list(),
      upstreamEndpointHealthApi.list(),
    ]);
    items.value = keysRes.items;
    presets.value = presetsRes.items;
    endpointHealthRows.value = healthRes.items;
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    loading.value = false;
    presetsLoading.value = false;
  }
}

onMounted(refresh);

function openCreate() {
  resetForm();
  drawerOpen.value = true;
}

async function openEdit(row: UpstreamKey) {
  resetForm();
  editingId.value = row.id;
  form.value.name = row.name;
  form.value.providerType = row.providerType;
  form.value.baseUrl = row.baseUrl;
  form.value.apiKey = '';
  authType.value = row.authType ?? 'pat';
  selectedPresetId.value = row.providerPresetId;
  extraHeaders.value = Object.entries(row.extraHeaders ?? {}).map(([key, value]) => ({
    key,
    value: String(value),
    enabled: true,
  }));
  extraParams.value = Object.entries(row.extraParams ?? {}).map(([key, value]) => ({
    key,
    value: JSON.stringify(value),
    enabled: true,
  }));
  try {
    const res = await upstreamKeysApi.getCandidates(row.id);
    modelMappings.value = res.items.map((c) => ({
      realName: c.realName,
      publicName: c.publicName === c.realName ? '' : c.publicName,
      enabled: c.enabled,
    }));
  } catch (err) {
    message.error((err as Error).message);
  }
  drawerOpen.value = true;
}

async function onSubmit() {
  const isPreset = Boolean(selectedPresetId.value);
  const needsApiKey = authType.value === 'pat' && !isEdit.value;
  const needsCozeAuthConfig = authType.value === 'coze_oauth_jwt' && !isEdit.value;
  if (
    !form.value.name ||
    (needsApiKey && !form.value.apiKey) ||
    (needsCozeAuthConfig &&
      (!cozeAuthConfig.value.appId.trim() ||
        !cozeAuthConfig.value.kid.trim() ||
        !cozeAuthConfig.value.privateKey.trim())) ||
    (!isPreset && !form.value.baseUrl)
  ) {
    message.error(t('upstreamKeys.validation.required'));
    return;
  }
  const activeMappings = modelMappings.value.filter((m) => m.enabled && m.realName.trim() !== '');
  if (activeMappings.length === 0) {
    message.error(t('upstreamKeys.validation.modelMappings'));
    return;
  }

  // Browser-based OAuth flows create the key after the provider redirects back.
  const codexBrowserMode =
    authType.value === 'codex_oauth' && !isEdit.value && !codexAuthConfig.value.refreshToken.trim();
  const cozePkceBrowserMode = authType.value === 'coze_oauth_pkce' && !isEdit.value;
  if (codexBrowserMode || cozePkceBrowserMode) {
    await startOAuth();
    return;
  }

  submitting.value = true;
  try {
    const mappings = activeMappings.map((m) => ({
      realName: m.realName.trim(),
      publicName: m.publicName.trim() || m.realName.trim(),
      enabled: m.enabled,
    }));
    const headersPayload: Record<string, string> = {};
    for (const h of extraHeaders.value) {
      if (h.enabled && h.key.trim()) headersPayload[h.key.trim()] = h.value;
    }
    const paramsPayload: Record<string, unknown> = {};
    for (const p of extraParams.value) {
      if (p.enabled && p.key.trim()) {
        try {
          paramsPayload[p.key.trim()] = JSON.parse(p.value);
        } catch {
          paramsPayload[p.key.trim()] = p.value;
        }
      }
    }

    if (isEdit.value) {
      const id = editingId.value!;
      const updates: Parameters<typeof upstreamKeysApi.update>[1] = {
        name: form.value.name,
        extraHeaders: headersPayload,
        extraParams: paramsPayload,
      };
      if (!isPreset) {
        updates.providerType = form.value.providerType;
        updates.baseUrl = form.value.baseUrl;
      }
      if (
        authType.value !== 'pat' ||
        cozeAuthConfig.value.appId.trim() ||
        codexAuthConfig.value.refreshToken.trim()
      ) {
        updates.authType = authType.value as UpstreamKeyCreatePayload['authType'];
        if (authType.value === 'coze_oauth_jwt' && cozeAuthConfig.value.privateKey.trim()) {
          updates.authConfig = {
            appId: cozeAuthConfig.value.appId.trim(),
            kid: cozeAuthConfig.value.kid.trim(),
            privateKey: cozeAuthConfig.value.privateKey.trim(),
            durationSeconds: cozeAuthConfig.value.durationSeconds,
          };
        }
        if (authType.value === 'codex_oauth' && codexAuthConfig.value.refreshToken.trim()) {
          const cfg: Record<string, unknown> = {
            refreshToken: codexAuthConfig.value.refreshToken.trim(),
          };
          if (codexAuthConfig.value.clientId.trim()) {
            cfg.clientId = codexAuthConfig.value.clientId.trim();
          }
          if (codexAuthConfig.value.tokenUrl.trim()) {
            cfg.tokenUrl = codexAuthConfig.value.tokenUrl.trim();
          }
          updates.authConfig = cfg;
        }
      }
      await upstreamKeysApi.update(id, updates);
      if (form.value.apiKey) {
        await upstreamKeysApi.rotateSecret(id, form.value.apiKey);
      }
      await upstreamKeysApi.setCandidates(id, mappings);
      await refresh();
      drawerOpen.value = false;
      message.success(t('upstreamKeys.toast.updated'));
    } else {
      const payload: UpstreamKeyCreatePayload = {
        name: form.value.name,
        modelMappings: mappings,
        extraHeaders: headersPayload,
        extraParams: paramsPayload,
      };
      if (isPreset) {
        payload.providerPresetId = selectedPresetId.value!;
      } else {
        payload.providerType = form.value.providerType;
        payload.baseUrl = form.value.baseUrl;
      }
      payload.authType = authType.value as UpstreamKeyCreatePayload['authType'];
      if (authType.value === 'pat') {
        payload.apiKey = form.value.apiKey;
      } else if (authType.value === 'coze_oauth_jwt') {
        payload.authConfig = {
          appId: cozeAuthConfig.value.appId.trim(),
          kid: cozeAuthConfig.value.kid.trim(),
          privateKey: cozeAuthConfig.value.privateKey.trim(),
          durationSeconds: cozeAuthConfig.value.durationSeconds,
        };
      } else if (authType.value === 'codex_oauth') {
        const cfg: Record<string, unknown> = {
          refreshToken: codexAuthConfig.value.refreshToken.trim(),
        };
        if (codexAuthConfig.value.clientId.trim()) {
          cfg.clientId = codexAuthConfig.value.clientId.trim();
        }
        if (codexAuthConfig.value.tokenUrl.trim()) {
          cfg.tokenUrl = codexAuthConfig.value.tokenUrl.trim();
        }
        payload.authConfig = cfg;
      }
      const created = await upstreamKeysApi.create(payload);
      items.value = [created, ...items.value];
      drawerOpen.value = false;
      message.success(t('upstreamKeys.toast.created'));
    }
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function startOAuth() {
  const isPreset = Boolean(selectedPresetId.value);
  if (!form.value.name || (!isPreset && !form.value.baseUrl)) {
    message.error(t('upstreamKeys.validation.required'));
    return;
  }
  // Browser-based OAuth flows do not require the admin to pre-fill model
  // mappings. The available models are discovered automatically after the
  // provider returns a refresh token.
  const activeMappings = modelMappings.value.filter((m) => m.enabled && m.realName.trim() !== '');

  if (authType.value === 'coze_oauth_pkce') {
    if (!cozePkceConfig.value.clientId.trim() || !workspaceId.value.trim()) {
      message.error(t('upstreamKeys.validation.required'));
      return;
    }
  }

  oauthInProgress.value = true;
  try {
    const mappings = activeMappings.map((m) => ({
      realName: m.realName.trim(),
      publicName: m.publicName.trim() || m.realName.trim(),
      enabled: m.enabled,
    }));
    const headersPayload: Record<string, string> = {};
    for (const h of extraHeaders.value) {
      if (h.enabled && h.key.trim()) headersPayload[h.key.trim()] = h.value;
    }
    const paramsPayload: Record<string, unknown> = {};
    for (const p of extraParams.value) {
      if (p.enabled && p.key.trim()) {
        try {
          paramsPayload[p.key.trim()] = JSON.parse(p.value);
        } catch {
          paramsPayload[p.key.trim()] = p.value;
        }
      }
    }

    const draft: UpstreamKeyCreatePayload = {
      name: form.value.name,
      modelMappings: mappings,
      extraHeaders: headersPayload,
      extraParams: paramsPayload,
    };
    if (isPreset) {
      draft.providerPresetId = selectedPresetId.value!;
    } else {
      draft.providerType = form.value.providerType;
      draft.baseUrl = form.value.baseUrl;
    }
    draft.authType = authType.value as UpstreamKeyCreatePayload['authType'];

    let initPayload: import('../api/admin.js').OAuthInitPayload;
    if (authType.value === 'codex_oauth') {
      initPayload = {
        provider: 'codex',
        authType: 'codex_oauth',
        clientId: codexAuthConfig.value.clientId.trim(),
        redirectUri: codexAuthConfig.value.redirectUri.trim(),
        ...(isEdit.value && editingId.value ? { upstreamKeyId: editingId.value } : { draft }),
      };
    } else {
      initPayload = {
        provider: 'coze',
        authType: 'coze_oauth_pkce',
        clientId: cozePkceConfig.value.clientId.trim(),
        redirectUri: cozePkceConfig.value.redirectUri.trim(),
        baseUrl: form.value.baseUrl?.trim() ?? '',
        workspaceId: workspaceId.value.trim() || undefined,
        ...(isEdit.value && editingId.value ? { upstreamKeyId: editingId.value } : { draft }),
      };
    }

    const { authorizationUrl } = await upstreamKeysApi.oauthInit(initPayload);
    window.open(authorizationUrl, '_blank');
    message.info(t('upstreamKeys.oauth.windowOpened'));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    oauthInProgress.value = false;
  }
}

async function toggleFreeze(row: UpstreamKey) {
  togglingIds.value = new Set(togglingIds.value).add(row.id);
  try {
    if (row.frozen) {
      const res = await upstreamKeysApi.unfreeze(row.id);
      message.success(
        res.frozen ? t('upstreamKeys.toast.frozen') : t('upstreamKeys.toast.unfrozen'),
      );
    } else {
      await upstreamKeysApi.freeze(row.id, 'manual freeze');
      message.success(t('upstreamKeys.toast.frozen'));
    }
    await refresh();
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    const next = new Set(togglingIds.value);
    next.delete(row.id);
    togglingIds.value = next;
  }
}

async function handleDelete(row: UpstreamKey) {
  try {
    await upstreamKeysApi.delete(row.id);
    message.success(t('upstreamKeys.toast.deleted'));
    await refresh();
  } catch (err) {
    message.error((err as Error).message);
  }
}

async function openPing(row: UpstreamKey) {
  pingKey.value = row;
  pingResults.value = {};
  pingLoading.value = new Set();
  pingOpen.value = true;
  await refreshPingCandidates(row.id);
}

async function refreshPingCandidates(id: string) {
  try {
    const res = await upstreamKeysApi.getCandidates(id);
    pingCandidates.value = res.items;
  } catch (err) {
    message.error((err as Error).message);
    pingCandidates.value = [];
  }
}

async function handlePing(id: string, realName: string) {
  pingLoading.value = new Set(pingLoading.value).add(realName);
  try {
    const res = await upstreamKeysApi.ping(id, { realModelName: realName });
    pingResults.value = { ...pingResults.value, [realName]: res };
    await refreshPingCandidates(id);
  } catch (err) {
    pingResults.value = {
      ...pingResults.value,
      [realName]: {
        ok: false,
        latencyMs: 0,
        error: { type: 'client_error', message: (err as Error).message },
      },
    };
  } finally {
    const next = new Set(pingLoading.value);
    next.delete(realName);
    pingLoading.value = next;
  }
}

async function handlePingAll() {
  const candidates = pingCandidates.value.filter((c) => c.enabled);
  for (const c of candidates) {
    await handlePing(pingKey.value!.id, c.realName);
  }
}

const pingCandidateRows = computed(() =>
  pingCandidates.value.map((c) => {
    const live = pingResults.value[c.realName];
    const stored: UpstreamKeyPingResult | undefined =
      c.lastPingAt && c.lastPingOk !== null
        ? {
            ok: c.lastPingOk,
            status: c.lastPingStatus ?? undefined,
            latencyMs: c.lastPingLatencyMs ?? 0,
            error: c.lastPingError ? { type: 'stored', message: c.lastPingError } : undefined,
          }
        : undefined;
    return {
      ...c,
      result: live ?? stored,
      resultTime: live ? undefined : c.lastPingAt,
    };
  }),
);

function formatLastPing(iso: string | null | undefined): string {
  if (!iso) return t('upstreamKeys.ping.never');
  return new Date(iso).toLocaleString();
}

function latencyTagType(latencyMs: number): 'success' | 'warning' | 'error' {
  if (latencyMs < 100) return 'success';
  if (latencyMs < 1000) return 'warning';
  return 'error';
}

function healthRowsForKey(keyId: string): UpstreamEndpointHealth[] {
  return endpointHealthRows.value.filter((h) => h.upstreamKeyId === keyId);
}

interface KeyHealthSummary {
  total: number;
  checked: number;
  degraded: number;
  bestDelayMs: number | null;
}

function summarizeKeyHealth(keyId: string): KeyHealthSummary {
  const rows = healthRowsForKey(keyId);
  let checked = 0;
  let degraded = 0;
  let bestDelayMs: number | null = null;
  for (const r of rows) {
    if (r.lastCheckedAt !== null) {
      checked += 1;
      if (r.degraded) {
        degraded += 1;
      } else if (r.delayMs !== null) {
        bestDelayMs = bestDelayMs === null ? r.delayMs : Math.min(bestDelayMs, r.delayMs);
      }
    }
  }
  return { total: rows.length, checked, degraded, bestDelayMs };
}

async function openHealth(row: UpstreamKey) {
  healthKey.value = row;
  healthOpen.value = true;
  healthLoading.value = true;
  try {
    const res = await upstreamEndpointHealthApi.list(row.id);
    healthRows.value = res.items;
  } catch (err) {
    message.error((err as Error).message);
    healthRows.value = [];
  } finally {
    healthLoading.value = false;
  }
}

const pingHealthRows = computed(() => (pingKey.value ? healthRowsForKey(pingKey.value.id) : []));

const healthColumns = computed<DataTableColumns<UpstreamEndpointHealth>>(() => [
  { title: t('upstreamKeys.health.endpoint'), key: 'endpointBaseUrl', ellipsis: { tooltip: true } },
  {
    title: t('upstreamKeys.health.latency'),
    key: 'delayMs',
    width: 110,
    render: (row) => {
      if (row.delayMs === null) return h(NText, { depth: 3, size: 'small' }, () => '—');
      return h(NTag, { type: latencyTagType(row.delayMs), size: 'small' }, () => `${row.delayMs} ms`);
    },
  },
  {
    title: t('upstreamKeys.health.status'),
    key: 'degraded',
    width: 110,
    render: (row) =>
      h(
        NTag,
        { type: row.degraded ? 'error' : 'success', size: 'small' },
        () => (row.degraded ? row.errorCode ?? t('upstreamKeys.health.degraded') : t('upstreamKeys.health.healthy')),
      ),
  },
  {
    title: t('upstreamKeys.health.lastChecked'),
    key: 'lastCheckedAt',
    width: 160,
    render: (row) =>
      h(NText, { depth: 3, size: 'small' }, () =>
        row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : '—',
      ),
  },
]);

const providerOptions = computed(() => [
  { label: t('upstreamKeys.drawer.providers.anthropic'), value: 'anthropic_compatible' },
  { label: t('upstreamKeys.drawer.providers.openai'), value: 'openai_compatible' },
  { label: t('upstreamKeys.drawer.providers.codex'), value: 'codex' },
]);

const authTypeOptions = computed(() => {
  const preset = selectedPreset.value;
  if (preset?.authStrategies?.available) {
    return preset.authStrategies.available.map((value) => {
      const labelKey =
        value === 'coze_oauth_jwt'
          ? 'cozeOauthJwt'
          : value === 'coze_oauth_pkce'
            ? 'cozeOauthPkce'
            : value === 'codex_oauth'
              ? 'codexOauth'
              : 'pat';
      return { label: t(`upstreamKeys.drawer.authType.${labelKey}`), value };
    });
  }
  if (form.value.providerType === 'codex') {
    return [
      { label: t('upstreamKeys.drawer.authType.pat'), value: 'pat' },
      { label: t('upstreamKeys.drawer.authType.codexOauth'), value: 'codex_oauth' },
    ];
  }
  return [{ label: t('upstreamKeys.drawer.authType.pat'), value: 'pat' }];
});

const presetOptions = computed(() => {
  const sorted = [...presets.value].sort((a, b) =>
    t(`providers.${a.id}`).localeCompare(t(`providers.${b.id}`)),
  );
  return [
    { label: t('upstreamKeys.drawer.preset.manual'), value: '' },
    ...sorted.map((p) => ({
      label: `${p.icon ? `${p.icon} ` : ''}${t(`providers.${p.id}`)}`,
      value: p.id,
    })),
  ];
});

const selectedPreset = computed(() => presets.value.find((p) => p.id === selectedPresetId.value));

function applyPreset(preset: ProviderPreset | undefined) {
  if (!preset) {
    selectedPresetId.value = null;
    if (!isEdit.value) {
      modelMappings.value = [];
    }
    return;
  }
  // Name follows the selected preset so the admin does not have to type it.
  if (!isEdit.value) {
    form.value.name = t(`providers.${preset.id}`);
  }
  // Use the preset's first endpoint as the recommended default.
  const endpoint = preset.endpoints[0];
  if (endpoint) {
    form.value.providerType = endpoint.providerType;
    form.value.baseUrl = endpoint.baseUrl;
  }
  // Use the preset's recommended authentication strategy (e.g. OAuth JWT for Coze).
  if (preset.authStrategies) {
    authType.value = preset.authStrategies.default;
  }
  // Never pre-fill hardcoded model mappings; the admin fetches from upstream.
  if (!isEdit.value) {
    modelMappings.value = [];
    extraHeaders.value = Object.entries(preset.defaultExtraHeaders ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
      enabled: true,
    }));
    extraParams.value = Object.entries(preset.defaultExtraParams ?? {}).map(([key, value]) => ({
      key,
      value: JSON.stringify(value),
      enabled: true,
    }));
  }
}

watch(selectedPresetId, (id) => {
  applyPreset(presets.value.find((p) => p.id === id));
});

const isCoze = computed(
  () => form.value.providerType === 'coze' || selectedPreset.value?.id === 'coze',
);

const isCodex = computed(
  () => form.value.providerType === 'codex' || selectedPreset.value?.id === 'codex',
);

const canFetchModels = computed(() => {
  if (!form.value.baseUrl?.trim()) return false;
  if (isCoze.value) {
    if (!workspaceId.value.trim()) return false;
    if (authType.value === 'pat') {
      return Boolean(form.value.apiKey?.trim() || isEdit.value);
    }
    if (authType.value === 'coze_oauth_pkce') {
      // A fresh PKCE key has no token until the browser flow completes.
      return isEdit.value;
    }
    return Boolean(
      cozeAuthConfig.value.appId.trim() &&
      cozeAuthConfig.value.kid.trim() &&
      cozeAuthConfig.value.privateKey.trim(),
    );
  }
  if (authType.value === 'codex_oauth') {
    return Boolean(codexAuthConfig.value.refreshToken.trim() || isEdit.value);
  }
  return Boolean(form.value.apiKey?.trim() || isEdit.value);
});

async function handleFetchModels() {
  if (!canFetchModels.value) {
    message.error(t('upstreamKeys.validation.required'));
    return;
  }
  fetchingModels.value = true;
  try {
    const payload: DiscoverModelsPayload = {
      baseUrl: form.value.baseUrl?.trim() ?? '',
      providerType: form.value.providerType ?? 'anthropic_compatible',
      providerPresetId: selectedPresetId.value || undefined,
      authType: authType.value as DiscoverModelsPayload['authType'],
    };
    if (isCoze.value) {
      payload.workspaceId = workspaceId.value.trim();
      if (authType.value === 'pat' && form.value.apiKey?.trim()) {
        payload.apiKey = form.value.apiKey.trim();
      } else if (authType.value === 'coze_oauth_jwt') {
        payload.authConfig = {
          appId: cozeAuthConfig.value.appId.trim(),
          kid: cozeAuthConfig.value.kid.trim(),
          privateKey: cozeAuthConfig.value.privateKey.trim(),
          durationSeconds: cozeAuthConfig.value.durationSeconds,
        };
      } else if (authType.value === 'coze_oauth_pkce') {
        if (isEdit.value && editingId.value) {
          payload.upstreamKeyId = editingId.value;
        }
      }
    } else if (authType.value === 'codex_oauth') {
      payload.authConfig = {
        refreshToken: codexAuthConfig.value.refreshToken.trim(),
        ...(codexAuthConfig.value.clientId.trim()
          ? { clientId: codexAuthConfig.value.clientId.trim() }
          : {}),
        ...(codexAuthConfig.value.tokenUrl.trim()
          ? { tokenUrl: codexAuthConfig.value.tokenUrl.trim() }
          : {}),
      };
    } else if (form.value.apiKey?.trim()) {
      payload.apiKey = form.value.apiKey.trim();
    } else if (isEdit.value && editingId.value) {
      payload.upstreamKeyId = editingId.value;
    }
    const result = await upstreamKeysApi.discoverModels(payload);
    const existing = new Map(modelMappings.value.map((m) => [m.realName.trim(), m]));
    let added = 0;
    for (const item of result.items) {
      const realName = item.realName.trim();
      if (!realName || existing.has(realName)) continue;
      const publicName = item.publicName.trim();
      modelMappings.value.push({
        realName,
        publicName: publicName === realName ? '' : publicName,
        enabled: true,
      });
      existing.set(realName, modelMappings.value[modelMappings.value.length - 1]!);
      added++;
    }
    message.success(t('upstreamKeys.drawer.modelMappings.fetchSuccess', { count: added }));
  } catch (err) {
    message.error((err as Error).message);
  } finally {
    fetchingModels.value = false;
  }
}

const columns = computed<DataTableColumns<UpstreamKey>>(() => [
  { title: t('upstreamKeys.columns.name'), key: 'name', fixed: 'left', width: 200 },
  {
    title: t('upstreamKeys.columns.provider'),
    key: 'providerType',
    width: 220,
    render: (row) => {
      const preset = presets.value.find((p) => p.id === row.providerPresetId);
      const label = preset ? t(`providers.${preset.id}`) : row.providerType;
      const icon = preset?.icon ?? '';
      return h(NTag, { type: 'info', size: 'small' }, () => `${icon ? `${icon} ` : ''}${label}`);
    },
  },
  { title: t('upstreamKeys.columns.baseUrl'), key: 'baseUrl', ellipsis: { tooltip: true } },
  {
    title: t('upstreamKeys.columns.models'),
    key: 'candidateCount',
    width: 80,
    render: (row) => String(row.candidateCount ?? 0),
  },
  {
    title: t('upstreamKeys.columns.status'),
    key: 'status',
    width: 100,
    render: (row) =>
      h(
        NSwitch,
        {
          size: 'small',
          value: !row.frozen,
          loading: togglingIds.value.has(row.id),
          'on-update:value': () => toggleFreeze(row),
        },
        {
          checked: () => t('upstreamKeys.status.unfrozen'),
          unchecked: () => t('upstreamKeys.status.frozen'),
        },
      ),
  },
  {
    title: t('upstreamKeys.columns.health'),
    key: 'health',
    width: 150,
    render: (row) => {
      const summary = summarizeKeyHealth(row.id);
      if (summary.checked === 0) {
        return h(NText, { depth: 3, size: 'small' }, () => '—');
      }
      if (summary.degraded > 0) {
        return h(
          NTag,
          { type: 'error', size: 'small' },
          () => t('upstreamKeys.health.degradedCount', { count: summary.degraded, total: summary.total }),
        );
      }
      const ms = summary.bestDelayMs ?? 0;
      const label =
        summary.total > 1
          ? t('upstreamKeys.health.bestLatency', { ms, total: summary.total })
          : t('upstreamKeys.health.latencyMs', { ms });
      return h(NTag, { type: latencyTagType(ms), size: 'small' }, () => label);
    },
  },
  {
    title: t('upstreamKeys.columns.actions'),
    key: 'actions',
    width: 280,
    render: (row) =>
      h(NSpace, { size: 'small', align: 'center' }, () => [
        h(NButton, { size: 'small', onClick: () => openPing(row) }, () =>
          t('upstreamKeys.actions.test'),
        ),
        h(NButton, { size: 'small', onClick: () => openHealth(row) }, () =>
          t('upstreamKeys.actions.health'),
        ),
        h(NButton, { size: 'small', onClick: () => openEdit(row) }, () =>
          t('upstreamKeys.actions.edit'),
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => handleDelete(row) },
          {
            trigger: () =>
              h(NButton, { size: 'small', type: 'error' }, () => t('upstreamKeys.actions.delete')),
            default: () => t('upstreamKeys.confirm.delete'),
          },
        ),
      ]),
  },
]);
</script>

<template>
  <div class="page">
    <NCard>
      <NSpace align="center" justify="space-between" style="margin-bottom: 16px">
        <NText strong>{{ t('upstreamKeys.title') }}</NText>
        <NButton type="primary" @click="openCreate">{{ t('upstreamKeys.new') }}</NButton>
      </NSpace>

      <NDataTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :bordered="false"
        :single-line="false"
        :row-key="(row) => row.id"
        :empty="h(NEmpty, { description: t('upstreamKeys.empty') })"
      />
    </NCard>

    <NDrawer v-model:show="drawerOpen" :width="480">
      <NDrawerContent
        :title="isEdit ? t('upstreamKeys.drawer.editTitle') : t('upstreamKeys.drawer.title')"
        closable
      >
        <NForm label-placement="top">
          <NFormItem :label="t('upstreamKeys.drawer.preset.label')">
            <NSelect
              v-model:value="selectedPresetId"
              :options="presetOptions"
              :loading="presetsLoading"
              :placeholder="t('upstreamKeys.drawer.preset.placeholder')"
              :disabled="isEdit"
              clearable
            />
          </NFormItem>
          <NSpace
            v-if="selectedPreset?.guideUrl"
            align="center"
            :size="4"
            style="margin-top: -12px; margin-bottom: 12px"
          >
            <NText depth="3" style="font-size: 12px">
              {{ t('upstreamKeys.drawer.preset.guideLinkHint') }}
            </NText>
            <a
              :href="selectedPreset.guideUrl"
              target="_blank"
              rel="noopener noreferrer"
              style="font-size: 12px"
              >{{ t('upstreamKeys.drawer.preset.guideLink') }} ↗</a
            >
          </NSpace>
          <NFormItem :label="t('upstreamKeys.drawer.name')" required>
            <NInput
              v-model:value="form.name"
              :placeholder="t('upstreamKeys.drawer.placeholders.name')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.provider')" required>
            <NSelect
              v-model:value="form.providerType"
              :options="providerOptions"
              :disabled="Boolean(selectedPreset)"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.baseUrl')" required>
            <NInput
              v-model:value="form.baseUrl"
              :placeholder="t('upstreamKeys.drawer.placeholders.baseUrl')"
              :disabled="Boolean(selectedPreset)"
            />
          </NFormItem>
          <NFormItem
            v-if="authTypeOptions.length > 1"
            :label="t('upstreamKeys.drawer.authType.label')"
          >
            <NSelect v-model:value="authType" :options="authTypeOptions" :disabled="isEdit" />
          </NFormItem>
          <template v-if="authType === 'coze_oauth_jwt'">
            <NFormItem :label="t('upstreamKeys.drawer.coze.appId')" required>
              <NInput v-model:value="cozeAuthConfig.appId" />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.coze.kid')" required>
              <NInput v-model:value="cozeAuthConfig.kid" />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.coze.privateKey')" required>
              <NInput
                v-model:value="cozeAuthConfig.privateKey"
                type="textarea"
                :rows="6"
                :placeholder="t('upstreamKeys.drawer.placeholders.privateKey')"
              />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.coze.durationSeconds')">
              <NInputNumber
                v-model:value="cozeAuthConfig.durationSeconds"
                :min="1"
                :max="86399"
                style="width: 100%"
              />
            </NFormItem>
          </template>
          <template v-else-if="authType === 'coze_oauth_pkce'">
            <NFormItem :label="t('upstreamKeys.drawer.cozePkce.clientId')" required>
              <NInput
                v-model:value="cozePkceConfig.clientId"
                :placeholder="t('upstreamKeys.drawer.placeholders.cozeClientId')"
              />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.cozePkce.redirectUri')" required>
              <NInput v-model:value="cozePkceConfig.redirectUri" />
            </NFormItem>
            <NFormItem>
              <NSpace vertical>
                <NButton type="primary" :loading="oauthInProgress" @click="startOAuth">
                  {{
                    isEdit ? t('upstreamKeys.oauth.reauthorize') : t('upstreamKeys.oauth.authorize')
                  }}
                </NButton>
                <NText depth="3" style="font-size: 12px">
                  {{ t('upstreamKeys.oauth.cozeHint') }}
                </NText>
              </NSpace>
            </NFormItem>
          </template>
          <template v-else-if="authType === 'codex_oauth'">
            <NFormItem>
              <NSpace vertical>
                <NButton type="primary" :loading="oauthInProgress" @click="startOAuth">
                  {{
                    isEdit ? t('upstreamKeys.oauth.reauthorize') : t('upstreamKeys.oauth.authorize')
                  }}
                </NButton>
                <NText depth="3" style="font-size: 12px">
                  {{ t('upstreamKeys.oauth.codexHint') }}
                </NText>
              </NSpace>
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.codex.redirectUri')">
              <NInput v-model:value="codexAuthConfig.redirectUri" />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.codex.refreshToken')">
              <NInput
                v-model:value="codexAuthConfig.refreshToken"
                type="password"
                show-password-on="click"
                :placeholder="t('upstreamKeys.drawer.placeholders.refreshToken')"
              />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.codex.clientId')">
              <NInput
                v-model:value="codexAuthConfig.clientId"
                :placeholder="t('upstreamKeys.drawer.placeholders.clientId')"
              />
            </NFormItem>
            <NFormItem :label="t('upstreamKeys.drawer.codex.tokenUrl')">
              <NInput
                v-model:value="codexAuthConfig.tokenUrl"
                :placeholder="t('upstreamKeys.drawer.placeholders.tokenUrl')"
              />
            </NFormItem>
          </template>
          <template v-else>
            <NFormItem :label="t('upstreamKeys.drawer.apiKey')" :required="!isEdit">
              <NInput
                v-model:value="form.apiKey"
                type="password"
                show-password-on="click"
                :placeholder="
                  isEdit
                    ? t('upstreamKeys.drawer.placeholders.apiKeyEdit')
                    : t('upstreamKeys.drawer.placeholders.apiKey')
                "
              />
            </NFormItem>
          </template>
          <template v-if="isCoze">
            <NFormItem :label="t('upstreamKeys.drawer.workspaceId')" required>
              <NInput
                v-model:value="workspaceId"
                :placeholder="t('upstreamKeys.drawer.placeholders.workspaceId')"
              />
            </NFormItem>
            <NText
              depth="3"
              style="font-size: 12px; display: block; margin-top: -12px; margin-bottom: 8px"
            >
              {{ t('upstreamKeys.drawer.coze.guide') }}
            </NText>
          </template>
          <NFormItem :label="t('upstreamKeys.drawer.extraHeaders.label')">
            <KeyValueEditor
              v-model="extraHeaders"
              :key-placeholder="t('upstreamKeys.drawer.extraHeaders.key')"
              :value-placeholder="t('upstreamKeys.drawer.extraHeaders.value')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.extraParams.label')">
            <KeyValueEditor
              v-model="extraParams"
              :key-placeholder="t('upstreamKeys.drawer.extraParams.key')"
              :value-placeholder="t('upstreamKeys.drawer.extraParams.value')"
            />
          </NFormItem>
          <NFormItem :label="t('upstreamKeys.drawer.modelMappings.label')" required>
            <NSpace vertical style="width: 100%">
              <NButton
                size="small"
                :disabled="!canFetchModels || fetchingModels"
                :loading="fetchingModels"
                @click="handleFetchModels"
              >
                {{
                  fetchingModels
                    ? t('upstreamKeys.drawer.modelMappings.fetching')
                    : t('upstreamKeys.drawer.modelMappings.fetch')
                }}
              </NButton>
              <ModelMappingEditor v-model="modelMappings" />
            </NSpace>
          </NFormItem>
        </NForm>
        <template #footer>
          <NSpace justify="end">
            <NButton @click="drawerOpen = false">{{ t('common.cancel') }}</NButton>
            <NButton
              v-if="authType === 'codex_oauth' || authType === 'coze_oauth_pkce'"
              :loading="oauthInProgress"
              @click="startOAuth"
            >
              {{ isEdit ? t('upstreamKeys.oauth.reauthorize') : t('upstreamKeys.oauth.authorize') }}
            </NButton>
            <NButton type="primary" :loading="submitting" @click="onSubmit">{{
              isEdit ? t('common.save') : t('common.create')
            }}</NButton>
          </NSpace>
        </template>
      </NDrawerContent>
    </NDrawer>

    <NModal
      v-model:show="pingOpen"
      preset="card"
      style="max-width: 640px"
      :title="t('upstreamKeys.ping.title', { name: pingKey?.name ?? '' })"
      @update:show="(v: boolean) => (pingOpen = v)"
    >
      <NSpace vertical>
        <NText depth="3">{{ pingKey?.baseUrl }}</NText>
        <NSpace v-if="pingHealthRows.length > 0" vertical size="small" style="width: 100%">
          <NText depth="3" style="font-size: 12px">{{ t('upstreamKeys.ping.endpointHealthTitle') }}</NText>
          <NList bordered size="small">
            <NListItem v-for="h in pingHealthRows" :key="h.id">
              <NSpace align="center" justify="space-between" style="width: 100%">
                <NText style="font-size: 12px">{{ h.endpointBaseUrl }}</NText>
                <NSpace align="center" :size="4">
                  <NTag
                    v-if="h.delayMs !== null"
                    :type="latencyTagType(h.delayMs)"
                    size="small"
                  >{{ h.delayMs }} ms</NTag>
                  <NTag v-else type="warning" size="small">—</NTag>
                  <NTag :type="h.degraded ? 'error' : 'success'" size="small">
                    {{ h.degraded ? t('upstreamKeys.health.degraded') : t('upstreamKeys.health.healthy') }}
                  </NTag>
                  <NText depth="3" style="font-size: 11px">
                    {{ h.lastCheckedAt ? new Date(h.lastCheckedAt).toLocaleString() : '' }}
                  </NText>
                </NSpace>
              </NSpace>
            </NListItem>
          </NList>
        </NSpace>
        <NSpace>
          <NButton size="small" :loading="pingLoading.size > 0" @click="handlePingAll">
            {{ t('upstreamKeys.ping.pingAll') }}
          </NButton>
        </NSpace>
        <NList bordered>
          <NListItem v-for="c in pingCandidateRows" :key="c.id">
            <NSpace align="center" justify="space-between" style="width: 100%">
              <NSpace vertical :size="0">
                <NText strong>{{ c.publicName }}</NText>
                <NText depth="3" style="font-size: 12px">{{ c.realName }}</NText>
              </NSpace>
              <NSpace align="center">
                <NSpin v-if="pingLoading.has(c.realName)" size="small" />
                <template v-else-if="c.result">
                  <NSpace vertical :size="0" align="end">
                    <NTag
                      v-if="c.result.ok"
                      :type="latencyTagType(c.result.latencyMs)"
                      size="small"
                      >{{ t('upstreamKeys.ping.success', { ms: c.result.latencyMs }) }}</NTag
                    >
                    <NTag v-else type="error" size="small">{{
                      t('upstreamKeys.ping.failed')
                    }}</NTag>
                    <NText depth="3" style="font-size: 11px">
                      {{ t('upstreamKeys.ping.lastTest') }} {{ formatLastPing(c.resultTime) }}
                    </NText>
                    <NText
                      v-if="!c.result.ok && c.result.error"
                      depth="3"
                      style="font-size: 12px; max-width: 220px"
                      >{{ c.result.error.message }}</NText
                    >
                  </NSpace>
                </template>
                <NText v-else depth="3" style="font-size: 11px">
                  {{ t('upstreamKeys.ping.lastTest') }} {{ formatLastPing(c.resultTime) }}
                </NText>
                <NButton
                  size="small"
                  :loading="pingLoading.has(c.realName)"
                  :disabled="pingLoading.has(c.realName)"
                  @click="handlePing(pingKey!.id, c.realName)"
                >
                  {{ t('upstreamKeys.ping.button') }}
                </NButton>
              </NSpace>
            </NSpace>
          </NListItem>
        </NList>
      </NSpace>
    </NModal>

    <NModal
      v-model:show="healthOpen"
      preset="card"
      style="max-width: 720px"
      :title="t('upstreamKeys.health.title', { name: healthKey?.name ?? '' })"
      @update:show="(v: boolean) => (healthOpen = v)"
    >
      <NDataTable
        :columns="healthColumns"
        :data="healthRows"
        :loading="healthLoading"
        :bordered="false"
        :single-line="false"
        :row-key="(row) => row.id"
        :empty="h(NEmpty, { description: t('upstreamKeys.health.empty') })"
      />
    </NModal>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
