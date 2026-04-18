import type { BuilderArchetype, BuilderModule } from './types.js';

const ARCHETYPE_MODULES: Record<BuilderArchetype, readonly BuilderModule[]> = {
  tracker: ['schedule', 'progress'],
  'social-feed': ['activity-feed', 'profiles'],
  matching: ['profiles', 'matches', 'chat'],
  portfolio: ['gallery', 'booking'],
  storefront: ['catalog', 'cart', 'checkout'],
  dashboard: ['analytics', 'customers'],
  booking: ['appointments', 'schedule', 'customers'],
};

export function getDefaultBuilderModules(archetype: BuilderArchetype): readonly BuilderModule[] {
  return ARCHETYPE_MODULES[archetype];
}
