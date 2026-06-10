/**
 * Request → domain model (the "understand the instruction" front end).
 *
 * The legacy builder routed a free-form request through a ~50-branch keyword
 * switch into one of a handful of fully pre-authored page templates. A request
 * it didn't recognise ("a landing page for a coffee shop") fell through to a
 * fixed "Signal Forge" developer-workflow page — the subject was discarded.
 *
 * This module does the opposite: it MODELS the request. It pulls out the actual
 * subject, classifies it into a domain category, and from that decides which
 * sections the page needs and what real, subject-appropriate content fills them.
 * A coffee shop becomes a café with a menu, hours, and a location — not a dev
 * tool. Unknown subjects degrade to a generic-but-subject-aware business page
 * rather than an unrelated template.
 *
 * Deterministic by design (Vai has no LLM). The category content here is still
 * authored vocab; the next step replaces that vocab with doc/-corpus retrieval
 * (the "read the docs" bridge). The architecture — model the request, then
 * compose sections — is the part that generalises.
 */

export type SectionId =
  | 'hero'
  | 'highlights'
  | 'menu'
  | 'services'
  | 'gallery'
  | 'hours'
  | 'location'
  | 'about'
  | 'testimonials'
  | 'contact';

export type Tone = 'warm' | 'fresh' | 'elegant' | 'professional' | 'neutral';

export interface Palette {
  readonly bg: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentText: string;
  readonly border: string;
}

export interface MenuItem { readonly name: string; readonly description: string; readonly price: string; }
export interface ServiceItem { readonly name: string; readonly description: string; readonly price?: string; }
export interface Highlight { readonly title: string; readonly body: string; }
export interface Hour { readonly day: string; readonly time: string; }
export interface Testimonial { readonly quote: string; readonly author: string; }

export interface DomainContent {
  readonly highlights: readonly Highlight[];
  readonly menu?: readonly MenuItem[];
  readonly services?: readonly ServiceItem[];
  readonly hours?: readonly Hour[];
  readonly location?: { readonly address: string; readonly note: string };
  readonly about: string;
  readonly testimonials: readonly Testimonial[];
  readonly contact: { readonly email: string; readonly phone: string };
  readonly ctaLabel: string;
  readonly ctaTitle: string;
  readonly ctaBody: string;
}

export type DomainCategory =
  | 'cafe'
  | 'bakery'
  | 'restaurant'
  | 'bar'
  | 'salon'
  | 'wellness'
  | 'florist'
  | 'retail'
  | 'professional'
  | 'generic';

export interface DomainModel {
  /** The real subject pulled from the request, e.g. "coffee shop". */
  readonly subject: string;
  /** A domain-appropriate brand placeholder (never an unrelated canned name). */
  readonly brandName: string;
  readonly category: DomainCategory;
  readonly tone: Tone;
  readonly palette: Palette;
  readonly eyebrow: string;
  readonly heroHeadline: string;
  readonly heroSub: string;
  readonly sections: readonly SectionId[];
  readonly content: DomainContent;
  /** 0–1 — how confident the classifier is that this is a real consumer-business landing. */
  readonly confidence: number;
}

// ── Palettes (light, warm-leaning — appropriate for consumer businesses) ──

const PALETTES: Record<Tone, Palette> = {
  warm: { bg: '#fbf6ef', surface: '#ffffff', text: '#2b211a', muted: '#7c6f63', accent: '#b4541f', accentText: '#ffffff', border: '#ece2d6' },
  fresh: { bg: '#f6faf6', surface: '#ffffff', text: '#1c2a22', muted: '#5f7468', accent: '#2f8f5b', accentText: '#ffffff', border: '#dcebe1' },
  elegant: { bg: '#faf7fb', surface: '#ffffff', text: '#241f2b', muted: '#6f6577', accent: '#8a5cf6', accentText: '#ffffff', border: '#ece4f3' },
  professional: { bg: '#f5f8fc', surface: '#ffffff', text: '#11233a', muted: '#5b6b80', accent: '#1f5fd6', accentText: '#ffffff', border: '#dde6f1' },
  neutral: { bg: '#f7f7f8', surface: '#ffffff', text: '#1d2025', muted: '#6b7280', accent: '#3f4654', accentText: '#ffffff', border: '#e6e7ea' },
};

// ── Shared content builders ──

function hashString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pick<T>(pool: readonly T[], seed: number): T {
  return pool[seed % pool.length];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'site';
}

function standardHours(): Hour[] {
  return [
    { day: 'Mon – Fri', time: '7:00 – 18:00' },
    { day: 'Saturday', time: '8:00 – 17:00' },
    { day: 'Sunday', time: '9:00 – 15:00' },
  ];
}

function standardLocation(): { address: string; note: string } {
  return { address: '24 Harbour Lane, Oslo', note: 'Two minutes from the waterfront — street parking and a tram stop on the corner.' };
}

function contactFor(brand: string): { email: string; phone: string } {
  return { email: `hello@${slug(brand)}.com`, phone: '+47 21 00 00 00' };
}

// ── Category knowledge base ──

interface CategoryDef {
  readonly id: DomainCategory;
  readonly match: RegExp;
  readonly tone: Tone;
  readonly brands: readonly string[];
  readonly sections: readonly SectionId[];
  readonly build: (subject: string, brand: string, seed: number) => Omit<DomainModel, 'subject' | 'brandName' | 'category' | 'palette' | 'sections' | 'confidence'>;
}

const CATEGORY_DEFS: readonly CategoryDef[] = [
  {
    id: 'cafe',
    match: /\b(coffee\s*shop|coffeehouse|coffee\s*house|caf[eé]|espresso\s*bar|roastery|coffee\s*bar)\b/i,
    tone: 'warm',
    brands: ['Morning Ritual', 'Daybreak Coffee', 'Crema & Co.', 'Common Grounds', 'The Roastery'],
    sections: ['hero', 'highlights', 'menu', 'hours', 'location', 'testimonials', 'contact'],
    build: (subject, brand) => ({
      tone: 'warm',
      eyebrow: 'Neighbourhood coffee',
      heroHeadline: 'Small-batch coffee, made slow and made right.',
      heroSub: `${brand} is a neighbourhood ${subject} pouring single-origin espresso, slow pour-overs, and fresh pastries from open to close.`,
      content: {
        highlights: [
          { title: 'Roasted in-house', body: 'Beans roasted weekly in small batches so every cup is bright, fresh, and never sat on a shelf.' },
          { title: 'Slow mornings welcome', body: 'Warm light, good seats, and fast wifi — stay for one cup or the whole morning.' },
          { title: 'Real pastries', body: 'Croissants, banana bread, and seasonal bakes delivered fresh each day from a local kitchen.' },
        ],
        menu: [
          { name: 'Espresso', description: 'A clean, balanced double shot pulled to order.', price: '38' },
          { name: 'Flat White', description: 'Velvety microfoam over a ristretto-forward base.', price: '49' },
          { name: 'Pour-Over', description: 'Single-origin, brewed by hand for clarity and lift.', price: '55' },
          { name: 'Cold Brew', description: 'Steeped 18 hours for a smooth, low-acidity finish.', price: '52' },
          { name: 'Butter Croissant', description: 'Laminated, flaky, and baked fresh every morning.', price: '42' },
          { name: 'Seasonal Bake', description: 'Ask the counter — it changes with what is good.', price: '46' },
        ],
        hours: standardHours(),
        location: standardLocation(),
        about: `${brand} started with one espresso machine and a simple idea: coffee worth slowing down for. We roast our own beans, bake fresh, and keep the room calm enough to actually enjoy it.`,
        testimonials: [
          { quote: 'The flat white here ruined every other coffee for me. Worth the walk.', author: 'Mari, regular since day one' },
          { quote: 'Best seats in the neighbourhood and the croissants sell out for a reason.', author: 'Jonas K.' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'See the menu',
        ctaTitle: 'Come in for a cup',
        ctaBody: 'Open early, every day. First pour-over is always worth the wait.',
      },
    }),
  },
  {
    id: 'bakery',
    match: /\b(bakery|bakeries|patisserie|p[aâ]tisserie|bread|pastry|pastries|cake\s*shop)\b/i,
    tone: 'warm',
    brands: ['Flour & Crumb', 'The Daily Loaf', 'Rise Bakery', 'Golden Hour Bakes', 'Hearth & Crumb'],
    sections: ['hero', 'highlights', 'menu', 'hours', 'location', 'testimonials', 'contact'],
    build: (subject, brand) => ({
      tone: 'warm',
      eyebrow: 'Baked fresh daily',
      heroHeadline: 'Bread and pastry, baked before you wake.',
      heroSub: `${brand} is a small ${subject} turning out sourdough, laminated pastry, and seasonal cakes from a wood-warm kitchen every morning.`,
      content: {
        highlights: [
          { title: 'Long-fermented', body: 'Our doughs rest 24–36 hours for deep flavour and a crust that actually crackles.' },
          { title: 'Daily bakes', body: 'Croissants, cinnamon rolls, and country loaves out of the oven by 7am.' },
          { title: 'Order ahead', body: 'Reserve a celebration cake or a dozen pastries and skip the morning queue.' },
        ],
        menu: [
          { name: 'Country Sourdough', description: 'Naturally leavened, open crumb, blistered crust.', price: '79' },
          { name: 'Butter Croissant', description: 'Twenty-seven layers of laminated French butter.', price: '42' },
          { name: 'Cinnamon Roll', description: 'Soft, gooey, finished with brown-butter glaze.', price: '48' },
          { name: 'Almond Danish', description: 'Frangipane, toasted almonds, a dusting of sugar.', price: '52' },
          { name: 'Seasonal Tart', description: 'Whatever fruit is at its best this week.', price: '58' },
          { name: 'Celebration Cake', description: 'Made to order — ask the counter for flavours.', price: 'from 450' },
        ],
        hours: standardHours(),
        location: standardLocation(),
        about: `${brand} is a one-room ${subject} that believes good bread takes time. We mill, mix, and bake on site, and we sell out most days — which is exactly how we like it.`,
        testimonials: [
          { quote: 'I plan my Saturdays around the croissants. They are that good.', author: 'Sofie A.' },
          { quote: 'The sourdough has real character — crust, chew, the whole thing.', author: 'Henrik L.' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'See what we bake',
        ctaTitle: 'Reserve your morning bake',
        ctaBody: 'Order ahead for pickup, or just come early before it sells out.',
      },
    }),
  },
  {
    id: 'restaurant',
    match: /\b(restaurant|bistro|eatery|diner|trattoria|brasserie|pizzeria|taqueria|ramen|sushi|steakhouse|kitchen|grill)\b/i,
    tone: 'fresh',
    brands: ['Saltwater Kitchen', 'The Long Table', 'Ember & Oak', 'Harvest Room', 'Northside Bistro'],
    sections: ['hero', 'highlights', 'menu', 'hours', 'location', 'testimonials', 'contact'],
    build: (subject, brand) => ({
      tone: 'fresh',
      eyebrow: 'Seasonal kitchen',
      heroHeadline: 'Seasonal plates, shared tables, no fuss.',
      heroSub: `${brand} is a ${subject} cooking honest, seasonal food — short menu, long table, and a room built for staying a while.`,
      content: {
        highlights: [
          { title: 'Market-led menu', body: 'The menu changes with the season and what arrives fresh that morning.' },
          { title: 'Built for sharing', body: 'Generous plates designed to land in the middle of the table.' },
          { title: 'Book a table', body: 'Walk-ins welcome at the bar; reserve ahead for the dining room.' },
        ],
        menu: [
          { name: 'Wood-fired Bread', description: 'House cultured butter, sea salt, olive oil.', price: '95' },
          { name: 'Catch of the Day', description: 'Line-caught, simply grilled, herb salsa.', price: '285' },
          { name: 'Slow Lamb', description: 'Eight-hour shoulder, charred greens, jus.', price: '320' },
          { name: 'Garden Plate', description: 'Roasted seasonal vegetables, grains, tahini.', price: '210' },
          { name: 'Burnt Honey Tart', description: 'Crème fraîche, toasted hazelnut.', price: '120' },
        ],
        hours: [
          { day: 'Tue – Thu', time: '17:00 – 22:00' },
          { day: 'Fri – Sat', time: '16:00 – 23:00' },
          { day: 'Sun – Mon', time: 'Closed' },
        ],
        location: standardLocation(),
        about: `${brand} is a neighbourhood ${subject} run by people who would rather cook one thing well than ten things loudly. Seasonal, local, and unhurried.`,
        testimonials: [
          { quote: 'Easily our favourite table in the city. The lamb is unforgettable.', author: 'Ingrid & Tom' },
          { quote: 'Short menu, perfect execution. We never order wrong here.', author: 'Petter V.' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'View the menu',
        ctaTitle: 'Reserve your table',
        ctaBody: 'The dining room fills up — book ahead, especially on weekends.',
      },
    }),
  },
  {
    id: 'salon',
    match: /\b(salon|hair\s*salon|barber|barbershop|beauty|spa|nail\s*(?:bar|salon)|stylist|grooming)\b/i,
    tone: 'elegant',
    brands: ['Studio Halo', 'The Chair', 'Lumen Hair', 'Atelier Grace', 'North & Co.'],
    sections: ['hero', 'highlights', 'services', 'hours', 'location', 'testimonials', 'contact'],
    build: (subject, brand) => ({
      tone: 'elegant',
      eyebrow: 'By appointment',
      heroHeadline: 'A cut that actually suits you.',
      heroSub: `${brand} is a ${subject} where the consultation matters as much as the chair — modern colour, precision cuts, and care that lasts past the appointment.`,
      content: {
        highlights: [
          { title: 'Real consultations', body: 'Every appointment starts with a proper conversation about hair, not a rushed glance.' },
          { title: 'Senior stylists', body: 'Experienced hands only — colour correction, balayage, and precision cutting.' },
          { title: 'Easy booking', body: 'Book online in under a minute and get a reminder the day before.' },
        ],
        services: [
          { name: 'Cut & Finish', description: 'Consultation, precision cut, and styling.', price: 'from 650' },
          { name: 'Colour', description: 'Single process, gloss, or full transformation.', price: 'from 1200' },
          { name: 'Balayage', description: 'Hand-painted, lived-in dimension.', price: 'from 1800' },
          { name: 'Treatment', description: 'Bond-building or deep-conditioning add-on.', price: 'from 350' },
        ],
        hours: [
          { day: 'Tue – Fri', time: '10:00 – 19:00' },
          { day: 'Saturday', time: '9:00 – 17:00' },
          { day: 'Sun – Mon', time: 'Closed' },
        ],
        location: standardLocation(),
        about: `${brand} is a small ${subject} built on one idea: you should leave looking like the best version of yourself, not a trend. Calm room, senior team, honest advice.`,
        testimonials: [
          { quote: 'First time in years I have left a salon genuinely happy. The colour is perfect.', author: 'Nora S.' },
          { quote: 'They listen. That is rare. Best cut I have had.', author: 'Amir H.' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'See services',
        ctaTitle: 'Book your appointment',
        ctaBody: 'Online booking is open now — pick a stylist and a time that works.',
      },
    }),
  },
  {
    id: 'wellness',
    match: /\b(yoga|pilates|meditation|wellness|massage|therapy\s*studio|reiki|mindfulness)\b/i,
    tone: 'elegant',
    brands: ['Still Studio', 'Breathing Room', 'Quiet Practice', 'The Mat', 'Anchor Wellness'],
    sections: ['hero', 'highlights', 'services', 'hours', 'location', 'testimonials', 'contact'],
    build: (subject, brand) => ({
      tone: 'elegant',
      eyebrow: 'A calmer practice',
      heroHeadline: 'Slow down, breathe, begin again.',
      heroSub: `${brand} is a ${subject} for every level — small classes, real teachers, and a room that asks nothing of you but to show up.`,
      content: {
        highlights: [
          { title: 'Small classes', body: 'Capped sizes so teachers can actually see and adjust you.' },
          { title: 'Every level', body: 'Beginner-friendly foundations through to strong, focused practice.' },
          { title: 'Drop in or commit', body: 'Single classes, intro offers, or monthly memberships — no pressure.' },
        ],
        services: [
          { name: 'Foundations', description: 'A gentle, well-taught place to start.', price: 'from 180' },
          { name: 'Vinyasa Flow', description: 'Breath-led movement with room to grow.', price: 'from 200' },
          { name: 'Restorative', description: 'Slow, supported, deeply quieting.', price: 'from 200' },
          { name: 'Private Session', description: 'One-to-one, built entirely around you.', price: 'from 850' },
        ],
        hours: [
          { day: 'Mon – Fri', time: '6:30 – 20:00' },
          { day: 'Saturday', time: '8:00 – 14:00' },
          { day: 'Sunday', time: '9:00 – 13:00' },
        ],
        location: standardLocation(),
        about: `${brand} is a ${subject} that keeps it simple: good teaching, small rooms, and a practice you can actually sustain. Come as you are.`,
        testimonials: [
          { quote: 'The only studio where I never feel behind. The teachers are wonderful.', author: 'Lena M.' },
          { quote: 'Calm, kind, and genuinely good instruction. It became my weekly reset.', author: 'David O.' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'See classes',
        ctaTitle: 'Book your first class',
        ctaBody: 'New here? The intro offer is the easiest place to start.',
      },
    }),
  },
  {
    id: 'florist',
    match: /\b(florist|flower\s*shop|floral|flowers|bouquet|blooms)\b/i,
    tone: 'fresh',
    brands: ['Wild Stem', 'Bloom & Branch', 'The Flower Room', 'Petal & Co.', 'Garden State'],
    sections: ['hero', 'highlights', 'services', 'gallery', 'location', 'contact'],
    build: (subject, brand) => ({
      tone: 'fresh',
      eyebrow: 'Seasonal flowers',
      heroHeadline: 'Flowers with a little wildness left in.',
      heroSub: `${brand} is a ${subject} arranging seasonal, locally grown stems — for a Tuesday, a wedding, or just because.`,
      content: {
        highlights: [
          { title: 'Seasonal & local', body: 'We buy what is blooming now, from growers we actually know.' },
          { title: 'Same-day delivery', body: 'Order before noon and we will hand-deliver across the city today.' },
          { title: 'Events & weddings', body: 'From a single table to a whole celebration — we love the big ones.' },
        ],
        services: [
          { name: 'Market Bouquet', description: 'A generous, seasonal hand-tie.', price: 'from 350' },
          { name: 'Weekly Flowers', description: 'Fresh stems delivered every week.', price: 'from 300/wk' },
          { name: 'Events', description: 'Arrangements, installs, and styling.', price: 'on request' },
          { name: 'Weddings', description: 'Full floral design, start to aisle.', price: 'on request' },
        ],
        location: standardLocation(),
        about: `${brand} is a small ${subject} that believes flowers should look like they were just gathered, not manufactured. Seasonal, local, and a little untamed.`,
        testimonials: [
          { quote: 'The most beautiful bouquet I have ever received. People still ask about it.', author: 'Camilla R.' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'See arrangements',
        ctaTitle: 'Send flowers today',
        ctaBody: 'Order before noon for same-day delivery across the city.',
      },
    }),
  },
  {
    id: 'professional',
    match: /\b(dentist|dental|clinic|law\s*firm|lawyer|attorney|accountant|accounting|consult(?:ing|ant)|agency|real\s*estate|realtor|architect|plumber|electrician|contractor|insurance|financial\s*advisor|physiotherap)\b/i,
    tone: 'professional',
    brands: ['Meridian', 'Northpoint', 'Clearwater', 'Atlas Partners', 'Bridgewell'],
    sections: ['hero', 'highlights', 'services', 'about', 'testimonials', 'contact'],
    build: (subject, brand) => ({
      tone: 'professional',
      eyebrow: 'Trusted local practice',
      heroHeadline: 'Expert help, explained in plain language.',
      heroSub: `${brand} is a ${subject} that does the hard part for you — clear advice, steady hands, and no jargon you have to decode later.`,
      content: {
        highlights: [
          { title: 'Clear from day one', body: 'You will always know what is happening, what it costs, and what comes next.' },
          { title: 'Experienced team', body: 'Senior practitioners who have handled cases like yours many times over.' },
          { title: 'Responsive', body: 'Real people who call you back the same day — not a ticket queue.' },
        ],
        services: [
          { name: 'Consultation', description: 'An honest first conversation about your situation.', price: 'Free' },
          { name: 'Core Service', description: 'The day-to-day work we are known for, done properly.', price: 'on request' },
          { name: 'Ongoing Care', description: 'Steady support so nothing falls through the cracks.', price: 'on request' },
        ],
        about: `${brand} is a ${subject} built on trust earned one client at a time. We keep our caseload deliberate so every client gets the attention they came for.`,
        testimonials: [
          { quote: 'They explained everything clearly and made a stressful process easy. Highly recommend.', author: 'A. Berg' },
          { quote: 'Responsive, professional, and genuinely on my side throughout.', author: 'M. Solberg' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'Our services',
        ctaTitle: 'Book a free consultation',
        ctaBody: 'Start with a no-obligation conversation. We will tell you honestly if we can help.',
      },
    }),
  },
  {
    id: 'retail',
    match: /\b(bookstore|book\s*shop|boutique|record\s*shop|plant\s*shop|gift\s*shop|toy\s*store|concept\s*store|homeware)\b/i,
    tone: 'warm',
    brands: ['Foxglove', 'The Corner', 'Marlowe & Sons', 'Field Notes', 'Goodwell'],
    sections: ['hero', 'highlights', 'gallery', 'hours', 'location', 'contact'],
    build: (subject, brand) => ({
      tone: 'warm',
      eyebrow: 'An independent shop',
      heroHeadline: 'A small shop, carefully kept.',
      heroSub: `${brand} is an independent ${subject} stocked with things worth owning — chosen by hand, not by an algorithm.`,
      content: {
        highlights: [
          { title: 'Hand-picked', body: 'Everything on the shelves is here because we love it, not because it sells fastest.' },
          { title: 'Knowledgeable staff', body: 'Ask us anything — we actually use and read what we stock.' },
          { title: 'Local & online', body: 'Shop in person, or order online and we will ship it the same week.' },
        ],
        hours: standardHours(),
        location: standardLocation(),
        about: `${brand} is a neighbourhood ${subject} run by people who care about the things they sell. Come browse — there is always something new tucked on a shelf.`,
        testimonials: [
          { quote: 'My favourite shop in the city. I never leave empty-handed.', author: 'Eline T.' },
        ],
        contact: contactFor(brand),
        ctaLabel: 'See the shop',
        ctaTitle: 'Come browse',
        ctaBody: 'Open most days — drop in, or message us and we will set something aside.',
      },
    }),
  },
];

const GENERIC_DEF: CategoryDef = {
  id: 'generic',
  match: /.*/,
  tone: 'neutral',
  brands: ['Brightwell', 'Northline', 'Common Co.', 'Beacon', 'Mainstay'],
  sections: ['hero', 'highlights', 'about', 'testimonials', 'contact'],
  build: (subject, brand) => ({
    tone: 'neutral',
    eyebrow: 'Now open',
    heroHeadline: subject ? `Everything you need from a ${subject}, done right.` : 'A simple site, done right.',
    heroSub: `${brand} is a ${subject || 'local business'} focused on doing one thing well and treating people the way they would want to be treated.`,
    content: {
      highlights: [
        { title: 'Straightforward', body: 'No runaround. You will know exactly what to expect from your first visit.' },
        { title: 'People-first', body: 'We treat every customer like the reason we are here — because you are.' },
        { title: 'Always improving', body: 'We listen, we adjust, and we get a little better every week.' },
      ],
      about: `${brand} is a ${subject || 'local business'} that keeps things simple and honest. Whatever brought you here, we are glad you came.`,
      testimonials: [
        { quote: 'Friendly, reliable, and exactly what they promise. I keep coming back.', author: 'A happy regular' },
      ],
      contact: contactFor(brand),
      ctaLabel: 'Learn more',
      ctaTitle: 'Come say hello',
      ctaBody: 'Reach out any time — we would love to hear from you.',
    },
  }),
};

// ── Subject extraction ──

const BUILD_NOISE = /\b(?:build|create|make|generate|design|develop|scaffold|please|me|a|an|the|my|our|small|simple|basic|quick|nice|clean|modern|polished|gorgeous|beautiful|landing\s*page|website|web\s*site|web\s*page|homepage|home\s*page|site|page|one[-\s]?page|for)\b/gi;

/** Pull the real subject out of a build request ("...for a coffee shop" -> "coffee shop"). */
export function extractSubject(desc: string): string {
  const text = desc.toLowerCase().replace(/\s+/g, ' ').trim();

  const forMatch = /\b(?:landing\s*page|website|web\s*site|web\s*page|homepage|home\s*page|site|page)\s+for\s+(?:a|an|my|our|the)?\s*([a-z][a-z\s&'-]{2,40}?)(?:\s+(?:that|which|with|to|in|using|—|-|\.)|$)/i.exec(text);
  if (forMatch?.[1]) return cleanSubject(forMatch[1]);

  const forAny = /\bfor\s+(?:a|an|my|our|the)\s+([a-z][a-z\s&'-]{2,40}?)(?:\s+(?:that|which|with|to|in|using|—|-|\.)|$)/i.exec(text);
  if (forAny?.[1]) return cleanSubject(forAny[1]);

  const possessive = /\b(?:a|an|my|our)\s+([a-z][a-z\s&'-]{2,40}?)\s+(?:landing\s*page|website|web\s*site|site|homepage|home\s*page|brand|business|shop|store)\b/i.exec(text);
  if (possessive?.[1]) return cleanSubject(possessive[1]);

  // Fallback: strip the build/scaffolding words and keep what remains.
  const stripped = text.replace(BUILD_NOISE, ' ').replace(/\s+/g, ' ').trim();
  return cleanSubject(stripped);
}

function cleanSubject(value: string): string {
  return value
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .replace(/\b(?:landing\s*page|website|web\s*site|site|page|homepage|home\s*page)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ');
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

function classify(subject: string, fullDesc: string): CategoryDef {
  const haystack = `${subject} ${fullDesc}`;
  for (const def of CATEGORY_DEFS) {
    if (def.match.test(haystack)) return def;
  }
  return GENERIC_DEF;
}

/**
 * Analyse a build request into a domain model. Returns null only when there is
 * nothing to model (empty/degenerate input). `confidence` is high when the
 * subject mapped to a known category and lower for the generic fallback so
 * callers can decide whether to defer to a more specific generator.
 */
export function analyzeRequest(desc: string): DomainModel | null {
  const cleaned = (desc || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) return null;

  const subject = extractSubject(cleaned) || 'local business';
  const def = classify(subject, cleaned);
  const seed = hashString(subject || cleaned);

  // An explicit brand the user named in quotes / "called X" wins over the pool.
  const named = /\b(?:called|named)\s+["']?([A-Za-z][A-Za-z0-9&'\s-]{1,32})["']?/.exec(desc)?.[1]
    ?? /["“]([A-Za-z][A-Za-z0-9&'\s-]{1,32})["”]/.exec(desc)?.[1];
  const brandName = named ? titleCase(named.trim()) : pick(def.brands, seed);

  const built = def.build(subject, brandName, seed);
  const confidence = def.id === 'generic' ? 0.45 : 0.85;

  return {
    subject,
    brandName,
    category: def.id,
    sections: def.sections,
    palette: PALETTES[def.tone],
    confidence,
    ...built,
  };
}
