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
      'https://www.google.no/*',
      'https://www.google.co.uk/*',
      'https://www.google.se/*',
      'https://www.google.de/*',
      'https://www.google.fr/*',
      'https://www.google.es/*',
      'https://www.google.ca/*',
      'https://www.google.com.au/*',
      'https://www.google.co.in/*',
      'https://www.google.co.jp/*',
    ],
  },
});
