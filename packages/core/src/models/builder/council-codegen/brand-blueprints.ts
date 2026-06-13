/**
 * Brand blueprints — concrete product specs for clone requests.
 *
 * A generic "mirror the product" instruction is not enough for a small local
 * coder model: the live "clone of tinder" run produced a plain card with two
 * buttons, fake match semantics, and zero brand identity. Each blueprint pins
 * the SIGNATURE features and the visual identity so the architect, coder, and
 * reviewers all hold the build to the same recognizable bar.
 *
 * Visuals must be self-contained: CSS gradients / SVG / initials-on-gradient
 * avatars. External image URLs are banned by validation (offline sandbox).
 */

export interface BrandBlueprint {
  readonly brand: string;
  /** Words in the brief that select this blueprint. */
  readonly match: RegExp;
  /** Signature features — the architect must include ALL of them. */
  readonly features: readonly string[];
  /** Visual identity the coder must reproduce. */
  readonly visual: string;
  /** Checklist for reviewers: missing any of these is a must-fix. */
  readonly reviewChecklist: readonly string[];
}

export const BRAND_BLUEPRINTS: readonly BrandBlueprint[] = [
  {
    brand: 'Tinder',
    match: /\b(?:tinder|hinge|bumble|dating\s+app|swipe\s+app)\b/i,
    features: [
      'Card stack view: the top profile card fills ~80% of the viewport with the next card peeking behind; each profile has 2-3 "photos" (distinct CSS gradient art panels — NO external images) with thin dash progress bars across the top of the card; tapping the left/right halves of the card cycles photos',
      'Card content over a dark bottom gradient so white text stays readable: name + age, distance ("3 km away"), a one-line bio, and 2-3 interest chips',
      'Bottom action bar of circular white drop-shadow buttons with colored icons and hover lift: Rewind (↺ yellow), Nope (✕ red), Super Like (★ blue), Like (♥ green/pink), Boost (⚡ purple)',
      'Swipe physics: Like/Nope slides the card off with rotation while a rotated "LIKE" (green) or "NOPE" (red) stamp fades in over the photo before it leaves (CSS transitions/keyframes)',
      'Mutual match engine: each profile has a hidden likesYou flag; a match fires ONLY when you Like a profile that likes you back → full-screen "It\'s a Match!" modal with both avatars and "Send Message" / "Keep Swiping"',
      'Rewind: a buffer of the last swiped card; the yellow ↺ pulls it back onto the top of the stack',
      'A fixed bottom navigation with 3-4 tabs: Discovery (the deck), Matches/Chat, Profile — Matches shows a horizontal rail of round match avatars on top and a chat list below; opening a match shows a working local chat (send messages, your bubbles right-aligned in the brand gradient)',
      'Like limit: a counter of remaining free Likes (e.g. 20); when exhausted, show an upgrade-style modal blocking further likes; deck-empty state with "Start over"',
    ],
    visual: 'Bright white chrome like real Tinder: flame-glyph wordmark top-left tinted with the brand gradient; warm gradient (linear-gradient(45deg, #fd297b, #ff5864, #ff655b)) on the wordmark, LIKE stamp, match modal and primary buttons; profile card with 16px+ rounded corners, 4:5-ish aspect, deep soft shadow; soft grays for secondary text; the card dominates the screen like a card game.',
    reviewChecklist: [
      'photo cycling via left/right card taps with dash progress bars',
      'match modal ("It\'s a Match!") only when likesYou is true',
      'LIKE/NOPE stamp + card exit animation',
      'all five circular action buttons (rewind/nope/superlike/like/boost)',
      'rewind restores the last swiped card',
      'bottom tabs with a working matches + chat view',
      'no external image URLs',
    ],
  },
  {
    brand: 'Twitter/X',
    match: /\b(?:twitter|x\.com|tweet)\b/i,
    features: [
      'A three-column layout: left nav (Home, Explore, Notifications, Profile + a prominent Post button), center timeline, right "Who to follow" panel',
      'A composer at the top of the timeline with a character counter (280) and a disabled state when empty/over limit',
      'A seeded timeline of posts: avatar (initials on gradient), display name, @handle, relative time, text, and action row (reply, repost, like with live counts)',
      'Like and repost toggle on click with count changes and color feedback (pink like, green repost)',
      'Posting prepends your post to the timeline instantly',
    ],
    visual: 'Dark theme like X: near-black background, white text, single accent blue (#1d9bf0) for the Post button and active states, thin hairline borders between posts, round avatars.',
    reviewChecklist: ['three-column layout', 'character counter', 'working like/repost toggles', 'composer prepends posts'],
  },
  {
    brand: 'Instagram',
    match: /\b(?:instagram|insta\b|ig\s+clone)\b/i,
    features: [
      'A stories rail at the top: round gradient-ringed avatars with names',
      'A vertical feed of posts: header (avatar + username), a large visual area (CSS gradient art — no external images), action row (heart, comment, share), like count, caption with username',
      'Double-click/tap the post visual to like it with a big heart pop animation; the heart icon and count update',
      'A comment input per post that appends comments locally',
    ],
    visual: 'Clean white chrome, Instagram gradient (radial: #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5) on story rings and the wordmark, square-ish post visuals, compact typography.',
    reviewChecklist: ['stories rail with gradient rings', 'double-click like with heart pop', 'working comments', 'no external image URLs'],
  },
  {
    brand: 'Spotify',
    match: /\b(?:spotify|music\s+player\s+clone)\b/i,
    features: [
      'A dark three-part layout: left sidebar (Home, Search, Your Library, playlists), main grid of playlist/album cards (gradient cover art), and a fixed bottom player bar',
      'The player bar shows the current track (cover, title, artist), play/pause, next/previous, a moving progress bar, and a volume slider',
      'Clicking a track row starts "playing" it: the bar updates and the progress animates; play/pause actually toggles the progress',
      'A seeded library: 2-3 playlists with 5+ tracks each (title, artist, duration)',
    ],
    visual: 'Spotify identity: #121212 background, #1db954 green accent on play states and hover, rounded cards with hover lift, bottom bar fixed and always visible.',
    reviewChecklist: ['fixed bottom player with working play/pause + progress', 'sidebar + card grid', 'clicking tracks changes the player'],
  },
  {
    brand: 'Trello',
    match: /\b(?:trello|kanban\s+clone)\b/i,
    features: [
      'Horizontal board of lists (To Do / Doing / Done + "Add list"), each list a column of cards',
      'Add a card to any list; move cards left/right between lists with visible buttons (and drag if simple)',
      'Card labels (colored chips) and a card counter per list',
      'Board header with a board name and a subtle background',
    ],
    visual: 'Trello identity: a colorful board background (gradient), translucent white lists with rounded corners, compact white cards with shadows, blue (#0079bf) accents.',
    reviewChecklist: ['multiple lists with working add/move', 'labels + counters', 'board-style background'],
  },
];

export function detectBrandBlueprint(brief: string): BrandBlueprint | null {
  for (const blueprint of BRAND_BLUEPRINTS) {
    if (blueprint.match.test(brief)) return blueprint;
  }
  return null;
}
