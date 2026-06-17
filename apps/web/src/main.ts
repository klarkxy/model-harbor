import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'vfonts/Inter.css';
import 'vfonts/FiraCode.css';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n/index.js';

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(router);
app.mount('#app');
