import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'VeggaAI',
    description: 'VeggaAI learns from your browsing — YouTube transcripts, GitHub repos, search results, and more.',
    permissions: ['activeTab', 'storage', 'scripting', 'tabs'],
    host_permissions: [
      'http://localhost:3006/*',
      'https://*/*',
      'http://*/*',
    ],
  },
});
