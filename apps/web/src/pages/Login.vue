<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useMessage } from 'naive-ui';
import { NForm, NFormItem, NInput, NButton, NSpace, NCard } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth.js';
import { getSetupStatus } from '../api/admin/setup.js';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const message = useMessage();
const auth = useAuthStore();

const username = ref('');
const password = ref('');
const loading = ref(false);
const checking = ref(true);

async function onSubmit(): Promise<void> {
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.push(redirect);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('login.failed'));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const status = await getSetupStatus();
    if (status.needsSetup) {
      await router.replace({ name: 'setup' });
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : t('login.failed'));
  } finally {
    checking.value = false;
  }
});
</script>

<template>
  <div v-if="!checking" class="login-page">
    <NCard :title="t('login.title')" style="width: 360px">
      <NForm @submit.prevent="onSubmit">
        <NFormItem :label="t('login.username')">
          <NInput v-model:value="username" />
        </NFormItem>
        <NFormItem :label="t('login.password')">
          <NInput v-model:value="password" type="password" />
        </NFormItem>
        <NSpace justify="end">
          <NButton type="primary" attr-type="submit" :loading="loading">
            {{ t('login.submit') }}
          </NButton>
        </NSpace>
      </NForm>
    </NCard>
  </div>
</template>

<style scoped>
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--n-color-hover);
}
</style>
