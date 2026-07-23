import type { Message } from './models/adapter.js';

/**
 * Mutable facts people ask about real-world venues and services.
 *
 * Keep this grammar in one deterministic module: routing, retrieval, relevance,
 * and final-answer validation must agree about the shape the user requested.
 */
export type VenuePracticalDetailKind =
  | 'hours'
  | 'admission-price'
  | 'menu-price'
  | 'menu'
  | 'schedule'
  | 'contact'
  | 'address'
  | 'website'
  | 'parking'
  | 'accessibility';

// A dotted clock must not end in another dot. That distinction keeps common
// European hours such as `10.00-20.00`, while rejecting calendar dates such as
// `01.01.`. Do not make the hour/minute separator optional: `2026` is a year,
// not evidence that a shop opens at 20:26.
const CLOCK_TIME = String.raw`(?:[01]?\d|2[0-3]):[0-5]\d|(?:[01]?\d|2[0-3])\.[0-5]\d(?!\.)|(?:1[0-2]|0?[1-9])\s*(?:a\.?m\.?|p\.?m\.?)|(?:[01]?\d|2[0-3])\s*[-–—]\u200B?\s*(?:[01]?\d|2[0-3])\s*(?:uhr|h)`;
const CURRENCY_VALUE = /(?:(?:us|ca|au|nz|hk|sg|r)?[$€£¥₹₩₽₺₫₪₱฿₴₦]\s?\d(?:[\d,. ]*\d)?|\d(?:[\d,. ]*\d)?\s?(?:(?:usd|cad|aud|nzd|eur|gbp|jpy|cny|rmb|hkd|sgd|inr|krw|aed|sar|qar|chf|pln|czk|huf|ron|try|rub|brl|mxn|zar|nok|sek|dkk|isk|kr|kroner?|yen|yuan)\b|円|元|원|درهم)|\b\d{1,5},-(?=\s|$))/iu;

const INTERNATIONAL_HOURS_ANSWER_CUE = /\b(?:opening\s+hours?|hours?|open|closed|weekday|weekend|every\s+day|daily|alle\s+dager|hver\s+dag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|åpningstid(?:er)?|stengt|åpent|horarios?|abiert[oa]|lunes|martes|miércoles|jueves|viernes|sábado|domingo|horaires?|ouvert[es]?|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|öffnungszeiten|geöffnet|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|orari|apert[oa]|lunedì|martedì|mercoledì|giovedì|venerdì|domenica|horários?|abert[oa]|segunda|terça|quarta|quinta|sexta|openingstijden|geopend|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b|(?:営業時間|開店|閉店|营业时间|營業時間|영업시간)/iu;
const INTERNATIONAL_CLOSED_CUE = /\b(?:closed|stengt|stängd|lukket|cerrad[oa]|fermé[es]?|geschlossen|chius[oa]|fechad[oa]|gesloten)\b|(?:休業|定休日|休息|휴무)/iu;

export function detectVenuePracticalDetail(input: string): VenuePracticalDetailKind | null {
  const q = input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const asksFoodList = /\bfood\s+list\b/iu.test(q);

  // A mixed stale query can contain an earlier price phrase plus the user's new
  // hours question. Prefer the new, more specific answer shape in that case.
  // The vocabulary intentionally covers how people ask about shops around the
  // world: store/trading hours, "shut", day-specific open questions, common
  // European languages, and the most common CJK hours labels.
  const asksHours = [
    /\b(?:opening|closing|business|visitor|service|store|shop|trading|holiday)\s+(?:hours?|times?)\b/iu,
    /\b(?:opening|closing)\s+time\b/iu,
    /\b(?:when|what\s+time)\b.{0,100}\b(?:open|close|shut)\b/iu,
    /\b(?:open|close[sd]?|closed|shut[sd]?)\s+(?:at|today|tonight|tomorrow|now|on\s+(?:mon|tues?|wednes|thurs?|fri|satur|sun)days?)\b/iu,
    /^(?:is|are|does|do|will)\b.{1,100}\b(?:open|closed|close|shut|trade)\b.{0,40}(?:\?|$)/iu,
    /\b(?:åpningstid(?:er)?|åbningstid(?:er)?|öppettider|openingstijden)\b/iu,
    /\b(?:når|när|hvornår)\b.{0,80}\b(?:åpner|åbner|öppnar|stenger|stänger|lukker)\b/iu,
    /\b(?:åpent|åben|öppet|stengt|stängd|lukket)\b.{0,30}\b(?:nå|nu|idag|i\s+dag|søndag|söndag)\b/iu,
    /\b(?:horarios?|hora\s+de\s+(?:apertura|cierre))\b/iu,
    /\b(?:a\s+qu[eé]\s+hora|cu[aá]ndo)\b.{0,90}\b(?:abre|abren|cierra|cierran)\b/iu,
    /\b(?:horaires?|heure\s+d['’](?:ouverture|fermeture))\b/iu,
    /(?:^|\s)(?:à\s+quelle\s+heure|quand)\s+.{0,90}(?:ouvre|ouvrent|ferme|ferment)(?:\s|$)/iu,
    /(?:^|\s)(?:öffnungszeiten|wann)\s+.{0,90}(?:öffnet|öffnen|schließt|schliessen|schließen)(?:\s|$)|öffnungszeiten/iu,
    /\b(?:orari|quando)\b.{0,90}\b(?:apre|aprono|chiude|chiudono)\b|\borari\b/iu,
    /\b(?:hor[aá]rios?|quando)\b.{0,90}\b(?:abre|abrem|fecha|fecham)\b|\bhor[aá]rios?\b/iu,
    /(?:営業時間|開店時間|閉店時間|何時.{0,20}(?:開店|閉店))/u,
    /(?:营业时间|營業時間|几点.{0,20}(?:开门|关门|開門|關門))/u,
    /(?:영업시간|몇\s*시.{0,20}(?:열|닫))/u,
  ].some((pattern) => pattern.test(q));
  if (asksHours) {
    return 'hours';
  }
  if (asksFoodList) return 'menu';

  const asksPrice = /\b(?:prices?|pricing|costs?|how\s+much|priser?|pris|hva\s+koster)\b/iu.test(q);
  if (asksPrice && /\b(?:menu|food|dish(?:es)?|drinks?|meal(?:s)?|restaurant|cafe|café|meny|mat|retter?|drikke)\b/iu.test(q)) {
    return 'menu-price';
  }
  if (asksPrice && /\b(?:visit(?:ing)?|admission|entry|entrance|tickets?|day\s+passes?|family\s+passes?|lift\s+passes?|access|booking|book|besøk|inngang|billetter?)\b/iu.test(q)) {
    return 'admission-price';
  }
  if (/\b(?:menu|food\s+(?:served|available)|what\s+(?:do\s+they\s+serve|can\s+i\s+(?:eat|drink|order))|dishes?|drinks?|cuisine|vegan|vegetarian|gluten[ -]?free|meny(?:en)?|matservering|retter?|menú|carta|speisekarte|carte|メニュー)\b/iu.test(q)) {
    return 'menu';
  }
  if (/\b(?:schedule|timetable|session\s+times?|class\s+times?|tour\s+times?|show\s+times?|activity\s+times?|program(?:me)?|timeplan|rutetider?)\b/iu.test(q)) {
    return 'schedule';
  }
  if (/\b(?:phone(?:\s+number)?|telephone(?:\s+number)?|email(?:\s+address)?|contact(?:\s+details?|\s+information)?|how\s+can\s+i\s+(?:call|phone|email|reach|contact)|number\s+for|telefon(?:nummer)?|e-?post|kontaktinformasjon|tel[eé]fono|téléphone|kontakt|電話番号)\b/iu.test(q)) {
    return 'contact';
  }
  if (/\b(?:street\s+address|postal\s+address|what(?:'s|\s+is)\s+the\s+address|where\s+(?:is|are)\b.{0,80}\b(?:located|based)|where\s+can\s+i\s+find|location\s+of|directions|how\s+(?:do|can)\s+i\s+get\s+there|adresse|hvor\s+ligger|d[oó]nde\s+est[aá]|où\s+se\s+trouve|wo\s+(?:ist|befindet))\b/iu.test(q)) {
    return 'address';
  }
  if (/\b(?:official\s+website|home\s?page|booking\s+(?:page|site|link)|website|web\s?site|nettside)\b/iu.test(q)) {
    return 'website';
  }
  if (/\b(?:parking|car\s+park|where\s+can\s+i\s+park|parkering)\b/iu.test(q)) return 'parking';
  if (/\b(?:wheelchair|accessible|accessibility|step[ -]?free|disabled\s+access|tilgjengelighet|rullestol)\b/iu.test(q)) return 'accessibility';
  return null;
}

export function venuePracticalIntent(kind: VenuePracticalDetailKind): string {
  return kind === 'admission-price' ? kind : `venue-${kind}`;
}

export function venuePracticalKindFromIntent(intent: string): VenuePracticalDetailKind | null {
  if (intent === 'admission-price') return 'admission-price';
  if (!intent.startsWith('venue-')) return null;
  const kind = intent.slice('venue-'.length) as VenuePracticalDetailKind;
  return [
    'hours', 'menu-price', 'menu', 'schedule', 'contact', 'address', 'website', 'parking', 'accessibility',
  ].includes(kind) ? kind : null;
}

export function isVenuePracticalIntent(intent: string): boolean {
  return venuePracticalKindFromIntent(intent) !== null;
}

export function answerMatchesVenuePracticalDetail(
  kind: VenuePracticalDetailKind,
  answer: string,
): boolean {
  const text = answer.trim();
  if (!text) return false;
  // Reject refusal-shaped bodies, but do not reject a factual answer merely
  // because its closing confidence note says a second source was not found.
  // Venue answers should remain usable when one current first-party page is
  // the only authoritative source available.
  if (/^(?:(?:i|we)\s+(?:could\s+not|couldn't|did\s+not|didn't|(?:am|are|was|were)\s+unable|(?:found|searched)\b[^.\n]{0,220}\bbut\b)|none\s+(?:of\s+the\s+)?(?:pages|sources)|unable\s+to)\b/iu.test(text)) return false;
  const clock = new RegExp(`\\b${CLOCK_TIME}\\b`, 'i');
  switch (kind) {
    case 'hours':
      return (clock.test(text) || /\b(?:open\s+24\s+hours?|24\/7)\b/i.test(text))
        && (INTERNATIONAL_HOURS_ANSWER_CUE.test(text) || INTERNATIONAL_CLOSED_CUE.test(text));
    case 'admission-price':
      return CURRENCY_VALUE.test(text)
        && /\b(?:price|cost|ticket|admission|entry|entrance|pass|weekday|weekend|pris|billett|inngang)\b/iu.test(text);
    case 'menu-price':
      return CURRENCY_VALUE.test(text)
        && /\b(?:menu|food|dish|drink|meal|restaurant|cafe|café|meny|mat|rett|drikke)\b/iu.test(text);
    case 'menu':
      return /\b(?:menu|serves?|dishes?|drinks?|cuisine|breakfast|lunch|dinner|vegan|vegetarian|gluten[ -]?free|meny|serverer|retter?|drikke|frokost|lunsj|middag|menú|carta|carte|speisekarte)\b|メニュー/iu.test(text);
    case 'schedule':
      return clock.test(text) || /\b(?:schedule|timetable|session|class|tour|show|programme?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|timeplan|program|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b/iu.test(text);
    case 'contact':
      return /\b(?:phone|telephone|email|contact|telefon|e-?post|tel[eé]fono|téléphone|kontakt|telefono)\b|電話/iu.test(text)
        && (/(?:\+?\d[\d ()-]{5,}\d)/.test(text) || /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(text));
    case 'address':
      return /\b(?:address|located|location|street|road|avenue|gate|gata|vei|veien|adresse|direcci[oó]n|anschrift|indirizzo|endere[cç]o|post(?:al)?\s*code|\d{4,6}\s+[\p{L}])\b|(?:住所|地址|주소)/iu.test(text);
    case 'website':
      return /https?:\/\/[^\s)]+/i.test(text) || /\b(?:official\s+website|website|nettside)\b/iu.test(text);
    case 'parking':
      return /\b(?:parking|car\s+park|garage|spaces?|parkering|parkeringsplass)\b/iu.test(text);
    case 'accessibility':
      return /\b(?:wheelchair|accessible|accessibility|step[ -]?free|lift|elevator|disabled\s+access|rullestol|tilgjengelig)\b/iu.test(text);
  }
}

const REFERENTIAL_VENUE_CUE = /\b(?:their|its|they|them|it|there|that\s+place|this\s+place|the\s+place)\b/i;

export interface VenueProximityRequest {
  readonly venue: string;
  readonly anchor: string;
}

interface VenueProximityClause {
  readonly venueClause: string;
  readonly anchorClause: string;
}

/**
 * Split composite requests such as "menu for the Jønk nearest Bygdøy" into
 * the venue identity and the geographic anchor. Keep this grammar separate
 * from search ranking: proximity words are instructions, never branch-name
 * tokens. The variants cover ordinary English/Norwegian plus common global
 * formulations without maintaining a list of brands or cities.
 */
function splitVenueProximityClause(input: string): VenueProximityClause | null {
  const value = input.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const leadingRelation = /\b(?:closest|nearest)\s+(.{2,80}?)\s+(?:to|from|near)\s+(.+)$/iu.exec(value);
  if (leadingRelation?.[1] && leadingRelation[2]) {
    return {
      venueClause: `${value.slice(0, leadingRelation.index)} ${leadingRelation[1]}`.trim(),
      anchorClause: leadingRelation[2].trim(),
    };
  }
  const patterns = [
    /\b(?:n\u00e4rmast|n\u00e4rmsta|n\u00e4ra)\s+(.+)$/iu,
    /\b(?:dichtst\s+bij|in\s+de\s+buurt\s+van)\s+(.+)$/iu,
    /\b(?:najbli\u017cej|w\s+pobli\u017cu)\s+(.+)$/iu,
    /\b(?:closest|nearest)(?:\s+(?:branch|location|store|shop|restaurant|cafe|café|outlet))?\s+(?:to|from|near)\s+(.+)$/iu,
    /\bnearest\s+(.+)$/iu,
    /\b(?:close\s+to|near|around)\s+(.+)$/iu,
    /\b(?:nærmest|nær|i\s+nærheten\s+av)\s+(.+)$/iu,
    /\b(?:más\s+cerca\s+de|cerca\s+de)\s+(.+)$/iu,
    /\b(?:le\s+plus\s+proche\s+de|près\s+de)\s+(.+)$/iu,
    /\b(?:in\s+der\s+nähe\s+von|nächst(?:e|en|er|es)\s+(?:filiale\s+)?(?:zu|bei))\s+(.+)$/iu,
    /\b(?:più\s+vicino\s+a|vicino\s+a)\s+(.+)$/iu,
    /\b(?:mais\s+perto\s+de|perto\s+de)\s+(.+)$/iu,
    /(?:最寄り|近く)\s*(?:の|にある)?\s*(.+)$/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match?.[1] || match.index < 2) continue;
    return {
      venueClause: value.slice(0, match.index).trim(),
      anchorClause: match[1].trim(),
    };
  }
  return null;
}

/** Strip request grammar while retaining only the venue/entity needed by a follow-up. */
export function extractVenuePracticalSubject(input: string): string {
  const proximity = splitVenueProximityClause(input);
  let value = (proximity?.venueClause ?? input).normalize('NFKC')
    .replace(/^(?:hello|hi|hey)[,!.:;\s]+/i, '')
    .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?/i, '')
    .replace(/^(?:which|what)\s+(?:branch|location|store|shop|restaurant|cafe|outlet)\s+(?:of\s+)?/iu, '')
    .replace(/^(?:please\s+)?(?:find|look\s+up|search\s+for)\s+(?:me\s+)?/i, '')
    .replace(/^food\s+list\s+(?:for|from|at|of)\s+/iu, '')
    .replace(/^(?:finn|finn\s+meg)\s+(?:menyen?|mat|prisene?)\s+(?:til|for|fra)\s+/iu, '')
    .replace(/^(?:menu|meny|menyen|menú|speisekarte|carte)\s+(?:(?:of|for|at|til|fra|del|de|der|von|pour)\s+)?/iu, '')
    .replace(/^(?:please\s+)?(?:tell|show|give)\s+me\s+(?:about\s+)?/i, '')
    .replace(/^(?:what(?:'s|\s+is|\s+are)\s+)?(?:the\s+)?(?:price|prices|cost|costs)\s+(?:of|for|at|to)\s+(?:visit(?:ing)?|enter(?:ing)?|admission\s+(?:to|for))?\s*/i, '')
    .replace(/^how\s+much\s+(?:does|do|would|is|are)\s+(?:it\s+)?cost\s+(?:to\s+)?(?:visit|enter|go\s+to)?\s*/i, '')
    .replace(/^(?:what(?:'s|\s+is|\s+are)|when\s+(?:do|does|is|are)|what\s+time\s+(?:do|does|is|are))\s+(?:the\s+)?/i, '')
    .replace(/^(?:what\s+can\s+i\s+(?:eat|drink|order)\s+(?:at|from)|how\s+can\s+i\s+(?:call|phone|email|reach|contact)|where\s+can\s+i\s+find)\s+(?:the\s+)?/i, '')
    .replace(/^(?:store|shop|trading|holiday|opening|closing)\s+(?:hours?|times?)\s+(?:for|at|of)\s+/i, '')
    .replace(/^(?:¿?a\s+qu[eé]\s+hora|cu[aá]ndo)\s+(?:abre|abren|cierra|cierran)\s+/iu, '')
    .replace(/^(?:à\s+quelle\s+heure|quand)\s+(?:ouvre|ouvrent|ferme|ferment)\s+/iu, '')
    .replace(/^wann\s+(?:öffnet|öffnen|schließt|schliessen|schließen)\s+/iu, '')
    .replace(/^(?:når|när|hvornår)\s+(?:åpner|åbner|öppnar|stenger|stänger|lukker)\s+/iu, '')
    .replace(/\s+(?:and\s+)?what\s+are\s+(?:the|their|its)\s+(?:prices?|opening\s+hours?|hours?|menu).*$/i, '')
    .replace(/\s+(?:and\s+)?(?:when|what\s+time)\s+(?:do|does|is|are)\b.*$/i, '')
    // "open up" is ordinary speech for "open". Remove it as one request
    // phrase so the particle "up" cannot leak into the business identity and
    // poison a later search query (the observed Brygge Bakeren failure).
    .replace(/\b(?:open(?:ing)?|close|closing)\s+up\b/gi, ' ')
    .replace(/\b(?:opening|closing|business|visitor|service|store|shop|trading|holiday)\s+(?:hours?|times?)\b/gi, ' ')
    .replace(/\b(?:opening|closing)\s+time\b/gi, ' ')
    .replace(/\b(?:schedule|timetable|menu|meny|menú|speisekarte|carte|food|mat|dishes?|retter?|prices?|pricing|priser?|costs?|admission|entry|entrance|tickets?|contact\s+details?|phone\s+number|email\s+address|official\s+website|street\s+address|parking|accessibility)\b/giu, ' ')
    .replace(/\b(?:branch|location|outlet)\b/giu, ' ')
    .replace(/\bon\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekdays?|weekends?)\b/gi, ' ')
    .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|weekday|weekend)\b/gi, ' ')
    .replace(/\b(?:when|what|where|how|find|do|does|did|is|are|was|were|open|opens|opened|close|closes|closed|shut|shuts|trade|trades|up|at|for|of|to|visit|visiting|enter|their|its|they|them|it|there|that|this|place|please|current|today|tonight|tomorrow|now)\b/gi, ' ')
    .replace(/\b(?:når|när|hvornår|åpner|åbner|öppnar|stenger|stänger|lukker|i\s+dag|idag|nå|nu|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b/giu, ' ')
    .replace(/\b(?:a\s+qu[eé]\s+hora|cu[aá]ndo|abre|abren|cierra|cierran|horarios?|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/giu, ' ')
    .replace(/\b(?:à\s+quelle\s+heure|quand|ouvre|ouvrent|ferme|ferment|horaires?|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/giu, ' ')
    .replace(/\b(?:wann|öffnet|öffnen|schließt|schliessen|schließen|öffnungszeiten|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/giu, ' ')
    .replace(/(?:は)?何時(?:に)?(?:開店|閉店).*$/u, ' ')
    .replace(/(?:営業時間|開店時間|閉店時間).*$/u, ' ')
    .replace(/(?:几点|幾點).{0,12}(?:开门|关门|開門|關門).*$/u, ' ')
    .replace(/(?:营业时间|營業時間).*$/u, ' ')
    .replace(/(?:몇\s*시).{0,12}(?:열|닫).*$/u, ' ')
    .replace(/영업시간.*$/u, ' ')
    .replace(/\s+[—–-]\s+/g, ' ')
    .replace(/[?!.:,;¿¡]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = value.replace(/^(?:(?:the|a|an|der|die|das|den|det|la|le|les|el)\s+)+/iu, '').trim();
  return value.length >= 2 ? value.slice(0, 100).trim() : '';
}

export function extractVenueProximityRequest(input: string): VenueProximityRequest | null {
  const split = splitVenueProximityClause(input);
  if (!split) return null;
  const venue = extractVenuePracticalSubject(split.venueClause);
  const anchor = split.anchorClause
    .replace(/\s+(?:open|opens|opened|close|closes|closed|shut|shuts|phone|telephone|call)(?:\s+(?:today|tonight|tomorrow|now))?\s*[?!.:,;]*$/iu, '')
    .replace(/\b(?:menu|meny|menú|speisekarte|carte|opening\s+hours?|hours?|prices?|priser?|schedule|contact|address|website)\b.*$/iu, '')
    .replace(/[?!.:,;]+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return venue.length >= 2 && anchor.length >= 2 ? { venue, anchor } : null;
}

/**
 * Resolve practical-detail follow-ups using only the prior venue identity.
 * Never concatenate the prior requested detail (for example prices) into a
 * new detail request (for example hours).
 */
export function resolveVenuePracticalFollowUp(
  input: string,
  history: readonly Message[],
): string | null {
  const kind = detectVenuePracticalDetail(input);
  if (!kind) return null;

  const current = input.replace(/\s+/g, ' ').trim();
  const currentSubject = extractVenuePracticalSubject(current);
  if (currentSubject && !REFERENTIAL_VENUE_CUE.test(current)) return null;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role !== 'user' || typeof message.content !== 'string') continue;
    const candidate = message.content.replace(/\s+/g, ' ').trim();
    if (!candidate || candidate.toLowerCase() === current.toLowerCase()) continue;
    const subject = extractVenuePracticalSubject(candidate);
    if (!subject) continue;
    return `${subject} — ${current}`;
  }
  return null;
}
