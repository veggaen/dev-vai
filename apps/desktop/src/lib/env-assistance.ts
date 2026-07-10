export type EnvGuideGroup =
  | 'Core runtime'
  | 'Authentication'
  | 'Billing'
  | 'Video'
  | 'Storage'
  | 'Other';

export interface EnvGuide {
  name: string;
  group: EnvGuideGroup;
  service: string;
  description: string;
  getValueUrl?: string;
  generated?: boolean;
  rank?: number;
  requiredToBoot?: boolean;
  serverOnly?: boolean;
}

const GROUP_ORDER: EnvGuideGroup[] = [
  'Core runtime',
  'Authentication',
  'Billing',
  'Video',
  'Storage',
  'Other',
];

const CONVEX_DASHBOARD = 'https://dashboard.convex.dev';
const CLERK_DASHBOARD = 'https://dashboard.clerk.com';
const STRIPE_KEYS = 'https://dashboard.stripe.com/test/apikeys';
const STRIPE_WEBHOOKS = 'https://dashboard.stripe.com/test/webhooks';
const STRIPE_PRODUCTS = 'https://dashboard.stripe.com/test/products';
const MUX_TOKENS = 'https://dashboard.mux.com/settings/access-tokens';
const MUX_WEBHOOKS = 'https://dashboard.mux.com/settings/webhooks';
const MUX_SIGNING_KEYS = 'https://dashboard.mux.com/settings/signing-keys';
const RAILWAY_DASHBOARD = 'https://railway.com/dashboard';
const AUTUMN_DASHBOARD = 'https://app.useautumn.com';
const CHUNKIFY_SIGN_IN = 'https://chunkify.dev/signin';

const ENV_GUIDES: Record<string, Omit<EnvGuide, 'name'>> = {
  CONVEX_DEPLOYMENT: {
    group: 'Core runtime',
    service: 'Convex',
    description: 'Created when you run npx convex dev.',
    getValueUrl: CONVEX_DASHBOARD,
    generated: true,
    rank: 1,
  },
  VITE_CONVEX_URL: {
    group: 'Core runtime',
    service: 'Convex',
    description: 'Public development deployment URL; npx convex dev normally writes it for you.',
    getValueUrl: CONVEX_DASHBOARD,
    generated: true,
    rank: 0,
    requiredToBoot: true,
  },
  VITE_CONVEX_SITE_URL: {
    group: 'Core runtime',
    service: 'Convex',
    description: 'Public HTTP-actions URL; npx convex dev normally writes it for you.',
    getValueUrl: CONVEX_DASHBOARD,
    generated: true,
    rank: 2,
  },
  VITE_CLERK_PUBLISHABLE_KEY: {
    group: 'Authentication',
    service: 'Clerk',
    description: 'Frontend-safe test key beginning with pk_test_.',
    getValueUrl: CLERK_DASHBOARD,
    rank: 0,
    requiredToBoot: true,
  },
  CLERK_SECRET_KEY: {
    group: 'Authentication',
    service: 'Clerk',
    description: 'Backend test key beginning with sk_test_. Also add it to the Convex deployment env.',
    getValueUrl: CLERK_DASHBOARD,
    rank: 1,
    serverOnly: true,
  },
  CLERK_JWT_ISSUER_DOMAIN: {
    group: 'Authentication',
    service: 'Clerk + Convex',
    description: 'Clerk Frontend API URL used by Convex auth. Add it to the Convex deployment env.',
    getValueUrl: CLERK_DASHBOARD,
    rank: 2,
    serverOnly: true,
  },
  STRIPE_SECRET_KEY: {
    group: 'Billing',
    service: 'Stripe',
    description: 'Server test key beginning with sk_test_.',
    getValueUrl: STRIPE_KEYS,
    serverOnly: true,
  },
  STRIPE_PUBLISHABLE_KEY: {
    group: 'Billing',
    service: 'Stripe',
    description: 'Publishable test key beginning with pk_test_.',
    getValueUrl: STRIPE_KEYS,
  },
  STRIPE_WEBHOOK_SECRET: {
    group: 'Billing',
    service: 'Stripe',
    description: 'Endpoint signing secret beginning with whsec_.',
    getValueUrl: STRIPE_WEBHOOKS,
    serverOnly: true,
  },
  STRIPE_PRICE_BASIC_MONTHLY: {
    group: 'Billing',
    service: 'Stripe',
    description: 'Recurring Basic monthly Price ID beginning with price_.',
    getValueUrl: STRIPE_PRODUCTS,
    serverOnly: true,
  },
  STRIPE_PRICE_PRO_MONTHLY: {
    group: 'Billing',
    service: 'Stripe',
    description: 'Recurring Pro monthly Price ID beginning with price_.',
    getValueUrl: STRIPE_PRODUCTS,
    serverOnly: true,
  },
  AUTUMN_SECRET_KEY: {
    group: 'Billing',
    service: 'Autumn',
    description: 'Server billing and entitlement key beginning with am_sk_.',
    getValueUrl: AUTUMN_DASHBOARD,
    serverOnly: true,
  },
  MUX_TOKEN_ID: {
    group: 'Video',
    service: 'Mux',
    description: 'Server API access-token ID.',
    getValueUrl: MUX_TOKENS,
    serverOnly: true,
  },
  MUX_TOKEN_SECRET: {
    group: 'Video',
    service: 'Mux',
    description: 'Server API access-token secret; Mux only shows it when created.',
    getValueUrl: MUX_TOKENS,
    serverOnly: true,
  },
  MUX_WEBHOOK_SECRET: {
    group: 'Video',
    service: 'Mux',
    description: 'Signing secret for the configured Mux webhook endpoint.',
    getValueUrl: MUX_WEBHOOKS,
    serverOnly: true,
  },
  MUX_SIGNING_KEY: {
    group: 'Video',
    service: 'Mux',
    description: 'Signing-key ID used for secure playback.',
    getValueUrl: MUX_SIGNING_KEYS,
    serverOnly: true,
  },
  MUX_PRIVATE_KEY: {
    group: 'Video',
    service: 'Mux',
    description: 'Private key paired with the Mux signing-key ID; it is shown only once.',
    getValueUrl: MUX_SIGNING_KEYS,
    serverOnly: true,
  },
  CHUNKIFY_PROJECT_ACCESS_TOKEN: {
    group: 'Video',
    service: 'Chunkify',
    description: 'Project token beginning with sk_project_.',
    getValueUrl: CHUNKIFY_SIGN_IN,
    serverOnly: true,
  },
  CHUNKIFY_WEBHOOK_SECRET: {
    group: 'Video',
    service: 'Chunkify',
    description: 'Webhook key from the project Webhooks settings.',
    getValueUrl: CHUNKIFY_SIGN_IN,
    serverOnly: true,
  },
  RAILWAY_ENDPOINT: {
    group: 'Storage',
    service: 'Railway bucket',
    description: 'S3-compatible endpoint from the bucket Credentials tab.',
    getValueUrl: RAILWAY_DASHBOARD,
    serverOnly: true,
  },
  RAILWAY_ACCESS_KEY_ID: {
    group: 'Storage',
    service: 'Railway bucket',
    description: 'S3-compatible access-key ID from the bucket Credentials tab.',
    getValueUrl: RAILWAY_DASHBOARD,
    serverOnly: true,
  },
  RAILWAY_SECRET_ACCESS_KEY: {
    group: 'Storage',
    service: 'Railway bucket',
    description: 'S3-compatible secret access key from the bucket Credentials tab.',
    getValueUrl: RAILWAY_DASHBOARD,
    serverOnly: true,
  },
  RAILWAY_REGION: {
    group: 'Storage',
    service: 'Railway bucket',
    description: 'Bucket region; Railway currently commonly reports auto.',
    getValueUrl: RAILWAY_DASHBOARD,
    serverOnly: true,
  },
  RAILWAY_BUCKET_NAME: {
    group: 'Storage',
    service: 'Railway bucket',
    description: 'Exact S3 bucket name from the bucket Credentials tab.',
    getValueUrl: RAILWAY_DASHBOARD,
    serverOnly: true,
  },
  RAILWAY_PUBLIC_URL: {
    group: 'Storage',
    service: 'Railway bucket',
    description: 'Optional public/proxy base URL. Railway buckets are private by default.',
    getValueUrl: RAILWAY_DASHBOARD,
    serverOnly: true,
  },
  RAILWAY_PUBLIC_URL_INCLUDE_BUCKET: {
    group: 'Storage',
    service: 'Railway bucket',
    description: 'Optional Lawn URL-format switch; use false only when the base URL already includes the bucket.',
    getValueUrl: RAILWAY_DASHBOARD,
    serverOnly: true,
  },
};

export function getEnvGuide(name: string): EnvGuide {
  return {
    name,
    ...(ENV_GUIDES[name] ?? {
      group: 'Other' as const,
      service: 'Project',
      description: 'Read this project\'s setup notes to obtain the real value.',
      serverOnly: !name.startsWith('VITE_') && !name.startsWith('NEXT_PUBLIC_'),
    }),
  };
}

export function groupEnvGuides(names: string[]): Array<{ group: EnvGuideGroup; guides: EnvGuide[] }> {
  const unique = [...new Set(names)].map(getEnvGuide);
  return GROUP_ORDER
    .map((group) => ({
      group,
      guides: unique
        .filter((guide) => guide.group === group)
        .sort((left, right) => (left.rank ?? 100) - (right.rank ?? 100) || left.name.localeCompare(right.name)),
    }))
    .filter(({ guides }) => guides.length > 0);
}
