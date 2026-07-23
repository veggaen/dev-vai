import { describe, expect, it } from 'vitest';
import type { SearchSnippet } from './types.js';
import {
  buildSearchPlan,
  buildProbableOfficialVenueUrls,
  extractAdmissionPriceExcerpt,
  extractOpeningHoursExcerpt,
  extractVenueOpeningHoursExcerpt,
  extractSnoOsloOpeningHoursExcerpt,
  extractSnoOsloPriceExcerpt,
  decodeYahooRedirectUrl,
  parseYahooSearchHtml,
  parseStartpageSearchHtml,
  extractPageIdentitySignals,
  extractRelevantVenueResourceLinks,
  extractStructuredVenueBranchSignals,
  extractStructuredOpeningHoursSignals,
  extractNearbyVenueContainerNames,
  extractOfficialVenueBranchCandidates,
  extractVenueMenuItems,
  extractVenueContactExcerpt,
  extractVenueVerificationAddress,
  extractVenueVerificationIdentifier,
  looksLikeFirstPartyVenueResult,
  looksLikeTransactionalVenueMenuResult,
  promoteVerifiedVenueSources,
  isKnownOfficialAdmissionPriceUrl,
  isKnownOfficialVenueDetailUrl,
  resolveKnownOfficialAdmissionPricePage,
  resolveKnownOfficialVenueDetailPage,
  filterRelevantSnippetsForQuery,
  scoreSnippetRelevanceForQuery,
  selectNearestVenueBranch,
  sourceMatchesResolvedVenueBranch,
} from './pipeline.js';

function snippet(title: string, text: string, domain = 'example.com', rank = 1): SearchSnippet {
  return {
    title,
    text,
    domain,
    url: `https://${domain}/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`,
    favicon: '',
    trust: { tier: domain.includes('wikipedia') ? 'high' : 'medium', score: domain.includes('wikipedia') ? 0.9 : 0.6, reason: 'test' },
    rank,
  };
}

describe('buildSearchPlan normalization', () => {
  it('strips web-search study preambles and trailing build instructions', () => {
    const plan = buildSearchPlan(
      'Use web search to study Base44 and Perplexity, then build the first grounded slice of a hybrid product I can preview.',
    );

    const entities = plan.entities.map((entity) => entity.toLowerCase());
    const fanOut = plan.fanOutQueries.join(' ').toLowerCase();

    expect(entities).toContain('base44');
    expect(entities).toContain('perplexity');
    expect(entities).not.toContain('study');
    expect(fanOut).not.toContain('to study');
    expect(fanOut).not.toContain('grounded slice');
  });

  it('routes venue admission pricing to official ticket pages, not market-price queries', () => {
    const plan = buildSearchPlan(
      'hello, what is the price of visiting the snow park in oslo the snø and what are their prices?',
    );
    const fanOut = plan.fanOutQueries.join('\n').toLowerCase();

    expect(plan.intent).toBe('admission-price');
    expect(fanOut).toContain('official prices');
    expect(fanOut).toContain('oslo snø official prices tickets');
    expect(fanOut).toContain('oslo sno official ticket prices products');
    expect(fanOut).toContain('tickets admission prices');
    expect(fanOut).toContain('day pass family pass prices');
    expect(fanOut).not.toContain('current price usd');
    expect(fanOut).not.toContain('live price now');
  });

  it.each([
    ['SNØ Oslo — what are their opening hours?', 'venue-hours', 'official opening hours'],
    ['what is the current menu at Maaemo?', 'venue-menu', 'official menu'],
    ['what does the food cost on the menu at Maaemo?', 'venue-menu-price', 'official menu prices'],
    ['what is the snow park schedule?', 'venue-schedule', 'official schedule timetable'],
  ])('routes practical venue detail: %s', (query, intent, fanOutCue) => {
    const plan = buildSearchPlan(query);
    expect(plan.intent).toBe(intent);
    expect(plan.fanOutQueries.join('\n').toLowerCase()).toContain(fanOutCue);
  });

  it('turns a spoken direct local-business question into entity-first multilingual searches', () => {
    const plan = buildSearchPlan('when does the bakery on hommersåk open up? brygge bakeren');
    const fanOut = plan.fanOutQueries.join('\n').toLowerCase();
    expect(plan.intent).toBe('venue-hours');
    expect(fanOut).toContain('brygge bakeren');
    expect(fanOut).toContain('hommersåk');
    expect(fanOut).toContain('opening hours');
    expect(fanOut).toContain('åpningstider');
    expect(fanOut).not.toContain('when does');
    expect(fanOut).not.toMatch(/\bopen up\b/);
  });

  it.each([
    "can you find meny of jønk' burgers closest to bygøy",
    'menu for the Jønk Burger nearest Bygdøy',
    'what can I eat at the closest Jønk restaurant to Bygdøy?',
    'finn menyen til Jønk Burger nærmest Bygdøy',
  ])('plans nearest-branch menu questions as location then menu discovery: %s', (query) => {
    const plan = buildSearchPlan(query);
    const fanOut = plan.fanOutQueries.join('\n').toLowerCase();
    expect(plan.intent).toBe('venue-menu');
    expect(plan.fanOutQueries[0].toLowerCase()).toContain('official locations');
    expect(fanOut).toMatch(/byg(?:d)?øy/);
    expect(fanOut).toContain('menu');
    expect(fanOut).not.toContain('burgers closest');
  });

  it.each([
    ['¿A qué hora abre Zara Gran Vía?', 'Zara Gran Vía horarios de apertura oficial'],
    ['À quelle heure ouvre Printemps Haussmann ?', "Printemps Haussmann horaires d'ouverture officiel"],
    ['Wann öffnet KaDeWe Berlin?', 'KaDeWe Berlin Öffnungszeiten offiziell'],
    ['渋谷のユニクロは何時に開店しますか', '営業時間 公式'],
  ])('uses the question language for global venue discovery: %s', (query, expectedQuery) => {
    const plan = buildSearchPlan(query);
    expect(plan.intent).toBe('venue-hours');
    expect(plan.fanOutQueries[0]).toContain(expectedQuery);
  });
});

describe('Yahoo local-business discovery', () => {
  it('decodes and parses organic result destinations without Yahoo chrome', () => {
    const destination = 'https://www.bryggebakeren.no/';
    const redirect = `https://r.search.yahoo.com/_ylt=test/RV=2/RE=1/RO=10/RU=${encodeURIComponent(destination)}/RK=2/RS=test`;
    const html = `<ol class="searchCenterMiddle"><li><div class="dd algo"><div class="compTitle"><a href="${redirect}"><div>domain</div><h3><span>Brygge Bakeren - Hommersåk</span></h3></a></div><div class="compText"><p>Brygge Bakeren is a local bakery in Hommersåk with current business details.</p></div></div></li></ol>`;
    expect(decodeYahooRedirectUrl(redirect)).toBe(destination);
    expect(parseYahooSearchHtml(html)).toEqual([{
      title: 'Brygge Bakeren - Hommersåk',
      snippet: 'Brygge Bakeren is a local bakery in Hommersåk with current business details.',
      url: destination,
    }]);
  });

  it('decodes localized HTML entities in organic titles', () => {
    const destination = 'https://www.bryggebakeren.no/';
    const redirect = `https://r.search.yahoo.com/RU=${encodeURIComponent(destination)}/RK=2/RS=test`;
    const html = `<ol class="searchCenterMiddle"><li><div class="compTitle"><a href="${redirect}"><h3>Brygge Bakeren - Hommers&aring;k</h3></a></div><div class="compText"><p>Lokalt bakeri med kontaktinformasjon og detaljer.</p></div></li></ol>`;
    expect(parseYahooSearchHtml(html)[0]?.title).toBe('Brygge Bakeren - Hommersåk');
  });

  it('keeps a footer phone as a stable first-party verification identifier', () => {
    const identity = extractPageIdentitySignals(`
      <main><h1>Brygge Bakeren</h1></main>
      <footer><a href="tel:51%2060%2056%2056">Ring oss</a></footer>
    `);
    expect(identity).toBe('Phone: 51 60 56 56');

    const source: SearchSnippet = {
      ...snippet('Brygge Bakeren', `Om bakeriet\n\n${identity}`, 'bryggebakeren.no'),
      trust: { tier: 'high', score: 0.82, reason: 'First-party venue domain/title match: bryggebakeren.no' },
    };
    expect(extractVenueVerificationIdentifier([source])).toBe('51 60 56 56');
  });

  it('keeps a plain-text phone found only in a business footer', () => {
    const identity = extractPageIdentitySignals(`
      <main><p>Fresh bread every day.</p></main>
      <footer><div class="footer-contacts"><p>Kaiveien 27</p><p>4310 Hommersåk</p><p>51 60 56 56</p></div></footer>
    `);
    expect(identity).toContain('Phone: 51 60 56 56');
    expect(identity).toContain('Street address: Kaiveien 27');
    expect(identity).toContain('Postal locality: 4310 Hommersåk');

    const source: SearchSnippet = {
      ...snippet('Brygge Bakeren', identity, 'bryggebakeren.no'),
      trust: { tier: 'high', score: 0.82, reason: 'First-party venue domain/title match: bryggebakeren.no' },
    };
    expect(extractVenueVerificationAddress([source])).toBe('Kaiveien 27, 4310 Hommersåk');
  });

  it('recovers a generic seven-day store schedule from application hydration JSON', () => {
    const html = `<script>{"physicalStoreExtendedDetails":{"name":"GRAN VIA","openingHours":{"schedule":[
      {"weekDay":1,"hours":["10:00","22:00"],"open":true},
      {"weekDay":7,"hours":["11:00","21:00"],"open":true}
    ]}}}</script>`;
    expect(extractStructuredOpeningHoursSignals(html)).toEqual([
      'Opening hours: Monday 10:00–22:00',
      'Opening hours: Sunday 11:00–21:00',
    ]);
    expect(extractPageIdentitySignals(html)).toContain('Opening hours: Monday 10:00–22:00');
  });

  it('recovers standard schema.org openingHoursSpecification data', () => {
    const html = `<script type="application/ld+json">{
      "@type":"Store",
      "openingHoursSpecification":{"dayOfWeek":["https://schema.org/Monday","Tuesday"],"opens":"09:30","closes":"18:00"}
    }</script>`;
    expect(extractStructuredOpeningHoursSignals(html)).toEqual([
      'Opening hours: Monday–Tuesday 09:30–18:00',
    ]);
  });

  it('does not mistake a footer date for a business phone identifier', () => {
    const identity = extractPageIdentitySignals(`
      <footer><p>Updated 21-12-2022</p><p>Kaiveien 27</p><p>4310 Hommersåk</p></footer>
    `);
    expect(identity).not.toContain('Phone: 21-12-2022');
  });

  it('selects named retail containers near a verified street address', () => {
    expect(extractNearbyVenueContainerNames([
      { tags: { name: 'Bryggen Senter', shop: 'mall' } },
      { tags: { name: 'Bryggen Senter', building: 'retail' } },
      { tags: { name: 'Unrelated road', highway: 'residential' } },
    ])).toEqual(['Bryggen Senter']);
  });

  it('does not promote directories whose own brand appears in a result-title suffix', () => {
    const subjectTokens = ['brygge', 'bakeren'];
    expect(looksLikeFirstPartyVenueResult(
      'cylex.no',
      'Brygge Bakern AS | Bakeri, Hommersåk - CYLEX Lokalt Søk Norge',
      'Contact details and opening hours for Brygge Bakern.',
      subjectTokens,
    )).toBe(false);
    expect(looksLikeFirstPartyVenueResult(
      'favrit.com',
      'Brygge bakeren HommersÃ¥k - Favrit',
      'The section opens tomorrow at 05:00.',
      subjectTokens,
    )).toBe(false);
    expect(looksLikeFirstPartyVenueResult(
      'sandnesposten.no',
      'Bakeriet hedret - Sandnesposten',
      'Brygge Bakeren has a bakery at HommersÃ¥k.',
      subjectTokens,
    )).toBe(false);
    expect(looksLikeFirstPartyVenueResult(
      'bryggebakeren.no',
      'Brygge Bakeren - Kaker og håndverksbakst',
      'Brygge Bakeren is a local bakery.',
      subjectTokens,
    )).toBe(true);
    expect(looksLikeFirstPartyVenueResult(
      'zara.com',
      'ZARA MADRID GRAN VIA Horarios e Información | ZARA España',
      'Opening hours for ZARA GRAN VIA, CALLE GRAN VIA 34, Madrid.',
      ['zara', 'gran', 'madrid'],
    )).toBe(true);
    expect(looksLikeFirstPartyVenueResult(
      'ikea.com',
      'IKEA Shibuya store information',
      'Opening hours and access for IKEA Shibuya.',
      ['ikea', 'shibuya'],
    )).toBe(true);
    expect(looksLikeFirstPartyVenueResult(
      'lawsons.co.uk',
      'Store Locator - Lawsons',
      'Find your nearest Lawsons branch and opening hours.',
      ['lawsons'],
    )).toBe(true);
    expect(looksLikeFirstPartyVenueResult(
      'bryggensenter.no',
      'Butikkoversikt - Bryggen Senter',
      'BRYGGE BAKER N opening hours.',
      subjectTokens,
    )).toBe(true);
    expect(looksLikeFirstPartyVenueResult(
      'jonkburger.no',
      'LOCATION | JØNK | Juicy smash burgers',
      'Explore our locations and find the closest JØNK.',
      ['jonk', 'burgers'],
    )).toBe(true);
  });

  it('promotes exact transactional menu pages but not generic platform listings', () => {
    const query = 'JØNK Colosseum menu';
    expect(looksLikeTransactionalVenueMenuResult(
      'foodora.no',
      'JØNK Colosseum - Oslo - foodora levering, meny',
      'BBQ Burger Meal fra 295 NOK. Premium Smash Beef menu.',
      query,
    )).toBe(true);
    expect(looksLikeTransactionalVenueMenuResult(
      'wolt.com',
      'Restaurants near you',
      'Browse restaurants and delivery options.',
      query,
    )).toBe(false);

    expect(looksLikeTransactionalVenueMenuResult(
      'orders.example.nz',
      'Cedar House Central menu and delivery',
      'Cedar Burger 22 NZD. House Fries 9 NZD. Order food online.',
      'Cedar House Central menu',
    )).toBe(true);
  });

  it('promotes an unknown merchant only after its read page proves multiple menu rows', () => {
    const candidate: SearchSnippet = {
      ...snippet('Cedar House Central menu', [
        'Cedar House Central menu',
        'Cedar Burger',
        '22 NZD',
        'House Fries',
        '9 NZD',
        'Garden Salad',
        '14 NZD',
      ].join('\n'), 'orders.example.nz'),
      trust: { tier: 'low', score: 0.45, reason: 'candidate' },
    };
    const [promoted] = promoteVerifiedVenueSources([candidate], 'Cedar House Central menu', 'menu');
    expect(promoted.trust.tier).toBe('medium');
    expect(promoted.trust.reason).toContain('Verified exact venue menu structure');

    const [notPromoted] = promoteVerifiedVenueSources([{
      ...candidate,
      text: 'Cedar House Central menu - one burger from 22 NZD.',
    }], 'Cedar House Central menu', 'menu');
    expect(notPromoted.trust.tier).toBe('low');
  });

  it('extracts branch labels, compares distance, and ignores product rows', () => {
    const branches = extractOfficialVenueBranchCandidates([
      'EXPLORE OUR LOCATIONS',
      'JØNK Grorud',
      'JØNK Mortensrud',
      'JØNK Røa',
      'JØNK Grønland',
      'JØNK Colosseum',
      'JØNK Fries',
    ].join('\n'), 'Jønk Burgers');
    expect(branches.map((branch) => branch.localityHint)).toEqual([
      'Grorud', 'Mortensrud', 'Røa', 'Grønland', 'Colosseum',
    ]);
    const nearest = selectNearestVenueBranch(
      { latitude: 59.9070, longitude: 10.6797, displayName: 'Bygdøy, Oslo, Norway' },
      [
        { ...branches[0], latitude: 59.9614, longitude: 10.8805, displayName: 'Grorud, Oslo' },
        { ...branches[4], latitude: 59.9296, longitude: 10.7104, displayName: 'Colosseum, Oslo' },
      ],
    );
    expect(nearest?.name).toBe('JØNK Colosseum');
    expect(nearest?.distanceKm).toBeGreaterThan(2);
    expect(nearest?.distanceKm).toBeLessThan(4);
  });

  it('extracts brand-suffix, labelled, and structured branch patterns', () => {
    const visible = extractOfficialVenueBranchCandidates([
      'Our locations',
      'Oxford Street | Northstar Books',
      'Location: Covent Garden',
      'Northstar Books at Kings Cross',
    ].join('\n'), 'Northstar Books');
    expect(visible.map((branch) => branch.localityHint)).toEqual([
      'Oxford Street', 'Covent Garden', 'Kings Cross',
    ]);

    const cards = extractOfficialVenueBranchCandidates([
      'Lawsons Acton',
      '2/4 Colville Road London Acton W3 8BL GB',
      'Monday 07:00 - 16:45',
      'Contact Us | Lawsons',
      'Lawsons Bedford',
      'Cambridge Road Bedfordshire Bedford MK42 0LH GB',
    ].join('\n'), 'Lawsons');
    expect(cards.map((branch) => branch.localityHint)).toEqual(['Acton', 'Bedford']);
    expect(cards[0].addressHint).toBe('2/4 Colville Road London Acton W3 8BL GB');
    expect(cards[1].addressHint).toBe('Cambridge Road Bedfordshire Bedford MK42 0LH GB');

    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        {
          '@type': 'Restaurant',
          name: 'Northstar Cafe Shibuya',
          address: { streetAddress: '1-2-3 Jinnan', addressLocality: 'Shibuya', addressRegion: 'Tokyo', postalCode: '150-0041' },
        },
        {
          '@type': 'Restaurant',
          name: 'Northstar Cafe Ginza',
          address: { streetAddress: '4-5-6 Ginza', addressLocality: 'Chuo', addressRegion: 'Tokyo', postalCode: '104-0061' },
        },
      ],
    })}</script>`;
    const signals = extractStructuredVenueBranchSignals(html, 'menu for Northstar Cafe nearest Tokyo Station');
    const structured = extractOfficialVenueBranchCandidates(signals, 'Northstar Cafe');
    expect(structured).toHaveLength(2);
    expect(structured[0]).toMatchObject({ localityHint: 'Shibuya, Tokyo' });
    expect(structured[0].addressHint).toContain('1-2-3 Jinnan');

    const linkedSignals = extractStructuredVenueBranchSignals(
      '<a href="/restaurants/northstar-shibuya/">Northstar Cafe Shibuya</a><a href="/menu">Northstar Cafe Menu</a>',
      'Northstar Cafe nearest Tokyo Station',
      'https://northstar.example/locations/',
    );
    const linked = extractOfficialVenueBranchCandidates(linkedSignals, 'Northstar Cafe');
    expect(linked).toEqual([{
      name: 'Northstar Cafe Shibuya',
      localityHint: 'Shibuya',
      urlHint: 'https://northstar.example/restaurants/northstar-shibuya/',
    }]);
  });

  it('keeps exact branch pages separate from chain-wide contact pages', () => {
    expect(sourceMatchesResolvedVenueBranch(
      { title: 'Camden Builders Merchant | London | Lawsons', url: 'https://lawsons.co.uk/lawsons-camden' },
      'Lawsons Camden',
      'Lawsons branch',
    )).toBe(true);
    expect(sourceMatchesResolvedVenueBranch(
      { title: 'Contact Us | Lawsons', url: 'https://lawsons.co.uk/contact-us' },
      'Lawsons Camden',
      'Lawsons branch',
    )).toBe(false);
    expect(extractVenueContactExcerpt([
      'Phone: 700006400050',
      'camden@lawsons.co.uk 020 7619 6470',
    ].join('\n'))).toBe('Phone: 020 7619 6470 · Email: camden@lawsons.co.uk');
  });

  it('extracts a clean itemized menu instead of an arbitrary price sentence', () => {
    const items = extractVenueMenuItems([
      'JØNK Colosseum',
      '6.5% Service fee (min. 10,50 NOK)',
      'Premium Beef Meals',
      'BBQ Burger Meal',
      'fra 295 NOK',
      'Double beef patties - Brioche bun.',
      'Classic Burger',
      '180 NOK',
      'Jønk Fries',
      'fra 135 NOK',
    ].join('\n'));
    expect(items).toEqual([
      { name: 'BBQ Burger Meal', price: 'from 295 NOK' },
      { name: 'Classic Burger', price: '180 NOK' },
      { name: 'Jønk Fries', price: 'from 135 NOK' },
    ]);
    expect(extractVenueMenuItems([
      'Hamburger 100 g 99,- 108,-',
      'Jafs Burger 200 g 159,- 173,-',
      'Kyllingburger 129,- 140,-',
    ].join('\n'))).toEqual([
      { name: 'Hamburger 100 g', price: '99,-' },
      { name: 'Jafs Burger 200 g', price: '159,-' },
      { name: 'Kyllingburger', price: '129,-' },
    ]);
  });
});

describe('official venue resource links', () => {
  it('derives cold-start official-domain probes from any venue and country', () => {
    const urls = buildProbableOfficialVenueUrls('Northstar Books restaurant', 'GB');
    expect(urls).toContain('https://www.northstarbooks.co.uk/');
    expect(urls).toContain('https://northstar-books.com/');
    expect(urls.join(' ')).not.toContain('jafs');
  });

  it('follows bounded same-site menu/PDF links but not third-party links', () => {
    const html = [
      '<a href="/menus/current.pdf">See our menu</a>',
      '<a href="https://delivery.example/menu/shop">Order menu</a>',
      '<a href="/contact">Contact</a>',
    ].join('');
    expect(extractRelevantVenueResourceLinks(html, 'https://restaurant.example/locations/central', 'menu')).toEqual([
      'https://restaurant.example/menus/current.pdf',
    ]);
    expect(extractRelevantVenueResourceLinks(html, 'https://restaurant.example/locations/central', 'hours')).toEqual([
      'https://restaurant.example/menus/current.pdf',
    ]);
    expect(extractRelevantVenueResourceLinks(
      '<a href="/restaurantene/">Our restaurants</a><a href="https://other.example/locations">Other locations</a>',
      'https://restaurant.example/',
      'hours',
      true,
    )).toEqual(['https://restaurant.example/restaurantene/']);
  });
});

describe('Startpage local-business discovery', () => {
  it('parses only direct organic result cards', () => {
    const html = `
      <div class="result css-hash">
        <a class="result-title result-link" href="https://www.bryggensenter.no/butikkoversikt/">
          <h2>Butikkoversikt - Hommers&aring;k - Bryggen Senter</h2>
        </a>
        <p class="description css-hash">BRYGGE <b>BAKER</b>'N. Åpningstid Mandag-Fredag 05.00-18.00.</p>
        <a href="https://eu3-browse.startpage.com/av/proxy?x=1">Anonymous view</a>
      </div>`;
    expect(parseStartpageSearchHtml(html)).toEqual([{
      title: 'Butikkoversikt - Hommersåk - Bryggen Senter',
      snippet: "BRYGGE BAKER'N. Åpningstid Mandag-Fredag 05.00-18.00.",
      url: 'https://www.bryggensenter.no/butikkoversikt/',
    }]);
  });
});

describe('admission price page extraction', () => {
  it('recognizes the Unicode venue name in the observed question', () => {
    expect(resolveKnownOfficialAdmissionPricePage(
      'hello, what is the price of visiting the snow park in oslo the snø and what are their prices?',
    )?.url).toBe('https://snooslo.no/no/products');
    expect(isKnownOfficialAdmissionPriceUrl('https://snooslo.no/no/products')).toBe(true);
    expect(isKnownOfficialAdmissionPriceUrl('https://example.com/no/products')).toBe(false);
  });

  it('keeps the nearby ticket label with each local-currency row', () => {
    const excerpt = extractAdmissionPriceExcerpt([
      'Timespass',
      'Alpint/Park',
      '2 Timer (Ukedag)',
      'Fra 395 kr',
      'Langrenn',
      '2 Timer (Ukedag)',
      'Fra 145 kr',
    ].join('\n'));

    expect(excerpt).toContain('2 Timer (Ukedag) — Fra 395 kr');
    expect(excerpt).toContain('Langrenn — 2 Timer (Ukedag) — Fra 145 kr');
  });

  it('turns the live SNØ product grid into labeled ticket rows', () => {
    const excerpt = extractSnoOsloPriceExcerpt(
      '2 Timer ( Ukedag ) Fra 395 kr Fra 145 kr 2 Timer ( Helg ) Fra 445 kr Fra 195 kr '
      + '1 dag ( Ukedag ) Fra 445 kr Fra 195 kr 1 dag ( Helg ) Fra 495 kr Fra 245 kr '
      + 'Sommersesong (20.4-2.8) 1690 kr 790 kr Klubbsesong (3.8-8.11) 3735 kr 1635 kr '
      + 'Familiepass Alpint/Park + Langrenn 1 dag ( Ukedag ) Fra 1195 kr 1 dag ( Helg ) Fra 1195 kr '
      + '12 måneder* 395 kr/mnd 245 kr/mnd 395 kr/mnd',
    );

    expect(excerpt).toContain('2 hours, weekday: Alpine/Park from 395 kr; cross-country from 145 kr.');
    expect(excerpt).toContain('1 day, weekend: Alpine/Park from 495 kr; cross-country from 245 kr.');
    expect(excerpt).toContain('Family day pass: weekday from 1195 kr; weekend from 1195 kr.');
    expect(excerpt).toContain('12-month membership: racing 395 kr/mnd; cross-country 245 kr/mnd; park 395 kr/mnd.');
  });
});

describe('opening-hours page extraction', () => {
  it('resolves the observed venue to its official hours page', () => {
    expect(resolveKnownOfficialVenueDetailPage('SNØ Oslo — what are their opening hours?', 'hours')?.url)
      .toBe('https://snooslo.no/no/opening-hours');
    expect(isKnownOfficialVenueDetailUrl('https://snooslo.no/no/opening-hours')).toBe(true);
    expect(isKnownOfficialVenueDetailUrl('https://example.com/opening-hours')).toBe(false);
  });

  it('turns the live snow-zone table into clear area-specific rows', () => {
    const excerpt = extractSnoOsloOpeningHoursExcerpt(
      'SNØ Alpint/parken Langrennsløype SNØborgen '
      + 'Mandag 10:00-17:00 Stengt Stengt '
      + 'Tirsdag - Torsdag 10:00-17:00 06:00-17:00 10:00-17:00 '
      + 'Fredag 10:00-17:00 Stengt 10:00-17:00 '
      + 'Lørdag - Søndag 10:00-17:00 06:00-17:00 10:00-17:00',
    );
    expect(excerpt).toContain('Monday: Alpine/Park 10:00-17:00; cross-country Closed; SNØborgen Closed.');
    expect(excerpt).toContain('Tuesday–Thursday: Alpine/Park 10:00-17:00; cross-country 06:00-17:00; SNØborgen 10:00-17:00.');
  });

  it('extracts ordinary day/time rows and ignores duration-based price rows', () => {
    expect(extractOpeningHoursExcerpt('Monday-Friday 09:00-18:00\nSaturday closed'))
      .toContain('Monday-Friday 09:00-18:00');
    expect(extractOpeningHoursExcerpt('2 hours weekday from 395 kr')).toBeNull();
  });

  it.each([
    ['Horaires\nLundi – Samedi\n10:00 – 20:00\nDimanche\n11:00 – 19:00', 'Lundi – Samedi: 10:00 – 20:00'],
    ['OUVERT de 10:00-20:00', 'OUVERT de 10:00-20:00'],
    ['Öffnungszeiten\nMontag–Samstag 10:00–20:00\nSonntag geschlossen', 'Sonntag geschlossen'],
    ['営業時間\n月曜日〜日曜日 10:00〜21:00', '月曜日〜日曜日 10:00〜21:00'],
  ])('extracts international and split-line hours from %s', (pageText, expected) => {
    expect(extractOpeningHoursExcerpt(pageText)).toContain(expected);
  });

  it('does not mistake a localized calendar date for an opening time', () => {
    expect(extractOpeningHoursExcerpt('Donnerstag, 01.01.')).toBeNull();
  });

  it('keeps complete day rows separate from headings and drops contextless closed status', () => {
    const excerpt = extractOpeningHoursExcerpt('Opening hours\nMonday 10:00-22:00\nClosed');
    expect(excerpt).toBe('Monday 10:00-22:00');
    expect(extractOpeningHoursExcerpt('Alle dager 10.30 - 20.00')).toBe('Alle dager 10.30 - 20.00');
  });

  it('keeps hours scoped to the requested tenant on a multi-business centre page', () => {
    const excerpt = extractVenueOpeningHoursExcerpt([
      'BRYGGE BAKER’N',
      'Lokalprodusert bakerhåndverk, kaker og brød',
      'Tlf.: 51 60 56 56',
      'Åpningstid:',
      'Mandag – Fredag 05.00-18.00',
      'Lørdag 05.00-17.00',
      'Bryggen Blomster & Interiør',
      'Åpningstid:',
      'Mandag – Fredag 10.00-18.00',
      'Lørdag 10.00-17.00',
    ].join('\n'), 'when does Brygge Bakeren in Hommersåk open?');
    expect(excerpt).toContain('Mandag – Fredag 05.00-18.00');
    expect(excerpt).toContain('Lørdag 05.00-17.00');
    expect(excerpt).not.toContain('10.00-18.00');
  });
});

describe('search relevance gate', () => {
  it('requires the requested branch locality for a global chain result', () => {
    const query = 'Is the UNIQLO Ginza store open on Sunday?';
    const ginza = snippet(
      'UNIQLO Ginza Store Information',
      'Ginza store opening hours Sunday 11:00-21:00.',
      'uniqlo.com',
    );
    const shinjuku = snippet(
      'UNIQLO Shinjuku Store Information',
      'Shinjuku store opening hours Sunday 10:00-20:00.',
      'uniqlo.com',
    );
    expect(scoreSnippetRelevanceForQuery(query, ginza).matched).toBe(true);
    expect(scoreSnippetRelevanceForQuery(query, shinjuku).matched).toBe(false);
  });

  it('accepts a first-party tenant spelling variant when the requested hours are present', () => {
    const query = 'when does the bakery on hommersåk open up? brygge bakeren';
    const tenantPage = snippet(
      'Butikkoversikt - Bryggen Senter',
      'BRYGGE BAKER’N Lokalprodusert bakerhåndverk. Åpningstid: Mandag – Fredag 05.00-18.00. Lørdag 05.00-17.00.',
      'bryggensenter.no',
    );
    expect(scoreSnippetRelevanceForQuery(query, tenantPage)).toMatchObject({ matched: true, shape: 'hours' });
  });

  it('orders verified first-party venue hours ahead of a more keyword-rich directory', () => {
    const query = 'when does the bakery on hommersåk open up? brygge bakeren';
    const official: SearchSnippet = {
      ...snippet(
        'Butikkoversikt - Bryggen Senter',
        'BRYGGE BAKER’N. Åpningstid: Mandag – Fredag 05.00-18.00. Lørdag 05.00-17.00.',
        'bryggensenter.no',
      ),
      trust: { tier: 'high', score: 0.82, reason: 'First-party venue domain/title match: bryggensenter.no' },
    };
    const directory: SearchSnippet = {
      ...snippet(
        'Brygge Bakeren - Hommersåk',
        'Brygge Bakeren Hommersåk opening hours Monday-Friday 05:00-19:00.',
        'mappno.com',
      ),
      trust: { tier: 'low', score: 0.35, reason: 'Unknown domain: mappno.com' },
    };
    expect(filterRelevantSnippetsForQuery(query, [directory, official])).toEqual([official, directory]);
  });

  it('accepts official clock times and rejects same-venue ticket prices for an hours query', () => {
    const query = 'SNØ Oslo — what are their opening hours?';
    const officialHours = snippet(
      'Opening hours | SNØ Oslo',
      'Monday: Alpine/Park 10:00-17:00. Saturday-Sunday: 10:00-17:00.',
      'snooslo.no',
      1,
    );
    const ticketPrices = snippet(
      'Prices | SNØ Oslo',
      '2 hours weekday: Alpine/Park from 395 kr. Weekend day pass from 495 kr.',
      'snooslo.no',
      2,
    );
    expect(scoreSnippetRelevanceForQuery(query, officialHours)).toMatchObject({ matched: true, shape: 'hours' });
    expect(scoreSnippetRelevanceForQuery(query, ticketPrices)).toMatchObject({ matched: false, shape: 'hours' });
    expect(filterRelevantSnippetsForQuery(query, [ticketPrices, officialHours])).toEqual([officialHours]);
  });

  it('accepts local-currency ticket prices from the venue page', () => {
    const query = 'what is the price of visiting the snow park in Oslo SNØ and what are their prices?';
    const officialPrices = snippet(
      'Prices and products | SNØ Oslo',
      'Alpine skiing and park, 2 hours weekday from 395 kr. Cross-country skiing from 145 kr. Weekend day pass from 495 kr.',
      'snooslo.no',
      1,
    );
    const marketNoise = snippet(
      'Snowflake stock price live',
      'The current stock price is $220 USD with live market volume and a market cap.',
      'markets.example.com',
      1,
    );
    const electricityNoise = snippet(
      'Electricity prices in Trondheim today',
      'The navigation links to Oslo. Electricity costs 1,15 kr per kWh today and 1,27 kr tomorrow.',
      'hvakosterstrommen.no',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, officialPrices)).toMatchObject({ matched: true, shape: 'price' });
    expect(scoreSnippetRelevanceForQuery(query, marketNoise).matched).toBe(false);
    expect(scoreSnippetRelevanceForQuery(query, electricityNoise).matched).toBe(false);
    expect(filterRelevantSnippetsForQuery(query, [marketNoise, electricityNoise, officialPrices])).toEqual([officialPrices]);
  });

  it('rejects same-entity snippets that do not match a population question shape', () => {
    const query = 'how many people live in Oslo?';
    const shooting = snippet(
      'Oslo shooting latest updates',
      'A shooting in central Oslo killed two people and injured several others, police said.',
      'bbc.com',
      2,
    );
    const population = snippet(
      'Oslo population',
      'Oslo municipality had a population of 717,710 residents in 2024, with more people in the urban area.',
      'en.wikipedia.org',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, shooting).matched).toBe(false);
    expect(scoreSnippetRelevanceForQuery(query, population).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [shooting, population])).toEqual([population]);
  });

  it('requires recommendation-shaped evidence for recommendation follow-ups', () => {
    const query = 'would you recommend using a VPN?';
    const genericForum = snippet(
      'Weekly r/VPN discussion thread',
      'This thread is for general VPN chat, provider memes, subreddit rules, and off-topic comments.',
      'reddit.com',
      2,
    );
    const usefulAdvice = snippet(
      'When a VPN is worth using',
      'A VPN can be useful on public Wi-Fi and for some privacy needs, but you have to trust the provider and weigh the trade-offs.',
      'consumerreports.org',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, genericForum).matched).toBe(false);
    expect(scoreSnippetRelevanceForQuery(query, usefulAdvice).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [genericForum, usefulAdvice])).toEqual([usefulAdvice]);
  });

  it('keeps direct definition snippets', () => {
    const query = 'what is SearXNG?';
    const definition = snippet(
      'SearXNG documentation',
      'SearXNG is a free internet metasearch engine that aggregates results from multiple search services.',
      'docs.searxng.org',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, definition).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [definition])).toEqual([definition]);
  });

  it('keeps comparison evidence when each source explains one side of the trade-off', () => {
    const query = 'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?';
    const searxng = snippet(
      'SearXNG',
      'SearXNG is a free and privacy-respecting metasearch engine that aggregates results from multiple search services.',
      'en.wikipedia.org',
      1,
    );
    const duckduckgo = snippet(
      'DuckDuckGo Instant Answer API',
      'DuckDuckGo Instant Answer API returns zero-click answers and related topics, but it is not a general metasearch engine.',
      'duckduckgo.com',
      1,
    );

    expect(scoreSnippetRelevanceForQuery(query, searxng).matched).toBe(true);
    expect(scoreSnippetRelevanceForQuery(query, duckduckgo).matched).toBe(true);
    expect(filterRelevantSnippetsForQuery(query, [searxng, duckduckgo])).toHaveLength(2);
  });
});
