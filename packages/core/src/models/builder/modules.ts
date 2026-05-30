import type { BuilderArchetype, BuilderModule } from './types.js';

const ARCHETYPE_MODULES: Record<BuilderArchetype, readonly BuilderModule[]> = {
  tracker: ['schedule', 'progress'],
  habit: ['schedule', 'progress', 'analytics'],
  'social-feed': ['activity-feed', 'profiles'],
  matching: ['profiles', 'matches', 'chat'],
  portfolio: ['gallery', 'booking'],
  storefront: ['catalog', 'cart', 'checkout'],
  dashboard: ['analytics', 'customers'],
  booking: ['appointments', 'schedule', 'customers'],
  todo: ['schedule'],
  pomodoro: ['schedule', 'progress'],
  markdown: [],
  password: [],
};

export function getDefaultBuilderModules(archetype: BuilderArchetype): readonly BuilderModule[] {
  return ARCHETYPE_MODULES[archetype];
}
