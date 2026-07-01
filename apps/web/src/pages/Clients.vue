<script setup lang="ts">
import { ref, onMounted, h } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import {
  NCard,
  NSpace,
  NButton,
  NDataTable,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NSwitch,
  NSpin,
  NText,
  NPopconfirm,
  NCollapse,
  NCollapseItem,
  NTabs,
  NTabPane,
} from 'naive-ui';
import { useI18n } from 'vue-i18n';
import {
  listClients,
  createClient,
  updateClient,
  deleteClient,
  listClientKeys,
  rotateClientActiveKey,
  revokeClientActiveKey,
} from '../api/admin/clients.js';
import type { ClientContract, ClientKeyContract } from '@manageyourllm/contracts';
import type { DataTableColumns } from 'naive-ui';
import ClientSnippetPanel from '../components/ClientSnippetPanel.vue';

const { t } = useI18n();
const message = useMessage();
const router = useRouter();

const clients = ref<ClientContract[]>([]);
const loading = ref(false);
const showCreateModal = ref(false);
const form = ref({ name: '', description: '' });

const clientKeyMap = ref<Record<string, ClientKeyContract[]>>({});
const rawKeyModal = ref<{ show: boolean; title: string; rawKey: string }>({
  show: false,
  title: '',
  rawKey: '',
});
const snippetKeyMap = ref<Record<string, string | null>>({});

async function loadClients() {
  loading.value = true;
  try {
    clients.value = await listClients();
    await Promise.all(
      clients.value.map(async (c) => {
        clientKeyMap.value[c.id] = await listClientKeys(c.id);
      }),
    );
    // 清理已不存在的 client 的 snippetKey 缓存。
    for (const id of Object.keys(snippetKeyMap.value)) {
      if (!clients.value.some((c) => c.id === id)) {
        delete snippetKeyMap.value[id];
      }
    }
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  form.value = { name: '', description: '' };
  showCreateModal.value = true;
}

async function onSave() {
  try {
    // v1 Phase 6：Client 创建时后端自动生成 active key，
    // 响应里 rawKey 只展示一次；前端立即调出 modal 让用户复制，
    // 同时把 rawKey 写入 snippetKeyMap 让 Snippet tab 能渲染可用片段。
    const res = await createClient<{ client: ClientContract; rawKey: string }>(form.value);
    showCreateModal.value = false;
    snippetKeyMap.value[res.client.id] = res.rawKey;
    await loadClients();
    rawKeyModal.value = {
      show: true,
      title: t('clients.clientCreatedWithKey'),
      rawKey: res.rawKey,
    };
    message.success(t('common.saved'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function copyRawKey() {
  if (!rawKeyModal.value.rawKey) return;
  try {
    await navigator.clipboard.writeText(rawKeyModal.value.rawKey);
    message.success(t('common.copied'));
  } catch {
    message.error(t('common.copyFailed'));
  }
}

async function toggleClient(client: ClientContract) {
  try {
    await updateClient(client.id, { enabled: !client.enabled });
    await loadClients();
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function onDelete(client: ClientContract) {
  try {
    await deleteClient(client.id);
    await loadClients();
    message.success(t('common.deleted'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.deleteFailed'));
  }
}

async function rotateKey(client: ClientContract) {
  try {
    const res = await rotateClientActiveKey<{ clientKey: ClientKeyContract; rawKey: string }>(
      client.id,
    );
    // 新 rawKey 只在响应里出现一次；写入 snippetKeyMap 让 Snippet tab 立刻可用。
    snippetKeyMap.value[client.id] = res.rawKey;
    await loadClients();
    rawKeyModal.value = {
      show: true,
      title: t('clients.keyRotated'),
      rawKey: res.rawKey,
    };
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

async function revokeKey(client: ClientContract) {
  try {
    await revokeClientActiveKey(client.id);
    // 已吊销的 key 不应再在 Snippet tab 显示；清空缓存直到下次 rotate 才回填。
    delete snippetKeyMap.value[client.id];
    await loadClients();
    message.success(t('clients.keyRevoked'));
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('common.saveFailed'));
  }
}

function jumpToUsage(client: ClientContract) {
  void router.push({ name: 'usage', query: { clientId: client.id } });
}

function jumpToTraces(client: ClientContract) {
  void router.push({ name: 'traces', query: { clientId: client.id } });
}

const columns: DataTableColumns<ClientContract> = [
  { title: t('clients.name'), key: 'name' },
  { title: t('clients.description'), key: 'description' },
  {
    title: t('clients.enabled'),
    key: 'enabled',
    render(row) {
      return h(NSwitch, {
        value: row.enabled,
        onUpdateValue: () => toggleClient(row),
      });
    },
  },
  {
    title: t('common.actions'),
    key: 'actions',
    render(row) {
      return h(
        NSpace,
        { size: 'small' },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', onClick: () => jumpToUsage(row) },
              { default: () => t('clients.viewUsage') },
            ),
            h(
              NButton,
              { size: 'small', onClick: () => jumpToTraces(row) },
              { default: () => t('clients.viewTraces') },
            ),
            h(
              NPopconfirm,
              { onPositiveClick: () => onDelete(row) },
              {
                trigger: () =>
                  h(
                    NButton,
                    { size: 'small', type: 'error' },
                    { default: () => t('common.delete') },
                  ),
                default: () => t('clients.confirmDelete'),
              },
            ),
          ],
        },
      );
    },
  },
];

onMounted(async () => {
  await loadClients();
});
</script>

<template>
  <NCard :title="t('clients.title')">
    <NSpace vertical :size="16">
      <NSpace justify="end">
        <NButton type="primary" @click="openCreate">{{ t('clients.create') }}</NButton>
      </NSpace>
      <NDataTable
        :columns="columns"
        :data="clients"
        :loading="loading"
        :row-key="(row) => row.id"
      />

      <NModal
        v-model:show="showCreateModal"
        :title="t('clients.create')"
        preset="card"
        style="width: 480px"
      >
        <NForm label-placement="left" label-width="80px">
          <NFormItem :label="t('clients.name')">
            <NInput v-model:value="form.name" />
          </NFormItem>
          <NFormItem :label="t('clients.description')">
            <NInput v-model:value="form.description" type="textarea" />
          </NFormItem>
        </NForm>
        <NSpace justify="end">
          <NButton @click="showCreateModal = false">{{ t('common.cancel') }}</NButton>
          <NButton type="primary" @click="onSave">{{ t('common.save') }}</NButton>
        </NSpace>
      </NModal>

      <NModal
        v-model:show="rawKeyModal.show"
        :title="rawKeyModal.title"
        preset="card"
        style="width: 520px"
      >
        <NSpin :show="false">
          <NFormItem :label="t('clients.rawKey')">
            <NInput :value="rawKeyModal.rawKey" readonly />
          </NFormItem>
          <NText type="warning">{{ t('clients.rawKeyWarning') }}</NText>
        </NSpin>
        <template #footer>
          <NSpace justify="end">
            <NButton @click="copyRawKey">{{ t('common.copy') }}</NButton>
            <NButton @click="rawKeyModal.show = false">{{ t('common.close') }}</NButton>
          </NSpace>
        </template>
      </NModal>

      <NCollapse>
        <NCollapseItem
          v-for="client in clients"
          :key="`detail-${client.id}`"
          :title="`${client.name} - ${t('clients.clientDetail')}`"
        >
          <NTabs type="line" default-value="key">
            <NTabPane name="key" :tab="t('clients.activeKey')">
              <NSpace vertical :size="12">
                <NDataTable
                  :data="clientKeyMap[client.id] ?? []"
                  :columns="[
                    { title: t('clientKeys.name'), key: 'name' },
                    {
                      title: t('clientKeys.prefix'),
                      key: 'keyPrefix',
                      render(row: ClientKeyContract) {
                        const idTail = String(row.id ?? '').slice(-8);
                        return `${row.keyPrefix}…${row.keySuffix ?? ''} · ${idTail}`;
                      },
                    },
                    {
                      title: t('clientKeys.enabled'),
                      key: 'enabled',
                      render(row: ClientKeyContract) {
                        return h(NText, null, {
                          default: () =>
                            row.revokedAt ? t('clientKeys.revoked') : t('clientKeys.active'),
                        });
                      },
                    },
                    {
                      title: t('common.actions'),
                      key: 'actions',
                      render: () =>
                        h(
                          NSpace,
                          { size: 'small' },
                          {
                            default: () => [
                              h(
                                NButton,
                                { size: 'small', onClick: () => rotateKey(client) },
                                { default: () => t('clientKeys.rotate') },
                              ),
                              h(
                                NPopconfirm,
                                { onPositiveClick: () => revokeKey(client) },
                                {
                                  trigger: () =>
                                    h(
                                      NButton,
                                      { size: 'small', type: 'warning' },
                                      { default: () => t('clientKeys.revoke') },
                                    ),
                                  default: () => t('clientKeys.confirmRevoke'),
                                },
                              ),
                            ],
                          },
                        ),
                    },
                  ]"
                  :row-key="(row: ClientKeyContract) => row.id"
                />
                <NText depth="3">{{ t('clients.keyHint') }}</NText>
              </NSpace>
            </NTabPane>
            <NTabPane name="snippet" :tab="t('clients.snippet')">
              <ClientSnippetPanel :api-key="snippetKeyMap[client.id] ?? ''" />
            </NTabPane>
          </NTabs>
        </NCollapseItem>
      </NCollapse>
    </NSpace>
  </NCard>
</template>
