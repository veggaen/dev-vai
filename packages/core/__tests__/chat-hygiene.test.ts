/**
 * Chat-hygiene tests.
 *
 * Pin down the failure modes the user just reported in real desktop chats:
 *   - Code/transcript snippets leaking into responses ("to be a string.").
 *   - YouTube transcript noise ("subscribe to my channel", "[Music]").
 *   - Date strings being used as the "we were discussing" anchor.
 *   - Identical bullet-block fallback repeating turn after turn.
 *   - Topic-echo fragments like "**Norway We have these**" or
 *     "**Ukrainian war started**" or "**developed the first pistol**".
 *   - The four knowledge gaps the user hit: Russia–Ukraine war, fylker
 *     list, pistol history, "top games on Steam".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

describe('chat hygiene', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    (engine as unknown as { _nowMs: () => number })._nowMs = () =>
      new Date('2026-05-13T10:00:00Z').getTime();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch disabled in chat-hygiene test');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('transcript-noise guard', () => {
    it('engine.suppressTranscriptNoise drops obvious transcript junk', () => {
      const eng = engine as unknown as {
        suppressTranscriptNoise: (input: string, response: string) => string;
      };
      expect(eng.suppressTranscriptNoise('q', 'subscribe to my channel and hit the bell')).toBe('');
      expect(eng.suppressTranscriptNoise('q', '[Music] welcome back')).toBe('');
      expect(eng.suppressTranscriptNoise('q', 'check it out at youtu.be/abc')).toBe('');
      expect(eng.suppressTranscriptNoise('q', 'to be a string.')).toBe('');
      // Real structured curated answers must pass.
      const real = '**Harald V** is the king of Norway. He has reigned since 17 January 1991. The current heir apparent is Crown Prince Haakon.';
      expect(eng.suppressTranscriptNoise('who is the king of norway?', real)).toBe(real);
    });
  });

  describe('fallback never uses a date as the anchor', () => {
    it('"we were discussing **Friday, May 15, 2026**" must not appear', async () => {
      const r = await engine.chat({
        messages: [
          { role: 'user', content: 'what day is the day after tomorrow?' },
          { role: 'assistant', content: 'The day after tomorrow is **Friday, May 15, 2026**.' },
          { role: 'user', content: 'tell me about quantum chromodynamics in one paragraph' },
        ],
      });
      expect(r.message.content).not.toMatch(/\*\*Friday[^*]*\*\*/);
      expect(r.message.content).not.toMatch(/\*\*[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d/);
    });
  });

  describe('fallback varies between consecutive turns', () => {
    it('two unknown questions in a row produce different fallbacks', async () => {
      const r1 = await engine.chat({
        messages: [
          { role: 'user', content: 'tell me about the absolutely-fictional zorglubs of planet quux' },
        ],
      });
      const r2 = await engine.chat({
        messages: [
          { role: 'user', content: 'tell me about the absolutely-fictional zorglubs of planet quux' },
          { role: 'assistant', content: r1.message.content },
          { role: 'user', content: 'and what about the made-up bibblefrobs of nowhere-land?' },
        ],
      });
      expect(r2.message.content).not.toBe(r1.message.content);
    });
  });

  describe('topic echo is clean', () => {
    const cases = [
      'when did the Ukrainian war start?',
      'who developed the first pistol?',
      'what is the typescript file of an angular component?',
      'and tell me about the ingredients in tahini',
    ];
    for (const q of cases) {
      it(`"${q}" — fallback (if any) does not echo a broken fragment`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        // Forbidden fragment patterns we actually saw in the user's screenshots.
        expect(text).not.toMatch(/\*\*And\s+who\s+are/i);
        expect(text).not.toMatch(/\*\*Norway\s+We\s+have/i);
        expect(text).not.toMatch(/\*\*about\s+the\s+ingredients\s+in\*\*/i);
        expect(text).not.toMatch(/\*\*Ukrainian\s+war\s+started\*\*/i);
        expect(text).not.toMatch(/\*\*developed\s+the\s+first\s+pistol\*\*/i);
        expect(text).not.toMatch(/\*\*typescript\s+file\s+of\s+an\*\*/i);
      });
    }
  });

  describe('Russia–Ukraine war — many phrasings', () => {
    const phrasings = [
      'when did the war in Ukraine start?',
      'when did the russia ukraine war start',
      'when did Russia invade Ukraine?',
      'when did the russo-ukrainian war begin?',
      'tell me when the Ukrainian war started',
      'what year did the war in ukraine begin',
    ];
    for (const q of phrasings) {
      it(`"${q}" → mentions Feb 2022 and 2014`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/2022/);
        expect(text, q).toMatch(/2014/);
      });
    }
  });

  describe('list of Norwegian fylker', () => {
    const phrasings = [
      'name every fylke in Norway',
      'list of fylker in Norway',
      'how many fylker are there in Norway',
      'hvilke fylker finnes i norge',
    ];
    for (const q of phrasings) {
      it(`"${q}" → returns a list with Oslo and Rogaland and notes statsforvalter`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/Oslo/);
        expect(text, q).toMatch(/Rogaland/);
        expect(text, q).toMatch(/15/);
        expect(text, q).toMatch(/fylkesordfører|statsforvalter/i);
      });
    }
  });

  describe('pistol — definition + history', () => {
    const phrasings = [
      'who invented the first pistol?',
      'what is a pistol?',
      'tell me the history of the pistol',
      'who developed the pistol',
    ];
    for (const q of phrasings) {
      it(`"${q}" → mentions handheld and Colt or Browning`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/handheld|hand[- ]?gun|one\s+hand/i);
        expect(text, q).toMatch(/Colt|Browning|Borchardt|matchlock|wheellock/i);
      });
    }
  });

  describe('top Steam games — honest no-live-data', () => {
    const phrasings = [
      'what are the top 10 games on steam right now?',
      'most popular games on steam currently',
      'top steam charts',
      'best selling games on steam',
    ];
    for (const q of phrasings) {
      it(`"${q}" → declines to fake live data and names known mainstays`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/can(?:'|no)?t (?:query|fetch|access).*real[\s-]?time|won't pretend|not live|store\.steampowered\.com\/charts/i);
        expect(text, q).toMatch(/Counter-Strike|Dota|PUBG|Apex|Baldur/i);
      });
    }
  });

  describe('common-knowledge coverage — no honest-gap fallback', () => {
    // These topics were curated after a coverage probe found Vai stalling on
    // them. Each row is [question, regex the answer MUST contain]. The test
    // also enforces that the answer does NOT use any of the honest-gap
    // fallback phrasings.
    const cases: Array<[string, RegExp]> = [
      ['what is the tallest mountain on Earth?', /\bMount Everest\b/i],
      ['what is the deepest ocean?', /\bMariana Trench|Challenger Deep|Pacific\b/i],
      ['what is a black hole?', /\bevent horizon\b/i],
      ['what was the Roman Empire?', /\b(?:27 BC|Augustus|476)\b/],
      ['who was Albert Einstein?', /\b(?:relativity|Nobel|E\s*=\s*mc)/i],
      ['what was the Industrial Revolution?', /\b(?:steam|factory|Britain)\b/i],
      ['who was Genghis Khan?', /\b(?:Mongol|Temüjin|1206)\b/i],
      ['how many chambers in the human heart?', /\bfour chambers?\b/i],
      ['what language do they speak in Norway?', /\bBokmål\b|\bNynorsk\b|\bNorwegian\b/i],
      ['who wrote Hamlet?', /\bShakespeare\b/i],
      ['who composed the 9th Symphony?', /\bBeethoven\b/i],
      ['who directed Star Wars?', /\bGeorge Lucas\b/i],
      ['what is the most populous country?', /\bIndia\b/i],
      ['what is a monad?', /\b(?:flatMap|bind|category theory|Maybe|Promise)\b/i],
      ['who was Cleopatra?', /\b(?:Ptolem|Egypt|Mark Antony|Caesar)\b/i],
      ['when did humans first land on the moon?', /\b(?:Apollo 11|Armstrong|1969)\b/i],
      ['what was the Renaissance?', /\b(?:Florence|humanism|Medici|Leonardo|Michelangelo)\b/i],
      ['who was Steve Jobs?', /\b(?:Apple|Macintosh|iPhone|Pixar)\b/i],
      ['who was Nikola Tesla?', /\b(?:alternating current|AC|tesla coil|Westinghouse)\b/i],
      ['who was Leonardo da Vinci?', /\b(?:Mona Lisa|Last Supper|Vinci|polymath)\b/i],
      ['what is a virus?', /\b(?:capsid|DNA|RNA|host cell|virion)\b/i],
      // Exponential expansion batch — geography, history, science, arts,
      // philosophy, finance, programming.
      ['what is the capital of Argentina?', /\bBuenos Aires\b/i],
      ['what is the capital of Egypt?', /\bCairo\b/i],
      ['what is the capital of Turkey?', /\bAnkara\b/i],
      ['what is the highest waterfall?', /\bAngel Falls\b/i],
      ['what is a comet?', /\b(?:Kuiper|Oort|coma|nucleus|Halley)\b/i],
      ['what is a galaxy?', /\b(?:spiral|elliptical|Milky Way|stars)\b/i],
      ['what is a supernova?', /\b(?:white dwarf|core[\s-]?collapse|Chandrasekhar|neutron star)\b/i],
      ['what is a neuron?', /\b(?:axon|dendrite|action potential|synapse)\b/i],
      ['what is oxidation?', /\b(?:electrons|redox|reduction)\b/i],
      ['what is a covalent bond?', /\b(?:shar(?:e|ing)|electron pair|polar)\b/i],
      ['what is a logarithm?', /\b(?:base|exponent|natural log|log_)/i],
      ['what was the Reformation?', /\b(?:Luther|1517|Ninety[\s-]?Five Theses|Protestant)\b/i],
      ['who was Julius Caesar?', /\b(?:Rubicon|Ides of March|44 BC|dictator)\b/i],
      ['who was Mahatma Gandhi?', /\b(?:satyagraha|Salt March|nonviolent|India)\b/i],
      ['who was Winston Churchill?', /\b(?:Prime Minister|1940|World War|Britain)\b/i],
      ['who was Joseph Stalin?', /\b(?:Soviet|USSR|Five[\s-]?Year|Gulag|Purge)\b/i],
      ['who was Alan Turing?', /\b(?:Turing machine|Enigma|Bletchley|computer science)\b/i],
      ['who was Ada Lovelace?', /\b(?:Babbage|Analytical Engine|first.*programmer|Bernoulli)\b/i],
      ['who was Bill Gates?', /\b(?:Microsoft|Allen|Windows|MS[\s-]?DOS)\b/i],
      ['who was Michelangelo?', /\b(?:David|Sistine|Pietà|Renaissance)\b/i],
      ['who was Vincent van Gogh?', /\b(?:Sunflowers|Starry Night|Post[\s-]?Impressionist|Arles)\b/i],
      ['who was Pablo Picasso?', /\b(?:Cubism|Guernica|Demoiselles|Braque)\b/i],
      ['who was Mozart?', /\b(?:Salzburg|Vienna|Magic Flute|Requiem|Köchel|K\.\s*\d)/i],
      ['who was Bach?', /\b(?:Leipzig|Brandenburg|fugue|Well-Tempered|BWV)\b/i],
      ['who was Frida Kahlo?', /\b(?:Mexican|Rivera|self[\s-]?portrait|Coyoacán|Casa Azul)\b/i],
      ['what is a deadlock?', /\b(?:Coffman|circular wait|mutual exclusion|lock)\b/i],
      ['who wrote Harry Potter?', /\b(?:J\.?\s*K\.?\s*Rowling|Rowling)\b/i],
      ['who wrote Lord of the Rings?', /\bTolkien\b/i],
      ['how many players on a soccer team?', /\b(?:11|eleven)\b/i],
      ['who was Plato?', /\b(?:Academy|Forms|Cave|Republic|Socrates)\b/i],
      ['who was Aristotle?', /\b(?:Lyceum|syllogis|virtue|Nicomachean|Alexander)\b/i],
      ['who was Socrates?', /\b(?:Athens|hemlock|Socratic method|Plato|elenchus)\b/i],
      ['what is a recession?', /\b(?:GDP|two consecutive quarters|NBER|economic)\b/i],
      ['what is a bond?', /\b(?:debt|coupon|maturity|yield|issuer)\b/i],
      ['what is a linked list?', /\b(?:node|pointer|singly|doubly|head)\b/i],
      ['who was Muhammad Ali?', /\b(?:boxing|heavyweight|Cassius Clay|Frazier|Foreman)\b/i],
      // Round 3 — even broader knowledge battery.
      ['what is the capital of Switzerland?', /\bBern\b/i],
      ['what is the capital of Austria?', /\bVienna\b/i],
      ['what is the capital of Ireland?', /\bDublin\b/i],
      ['what is the capital of Hungary?', /\bBudapest\b/i],
      ['what is the capital of the Czech Republic?', /\bPrague\b/i],
      ['what is the capital of Vietnam?', /\bHanoi\b/i],
      ['what is the capital of Thailand?', /\bBangkok\b/i],
      ['what is the capital of the Philippines?', /\bManila\b/i],
      ['what is the capital of Bangladesh?', /\bDhaka\b/i],
      ['what is the capital of Iran?', /\bTehran\b/i],
      ['what is the capital of Iraq?', /\bBaghdad\b/i],
      ['what is the capital of Saudi Arabia?', /\bRiyadh\b/i],
      ['what is the capital of Israel?', /\bJerusalem\b/i],
      ['what is the capital of Kenya?', /\bNairobi\b/i],
      ['what is the capital of Nigeria?', /\bAbuja\b/i],
      ['what is the capital of Ethiopia?', /\bAddis Ababa\b/i],
      ['what is the capital of Morocco?', /\bRabat\b/i],
      ['what is the capital of Chile?', /\bSantiago\b/i],
      ['what is the capital of Peru?', /\bLima\b/i],
      ['what is the capital of Colombia?', /Bogot[áa]/i],
      ['what is the capital of Venezuela?', /\bCaracas\b/i],
      ['what is the capital of South Korea?', /\bSeoul\b/i],
      ['what is the capital of North Korea?', /\bPyongyang\b/i],
      ['what is the capital of Indonesia?', /\bJakarta\b/i],
      ['what is the capital of Pakistan?', /\bIslamabad\b/i],
      ['what is the capital of Portugal?', /\bLisbon\b/i],
      ['what is the capital of Greece?', /\bAthens\b/i],
      ['what is the capital of Poland?', /\bWarsaw\b/i],
      ['what is the capital of the Netherlands?', /\bAmsterdam\b/i],
      ['what is the capital of Belgium?', /\bBrussels\b/i],
      ['what are the Pyramids of Giza?', /\b(?:Khufu|Cheops|Giza|Great Pyramid)\b/i],
      ['what is the largest animal?', /\bblue whale\b/i],
      ['tell me about the octopus', /\b(?:cephalopod|tentacle|chromatophore|three hearts)\b/i],
      ['what is a dolphin?', /\b(?:echolocation|cetacean|Delphinidae|pod|mammal)\b/i],
      ['what is a kangaroo?', /\b(?:marsupial|Australia|joey|pouch)\b/i],
      ['what is a platypus?', /\b(?:monotreme|egg|bill|Australia)\b/i],
      ['what is a chameleon?', /\b(?:colour|color|tongue|Madagascar|lizard)\b/i],
      ['what is a redwood?', /\b(?:Sequoia|sempervirens|California|tallest)\b/i],
      ['what is a tornado?', /\b(?:supercell|Fujita|EF\d|funnel|wind shear)\b/i],
      ['what is a hurricane?', /\b(?:tropical cyclone|typhoon|Saffir|eye|storm surge)\b/i],
      ['what is a neutron star?', /\b(?:supernova|pulsar|neutron|km|dense)\b/i],
      ['what is a quasar?', /\b(?:supermassive|accretion|active galactic|black hole)\b/i],
      ['who founded Facebook?', /\b(?:Zuckerberg|2004|Harvard)\b/i],
      ['when was the iPhone released?', /\b(?:2007|Steve Jobs|Macworld)\b/i],
      ['what is TCP/IP?', /\b(?:packet|protocol|IP|transport|internet)\b/i],
      ['what is a VPN?', /\b(?:tunnel|encrypt|WireGuard|OpenVPN|IPsec)\b/i],
      ['what is a transformer in AI?', /\b(?:attention|self[\s-]?attention|Vaswani|2017|GPT|BERT)\b/i],
      ["what is e in math?", /\b(?:Euler|2\.71828|natural log)\b/i],
      ['what is prime factorization?', /\b(?:prime|Fundamental Theorem|RSA|factor)\b/i],
      ['what is a fractal?', /\b(?:Mandelbrot|self[\s-]?similar|Hausdorff|Koch)\b/i],
      ['what is a bacterium?', /\b(?:prokaryot|peptidoglycan|binary fission|Gram)\b/i],
      ['who was Adolf Hitler?', /\b(?:Nazi|Führer|F\u00fchrer|1933|1945|Germany)\b/i],
      ['what was D-Day?', /\b(?:Normandy|6 June 1944|Overlord|Eisenhower)\b/i],
      ['what was the Holocaust?', /\b(?:Shoah|6 million|Auschwitz|Nazi)\b/i],
      ['what was Pearl Harbor?', /\b(?:1941|Japan|Hawaii|infamy|Roosevelt)\b/i],
      ['who was Anne Frank?', /\b(?:Amsterdam|diary|Bergen-Belsen|annex)\b/i],
      ['what was the Battle of Stalingrad?', /\b(?:Volga|Paulus|6th Army|1942|1943|Soviet)\b/i],
      ['what happened on 9/11?', /\b(?:al[\s-]?Qaeda|Twin Towers|World Trade|2001|hijack)\b/i],
      ['who was JFK?', /\b(?:Kennedy|1963|Dallas|35th|Cuban Missile)\b/i],
      ['who was Nelson Mandela?', /\b(?:apartheid|ANC|Robben Island|South Africa)\b/i],
      ['what was apartheid?', /\b(?:South Africa|National Party|segregat|1948|1994)\b/i],
      ['what was the Cuban Missile Crisis?', /\b(?:1962|Khrushchev|Kennedy|Cuba|13 days)\b/i],
      ['what was Brexit?', /\b(?:United Kingdom|EU|2016|Article 50|2020)\b/i],
      ['tell me about ancient Egypt', /\b(?:pharaoh|Nile|pyramid|hieroglyph)\b/i],
      ['tell me about ancient Greece', /\b(?:polis|Athens|Sparta|Plato|Aristotle)\b/i],
      ['tell me about the Maya civilization', /\b(?:Mesoamerica|Tikal|Yucat|glyph|calendar)\b/i],
      ['what was Mesopotamia?', /\b(?:Tigris|Euphrates|Sumer|cuneiform|cradle)\b/i],
      ['who was Hammurabi?', /\b(?:Babylon|Code|282|stele|law)\b/i],
      ['tell me about the piano', /\b(?:Cristofori|88 keys|hammer|grand|pianoforte)\b/i],
      ['tell me about the violin', /\b(?:Stradivari|Cremon|four strings|G[\s-]*D[\s-]*A[\s-]*E|bow)\b/i],
      ['who were the Beatles?', /\b(?:Lennon|McCartney|Harrison|Ringo|Liverpool)\b/i],
      ['who wrote Pride and Prejudice?', /\b(?:Jane Austen|Austen)\b/i],
      ['who wrote Moby-Dick?', /\b(?:Melville)\b/i],
      ['who wrote Don Quixote?', /\b(?:Cervantes)\b/i],
      ['who wrote One Hundred Years of Solitude?', /\b(?:Garc[íi]a M[áa]rquez|Marquez)\b/i],
      ['who wrote The Brothers Karamazov?', /\b(?:Dostoevsky|Dostoyevsky)\b/i],
      ['who was Jesus?', /\b(?:Nazareth|Christ|Christianity|Messiah|crucif)\b/i],
      ['who was the Buddha?', /\b(?:Siddh[āa]rtha|Gautama|enlightenment|Bodhi|Eightfold)\b/i],
      ['who was Moses?', /\b(?:Exodus|Sinai|Ten Commandments|Egypt|Hebrew)\b/i],
      ['who was Descartes?', /\b(?:cogito|I think|Cartesian|Meditations|dualism)\b/i],
      ['who was David Hume?', /\b(?:Scottish|empiric|induction|Treatise|Enlightenment)\b/i],
      ['what is the WTO?', /\b(?:World Trade|Geneva|1995|GATT|trade)\b/i],
      ['what was ARPANET?', /\b(?:DARPA|packet|1969|Vint Cerf|TCP\/IP|BBN)\b/i],
      ['who was Immanuel Kant?', /\b(?:Critique|Königsberg|Konigsberg|Categorical Imperative|transcendental)\b/i],
      ['who was Adam Smith?', /\b(?:Wealth of Nations|invisible hand|Scottish|economics|1776)\b/i],
      ['who was Henrik Ibsen?', /\b(?:Norwegian|Doll['']s House|Peer Gynt|playwright|drama)\b/i],
      // Round 4 — mythology, games, organic chemistry, scientists, stats.
      ['who was Achilles?', /\b(?:Trojan|Iliad|Patroclus|Hector|heel)\b/i],
      ['who was Odysseus?', /\b(?:Ithaca|Odyssey|Penelope|Trojan|Cyclops|Polyphemus)\b/i],
      ['what is Pac-Man?', /\b(?:Namco|1980|Iwatani|maze|ghost)\b/i],
      ['what is Half-Life?', /\b(?:Valve|1998|Gordon Freeman|Black Mesa|Xen)\b/i],
      ['what is a hydrocarbon?', /\b(?:alkane|alkene|petroleum|carbon|hydrogen)\b/i],
      ['what is a polymer?', /\b(?:monomer|polymerisation|polymerization|plastic|chain)\b/i],
      ['what is a p-value?', /\b(?:null hypothesis|significance|frequentist|alpha|0\.05)\b/i],
      ['who was Marie Curie?', /\b(?:radioactivity|polonium|radium|Nobel|Sk[łl]odowska)\b/i],
      ['who was Isaac Newton?', /\b(?:Principia|gravitation|calculus|laws of motion|Royal Society)\b/i],
      ['who was Galileo Galilei?', /\b(?:telescope|Jupiter|moons|Inquisition|Copernican|heliocentr)\b/i],
      ['who was Stephen Hawking?', /\b(?:Hawking radiation|Cambridge|black hole|ALS|Brief History)\b/i],
      // Round 5 — Norse mythology, Greek gods, programming languages, NYC.
      ['who is Zeus?', /\b(?:Olympus|Greek|sky|thunder|Jupiter|Cronus)\b/i],
      ['who is Odin?', /\b(?:Norse|Asgard|Valhalla|raven|Yggdrasil|Wednesday)\b/i],
      ['who is Thor?', /\b(?:Norse|Mj[öo]lnir|hammer|thunder|Asgard|Thursday)\b/i],
      ['who is Loki?', /\b(?:Norse|trickster|Fenrir|J[öo]rmungandr|shape[\s-]?shift)\b/i],
      ['what is Ragnarok?', /\b(?:Norse|Fenrir|Surtr|Odin|Thor|end of the world|twilight)\b/i],
      ['what is Yggdrasil?', /\b(?:world tree|Norse|ash|Norn|Asgard|root)\b/i],
      ['what is Valhalla?', /\b(?:Odin|Asgard|einherjar|Valkyrie|hall|slain)\b/i],
      ['what is New York City?', /\b(?:Manhattan|Brooklyn|five boroughs|Hudson|United States|New Amsterdam)\b/i],
      // ── Round 6 ──
      ['what was the French Revolution?', /\b(?:Bastille|Louis XVI|Robespierre|Napoleon|Bourbon|guillotine)\b/i],
      ['what was the Russian Revolution?', /\b(?:Bolshevik|Lenin|Trotsky|Romanov|Tsar|Petrograd|Soviet)\b/i],
      ['what was the Crusades?', /\b(?:Holy Land|Jerusalem|Pope|Saladin|Urban II|Knights|Constantinople)\b/i],
      ['what is COVID-19?', /\b(?:SARS-CoV-2|coronavirus|Wuhan|pandemic|WHO|vaccine|mRNA|2019|2020)\b/i],
      ['what is hip-hop?', /\b(?:Bronx|DJ Kool Herc|rap|breakdanc|Sugarhill|Run-DMC|Afrika Bambaataa)\b/i],
      ['what is soccer?', /\b(?:football|FIFA|World Cup|11 players|goalkeeper|pitch|1863)\b/i],
      ['what is a bicycle?', /\b(?:two-wheeled|pedal|chain|bike|Tour de France|Dunlop|safety bicycle)\b/i],
      ['what is a Toyota Corolla?', /\b(?:Toyota|1966|compact|best-selling|Hasegawa|generations)\b/i],
      ['who was Beethoven?', /\b(?:German|Bonn|Vienna|symphon|deaf|Ninth|Ode to Joy|Pastoral)\b/i],
      ['who was Tchaikovsky?', /\b(?:Russian|Swan Lake|Nutcracker|1812 Overture|Pathétique|ballet)\b/i],
      ['who was Chopin?', /\b(?:Polish|piano|nocturne|mazurka|polonaise|Paris|George Sand)\b/i],
      ['who was Wagner?', /\b(?:German|opera|Ring|Bayreuth|Tristan|Valkyrie|Gesamtkunstwerk)\b/i],
      ['who was Debussy?', /\b(?:French|Impressionis|Clair de lune|La Mer|Pelléas|piano)\b/i],
      ['who was Stravinsky?', /\b(?:Russian|Rite of Spring|Firebird|Petrushka|Diaghilev|ballet|neoclassic)\b/i],
      ['who was Brahms?', /\b(?:German|Hamburg|Vienna|symphon|Three Bs|Lullaby|Requiem)\b/i],
      ['who was Handel?', /\b(?:German|Baroque|London|Messiah|Hallelujah|Water Music|Westminster)\b/i],
      ['who was Elvis Presley?', /\b(?:King of Rock|Memphis|Tupelo|Heartbreak Hotel|Hound Dog|Jailhouse|Graceland)\b/i],
      ['who was Michael Jackson?', /\b(?:King of Pop|Thriller|Jackson 5|Quincy Jones|Billie Jean|Beat It|moonwalk)\b/i],
      ['who was Bob Dylan?', /\b(?:singer-?songwriter|folk|Nobel|Blowin'? in the Wind|Like a Rolling Stone|Greenwich Village)\b/i],
      ['who was Freddie Mercury?', /\b(?:Queen|Bohemian Rhapsody|Zanzibar|vocalist|Mercury|Live Aid|Bulsara)\b/i],
      ['who was David Bowie?', /\b(?:Ziggy Stardust|British|Brixton|Space Oddity|Heroes|glam|Blackstar)\b/i],
      ['who was Madonna?', /\b(?:Queen of Pop|Like a Virgin|Material Girl|Vogue|American|singer|reinvent)\b/i],
      ['who was Bob Marley?', /\b(?:Jamaican|reggae|Rastafari|Wailers|No Woman|One Love|Exodus)\b/i],
      ['who was John Lennon?', /\b(?:Beatles|Liverpool|McCartney|Imagine|Yoko Ono|Dakota|Strawberry Fields)\b/i],
      ['who was Salvador Dali?', /\b(?:Surrealis|Spanish|Catalonia|Persistence of Memory|melting|Figueres|Buñuel)\b/i],
      ['who was Rembrandt?', /\b(?:Dutch|Baroque|Amsterdam|Night Watch|chiaroscuro|self-portrait|Leiden)\b/i],
      ['who was Raphael?', /\b(?:Italian|Renaissance|Urbino|Vatican|School of Athens|Madonna|Pantheon)\b/i],
      ['who was Niels Bohr?', /\b(?:Danish|atom|quantum|Copenhagen|Bohr model|Nobel|complementarity)\b/i],
      ['who was Werner Heisenberg?', /\b(?:German|quantum|uncertainty principle|matrix mechanics|Nobel|Copenhagen)\b/i],
      ['who was Confucius?', /\b(?:Chinese|Analects|Lu|filial|junzi|rén|Kong|ritual)\b/i],
      ['who was Lao Tzu?', /\b(?:Tao|Daois|Taois|Tao Te Ching|Dao|wu wei|Chinese|Way)\b/i],
      ['who was Sun Tzu?', /\b(?:Chinese|Art of War|strateg|general|Wu|deception|battles)\b/i],
      ['who was Spinoza?', /\b(?:Dutch|rationalis|Ethics|Amsterdam|substance|God or Nature|cherem|Sephard)\b/i],
      ['who was Hegel?', /\b(?:German|idealis|dialectic|Phenomenology|Geist|Spirit|Berlin|Stuttgart)\b/i],
      ['who was Schopenhauer?', /\b(?:German|pessimis|Will|World as Will|Danzig|Buddhis|representation)\b/i],
      ['who was Sartre?', /\b(?:French|existentialis|Being and Nothingness|Beauvoir|Nausea|No Exit|Nobel)\b/i],
      ['who was Wittgenstein?', /\b(?:Austrian|British|Tractatus|Cambridge|Vienna|language|Philosophical Investigations|Russell)\b/i],
      ['who was Charles Darwin?', /\b(?:naturalist|evolution|natural selection|Galápagos|Beagle|Origin of Species|Wallace)\b/i],
      ['who was Richard Feynman?', /\b(?:physicist|Caltech|Manhattan Project|QED|Feynman diagrams|Nobel|Challenger)\b/i],
      ['what is Counter-Strike?', /\b(?:Valve|first-person|CT|Terror|Half-Life|tactical|CS:GO|esports|bomb)\b/i],
      ['what is a Boeing 747?', /\b(?:Jumbo|wide-body|airliner|Pan Am|Sutter|hump|four engines|1970|1969)\b/i],
      // ── Round 7 ──
      ['what was the Rwandan Genocide?', /\b(?:Tutsi|Hutu|1994|Kagame|Interahamwe|Rwanda|UN|Kigali)\b/i],
      ['what is the lightbulb?', /\b(?:Edison|incandescent|filament|tungsten|Swan|LED|Menlo Park|1879)\b/i],
      ['who was Tim Berners-Lee?', /\b(?:World Wide Web|CERN|HTTP|HTML|URL|W3C|Turing Award|knighted|British)\b/i],
      ['who was Grace Hopper?', /\b(?:Navy|COBOL|compiler|Harvard Mark|Yale|admiral|Hopper|FLOW-MATIC|debugging)\b/i],
      ['who was Linus Torvalds?', /\b(?:Linux|kernel|Finnish|Helsinki|Git|GPL|1991|free software)\b/i],
      ['who was Dennis Ritchie?', /\b(?:C programming|Unix|Bell Labs|Thompson|Turing Award|K&R|Kernighan|systems)\b/i],
      ['who was Christopher Columbus?', /\b(?:Genoese|Spain|1492|Atlantic|Bahamas|Niña|Pinta|Santa María|Isabella|Indies)\b/i],
      ['who was Marco Polo?', /\b(?:Venetian|Silk Road|Kublai Khan|Mongol|China|Travels|Asia|Yuan|Italian)\b/i],
      ['who was Vasco da Gama?', /\b(?:Portuguese|India|Cape of Good Hope|1497|1498|Calicut|Manuel|spice|sea route)\b/i],
      ['who was Ferdinand Magellan?', /\b(?:Portuguese|Spanish|circumnavigat|Strait of Magellan|Pacific|Mactan|Elcano|1519|1522)\b/i],
      ['who was Captain Cook?', /\b(?:British|Royal Navy|Endeavour|Pacific|Australia|New Zealand|Hawai|Cook|Yorkshire)\b/i],
      ['who was Lewis and Clark?', /\b(?:Corps of Discovery|Jefferson|Louisiana Purchase|Pacific|Sacagawea|Missouri|Columbia|1804|1806)\b/i],
      ['who was Ernest Shackleton?', /\b(?:Antarctic|Endurance|Weddell|Elephant Island|James Caird|South Georgia|polar|British|Irish)\b/i],
      ['who was Neil Armstrong?', /\b(?:Apollo|Moon|astronaut|1969|Eagle|Tranquility|Aldrin|small step|Ohio|NASA)\b/i],
      ['what was the Magna Carta?', /\b(?:King John|1215|Runnymede|Latin|Great Charter|barons|Langton|due process|liberties)\b/i],
      ['what was the Yalta Conference?', /\b(?:Roosevelt|Churchill|Stalin|Big Three|Crimea|1945|Germany|United Nations|occupation)\b/i],
      ['what was the Potsdam Conference?', /\b(?:Truman|Stalin|Attlee|1945|Cecilienhof|Germany|Cold War|Hiroshima|atomic|Five Ds)\b/i],
      ['what was the Paris Agreement?', /\b(?:climate|UNFCCC|2015|COP|1\.5|2 °C|net-?zero|NDC|treaty|emissions)\b/i],
      ['what was the Titanic?', /\b(?:White Star|iceberg|1912|North Atlantic|Southampton|Belfast|maiden voyage|sank|Carpathia|lifeboat)\b/i],
      ['what was the Hindenburg?', /\b(?:airship|zeppelin|hydrogen|1937|Lakehurst|Frankfurt|fire|disaster|German|Morrison)\b/i],
      ['what was Chernobyl?', /\b(?:nuclear|reactor|RBMK|1986|Pripyat|Ukraine|Soviet|sarcophagus|exclusion|radioactive)\b/i],
      ['what was Fukushima?', /\b(?:nuclear|tsunami|2011|earthquake|Japan|Tōhoku|reactor|TEPCO|meltdown|Daiichi)\b/i],
      ['what was the 2004 Indian Ocean tsunami?', /\b(?:Sumatra|earthquake|Boxing Day|9\.|Aceh|Indonesia|Sri Lanka|warning system|magnitude|tsunami)\b/i],
      ['who was Euclid?', /\b(?:Greek|geometry|Elements|Alexandria|axiom|postulate|father of geometry|Ptolemy)\b/i],
      ['who was Pythagoras?', /\b(?:Greek|theorem|Samos|hypotenuse|Croton|number|right.?angle|musical ratio)\b/i],
      ['who was Archimedes?', /\b(?:Greek|Syracuse|Eureka|principle|sphere|cylinder|lever|Roman|buoyan|π|pi)\b/i],
      ['who was Euler?', /\b(?:Swiss|prolific|graph theory|Königsberg|notation|number|e \(|identity|Saint Petersburg|Berlin)\b/i],
      ['who was Gauss?', /\b(?:German|prince of mathematicians|Disquisitiones|number theory|Göttingen|Ceres|normal distribution|17-gon)\b/i],
      ['who was Riemann?', /\b(?:German|Riemann hypothesis|zeta|Riemannian geometry|relativity|complex|Göttingen|surfaces)\b/i],
      ['who was Cantor?', /\b(?:set theory|infinit|ℵ|aleph|continuum|Halle|diagonal|transfinite|Russian)\b/i],
      ['who was Ramanujan?', /\b(?:Indian|Hardy|Cambridge|number theory|partition|self-taught|Trinity|1729|continued fractions|Tamil)\b/i],
      ['who was Erdős?', /\b(?:Hungarian|prolific|collaborat|Erdős number|combinator|number theory|graph|Budapest)\b/i],
      ['who was Knut Hamsun?', /\b(?:Norwegian|Nobel|Hunger|Growth of the Soil|novelist|Markens Grøde|1920|literature)\b/i],
      ['who was Yuri Gagarin?', /\b(?:Soviet|cosmonaut|Vostok|first|space|orbit|1961|Russian|108 minutes)\b/i],
      // ── Round 8 ──
      ['who was J. R. R. Tolkien?', /\b(?:Hobbit|Lord of the Rings|Middle-earth|Oxford|Silmarillion|Inklings|Anglo-Saxon|elvish|Beowulf)\b/i],
      ['who was C. S. Lewis?', /\b(?:Narnia|Christian|Oxford|Magdalen|Belfast|Inklings|Tolkien|Mere Christianity|Screwtape)\b/i],
      ['who was Agatha Christie?', /\b(?:Queen of Crime|Poirot|Marple|Mousetrap|And Then There Were None|Murder on the Orient Express|2 billion|British|Devon)\b/i],
      ['who was Toni Morrison?', /\b(?:Beloved|Pulitzer|Nobel|African-American|Howard|Random House|Princeton|Ohio|Bluest Eye|Song of Solomon)\b/i],
      ['who was Gabriel García Márquez?', /\b(?:Colombian|magical realism|One Hundred Years|Macondo|Buendía|Nobel|Gabo|Aracataca|Love in the Time of Cholera)\b/i],
      ['what is a lion?', /\b(?:Panthera|big cat|pride|mane|sub-Saharan|Africa|Felidae|Asiatic|carnivor|apex|vulnerable)\b/i],
      ['what is a tiger?', /\b(?:Panthera tigris|Bengal|Siberian|Asia|stripes|largest|big cat|endangered|solitary|Felidae)\b/i],
      ['what is an elephant?', /\b(?:Loxodonta|Elephas|tusk|trunk|African|Asian|matriarch|largest|Proboscidea|ivory|Elephantidae)\b/i],
      ['what is a giraffe?', /\b(?:Giraffa|tallest|Africa|neck|savanna|seven|cervical|acacia|Giraffidae|Vulnerable)\b/i],
      ['what is a bear?', /\b(?:Ursidae|brown|polar|grizzly|hibernat|panda|sloth|sun|spectacled|Kodiak|carnivor)\b/i],
      ['what is a wolf?', /\b(?:Canis lupus|grey wolf|pack|Canidae|howl|Yellowstone|wolves|domestic dog|North America|Eurasia)\b/i],
      ['what is a fox?', /\b(?:Vulpes|red fox|Canidae|kitsune|Reynard|brush|Arctic|fennec|cunning|omnivor)\b/i],
      ['what is a horse?', /\b(?:Equus|Equidae|domesticated|Botai|hoof|breeds|donkey|zebra|Przewalski|Thoroughbred|Arabian)\b/i],
      ['what is a dog?', /\b(?:Canis familiaris|wolf|domesticated|breeds|Canidae|companion|pets|first species|smell|working)\b/i],
      ['what is a cat?', /\b(?:Felis catus|domestic|African wildcat|Felidae|carnivor|Egyptian|breeds|Bastet|9,000|Near East|Persian|Maine Coon)\b/i],
      ['what is a tulip?', /\b(?:Tulipa|Liliaceae|bulb|Netherlands|Holland|Tulip Mania|Ottoman|Clusius|Persian|Anatolia|spring)\b/i],
      ['what is a cactus?', /\b(?:Cactaceae|succulent|Americas|spines|areole|saguaro|prickly pear|Sonoran|peyote|CAM|desert)\b/i],
      ['what is an earthquake?', /\b(?:seismic|tectonic|epicentre|epicenter|hypocentre|Richter|moment magnitude|plate|Ring of Fire|P-wave|S-wave|Mercalli)\b/i],
      ['what is a volcano?', /\b(?:magma|lava|crust|tectonic|stratovolcano|shield|caldera|Vesuvius|Vulcan|VEI|Ring of Fire|hotspot)\b/i],
      ['what is a tsunami?', /\b(?:harbour wave|Japanese|earthquake|seismic|wavelength|deep ocean|2004|2011|Tōhoku|run-up|warning system|displacement)\b/i],
      ['what is the Notre-Dame Cathedral?', /\b(?:Paris|Gothic|Île de la Cité|1163|Hugo|Hunchback|Viollet-le-Duc|spire|2019|fire|UNESCO|2024)\b/i],
      ['what is Coca-Cola?', /\b(?:Atlanta|1886|Pemberton|Candler|coca|kola|carbonated|trade secret|hobble-skirt|Frank M\. Robinson|brand|Santa)\b/i],
      ['who was Augustus?', /\b(?:Octavian|Octavius|Roman|emperor|Caesar|Actium|Antony|princeps|Republic|Pax Romana|27 BCE|14 CE|Tiberius)\b/i],
      ['who was Charlemagne?', /\b(?:Frank|Carolingian|Holy Roman Emperor|Pope Leo|800|Aachen|Saxons|Lombards|Pepin|Carolingian Renaissance|Father of Europe)\b/i],
      ['who was Queen Victoria?', /\b(?:Victorian|British|United Kingdom|Albert|empress|India|1837|1901|Hanover|Grandmother of Europe|63|Industrial)\b/i],
      ['who was Queen Elizabeth I?', /\b(?:Tudor|Henry VIII|Anne Boleyn|Virgin Queen|Spanish Armada|1558|1603|Mary|Shakespeare|Elizabethan|Protestant)\b/i],
      ['who was Henry VIII?', /\b(?:Tudor|six|wives|Catherine of Aragon|Anne Boleyn|Reformation|Church of England|Pope|Cromwell|Wolsey|1509|1547|monasteries)\b/i],
      ['what is a mortgage?', /\b(?:loan|property|collateral|principal|interest|foreclos|borrower|lender|amortis|fixed-rate|adjustable|home|real estate|down payment)\b/i],
      // ── Round 9 ──
      ['what is a protein?', /\b(?:amino acid|peptide|polypeptide|enzyme|gene|DNA|ribosome|haemoglobin|hemoglobin|biomolecule|AlphaFold)\b/i],
      ['what is an enzyme?', /\b(?:catalyst|catalyse|catalyze|protein|substrate|active site|ribozyme|amylase|cofactor|EC class|coenzyme|allosteric)\b/i],
      ['what is a fungus?', /\b(?:Fungi|chitin|hyphae|mycelium|mushroom|yeast|mould|mold|lichen|mycorrhiz|spore|kingdom|Penicillium)\b/i],
      ['what is a chromosome?', /\b(?:DNA|histone|nucleus|46|23|autosome|sex chromosome|centromere|telomere|sister chromatid|karyotype|Down syndrome)\b/i],
      ['what is a gene?', /\b(?:DNA|heredity|allele|locus|protein|Mendel|Johannsen|exon|intron|promoter|central dogma|CRISPR|genome|20,000)\b/i],
      ['what is a vaccine?', /\b(?:immune|pathogen|antibody|antibodies|memory|Jenner|smallpox|cowpox|MMR|mRNA|live-attenuated|inactivated|herd immunity|polio|measles)\b/i],
      ['what is a truck?', /\b(?:lorry|cargo|payload|pickup|F-150|semi-trailer|tractor|chassis|diesel|GVWR|Daimler|Volvo|Mack|Class 8|18-wheeler|18 wheeler|articulated)\b/i],
      ['what is a motorcycle?', /\b(?:Daimler|Maybach|Reitwagen|Honda|Yamaha|Kawasaki|Suzuki|Harley|Ducati|Triumph|MotoGP|cruiser|sport|adventure|two-wheel)\b/i],
      ['what is a submarine?', /\b(?:underwater|U-boat|nuclear|SSN|SSBN|ballast|Hunley|Nautilus|Ohio|Yasen|hydroplane|diesel-electric|periscope|ballistic|Virginia class)\b/i],
      ['what is a helicopter?', /\b(?:rotorcraft|rotor|Sikorsky|VTOL|tail rotor|VS-300|main rotor|Apache|Black Hawk|Chinook|Huey|Mi-26|Robinson|Bell|tilting|cyclic|collective)\b/i],
      ['what is a rocket?', /\b(?:thrust|engine|propellant|Newton|Tsiolkovsky|Goddard|V-2|von Braun|Saturn V|Falcon 9|SpaceX|liquid|solid|oxidiser|oxidizer|Sputnik)\b/i],
      ['what is a satellite?', /\b(?:orbit|Sputnik|Explorer 1|LEO|MEO|GEO|geostationary|GPS|Hubble|James Webb|Starlink|communications|Earth observation|Telstar|Van Allen)\b/i],
      ['what is Tokyo?', /\b(?:Japan|capital|Edo|Honshu|Tokugawa|Meiji|prefecture|Shibuya|Shinjuku|Skytree|Tokyo Tower|Kantō|Kanto|earthquake|Olympic|Imperial Palace)\b/i],
      ['what is a drum?', /\b(?:percussion|drumhead|membrane|skin|snare|bass drum|timpani|tom|drum kit|tabla|djembe|conga|bongo|taiko|Bonham)\b/i],
      ['what is a flute?', /\b(?:woodwind|reedless|transverse|piccolo|Boehm|recorder|shakuhachi|Hohle Fels|Galway|Rampal|silver|embouchure|Pan flute)\b/i],
      ['what is a saxophone?', /\b(?:Adolphe Sax|woodwind|brass|reed|alto|tenor|soprano|baritone|jazz|Coltrane|Charlie Parker|Belgian|1846|conical)\b/i],
      // Round 10
      ['who was Emily Dickinson?', /\b(?:Amherst|Massachusetts|Homestead|reclusive|fascicle|slant rhyme|Lavinia|Mount Holyoke|hymn|1830|1886|Bright)\b/i],
      ['who was Walt Whitman?', /\b(?:Leaves of Grass|free verse|Brooklyn|Long Island|Lincoln|O Captain|Song of Myself|Lilacs|Civil War|Camden|Emerson|1855)\b/i],
      ['who was Edgar Allan Poe?', /\b(?:Raven|Tell-Tale|Usher|Cask of Amontillado|Dupin|Rue Morgue|Boston|Baltimore|Virginia|Edgar|Nevermore|gothic|detective)\b/i],
      ['who was William Wordsworth?', /\b(?:Romantic|Lake District|Coleridge|Lyrical Ballads|Tintern|Daffodils|Prelude|Cumbria|Dove Cottage|Grasmere|Poet Laureate|1850)\b/i],
      ['who was Lord Byron?', /\b(?:Romantic|Childe Harold|Don Juan|Caroline Lamb|Augusta|Greece|Missolonghi|Villa Diodati|Shelley|clubfoot|1788|1824|Annabella)\b/i],
      ['who was Percy Bysshe Shelley?', /\b(?:Romantic|Ozymandias|Mary|Frankenstein|Atheism|Adonais|Prometheus|West Wind|Skylark|Italy|Lerici|drowned|1822|legislators)\b/i],
      ['who was John Keats?', /\b(?:Romantic|Nightingale|Grecian Urn|Autumn|Endymion|Hyperion|Shelley|Fanny Brawne|tuberculosis|Rome|writ in Water|1819|1821|odes)\b/i],
      ['who was Dylan Thomas?', /\b(?:Welsh|Swansea|Under Milk Wood|Do Not Go Gentle|Fern Hill|villanelle|BBC|Caitlin|White Horse|New York|18 Poems|1953|Llareggub)\b/i],
      ['who was Pablo Neruda?', /\b(?:Chilean|Nobel|Twenty Love Poems|Canto General|Macchu Picchu|communist|diplomat|Allende|Pinochet|1971|Spanish|Lorca|odes|Matilde)\b/i],
      ['who was Rumi?', /\b(?:Persian|Sufi|Mevlana|Konya|Masnavi|Shams|Tabriz|whirling|dervish|Mevlevi|Balkh|13th|Coleman Barks|1207|1273)\b/i],
      ['who was Caravaggio?', /\b(?:Baroque|chiaroscuro|tenebrism|Italian|Rome|Saint Matthew|Contarelli|Tomassoni|Malta|Naples|naturalism|1571|1610|David|Goliath)\b/i],
      ['who was Vermeer?', /\b(?:Dutch|Delft|Golden Age|Girl with a Pearl Earring|View of Delft|Milkmaid|interior|light|ultramarine|camera obscura|Bolnes|1632|1675|Thoré)\b/i],
      ['who was Renoir?', /\b(?:Impressionism|French|Monet|Bal du moulin|Galette|Boating Party|Limoges|Aline|Jean Renoir|Cagnes|arthritis|porcelain|1841|1919)\b/i],
      ['who was Degas?', /\b(?:French|ballet|Impressionist|Paris|pastel|Little Dancer|horse|race|Beaux-Arts|Ingres|realist|1834|1917|Marie van Goethem)\b/i],
      ['who was Louis Pasteur?', /\b(?:French|microbiology|germ theory|pasteurisation|pasteurization|rabies|anthrax|chicken cholera|spontaneous generation|Joseph Meister|Institut Pasteur|chirality|Dole|1822|1895)\b/i],
      ['who was Gregor Mendel?', /\b(?:Augustinian|friar|monk|Brno|pea|inheritance|allele|dominant|recessive|segregation|independent assortment|genetics|1866|Moravian|Czech|Hynčice|Heinzendorf)\b/i],
      ['who was Rosalind Franklin?', /\b(?:X-ray|crystallography|DNA|Photo 51|King's College|double helix|Watson|Crick|Wilkins|Birkbeck|tobacco mosaic|ovarian|1958|1920|Newnham)\b/i],
      ['who was Søren Kierkegaard?', /\b(?:Danish|existentialist|Copenhagen|Either\/Or|Fear and Trembling|Sickness Unto Death|leap of faith|anxiety|angst|despair|Regine|pseudonym|1813|1855|theologian)\b/i],
      ['who was Simone de Beauvoir?', /\b(?:French|existentialist|feminist|Second Sex|Sartre|Mandarins|Goncourt|Sorbonne|agrégation|One is not born|Paris|Temps modernes|1908|1986|Other)\b/i],
      ['who was Michel Foucault?', /\b(?:French|Discipline and Punish|History of Sexuality|power|knowledge|panopticon|biopolitics|Madness|Collège de France|episteme|AIDS|1926|1984|gaze)\b/i],
      ['who was Bertrand Russell?', /\b(?:British|philosopher|mathematician|Principia Mathematica|Whitehead|Russell's paradox|analytic|Trinity|Cambridge|History of Western Philosophy|Nobel|pacifist|Pugwash|1872|1970)\b/i],
      ['who was Thomas Hobbes?', /\b(?:English|Leviathan|state of nature|social contract|sovereign|materialist|nasty|brutish|Cavendish|Malmesbury|Civil War|De Cive|1588|1679|absolute)\b/i],
      ['what was the Marshall Plan?', /\b(?:European Recovery Program|ERP|George Marshall|Truman|1947|1948|1951|13|billion|Western Europe|OEEC|OECD|Cold War|Comecon|reconstruction|Harvard)\b/i],
      ['what was Operation Barbarossa?', /\b(?:Nazi|Germany|Soviet|June 1941|22 June|Wehrmacht|Eastern Front|Molotov|Ribbentrop|Army Group|Moscow|Kiev|encirclement|Hitler|Frederick|Barbarossa|3\.8 million)\b/i],
      ['what was Iwo Jima?', /\b(?:Marines?|Pacific|volcanic|sulphur|sulfur|Kuribayashi|Mount Suribachi|Suribachi|Rosenthal|flag|February 1945|March 1945|Mariana|B-29|Operation Detachment|Spruance|Schmidt|Medal of Honor)\b/i],
      ['who was Erwin Schrödinger?', /\b(?:Austrian|Irish|Vienna|quantum|wave|equation|1926|Nobel|1933|Dirac|Berlin|Dublin|cat|What Is Life|aperiodic|1887|1961)\b/i],
      ['who was Max Planck?', /\b(?:German|Berlin|black-body|quantum|constant|Planck's constant|h\b|6\.626|1900|1918|Nobel|Kiel|Helmholtz|Kirchhoff|Erwin|Max Planck Society|Kaiser Wilhelm|1858|1947)\b/i],
      ['who was Tycho Brahe?', /\b(?:Danish|Hven|Uraniborg|Stjerneborg|nose|Frederick|De Stella Nova|supernova|1572|naked-eye|Kepler|Rudolf|Prague|Tychonic|1546|1601)\b/i],
    ];
    const fallbackPattern = /(?:i don['']t yet hold|isn['']t in my knowledge yet|isn['']t somewhere i can speak with confidence|real gap in what i hold|don['']t have \*\*[^*]+\*\* locally yet|empty pocket on)/i;
    for (const [q, expected] of cases) {
      it(`"${q}" → answers concretely`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, `${q} → should match ${expected}`).toMatch(expected);
        expect(text, `${q} → should not stall in honest-gap fallback`).not.toMatch(fallbackPattern);
      });
    }
  });
});
