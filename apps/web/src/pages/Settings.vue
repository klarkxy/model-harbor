<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NSpace,
  NText,
  type DataTableColumns,
} from 'naive-ui';
import { ApiClientError } from '../api/client.js';
import { accountApi, auditApi, type AdminSummary, type AuditEvent } from '../api/admin.js';

const { t } = useI18n();

const message = ref<string | null>(null);
const error = ref<string | null>(null);
const savingProfile = ref(false);
const savingPassword = ref(false);

const profile = ref<AdminSummary | null>(null);
const displayName = ref<string>('');

const currentPassword = ref<string>('');
const newPassword = ref<string>('');
const confirmPassword = ref<string>('');

const auditEvents = ref<AuditEvent[]>([]);
const auditLoading = ref(false);

async function refreshProfile(): Promise<void> {
  const res = await fetch('/api/admin/auth/me', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(t('settings.account.loadError'));
  }
  const json = (await res.json()) as { admin: AdminSummary };
  profile.value = json.admin;
  displayName.value = json.admin.displayName ?? '';
}

async function refreshAudit(): Promise<void> {
  auditLoading.value = true;
  try {
    const res = await auditApi.list(200);
    auditEvents.value = res.items;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    auditLoading.value = false;
  }
}

onMounted(async () => {
  try {
    await Promise.all([refreshProfile(), refreshAudit()]);
  } catch (err) {
    error.value = (err as Error).message;
  }
});

async function saveProfile(): Promise<void> {
  savingProfile.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await accountApi.updateProfile({ displayName: displayName.value.trim() });
    profile.value = res.admin;
    message.value = t('settings.account.updated');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingProfile.value = false;
  }
}

async function changePassword(): Promise<void> {
  error.value = null;
  message.value = null;
  if (newPassword.value.length < 8) {
    error.value = t('settings.password.tooShort');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = t('settings.password.mismatch');
    return;
  }
  savingPassword.value = true;
  try {
    await accountApi.changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    message.value = t('settings.password.changed');
  } catch (err) {
    error.value = err instanceof ApiClientError ? err.message : (err as Error).message;
  } finally {
    savingPassword.value = false;
  }
}

const auditColumns = computed<DataTableColumns<AuditEvent>>(() => [
  {
    title: t('settings.audit.columns.time'),
    key: 'createdAt',
    width: 200,
    render: (row) => new Date(row.createdAt).toLocaleString(),
  },
  { title: t('settings.audit.columns.actor'), key: 'actorUsername', width: 140 },
  {
    title: t('settings.audit.columns.action'),
    key: 'action',
    width: 220,
    ellipsis: { tooltip: true },
  },
  { title: t('settings.audit.columns.resourceType'), key: 'resourceType', width: 140 },
  {
    title: t('settings.audit.columns.resourceId'),
    key: 'resourceId',
    width: 200,
    ellipsis: { tooltip: true },
  },
  { title: t('settings.audit.columns.ip'), key: 'ip', width: 140 },
]);

const username = computed(() => profile.value?.username ?? '');
</script>

<template>
  <div class="settings-page">
    <NSpace vertical size="large">
      <NCard :title="t('settings.account.title')">
        <NForm label-placement="top" style="max-width: 480px">
          <NFormItem :label="t('settings.account.username')">
            <NInput :value="username" readonly />
          </NFormItem>
          <NFormItem :label="t('settings.account.displayName')">
            <NInput v-model:value="displayName" :placeholder="t('settings.account.placeholder')" />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingProfile" @click="saveProfile">
              {{ t('settings.account.save') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.password.title')">
        <NForm label-placement="top" style="max-width: 480px">
          <NFormItem :label="t('settings.password.current')">
            <NInput v-model:value="currentPassword" type="password" show-password-on="click" />
          </NFormItem>
          <NFormItem :label="t('settings.password.new')">
            <NInput v-model:value="newPassword" type="password" show-password-on="click" />
          </NFormItem>
          <NFormItem :label="t('settings.password.confirm')">
            <NInput v-model:value="confirmPassword" type="password" show-password-on="click" />
          </NFormItem>
          <NSpace>
            <NButton type="primary" :loading="savingPassword" @click="changePassword">
              {{ t('settings.password.change') }}
            </NButton>
          </NSpace>
        </NForm>
      </NCard>

      <NCard :title="t('settings.audit.title')" :loading="auditLoading">
        <NDataTable
          :columns="auditColumns"
          :data="auditEvents"
          :bordered="false"
          :single-line="false"
          :row-key="(r) => r.id"
          :max-height="480"
        />
      </NCard>

      <NAlert v-if="error" type="error" :show-icon="false">{{ error }}</NAlert>
      <NAlert v-if="message" type="success" :show-icon="false">{{ message }}</NAlert>
      <NText depth="3" style="font-size: 12px">
        {{ t('settings.secretsNote') }}
      </NText>
    </NSpace>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 1100px;
  margin: 0 auto;
}
</style>
