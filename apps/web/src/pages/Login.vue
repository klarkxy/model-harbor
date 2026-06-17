<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NCard, NForm, NFormItem, NInput, NButton, NAlert, NSpace, NText, NSelect } from 'naive-ui';
import { useAuthStore } from '../stores/auth.js';
import { ApiClientError } from '../api/client.js';
import { localeOptions, saveLocale, type SupportedLocale } from '../i18n/index.js';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const { t, locale } = useI18n();

const username = ref('');
const password = ref('');
const error = ref<string | null>(null);
const submitting = ref(false);

const redirectTo = computed<string>(() => {
  const r = route.query['redirect'];
  return typeof r === 'string' && r.startsWith('/') ? r : '/';
});

const currentLanguage = computed({
  get: () => locale.value as SupportedLocale,
  set: (value: SupportedLocale) => {
    locale.value = value;
    saveLocale(value);
  },
});

const languageOptions = computed(() =>
  localeOptions.map((opt) => ({ label: opt.label, value: opt.value })),
);

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  error.value = null;
  submitting.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    await router.push(redirectTo.value);
  } catch (err) {
    if (err instanceof ApiClientError) {
      error.value =
        err.status === 401 ? t('login.error401') : err.message || t('login.errorGeneric');
    } else {
      error.value = t('login.errorGeneric');
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <NCard :title="t('login.title')" class="login-card">
      <NForm @submit.prevent="onSubmit">
        <NFormItem :label="t('login.username')">
          <NInput
            v-model:value="username"
            placeholder="admin"
            autocomplete="username"
            :disabled="submitting"
          />
        </NFormItem>
        <NFormItem :label="t('login.password')">
          <NInput
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="••••••••"
            autocomplete="current-password"
            :disabled="submitting"
            @keyup.enter="onSubmit"
          />
        </NFormItem>
        <NAlert v-if="error" type="error" :show-icon="false" style="margin-bottom: 12px">
          {{ error }}
        </NAlert>
        <NSpace vertical size="medium">
          <NButton type="primary" block :loading="submitting" attr-type="submit" @click="onSubmit">
            {{ t('login.submit') }}
          </NButton>
          <NSpace align="center" justify="center" :size="12">
            <NSelect
              v-model:value="currentLanguage"
              :options="languageOptions"
              size="small"
              style="width: 130px"
              :consistent-menu-width="false"
            />
          </NSpace>
          <NText depth="3" style="text-align: center; font-size: 12px">
            {{ t('login.hint') }}
          </NText>
        </NSpace>
      </NForm>
    </NCard>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--n-color-modal, #f5f7fa);
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 380px;
}
</style>
