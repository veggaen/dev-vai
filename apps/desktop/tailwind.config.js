/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', '"Instrument Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      colors: {
        shell: {
          bg: 'var(--shell-bg)',
          surface: 'var(--shell-surface)',
          line: 'var(--shell-line)',
          text: 'var(--shell-text)',
          muted: 'var(--shell-text-muted)',
          accent: 'var(--shell-accent)',
        },
        app: {
          chrome: 'var(--app-chrome-background)',
          surface: 'var(--app-surface)',
        },
        sidebar: {
          surface: 'var(--sidebar-surface)',
        },
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'text-sheen': {
          '0%': { backgroundPosition: '200% 50%' },
          '100%': { backgroundPosition: '-200% 50%' },
        },
        'aurora-drift': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(4%, -6%) scale(1.08)' },
          '66%': { transform: 'translate(-5%, 4%) scale(0.96)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'text-sheen': 'text-sheen 5s linear infinite',
        'aurora-drift': 'aurora-drift 18s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
