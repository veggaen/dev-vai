import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'VeggaAI',
    description: 'VeggaAI learns from your browsing — YouTube transcripts, GitHub repos, search results, and more.',
    permissions: ['activeTab', 'storage'],
    host_permissions: [
      'http://localhost:3001/*',
      'https://www.youtube.com/*',
      'https://*.github.com/*',
      'https://www.google.com/*',
      'https://www.google.co.*/*',
    ],
  },
});
