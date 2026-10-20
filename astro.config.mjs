// @ts-check
import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://airdocs.cn',
  output: 'static',
  i18n: {
    defaultLocale: 'zh',
    locales: ['zh', 'en'],
    routing: { prefixDefaultLocale: true }
  }
});
