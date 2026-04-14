/**
 * Dynamic Skill Router — Domain-aware skill selection for VaiEngine
 *
 * Instead of hardcoding strategy chains, the SkillRouter detects the domain
 * from user messages and selects the appropriate skills, knowledge, and
 * response patterns dynamically.
 *
 * Vai picks skills based on what's actually best for the request — not templates.
 * Scaffolding only triggers when explicitly requested.
 */

/* ── Domain Definitions ─────────────────────────────────────────── */

export type DomainId =
  | 'app-builder'
  | 'game-dev'
  | 'web-design'
  | 'photography'
  | 'saas'
  | 'dashboard'
  | 'ecommerce'
  | 'mobile'
  | 'api'
  | 'devops'
  | 'data'
  | 'ai-ml'
  | 'general';

export interface DomainSkill {
  /** Unique domain identifier */
  readonly id: DomainId;
  /** Human-readable label */
  readonly label: string;
  /** Keywords that signal this domain (checked against user message) */
  readonly signals: readonly string[];
  /** Regex patterns for stronger signal matching */
  readonly patterns: readonly RegExp[];
  /** What kind of output Vai should produce for this domain */
  readonly outputStyle: 'code' | 'design' | 'plan' | 'hybrid';
  /** Domain-specific system prompt injection */
  readonly systemContext: string;
  /** Priority weight — higher = checked first when multiple domains match */
  readonly weight: number;
}

export interface SkillMatch {
  readonly domain: DomainSkill;
  readonly confidence: number;
  readonly matchedSignals: string[];
}

/* ── Domain Registry ────────────────────────────────────────────── */

const DOMAIN_SKILLS: readonly DomainSkill[] = [
  {
    id: 'app-builder',
    label: 'Chat App Builder',
    signals: [
      'base44', 'app builder', 'app-builder', 'builder mode', 'plan preview',
      'preview plans', 'sandbox preview', 'generated app', 'generated apps',
      'generate apps', 'chat with vai', 'talk to vai', 'build from chat',
      'users want to build', 'compare revisions', 'file tree', 'revision compare',
    ],
    patterns: [
      /\bbase44\b/i,
      /\b(?:chat|talk)\s+with\s+vai\b.*\b(?:build|generate|sandbox|app)\b/i,
      /\b(?:app[- ]builder|chat[- ]first\s+builder|builder[- ]first)\b/i,
      /\bpreview\s+plans?\b.*\b(?:generate|sandbox|apps?|builder)\b/i,
      /\b(?:compare\s+revisions?|file\s+trees?)\b.*\b(?:generated|sandbox|builder)\b/i,
      /\busers?\s+(?:want|need)\s+to\s+build\b/i,
    ],
    outputStyle: 'plan',
    systemContext: 'You are an expert chat-first app-builder architect. Treat Base44-style prompts as product and workflow design unless the user explicitly asks to scaffold. Focus on intent capture, plan preview, file-tree or diff review, revision compare, sandbox handoff, explicit generate gates, and keeping chat as the default surface until the user explicitly asks to build now or upgrade the current preview. Once a sandbox exists, stay diff-first and preserve the same app unless the user asks for a fresh restart.',
    weight: 9,
  },
  {
    id: 'game-dev',
    label: 'Game Development',
    signals: [
      'game', 'shooter', 'rpg', 'platformer', 'arcade', 'puzzle game',
      'top-down', 'top down', 'side-scroller', 'hotline miami', 'baldurs gate',
      'boss fight', 'enemy', 'enemies', 'weapon', 'weapons', 'combat',
      'quest', 'quests', 'achievement', 'lore', 'npc', 'inventory',
      'level editor', 'game engine', 'sprite', 'tilemap', 'canvas game',
      'pixel art', 'game loop', 'collision', 'hitbox', 'respawn',
      'multiplayer', 'leaderboard', 'score', 'health bar', 'mana',
      'dungeon', 'roguelike', 'survival', 'tower defense', 'racing game',
      'fighting game', 'card game', 'board game', 'strategy game',
    ],
    patterns: [
      /\b(?:make|build|create)\s+(?:me\s+)?(?:a\s+)?(?:modern\s+)?(?:game|shooter|rpg|platformer)/i,
      /\bhotline\s*miami\b/i,
      /\bbaldur'?s?\s*gate\b/i,
      /\b(?:2d|3d)\s+game\b/i,
      /\bgame\s+(?:like|similar|inspired)/i,
      /\b(?:action|adventure|horror|stealth)\s+game\b/i,
    ],
    outputStyle: 'code',
    systemContext: 'You are an expert game developer. Generate production-quality game code with deep mechanics: combat systems, AI behaviors, progression, story/lore, inventory, quests, achievements. Use Canvas 2D or WebGL. Never produce cube demos or placeholder games. Every game must be fully playable with real mechanics.',
    weight: 10,
  },
  {
    id: 'web-design',
    label: 'Web Design & UI',
    signals: [
      'website', 'landing page', 'portfolio', 'homepage', 'web design',
      'ui design', 'ux', 'responsive', 'layout', 'hero section',
      'navbar', 'footer', 'contact form', 'about page', 'blog',
      'typography', 'color scheme', 'gradient', 'animation',
      'photography website', 'agency website', 'personal site',
    ],
    patterns: [
      /\b(?:make|build|create|design)\s+(?:me\s+)?(?:a\s+)?(?:modern\s+)?(?:website|landing\s*page|portfolio|homepage)/i,
      /\bphotography\s+(?:website|portfolio|site)/i,
      /\bagency\s+(?:website|site)/i,
      /\bpersonal\s+(?:website|site|page)/i,
    ],
    outputStyle: 'code',
    systemContext: 'You are an expert web designer and frontend developer. Generate production-quality, visually stunning websites with modern CSS, smooth animations, responsive layouts, and real interactive elements. All buttons, links, forms must be fully functional — no dead hrefs or mock handlers.',
    weight: 8,
  },
  {
    id: 'photography',
    label: 'Photography & Visual',
    signals: [
      'photography', 'photo gallery', 'photo portfolio', 'lightbox',
      'image gallery', 'photo editing', 'camera', 'lens', 'exposure',
      'composition', 'portrait', 'landscape photography',
    ],
    patterns: [
      /\bphotography\b/i,
      /\bphoto\s+(?:gallery|portfolio|site|website)/i,
    ],
    outputStyle: 'hybrid',
    systemContext: 'You are an expert in photography and visual design. Generate beautiful photo galleries, portfolio sites, and image-centric experiences with lightbox viewers, lazy loading, masonry layouts, and EXIF data display.',
    weight: 7,
  },
  {
    id: 'saas',
    label: 'SaaS Product',
    signals: [
      'saas', 'subscription', 'pricing page', 'billing', 'stripe',
      'multi-tenant', 'onboarding', 'user management', 'admin panel',
      'analytics dashboard', 'usage metrics', 'api keys', 'rate limiting',
      'freemium', 'trial', 'upgrade', 'plan', 'tier',
    ],
    patterns: [
      /\bsaas\b/i,
      /\bsubscription\s+(?:service|platform|app)/i,
      /\bmulti[- ]?tenant/i,
    ],
    outputStyle: 'hybrid',
    systemContext: 'You are an expert SaaS architect. Generate production-quality SaaS features: auth flows, billing integration, multi-tenancy, admin dashboards, usage analytics, onboarding sequences. All features must be functional — no mocks.',
    weight: 8,
  },
  {
    id: 'dashboard',
    label: 'Dashboard & Analytics',
    signals: [
      'dashboard', 'analytics', 'charts', 'graphs', 'metrics',
      'data visualization', 'kpi', 'report', 'monitoring',
      'real-time', 'widgets', 'panels',
    ],
    patterns: [
      /\b(?:make|build|create)\s+(?:me\s+)?(?:a\s+)?(?:modern\s+)?dashboard/i,
      /\banalytics\s+(?:dashboard|panel|view)/i,
    ],
    outputStyle: 'code',
    systemContext: 'You are an expert dashboard developer. Generate production-quality dashboards with real data visualization, interactive charts, filterable tables, responsive layouts, and functional controls. No placeholder data — generate realistic sample datasets.',
    weight: 7,
  },
];

const MORE_DOMAINS: readonly DomainSkill[] = [
  {
    id: 'ecommerce',
    label: 'E-Commerce',
    signals: [
      'ecommerce', 'e-commerce', 'shop', 'store', 'cart', 'checkout',
      'product page', 'catalog', 'payment', 'order', 'inventory management',
      'shopify', 'woocommerce', 'headless commerce',
    ],
    patterns: [
      /\b(?:e[- ]?commerce|online\s+(?:shop|store))\b/i,
      /\b(?:make|build|create)\s+(?:me\s+)?(?:a\s+)?(?:shop|store|marketplace)/i,
    ],
    outputStyle: 'hybrid',
    systemContext: 'You are an expert e-commerce developer. Generate production-quality shopping experiences: product catalogs, cart logic, checkout flows, payment integration patterns, order management. All interactions must be functional.',
    weight: 7,
  },
  {
    id: 'mobile',
    label: 'Mobile App',
    signals: [
      'mobile app', 'ios app', 'android app', 'react native',
      'flutter', 'expo', 'native app', 'mobile design',
      'push notification', 'app store',
    ],
    patterns: [
      /\b(?:mobile|ios|android)\s+app\b/i,
      /\breact\s+native\b/i,
      /\bflutter\b/i,
    ],
    outputStyle: 'code',
    systemContext: 'You are an expert mobile app developer. Generate production-quality mobile app code with proper navigation, state management, platform-specific patterns, and responsive mobile UI.',
    weight: 7,
  },
  {
    id: 'api',
    label: 'API & Backend',
    signals: [
      'api', 'rest api', 'graphql', 'backend', 'microservice',
      'endpoint', 'middleware', 'authentication', 'jwt', 'oauth',
      'database schema', 'migration', 'websocket', 'grpc',
    ],
    patterns: [
      /\b(?:rest|graphql)\s+api\b/i,
      /\bmicroservice/i,
      /\b(?:make|build|create)\s+(?:me\s+)?(?:a\s+)?(?:api|backend|server)/i,
    ],
    outputStyle: 'code',
    systemContext: 'You are an expert backend/API developer. Generate production-quality API code with proper error handling, validation, auth, database integration, and comprehensive endpoint design.',
    weight: 6,
  },
  {
    id: 'devops',
    label: 'DevOps & Infrastructure',
    signals: [
      'devops', 'ci/cd', 'pipeline', 'docker', 'kubernetes', 'k8s',
      'terraform', 'ansible', 'deploy pipeline', 'monitoring',
      'logging', 'infrastructure', 'cloud', 'aws', 'gcp', 'azure',
    ],
    patterns: [
      /\bci\/?cd\b/i,
      /\bkubernetes|k8s\b/i,
      /\bterraform\b/i,
    ],
    outputStyle: 'code',
    systemContext: 'You are an expert DevOps engineer. Generate production-quality infrastructure code, CI/CD pipelines, Docker configurations, and deployment automation.',
    weight: 6,
  },
  {
    id: 'data',
    label: 'Data & Visualization',
    signals: [
      'data pipeline', 'etl', 'data processing', 'csv', 'json parser',
      'data analysis', 'statistics', 'chart', 'graph', 'visualization',
      'd3', 'plotly', 'recharts',
    ],
    patterns: [
      /\bdata\s+(?:pipeline|processing|analysis)/i,
      /\betl\b/i,
    ],
    outputStyle: 'code',
    systemContext: 'You are an expert data engineer. Generate production-quality data processing pipelines, visualizations, and analysis tools with real data handling.',
    weight: 5,
  },
  {
    id: 'ai-ml',
    label: 'AI & Machine Learning',
    signals: [
      'ai app', 'machine learning', 'ml model', 'neural network',
      'chatbot', 'llm', 'embedding', 'vector database', 'rag',
      'fine-tuning', 'prompt engineering', 'ai agent',
    ],
    patterns: [
      /\bai\s+(?:app|agent|chatbot)/i,
      /\bmachine\s+learning\b/i,
      /\brag\s+(?:system|pipeline|app)/i,
    ],
    outputStyle: 'hybrid',
    systemContext: 'You are an expert AI/ML engineer. Generate production-quality AI-powered features: chatbots, RAG systems, embedding pipelines, agent architectures, and ML integrations.',
    weight: 7,
  },
];

/** All registered domain skills */
const ALL_DOMAINS: readonly DomainSkill[] = [...DOMAIN_SKILLS, ...MORE_DOMAINS];

/* ── Skill Router ───────────────────────────────────────────────── */

export class SkillRouter {
  private domains: readonly DomainSkill[] = ALL_DOMAINS;

  /**
   * Detect the best matching domain(s) from a user message.
   * Returns matches sorted by confidence (highest first).
   * Returns empty array if no domain matches (general conversation).
   */
  detectDomain(input: string): SkillMatch[] {
    const lower = input.toLowerCase();
    const matches: SkillMatch[] = [];

    for (const domain of this.domains) {
      let confidence = 0;
      const matchedSignals: string[] = [];

      // Check signal keywords
      for (const signal of domain.signals) {
        if (lower.includes(signal)) {
          confidence += 0.15;
          matchedSignals.push(signal);
        }
      }

      // Check regex patterns (stronger signal)
      for (const pattern of domain.patterns) {
        if (pattern.test(lower)) {
          confidence += 0.30;
          matchedSignals.push(pattern.source.slice(0, 40));
        }
      }

      // Apply domain weight as multiplier
      confidence = Math.min(confidence * (domain.weight / 8), 1.0);

      if (confidence >= 0.15) {
        matches.push({ domain, confidence, matchedSignals });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get the single best domain match, or null if nothing matches well enough.
   * Threshold: 0.20 minimum confidence.
   */
  getBestMatch(input: string): SkillMatch | null {
    const matches = this.detectDomain(input);
    if (matches.length === 0) return null;
    if (matches[0].confidence < 0.20) return null;
    return matches[0];
  }

  /**
   * Check if a message is an explicit scaffold/deploy request.
   * This is the ONLY case where Vai should offer template buttons.
   */
  isExplicitScaffoldRequest(input: string): boolean {
    const lower = input.toLowerCase();
    // Must contain explicit scaffold/deploy language
    const explicitScaffold = /\b(scaffold|deploy|spin\s*up|bootstrap|set\s*up\s+(?:a\s+)?(?:pern|mern|next|next\.?js|t3|vinext)\b)/i;
    // "build me a PERN app" with explicit stack name = scaffold intent
    const explicitStackBuild = /\b(?:build|create|make|start|set\s*up|setup|install)\s+(?:me\s+)?(?:a\s+)?(?:pern|mern|next\.?js|t3|vinext)(?:\s+[a-z0-9.+-]+){0,4}\s+(?:app|project|stack|template|starter)\b/i;
    return explicitScaffold.test(lower) || explicitStackBuild.test(lower);
  }

  /**
   * Build a system context string from the matched domain.
   * This gets injected into Vai's response generation.
   */
  buildContext(match: SkillMatch): string {
    return `[Domain: ${match.domain.label}] ${match.domain.systemContext}`;
  }

  /** Get all registered domains for diagnostics */
  getDomains(): readonly DomainSkill[] {
    return this.domains;
  }
}

