export type BuilderArchetype = 'tracker' | 'social-feed' | 'matching' | 'portfolio' | 'storefront' | 'dashboard' | 'booking';

export type BuilderModule =
  | 'activity-feed'
  | 'analytics'
  | 'appointments'
  | 'booking'
  | 'cart'
  | 'catalog'
  | 'chat'
  | 'checkout'
  | 'customers'
  | 'gallery'
  | 'matches'
  | 'profiles'
  | 'progress'
  | 'schedule';

export type BuilderAudience = 'personal' | 'consumer' | 'creator';

export interface BuilderIntentInput {
  input: string;
  cleanedProjectDesc: string;
  fullDesc: string;
}

export interface BuilderIntent {
  readonly archetype: BuilderArchetype;
  readonly audience: BuilderAudience;
  readonly domain: string;
  readonly modules: readonly BuilderModule[];
  readonly prompt: string;
  readonly cleanedPrompt: string;
  readonly referenceBrand?: 'twitter' | 'x' | 'tinder';
  readonly isCloneRequest: boolean;
}
