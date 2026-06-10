/**
 * Compose a DomainModel into a runnable Vite + React + Tailwind app.
 *
 * Unlike the legacy fixed-template generators, every section and every line of
 * copy here comes from the model — so a café gets a menu, hours, and a warm
 * palette, while a dental practice gets services, an about, and a trust-first
 * blue. The scaffold (package.json / vite / tailwind / tsconfig) is the same
 * known-good baseline the other generators emit.
 */

import type { DomainModel, MenuItem, ServiceItem, Highlight, Hour, Testimonial } from './domain-model.js';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'site';
}

/** Escape a string for safe placement inside JSX text. */
function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function price(value: string): string {
  return /^\d+$/.test(value.trim()) ? `kr ${value.trim()}` : esc(value);
}

const navLabel: Record<string, string> = {
  highlights: 'Why us',
  menu: 'Menu',
  services: 'Services',
  gallery: 'Gallery',
  hours: 'Hours',
  location: 'Visit',
  about: 'About',
  testimonials: 'Reviews',
  contact: 'Contact',
};

function navLinks(model: DomainModel): string[] {
  const wanted = model.sections.filter((s) => s !== 'hero' && navLabel[s]);
  // Collapse hours+location into a single "Visit" link.
  const seen = new Set<string>();
  const links: string[] = [];
  for (const s of wanted) {
    const id = s === 'hours' ? 'location' : s;
    const label = s === 'hours' ? 'Visit' : navLabel[s];
    if (seen.has(id)) continue;
    seen.add(id);
    links.push(`            <a href="#${id}" className="nav-link">${esc(label)}</a>`);
  }
  return links;
}

function heroSection(model: DomainModel): string[] {
  return [
    '      <header className="hero">',
    '        <div className="hero-copy">',
    `          <p className="eyebrow">${esc(model.eyebrow)}</p>`,
    `          <h1 className="hero-title">${esc(model.heroHeadline)}</h1>`,
    `          <p className="hero-sub">${esc(model.heroSub)}</p>`,
    '          <div className="hero-actions">',
    `            <a href="#${model.sections.includes('menu') ? 'menu' : model.sections.includes('services') ? 'services' : 'contact'}" className="btn btn-accent">${esc(model.content.ctaLabel)}</a>`,
    '            <a href="#contact" className="btn btn-ghost">Get in touch</a>',
    '          </div>',
    '        </div>',
    '        <div className="hero-card" aria-hidden="true">',
    `          <span className="hero-card-mark">${esc(model.brandName.charAt(0).toUpperCase())}</span>`,
    `          <span className="hero-card-name">${esc(model.brandName)}</span>`,
    `          <span className="hero-card-tag">${esc(model.subject)}</span>`,
    '        </div>',
    '      </header>',
  ];
}

function highlightsSection(items: readonly Highlight[]): string[] {
  return [
    '      <section id="highlights" className="section">',
    '        <div className="grid-3">',
    ...items.flatMap((h) => [
      '          <article className="card">',
      `            <h3 className="card-title">${esc(h.title)}</h3>`,
      `            <p className="card-body">${esc(h.body)}</p>`,
      '          </article>',
    ]),
    '        </div>',
    '      </section>',
  ];
}

function menuSection(items: readonly MenuItem[]): string[] {
  return [
    '      <section id="menu" className="section">',
    '        <div className="section-head">',
    '          <h2 className="section-title">Menu</h2>',
    '          <p className="section-lead">A short menu we are proud of, changed when the season says so.</p>',
    '        </div>',
    '        <div className="menu-grid">',
    ...items.flatMap((m) => [
      '          <div className="menu-row">',
      '            <div className="menu-row-main">',
      `              <span className="menu-name">${esc(m.name)}</span>`,
      `              <span className="menu-desc">${esc(m.description)}</span>`,
      '            </div>',
      `            <span className="menu-price">${price(m.price)}</span>`,
      '          </div>',
    ]),
    '        </div>',
    '      </section>',
  ];
}

function servicesSection(items: readonly ServiceItem[]): string[] {
  return [
    '      <section id="services" className="section">',
    '        <div className="section-head">',
    '          <h2 className="section-title">Services</h2>',
    '          <p className="section-lead">Clear options, honest pricing, no surprises.</p>',
    '        </div>',
    '        <div className="grid-2">',
    ...items.flatMap((s) => [
      '          <article className="service-card">',
      '            <div className="service-head">',
      `              <h3 className="card-title">${esc(s.name)}</h3>`,
      s.price ? `              <span className="service-price">${price(s.price)}</span>` : '',
      '            </div>',
      `            <p className="card-body">${esc(s.description)}</p>`,
      '          </article>',
    ].filter(Boolean)),
    '        </div>',
    '      </section>',
  ];
}

function gallerySection(model: DomainModel): string[] {
  const tiles = Array.from({ length: 6 }, (_, i) => `          <div className="gallery-tile gallery-tile-${(i % 3) + 1}" />`);
  return [
    '      <section id="gallery" className="section">',
    '        <div className="section-head">',
    `          <h2 className="section-title">A look inside</h2>`,
    `          <p className="section-lead">Real spaces, real work — swap these for your own photos when you have them.</p>`,
    '        </div>',
    '        <div className="gallery-grid">',
    ...tiles,
    '        </div>',
    '      </section>',
  ];
}

function visitSection(model: DomainModel): string[] {
  const hours = model.content.hours ?? [];
  const loc = model.content.location;
  if (hours.length === 0 && !loc) return [];
  return [
    '      <section id="location" className="section">',
    '        <div className="visit-grid">',
    ...(hours.length > 0 ? [
      '          <div className="visit-block">',
      '            <h2 className="section-title">Hours</h2>',
      '            <ul className="hours-list">',
      ...hours.map((h: Hour) => `              <li className="hours-row"><span>${esc(h.day)}</span><span>${esc(h.time)}</span></li>`),
      '            </ul>',
      '          </div>',
    ] : []),
    ...(loc ? [
      '          <div className="visit-block">',
      '            <h2 className="section-title">Find us</h2>',
      `            <p className="visit-address">${esc(loc.address)}</p>`,
      `            <p className="visit-note">${esc(loc.note)}</p>`,
      '          </div>',
    ] : []),
    '        </div>',
    '      </section>',
  ];
}

function aboutSection(model: DomainModel): string[] {
  return [
    '      <section id="about" className="section section-narrow">',
    '        <h2 className="section-title">About</h2>',
    `        <p className="about-body">${esc(model.content.about)}</p>`,
    '      </section>',
  ];
}

function testimonialsSection(items: readonly Testimonial[]): string[] {
  if (items.length === 0) return [];
  return [
    '      <section id="testimonials" className="section">',
    '        <div className="grid-2">',
    ...items.flatMap((t) => [
      '          <figure className="quote">',
      `            <blockquote className="quote-text">${esc(t.quote)}</blockquote>`,
      `            <figcaption className="quote-author">${esc(t.author)}</figcaption>`,
      '          </figure>',
    ]),
    '        </div>',
    '      </section>',
  ];
}

function ctaSection(model: DomainModel): string[] {
  return [
    '      <section id="contact" className="cta">',
    `        <h2 className="cta-title">${esc(model.content.ctaTitle)}</h2>`,
    `        <p className="cta-body">${esc(model.content.ctaBody)}</p>`,
    '        <div className="cta-actions">',
    `          <a href="mailto:${esc(model.content.contact.email)}" className="btn btn-accent">${esc(model.content.contact.email)}</a>`,
    `          <a href="tel:${esc(model.content.contact.phone.replace(/\s+/g, ''))}" className="btn btn-ghost">${esc(model.content.contact.phone)}</a>`,
    '        </div>',
    '      </section>',
  ];
}

function renderSection(model: DomainModel, id: string): string[] {
  switch (id) {
    case 'hero': return heroSection(model);
    case 'highlights': return highlightsSection(model.content.highlights);
    case 'menu': return model.content.menu ? menuSection(model.content.menu) : [];
    case 'services': return model.content.services ? servicesSection(model.content.services) : [];
    case 'gallery': return gallerySection(model);
    case 'hours': return visitSection(model); // hours+location render together
    case 'location': return model.sections.includes('hours') ? [] : visitSection(model);
    case 'about': return aboutSection(model);
    case 'testimonials': return testimonialsSection(model.content.testimonials);
    case 'contact': return ctaSection(model);
    default: return [];
  }
}

function buildAppSource(model: DomainModel): string {
  const sectionLines = model.sections.flatMap((id) => renderSection(model, id));
  // Contact/CTA always closes the page even if not in the section list.
  if (!model.sections.includes('contact')) sectionLines.push(...ctaSection(model));

  return [
    "import './styles.css';",
    '',
    'export default function App() {',
    '  return (',
    '    <div className="page">',
    '      <nav className="nav">',
    `        <a href="#top" className="brand">${esc(model.brandName)}</a>`,
    '        <div className="nav-links">',
    ...navLinks(model),
    `          <a href="#contact" className="btn btn-accent btn-sm">${esc(model.content.ctaLabel)}</a>`,
    '        </div>',
    '      </nav>',
    '',
    '      <main id="top">',
    ...sectionLines,
    '      </main>',
    '',
    '      <footer className="footer">',
    `        <span>${esc(model.brandName)}</span>`,
    `        <span className="footer-muted">${esc(model.content.contact.email)} · ${esc(model.content.contact.phone)}</span>`,
    '      </footer>',
    '    </div>',
    '  );',
    '}',
  ].join('\n');
}

function buildStyles(model: DomainModel): string {
  const p = model.palette;
  return [
    '@import "tailwindcss";',
    '',
    ':root {',
    `  --bg: ${p.bg};`,
    `  --surface: ${p.surface};`,
    `  --text: ${p.text};`,
    `  --muted: ${p.muted};`,
    `  --accent: ${p.accent};`,
    `  --accent-text: ${p.accentText};`,
    `  --border: ${p.border};`,
    '}',
    '',
    '* { box-sizing: border-box; }',
    'html { scroll-behavior: smooth; }',
    'body {',
    '  margin: 0;',
    '  background: var(--bg);',
    '  color: var(--text);',
    "  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    '  -webkit-font-smoothing: antialiased;',
    '}',
    '',
    '.page { width: 100%; }',
    '.nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between;',
    '  padding: 1rem clamp(1.25rem, 5vw, 4rem); background: color-mix(in srgb, var(--bg) 88%, transparent);',
    '  backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }',
    '.brand { font-weight: 700; font-size: 1.1rem; letter-spacing: -0.01em; text-decoration: none; color: var(--text); }',
    '.nav-links { display: flex; align-items: center; gap: 1.25rem; }',
    '.nav-link { display: none; font-size: 0.9rem; color: var(--muted); text-decoration: none; transition: color .15s; }',
    '.nav-link:hover { color: var(--text); }',
    '@media (min-width: 820px) { .nav-link { display: inline; } }',
    '',
    '.btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 0.7rem; padding: 0.7rem 1.15rem;',
    '  font-weight: 600; font-size: 0.95rem; text-decoration: none; transition: transform .12s, filter .15s, background .15s; }',
    '.btn:hover { transform: translateY(-1px); }',
    '.btn-sm { padding: 0.5rem 0.9rem; font-size: 0.85rem; }',
    '.btn-accent { background: var(--accent); color: var(--accent-text); }',
    '.btn-accent:hover { filter: brightness(1.05); }',
    '.btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--border); }',
    '.btn-ghost:hover { background: var(--surface); }',
    '',
    '.hero { display: grid; grid-template-columns: 1fr; gap: 2.5rem; align-items: center;',
    '  padding: clamp(3rem, 8vw, 6rem) clamp(1.25rem, 5vw, 4rem) clamp(2rem, 5vw, 4rem); }',
    '@media (min-width: 900px) { .hero { grid-template-columns: 1.2fr 0.8fr; } }',
    '.eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 0.72rem; font-weight: 700; color: var(--accent); margin: 0 0 1rem; }',
    '.hero-title { font-size: clamp(2.2rem, 5vw, 3.6rem); line-height: 1.05; letter-spacing: -0.02em; margin: 0 0 1.1rem; font-weight: 800; }',
    '.hero-sub { font-size: clamp(1rem, 2vw, 1.2rem); line-height: 1.6; color: var(--muted); max-width: 34rem; margin: 0 0 1.8rem; }',
    '.hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }',
    '.hero-card { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; justify-content: center;',
    '  min-height: 18rem; padding: 2rem; border-radius: 1.4rem; border: 1px solid var(--border);',
    '  background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface)); }',
    '.hero-card-mark { display: inline-flex; align-items: center; justify-content: center; width: 3rem; height: 3rem;',
    '  border-radius: 0.9rem; background: var(--accent); color: var(--accent-text); font-weight: 800; font-size: 1.4rem; }',
    '.hero-card-name { font-size: 1.4rem; font-weight: 700; margin-top: 0.5rem; }',
    '.hero-card-tag { font-size: 0.9rem; color: var(--muted); text-transform: capitalize; }',
    '',
    '.section { padding: clamp(2.5rem, 6vw, 5rem) clamp(1.25rem, 5vw, 4rem); border-top: 1px solid var(--border); }',
    '.section-narrow { max-width: 52rem; margin: 0 auto; }',
    '.section-head { max-width: 40rem; margin-bottom: 2.25rem; }',
    '.section-title { font-size: clamp(1.5rem, 3vw, 2.1rem); letter-spacing: -0.01em; font-weight: 800; margin: 0 0 0.6rem; }',
    '.section-lead { color: var(--muted); font-size: 1.05rem; line-height: 1.6; margin: 0; }',
    '',
    '.grid-3 { display: grid; gap: 1.25rem; grid-template-columns: 1fr; }',
    '@media (min-width: 720px) { .grid-3 { grid-template-columns: repeat(3, 1fr); } }',
    '.grid-2 { display: grid; gap: 1.25rem; grid-template-columns: 1fr; }',
    '@media (min-width: 720px) { .grid-2 { grid-template-columns: repeat(2, 1fr); } }',
    '.card { padding: 1.5rem; border-radius: 1.1rem; border: 1px solid var(--border); background: var(--surface); }',
    '.card-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.5rem; }',
    '.card-body { color: var(--muted); line-height: 1.6; margin: 0; }',
    '',
    '.menu-grid { display: grid; gap: 0.4rem; grid-template-columns: 1fr; }',
    '@media (min-width: 760px) { .menu-grid { grid-template-columns: repeat(2, 1fr); column-gap: 3rem; } }',
    '.menu-row { display: flex; align-items: baseline; gap: 1rem; padding: 0.9rem 0; border-bottom: 1px solid var(--border); }',
    '.menu-row-main { display: flex; flex-direction: column; gap: 0.2rem; flex: 1; }',
    '.menu-name { font-weight: 700; }',
    '.menu-desc { color: var(--muted); font-size: 0.92rem; line-height: 1.45; }',
    '.menu-price { font-weight: 700; color: var(--accent); white-space: nowrap; }',
    '',
    '.service-card { padding: 1.5rem; border-radius: 1.1rem; border: 1px solid var(--border); background: var(--surface); }',
    '.service-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 0.5rem; }',
    '.service-price { font-weight: 700; color: var(--accent); white-space: nowrap; }',
    '',
    '.gallery-grid { display: grid; gap: 0.9rem; grid-template-columns: repeat(2, 1fr); }',
    '@media (min-width: 760px) { .gallery-grid { grid-template-columns: repeat(3, 1fr); } }',
    '.gallery-tile { aspect-ratio: 4 / 3; border-radius: 1rem; border: 1px solid var(--border); }',
    '.gallery-tile-1 { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--surface)), var(--surface)); }',
    '.gallery-tile-2 { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--bg)); }',
    '.gallery-tile-3 { background: linear-gradient(135deg, var(--surface), color-mix(in srgb, var(--accent) 18%, var(--surface))); }',
    '',
    '.visit-grid { display: grid; gap: 2rem; grid-template-columns: 1fr; }',
    '@media (min-width: 720px) { .visit-grid { grid-template-columns: repeat(2, 1fr); } }',
    '.hours-list { list-style: none; margin: 0; padding: 0; }',
    '.hours-row { display: flex; justify-content: space-between; padding: 0.55rem 0; border-bottom: 1px solid var(--border); color: var(--muted); }',
    '.hours-row span:first-child { color: var(--text); font-weight: 600; }',
    '.visit-address { font-size: 1.15rem; font-weight: 600; margin: 0 0 0.5rem; }',
    '.visit-note { color: var(--muted); line-height: 1.6; margin: 0; }',
    '.about-body { font-size: 1.15rem; line-height: 1.7; color: var(--muted); margin: 0; }',
    '',
    '.quote { margin: 0; padding: 1.6rem; border-radius: 1.1rem; border: 1px solid var(--border); background: var(--surface); }',
    '.quote-text { margin: 0 0 0.9rem; font-size: 1.1rem; line-height: 1.55; }',
    '.quote-author { color: var(--muted); font-size: 0.9rem; }',
    '',
    '.cta { text-align: center; padding: clamp(3rem, 7vw, 5.5rem) 1.5rem; border-top: 1px solid var(--border);',
    '  background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, var(--bg)), var(--bg)); }',
    '.cta-title { font-size: clamp(1.7rem, 4vw, 2.6rem); font-weight: 800; margin: 0 0 0.8rem; letter-spacing: -0.01em; }',
    '.cta-body { color: var(--muted); font-size: 1.1rem; max-width: 34rem; margin: 0 auto 1.8rem; line-height: 1.6; }',
    '.cta-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; }',
    '',
    '.footer { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: space-between;',
    '  padding: 1.5rem clamp(1.25rem, 5vw, 4rem); border-top: 1px solid var(--border); color: var(--text); }',
    '.footer-muted { color: var(--muted); font-size: 0.9rem; }',
  ].join('\n');
}

/** Compose the full runnable app as a titled-code-block markdown payload. */
export function composeDomainApp(model: DomainModel): string {
  const name = slug(model.brandName);
  const appSource = buildAppSource(model);
  const stylesSource = buildStyles(model);

  return [
    `Building **${model.brandName}** — a ${model.subject} ${model.category === 'generic' ? 'site' : `(${model.category})`} with ${model.sections.length} sections tailored to the request, not a fixed template.`,
    '',
    '```json title="package.json"',
    JSON.stringify({
      name,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: {
        '@types/react': '^18.3.1',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.1',
        '@tailwindcss/vite': '^4.2.2',
        tailwindcss: '^4.2.2',
        typescript: '^5.5.3',
        vite: '^5.4.10',
      },
    }, null, 2),
    '```',
    '',
    '```html title="index.html"',
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${esc(model.brandName)}</title>`,
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '  </body>',
    '</html>',
    '```',
    '',
    '```ts title="vite.config.ts"',
    "import { defineConfig } from 'vite';",
    "import react from '@vitejs/plugin-react';",
    "import tailwindcss from '@tailwindcss/vite';",
    '',
    'export default defineConfig({',
    '  plugins: [react(), tailwindcss()],',
    '});',
    '```',
    '',
    '```tsx title="src/main.tsx"',
    "import { StrictMode } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import App from './App.tsx';",
    '',
    "createRoot(document.getElementById('root')!).render(",
    '  <StrictMode>',
    '    <App />',
    '  </StrictMode>,',
    ');',
    '```',
    '',
    `\`\`\`tsx title="src/App.tsx"\n${appSource}\n\`\`\``,
    '',
    `\`\`\`css title="src/styles.css"\n${stylesSource}\n\`\`\``,
    '',
    '```json title="tsconfig.json"',
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
      },
      include: ['src'],
    }, null, 2),
    '```',
  ].join('\n');
}

/**
 * Decide whether the domain composer should own this landing request. Returns
 * null (defer to the legacy generators) for the cases the old templates handle
 * deliberately — explicit heading/CTA slot requests and the developer-tool /
 * ops / SaaS / dashboard / fitness surfaces those generators were tuned for.
 */
export function shouldUseDomainComposer(desc: string): boolean {
  const text = (desc || '').toLowerCase();
  // Explicit slot requests are handled by the slot-filling template path.
  if (/\bexact\s+(?:heading|headline)\b|\bbutton\s+(?:labeled|labelled|called|named|that\s+says)\b/i.test(desc)) return false;
  // Surfaces with dedicated, test-covered templates.
  if (/\b(developer\s+tool|dev\s+tool|devtool|saas|dashboard|workflow|incident|ops\b|on[-\s]?call|release|deploy|ci\/cd|observability|api\s+platform|admin\s+panel|control\s+center)\b/i.test(text)) return false;
  if (/\b(fitness|gym|workout|training|trainer|athlete|crossfit|bodybuilding)\b/i.test(text)) return false;
  return true;
}
