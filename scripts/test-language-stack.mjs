#!/usr/bin/env node
/**
 * Language & Web-Stack Benchmark — 100 questions + 100 follow-ups
 * ---------------------------------------------------------------
 * 25 Norwegian grammar   (Q 1-25)
 * 25 English grammar      (Q 26-50)
 * 25 MERN vs PERN (EN)    (Q 51-75)
 * 25 MERN vs MEVN (NO)    (Q 76-100)
 */
import WebSocket from 'ws';

const API  = 'http://localhost:3006';
const WS   = 'ws://localhost:3006/api/chat';
const TIMEOUT = 12_000;

/* ═══════════════ Questions ═══════════════ */

const norwegianQuestions = [
  // 1 – Verb conjugation: preteritum av "å gå"
  {
    q: 'Hva er preteritum av verbet "å gå" på norsk? Bøy hele verbet (presens, preteritum, perfektum).',
    followUp: 'Kan du også bøye "å spise" i alle tre formene?',
    validate: r => /gikk/i.test(r),
    validateFU: r => /spiste/i.test(r),
    desc: 'Preteritum av å gå',
  },
  // 2 – Word order: V2 rule
  {
    q: 'Forklar V2-regelen for ordstilling i norske hovedsetninger, med eksempler.',
    followUp: 'Hva skjer med ordstillingen i en leddsetning (bisetning)?',
    validate: r => /plass\s*2|V2|verb.*(?:plass|position)\s*(?:2|to)|andre\s*plass/i.test(r),
    validateFU: r => /ikke.*foran|adverb.*foran|før\s*verb|ikke\s+spiser/i.test(r),
    desc: 'V2-regelen',
  },
  // 3 – Noun genders
  {
    q: 'Hva er de tre kjønnene i norsk (bokmål)? Gi eksempler med ubestemt og bestemt form.',
    followUp: 'Kan alle hunkjønnsord bøyes som hankjønn i bokmål?',
    validate: r => /hankjønn|hunkjønn|intetkjønn/i.test(r),
    validateFU: r => /hunkjønn.*hankjønn|jente.*jenten|bokmål/i.test(r),
    desc: 'Tre kjønn',
  },
  // 4 – Prepositions i/på/hos
  {
    q: 'Forklar forskjellen mellom preposisjonene "i", "på" og "hos" i norsk med eksempler.',
    followUp: 'Hvilket preposisjon bruker man med "kontoret" – i eller på?',
    validate: r => /på.*arbeid|på.*kontor|hos.*lege|i.*bil/i.test(r),
    validateFU: r => /på\s+kontoret|på\b/i.test(r),
    desc: 'Preposisjoner',
  },
  // 5 – Formal email
  {
    q: 'Hvordan avslutter man en formell norsk e-post? Hva er den vanligste avslutningen?',
    followUp: 'Hva betyr forkortelsen MVH?',
    validate: r => /med\s+vennlig\s+hilsen|MVH/i.test(r),
    validateFU: r => /med\s+vennlig\s+hilsen/i.test(r),
    desc: 'Formell e-post',
  },
  // 6 – Bestemt form
  {
    q: 'Forklar bestemt form av substantiv i norsk (bokmål) med eksempler for alle tre kjønn.',
    followUp: 'Hva er bestemt form flertall av "en gutt"?',
    validate: r => /gutten|jenta|huset|bestemt/i.test(r),
    validateFU: r => /guttene/i.test(r),
    desc: 'Bestemt form',
  },
  // 7 – Modal verbs
  {
    q: 'Hva er de viktigste modalverbene i norsk? Gi eksempler på bruk.',
    followUp: 'Bruker man "å" etter modalverb i norsk?',
    validate: r => /må|kan|vil|skal|bør/i.test(r),
    validateFU: r => /uten\s*å|ikke.*å|infinitiv\s+uten/i.test(r),
    desc: 'Modalverb',
  },
  // 8 – Conjunctions
  {
    q: 'Hva er de viktigste konjunksjonene (bindeordene) i norsk? Gi eksempler.',
    followUp: 'Hva er forskjellen mellom en konjunksjon og en subjunksjon?',
    validate: r => /og|men|eller|for|så/i.test(r),
    validateFU: r => /subjunksjon|leddsetning|bisetning|fordi|at|når/i.test(r),
    desc: 'Konjunksjoner',
  },
  // 9 – Adjective agreement
  {
    q: 'Forklar adjektivbøyning i norsk – hvordan endres adjektivet for intetkjønn og flertall?',
    followUp: 'Hvordan bøyes adjektivet i bestemt form (f.eks. "den store bilen")?',
    validate: r => /stort|store|intetkjønn.*-t|flertall.*-e/i.test(r),
    validateFU: r => /store|den\s+store|bestemt.*-e/i.test(r),
    desc: 'Adjektivbøyning',
  },
  // 10 – Negation placement
  {
    q: 'Hvor plasseres "ikke" i norske hovedsetninger og leddsetninger?',
    followUp: 'Gi et eksempel på en leddsetning med "ikke".',
    validate: r => /(?:etter|after)\s+verb.*hovedsetning|(?:foran|before|før)\s+verb.*leddsetning/i.test(r),
    validateFU: r => /fordi\s+(?:\w+\s+)?ikke/i.test(r),
    desc: 'Negasjon',
  },
  // 11 – Reflexive verbs
  {
    q: 'Hva er refleksive verb i norsk? Gi eksempler.',
    followUp: 'Hva er de refleksive pronomenene i norsk?',
    validate: r => /sette\s+seg|legge\s+seg|glede\s+seg|føle\s+seg/i.test(r),
    validateFU: r => /meg|deg|seg|oss/i.test(r),
    desc: 'Refleksive verb',
  },
  // 12 – Question formation
  {
    q: 'Hvordan danner man spørsmål i norsk? Forklar med eksempler.',
    followUp: 'Hva er de vanligste spørreordene i norsk?',
    validate: r => /(?:verb.*plass\s*1|invers|spørreord)/i.test(r),
    validateFU: r => /hva|hvor|når|hvem|hvorfor|hvordan/i.test(r),
    desc: 'Spørsmålsformasjon',
  },
  // 13 – Double definite
  {
    q: 'Forklar dobbel bestemmelse i norsk (f.eks. "den store bilen").',
    followUp: 'Gjelder dobbel bestemmelse for alle kjønn?',
    validate: r => /den\s+store|dobbel\s+bestem|determinativ/i.test(r),
    validateFU: r => /den.*det.*de|alle\s+kjønn|hankjønn.*hunkjønn.*intetkjønn/i.test(r),
    desc: 'Dobbel bestemmelse',
  },
  // 14 – S-passive
  {
    q: 'Forklar s-passiv og bli-passiv i norsk med eksempler.',
    followUp: 'Hvilken passivform er vanligst i dagligtale?',
    validate: r => /leses|åpnes|s-passiv|bli-passiv/i.test(r),
    validateFU: r => /bli.?passiv|dagligtale/i.test(r),
    desc: 'Passiv',
  },
  // 15 – "å bli" vs "å være"
  {
    q: 'Hva er forskjellen mellom "å være" og "å bli" i norsk?',
    followUp: 'Kan du gi et eksempel der begge brukes i samme setning?',
    validate: r => /tilstand|endring|to\s+be|to\s+become|bli.*become|være.*be\b/i.test(r),
    validateFU: r => /er.*bli|bli.*er|var.*ble/i.test(r),
    desc: 'Å være vs å bli',
  },
  // 16 – Compound words
  {
    q: 'Forklar hvordan sammensatte ord fungerer i norsk. Hva betyr "arbeidstillatelse"?',
    followUp: 'Hva er binde-s og binde-e i sammensatte ord?',
    validate: r => /arbeid.*tillatelse|work\s*permit|sammensatt/i.test(r),
    validateFU: r => /binde-?s|binde-?e|fuge/i.test(r),
    desc: 'Sammensatte ord',
  },
  // 17 – Infinitive marker "å"
  {
    q: 'Forklar bruken av infinitivsmerket "å" i norsk.',
    followUp: 'Når brukes IKKE "å" foran et verb?',
    validate: r => /å.*infinitiv|infinitiv.*å|to\b.*read/i.test(r),
    validateFU: r => /modal|kan|må|skal|vil/i.test(r),
    desc: 'Infinitivsmerket å',
  },
  // 18 – Ordforråd: "erfaring"
  {
    q: 'Hva betyr det norske ordet "erfaring"? Gi eksempler på bruk.',
    followUp: 'Hva er adjektivet av "erfaring" (en person som har mye erfaring)?',
    validate: r => /experience/i.test(r),
    validateFU: r => /erfaren/i.test(r),
    desc: 'Ordforråd: erfaring',
  },
  // 19 – Ordforråd: "beskjed"
  {
    q: 'Hva betyr "gi beskjed" på norsk? Bruk det i en setning.',
    followUp: 'Hva betyr "få beskjed"?',
    validate: r => /message|notice|inform|notify/i.test(r),
    validateFU: r => /notif|be\s+(?:told|informed)|ble\s+informert/i.test(r),
    desc: 'Ordforråd: beskjed',
  },
  // 20 – Article usage en/ei/et
  {
    q: 'Forklar de ubestemte artiklene en, ei og et i norsk.',
    followUp: 'Er det vanlig å bruke "en" i stedet for "ei" i bokmål?',
    validate: r => /en.*hankjønn|ei.*hunkjønn|et.*intetkjønn/i.test(r),
    validateFU: r => /bokmål|en\s+(?:jente|bok)|vanlig/i.test(r),
    desc: 'Artikler en/ei/et',
  },
  // 21 – Verb: "å spise" conjugation
  {
    q: 'Hva er preteritum av verbet "å spise"? Bøy verbet i alle former.',
    followUp: 'Er "å spise" et sterkt eller svakt verb?',
    validate: r => /spiste/i.test(r),
    validateFU: r => /svak|gruppe\s*2/i.test(r),
    desc: 'Bøyning: å spise',
  },
  // 22 – Verb: "å være" conjugation
  {
    q: 'Bøy verbet "å være" i presens, preteritum og perfektum.',
    followUp: 'Er "å være" et regelmessig eller uregelmessig verb?',
    validate: r => /er.*var.*vært/i.test(r),
    validateFU: r => /uregelmessig|sterk/i.test(r),
    desc: 'Bøyning: å være',
  },
  // 23 – Verb: "å ha" conjugation
  {
    q: 'Bøy verbet "å ha" (presens, preteritum, perfektum) på norsk.',
    followUp: 'Bøy også "å komme" i alle formene.',
    validate: r => /har.*hadde.*hatt/i.test(r),
    validateFU: r => /kom\b/i.test(r),
    desc: 'Bøyning: å ha',
  },
  // 24 – Ordstilling in questions  
  {
    q: 'Forklar ordstillingen i norske spørsmål (ja/nei og informasjonsspørsmål).',
    followUp: 'Hva er inversjon i norsk grammatikk?',
    validate: r => /verb.*plass\s*1|inversjon|spørreord.*verb/i.test(r),
    validateFU: r => /inversjon|subjekt.*etter\s+verb|verb.*subjekt/i.test(r),
    desc: 'Ordstilling i spørsmål',
  },
  // 25 – Verb: "å skrive" conjugation
  {
    q: 'Hva er preteritum av "å skrive"? Bøy hele verbet.',
    followUp: 'Er "å skrive" et sterkt eller svakt verb?',
    validate: r => /skrev/i.test(r),
    validateFU: r => /sterk|uregelmessig/i.test(r),
    desc: 'Bøyning: å skrive',
  },
];

const englishQuestions = [
  // 26 – Present perfect vs past simple
  {
    q: 'Explain the difference between present perfect and past simple in English with examples.',
    followUp: 'When do you use "have been" vs "went"?',
    validate: r => /have.*past\s+participle|has\s+\+|unspecified|continuing/i.test(r),
    validateFU: r => /experience|state|specific\s+past/i.test(r),
    desc: 'Present perfect vs past simple',
  },
  // 27 – Dangling modifier
  {
    q: 'What is a dangling modifier? Give an example of one and show how to fix it.',
    followUp: 'What other types of modifier errors exist in English?',
    validate: r => /modif.*not\s+clearly|modif.*wrong|walking.*rain|incorrect/i.test(r),
    validateFU: r => /misplaced|squinting|modifier/i.test(r),
    desc: 'Dangling modifier',
  },
  // 28 – Affect vs Effect
  {
    q: 'What is the difference between "affect" and "effect" in English?',
    followUp: 'Can "effect" ever be used as a verb?',
    validate: r => /affect.*verb|effect.*noun/i.test(r),
    validateFU: r => /effect\s+change|bring\s+about|to\s+effect/i.test(r),
    desc: 'Affect vs Effect',
  },
  // 29 – 8 Parts of speech
  {
    q: 'List and explain the 8 parts of speech in English with examples.',
    followUp: 'Can a word belong to more than one part of speech depending on context?',
    validate: r => /noun|pronoun|verb|adjective|adverb|preposition|conjunction|interjection/i.test(r),
    validateFU: r => /context|different\s+part|multiple/i.test(r),
    desc: '8 Parts of speech',
  },
  // 30 – Subject-verb agreement
  {
    q: 'Explain subject-verb agreement in English. When is "the team is" vs "the team are" correct?',
    followUp: 'What about "everyone" – is it singular or plural for agreement purposes?',
    validate: r => /singular.*singular|plural.*plural|team\s+is|team\s+are/i.test(r),
    validateFU: r => /singular|everyone\s+(?:is|has)/i.test(r),
    desc: 'Subject-verb agreement',
  },
  // 31 – Active vs Passive voice
  {
    q: 'What is the difference between active and passive voice in English?',
    followUp: 'When should you use passive voice in writing?',
    validate: r => /subject.*verb.*object|active|passive|was\s+chased/i.test(r),
    validateFU: r => /scientific|formal|unknown.*doer|unimportant/i.test(r),
    desc: 'Active vs Passive voice',
  },
  // 32 – Who vs Whom
  {
    q: 'What is the difference between "who" and "whom" in English?',
    followUp: 'Is "whom" still commonly used in modern English?',
    validate: r => /who.*subject|whom.*object|he.*who|him.*whom/i.test(r),
    validateFU: r => /formal|declining|less\s+common|still\s+used/i.test(r),
    desc: 'Who vs Whom',
  },
  // 33 – Then vs Than
  {
    q: 'What is the difference between "then" and "than" in English?',
    followUp: 'Give an example sentence that uses both "then" and "than".',
    validate: r => /then.*time|than.*compar/i.test(r),
    validateFU: r => /then.*than|than.*then/i.test(r),
    desc: 'Then vs Than',
  },
  // 34 – Their/There/They're
  {
    q: 'Explain the difference between "their", "there", and "they\'re" with examples.',
    followUp: 'Which is the most commonly confused pair?',
    validate: r => /their.*possess|there.*location|they'?re.*they\s+are/i.test(r),
    validateFU: r => /their.*there|confus|common/i.test(r),
    desc: 'Their/There/They\'re',
  },
  // 35 – Its vs It's
  {
    q: 'What is the difference between "its" and "it\'s"?',
    followUp: 'Why doesn\'t the possessive "its" have an apostrophe?',
    validate: r => /its.*possess|it'?s.*contraction|it\s+is/i.test(r),
    validateFU: r => /pronoun|possessive\s+pronoun|his|hers|yours/i.test(r),
    desc: 'Its vs It\'s',
  },
  // 36 – Comma splice
  {
    q: 'What is a comma splice in English? How do you fix one?',
    followUp: 'What is the difference between a comma splice and a run-on sentence?',
    validate: r => /two\s+independent|comma\s+splice|period|semicolon|conjunction/i.test(r),
    validateFU: r => /run.?on|no\s+punct|without\s+(?:any\s+)?punct/i.test(r),
    desc: 'Comma splice',
  },
  // 37 – Lay vs Lie
  {
    q: 'What is the difference between "lay" and "lie" in English?',
    followUp: 'What is the past tense of "lie" (to recline)?',
    validate: r => /lay.*transitive|lie.*intransitive|lay.*object|lie.*recline/i.test(r),
    validateFU: r => /\blay\b/i.test(r),
    desc: 'Lay vs Lie',
  },
  // 38 – Gerund vs Infinitive
  {
    q: 'What is the difference between a gerund and an infinitive in English?',
    followUp: 'What happens when "stop" is followed by a gerund vs an infinitive?',
    validate: r => /gerund.*-ing|infinitive.*to\s*\+/i.test(r),
    validateFU: r => /stop\w*\s+smoking|stop\w*\s+to\s+smoke|quit|paused/i.test(r),
    desc: 'Gerund vs Infinitive',
  },
  // 39 – Semicolon usage
  {
    q: 'When do you use a semicolon in English? Give three usage rules.',
    followUp: 'Can a semicolon replace a period in all cases?',
    validate: r => /independent\s+clause|conjunctive\s+adverb|complex\s+list|however|therefore/i.test(r),
    validateFU: r => /related|connect|not\s+(?:always|all)/i.test(r),
    desc: 'Semicolon usage',
  },
  // 40 – Oxford comma
  {
    q: 'What is the Oxford comma? Why is it important?',
    followUp: 'Is the Oxford comma required in all English style guides?',
    validate: r => /serial\s+comma|comma\s+before\s+and|ambiguity/i.test(r),
    validateFU: r => /AP|style\s+guide|optional|not\s+required/i.test(r),
    desc: 'Oxford comma',
  },
  // 41 – Split infinitive
  {
    q: 'What is a split infinitive in English? Give an example.',
    followUp: 'Is it considered wrong to split infinitives in modern English?',
    validate: r => /adverb\s+between|to\s+boldly|split.*to.*verb/i.test(r),
    validateFU: r => /accept|modern|no\s+longer|not\s+wrong/i.test(r),
    desc: 'Split infinitive',
  },
  // 42 – Further vs Farther
  {
    q: 'What is the difference between "further" and "farther"?',
    followUp: 'Can "further" be used for physical distance too?',
    validate: r => /farther.*physical|further.*figurative|further.*additional/i.test(r),
    validateFU: r => /informal|sometimes|also/i.test(r),
    desc: 'Further vs Farther',
  },
  // 43 – Countable vs Uncountable
  {
    q: 'What is the difference between countable and uncountable nouns in English?',
    followUp: 'Is "information" countable or uncountable?',
    validate: r => /countable.*plural|uncountable.*(?:no\s+plural|cannot|can't)/i.test(r),
    validateFU: r => /uncountable/i.test(r),
    desc: 'Countable vs Uncountable',
  },
  // 44 – English articles
  {
    q: 'Explain the rules for using articles (a, an, the) in English.',
    followUp: 'Why do we say "a university" but "an umbrella"?',
    validate: r => /a.*consonant|an.*vowel|the.*specific/i.test(r),
    validateFU: r => /sound|yoo|vowel\s+sound/i.test(r),
    desc: 'English articles',
  },
  // 45 – Apostrophe rules
  {
    q: 'What are the rules for using apostrophes in English?',
    followUp: 'Is it "the children\'s toys" or "the childrens\' toys"?',
    validate: r => /contraction|possessive|'s/i.test(r),
    validateFU: r => /children's|irregular\s+plural/i.test(r),
    desc: 'Apostrophe rules',
  },
  // 46 – Fragment vs Sentence
  {
    q: 'What is the difference between a sentence fragment and a complete sentence?',
    followUp: 'Can fragments ever be used intentionally in writing?',
    validate: r => /subject.*verb|complete\s+thought|fragment.*lacks/i.test(r),
    validateFU: r => /style|emphasis|creative|intentional/i.test(r),
    desc: 'Fragment vs Sentence',
  },
  // 47 – Run-on sentence
  {
    q: 'What is a run-on sentence in English? How do you fix one?',
    followUp: 'What is a fused sentence?',
    validate: r => /two\s+independent|without.*punct|fix.*period|semicolon|conjunction/i.test(r),
    validateFU: r => /fused|no\s+punct|without\s+(?:any\s+)?punct/i.test(r),
    desc: 'Run-on sentence',
  },
  // 48 – Conditional tenses
  {
    q: 'Explain the four types of conditional tenses in English with examples.',
    followUp: 'What conditional type is used in the sentence: "If I had studied, I would have passed"?',
    validate: r => /zero|first|second|third|conditional/i.test(r),
    validateFU: r => /third/i.test(r),
    desc: 'Conditional tenses',
  },
  // 49 – Parallel structure
  {
    q: 'What is parallel structure in English? Give a correct and incorrect example.',
    followUp: 'Why is parallel structure important in professional writing?',
    validate: r => /same\s+(?:grammatical\s+)?form|parallel|reading.*swimming.*cooking/i.test(r),
    validateFU: r => /clarity|readab|professional|consistency/i.test(r),
    desc: 'Parallel structure',
  },
  // 50 – Pronoun agreement
  {
    q: 'What is pronoun agreement in English? Explain the debate about singular "they".',
    followUp: 'Is singular "they" grammatically correct in modern English?',
    validate: r => /agree.*antecedent|singular\s+they|everyone.*their/i.test(r),
    validateFU: r => /accept|widely|modern|correct/i.test(r),
    desc: 'Pronoun agreement',
  },
];

const mernPernQuestions = [
  // 51 – MERN definition
  {
    q: 'What does MERN stack stand for? Explain each technology\'s role.',
    followUp: 'Why is MERN called a "full JavaScript stack"?',
    validate: r => /MongoDB|Express|React|Node/i.test(r),
    validateFU: r => /same\s+lang|javascript.*(?:front|back|every)|JS.*(?:front|back)/i.test(r),
    desc: 'MERN stack definition',
  },
  // 52 – PERN definition
  {
    q: 'What does PERN stack stand for? How does it differ from MERN?',
    followUp: 'What are ACID properties in PostgreSQL?',
    validate: r => /PostgreSQL|Express|React|Node/i.test(r),
    validateFU: r => /atomic|consisten|isolat|durab/i.test(r),
    desc: 'PERN stack definition',
  },
  // 53 – MERN vs PERN
  {
    q: 'What is the main difference between MERN and PERN stacks?',
    followUp: 'When should I choose PERN over MERN for a project?',
    validate: r => /MongoDB.*PostgreSQL|NoSQL.*SQL|document.*relational/i.test(r),
    validateFU: r => /(?:relational|complex|strict|integrity|financial)/i.test(r),
    desc: 'MERN vs PERN comparison',
  },
  // 54 – Express.js role
  {
    q: 'What is the role of Express.js in the MERN/PERN stack?',
    followUp: 'Can you build a MERN stack without Express.js?',
    validate: r => /(?:web\s+framework|HTTP|API|route|middleware)/i.test(r),
    validateFU: r => /(?:Fastify|Koa|alternative|possible|yes)/i.test(r),
    desc: 'Express.js role',
  },
  // 55 – Middleware
  {
    q: 'What is middleware in Express.js? Give common examples.',
    followUp: 'What does the next() function do in middleware?',
    validate: r => /(?:request.*response|req.*res|between|function)/i.test(r),
    validateFU: r => /(?:next\s+middleware|pass|chain|control)/i.test(r),
    desc: 'Middleware concept',
  },
  // 56 – MongoDB vs PostgreSQL
  {
    q: 'Compare MongoDB and PostgreSQL. When would you choose each?',
    followUp: 'Can MongoDB do JOINs like PostgreSQL?',
    validate: r => /NoSQL.*SQL|document.*relational|flexible.*strict/i.test(r),
    validateFU: r => /\$lookup|limited|aggregat/i.test(r),
    desc: 'MongoDB vs PostgreSQL',
  },
  // 57 – ORM definition
  {
    q: 'What is an ORM? Name popular ORMs for Node.js.',
    followUp: 'Compare Prisma vs Sequelize - which is more type-safe?',
    validate: r => /Object.*Relational|database.*object|Prisma|Sequelize/i.test(r),
    validateFU: r => /Prisma.*type.?safe|TypeScript|schema.?first/i.test(r),
    desc: 'ORM definition',
  },
  // 58 – SQL vs NoSQL
  {
    q: 'What is the difference between SQL and NoSQL databases?',
    followUp: 'Can you use SQL queries with MongoDB?',
    validate: r => /(?:table|relational).*(?:document|flexible)|SQL.*NoSQL/i.test(r),
    validateFU: r => /(?:no|MongoDB\s+Query|MQL|not\s+(?:directly|natively))/i.test(r),
    desc: 'SQL vs NoSQL',
  },
  // 59 – REST API
  {
    q: 'What is a REST API? List the main HTTP methods used.',
    followUp: 'What is the difference between PUT and PATCH?',
    validate: r => /GET|POST|PUT|DELETE|REST/i.test(r),
    validateFU: r => /PUT.*full|PATCH.*partial|PUT.*replac|PATCH.*updat/i.test(r),
    desc: 'REST API basics',
  },
  // 60 – REST vs GraphQL
  {
    q: 'What is the difference between REST and GraphQL?',
    followUp: 'What is over-fetching and how does GraphQL solve it?',
    validate: r => /(?:multiple.*endpoint|single\s+endpoint|over.?fetch|under.?fetch)/i.test(r),
    validateFU: r => /over.?fetch.*(?:exact|specific|client)|unnecessary\s+data/i.test(r),
    desc: 'REST vs GraphQL',
  },
  // 61 – SSR vs CSR
  {
    q: 'What is the difference between SSR and CSR?',
    followUp: 'Why is SSR better for SEO?',
    validate: r => /Server.*(?:Side|Render)|Client.*(?:Side|Render)|SSR|CSR/i.test(r),
    validateFU: r => /(?:HTML|pre.?render|crawl|bot|search\s+engine)/i.test(r),
    desc: 'SSR vs CSR',
  },
  // 62 – Next.js
  {
    q: 'What is Next.js? What features does it provide?',
    followUp: 'What is the difference between SSR and SSG in Next.js?',
    validate: r => /React\s+framework|SSR|SSG|Vercel|file.?based\s+rout/i.test(r),
    validateFU: r => /SSG.*build\s+time|SSR.*(?:server|request\s+time)/i.test(r),
    desc: 'Next.js overview',
  },
  // 63 – Database migrations
  {
    q: 'What are database migrations and why are they important?',
    followUp: 'Name two tools used for database migrations in Node.js.',
    validate: r => /version.*(?:control|schema)|schema.*(?:change|sync)|rollback/i.test(r),
    validateFU: r => /Prisma|Sequelize|Knex|Flyway/i.test(r),
    desc: 'Database migrations',
  },
  // 64 – JWT
  {
    q: 'What is a JWT (JSON Web Token)? How is it structured?',
    followUp: 'Where should JWTs be stored on the client side?',
    validate: r => /header.*payload.*signature|token|JSON\s+Web\s+Token/i.test(r),
    validateFU: r => /(?:httpOnly|cookie|localStorage|secure)/i.test(r),
    desc: 'JWT authentication',
  },
  // 65 – CORS
  {
    q: 'What is CORS? Why does it exist?',
    followUp: 'How do you enable CORS in an Express.js server?',
    validate: r => /Cross.*Origin|security|browser.*block|domain/i.test(r),
    validateFU: r => /cors\(\)|app\.use\(cors|Access.Control/i.test(r),
    desc: 'CORS explained',
  },
  // 66 – CRUD
  {
    q: 'What does CRUD stand for? Map each to an HTTP method.',
    followUp: 'What SQL statements correspond to each CRUD operation?',
    validate: r => /Create|Read|Update|Delete/i.test(r),
    validateFU: r => /INSERT|SELECT|UPDATE|DELETE/i.test(r),
    desc: 'CRUD operations',
  },
  // 67 – React vs Vue
  {
    q: 'Compare React and Vue.js. What are the main differences?',
    followUp: 'What is JSX and why does React use it?',
    validate: r => /React.*Vue|Vue.*React|one.?way.*two.?way|JSX.*HTML/i.test(r),
    validateFU: r => /JSX.*(?:JavaScript|HTML|syntax|template)/i.test(r),
    desc: 'React vs Vue',
  },
  // 68 – SPA vs MPA
  {
    q: 'What is the difference between a SPA and an MPA?',
    followUp: 'Why is SEO harder for SPAs?',
    validate: r => /Single.*Page|Multi.*Page|SPA|MPA|reload/i.test(r),
    validateFU: r => /(?:empty\s+HTML|JavaScript|crawl|initial|no\s+content)/i.test(r),
    desc: 'SPA vs MPA',
  },
  // 69 – Virtual DOM
  {
    q: 'What is the virtual DOM? How does it work in React?',
    followUp: 'Does Vue.js also use a virtual DOM?',
    validate: r => /(?:virtual.*DOM|diff|reconcil|lightweight.*copy)/i.test(r),
    validateFU: r => /(?:Vue.*(?:also|yes|virtual)|yes)/i.test(r),
    desc: 'Virtual DOM',
  },
  // 70 – Node.js role
  {
    q: 'What is Node.js? What is its role in the MERN stack?',
    followUp: 'What is the Node.js event loop?',
    validate: r => /(?:JavaScript\s+runtime|V8|server.*side|server.*JavaScript)/i.test(r),
    validateFU: r => /(?:event\s+loop|non.?blocking|async|single.?thread)/i.test(r),
    desc: 'Node.js overview',
  },
  // 71 – MVC pattern
  {
    q: 'What is the MVC pattern? Explain each component.',
    followUp: 'How does MVC apply to an Express.js application?',
    validate: r => /Model|View|Controller/i.test(r),
    validateFU: r => /(?:route|controller|template|view|model)/i.test(r),
    desc: 'MVC pattern',
  },
  // 72 – JSON
  {
    q: 'What is JSON? What data types does it support?',
    followUp: 'What is the difference between JSON and a JavaScript object?',
    validate: r => /JavaScript\s+Object\s+Notation|string|number|boolean|array|object|null/i.test(r),
    validateFU: r => /(?:quoted|double.*quote|string\s+key|parse|stringify)/i.test(r),
    desc: 'JSON format',
  },
  // 73 – Props and State
  {
    q: 'What is the difference between props and state in React?',
    followUp: 'What happens when state is updated in a React component?',
    validate: r => /props.*parent|state.*internal|immutable|mutable/i.test(r),
    validateFU: r => /(?:re.?render|update|virtual\s+DOM)/i.test(r),
    desc: 'Props vs State',
  },
  // 74 – npm vs yarn vs pnpm
  {
    q: 'Compare npm vs yarn vs pnpm. What are the key differences?',
    followUp: 'Why is pnpm considered the most disk-efficient?',
    validate: r => /npm|yarn|pnpm/i.test(r),
    validateFU: r => /(?:content.?address|symlink|hard\s+link|shared|disk)/i.test(r),
    desc: 'npm vs yarn vs pnpm',
  },
  // 75 – Environment variables
  {
    q: 'What are environment variables in web development? Why are they important?',
    followUp: 'Should you ever commit a .env file to git?',
    validate: r => /(?:config|secret|API\s+key|outside|\.env|process\.env)/i.test(r),
    validateFU: r => /(?:never|no|\.gitignore|\.env\.example)/i.test(r),
    desc: 'Environment variables',
  },
];

const mernMevnNorwegian = [
  // 76 – MEVN definition
  {
    q: 'Hva betyr MEVN stack? Forklar hver teknologi.',
    followUp: 'Hva er hovedfordelen med Vue.js sammenlignet med Angular?',
    validate: r => /MongoDB|Express|Vue|Node/i.test(r),
    validateFU: r => /(?:enklere|lettere|lærings?kurve|progressive|gentle)/i.test(r),
    desc: 'MEVN stack definisjon',
  },
  // 77 – MERN vs MEVN
  {
    q: 'Hva er forskjellen mellom MERN og MEVN stacks?',
    followUp: 'Hvilken stack har en enklere læringskurve – MERN eller MEVN?',
    validate: r => /React.*Vue|Vue.*React|MERN.*MEVN|frontend/i.test(r),
    validateFU: r => /MEVN|Vue|enklere|gentle/i.test(r),
    desc: 'MERN vs MEVN forskjell',
  },
  // 78 – React vs Vue (Norwegian)
  {
    q: 'Sammenlign React og Vue.js – hva er de viktigste forskjellene?',
    followUp: 'Hva betyr "enveis databinding" vs "toveis databinding"?',
    validate: r => /React|Vue|JSX|template|databinding|data\s+binding/i.test(r),
    validateFU: r => /enveis|toveis|one.?way|two.?way|v-model/i.test(r),
    desc: 'React vs Vue norsk',
  },
  // 79 – Vue.js composition API
  {
    q: 'Hva er Vue.js? Forklar hvordan det brukes i MEVN-stacken.',
    followUp: 'Hva er forskjellen mellom Vue Options API og Composition API?',
    validate: r => /Vue|frontend|progressive|component/i.test(r),
    validateFU: r => /(?:Composition|Options|setup|ref|reactive)/i.test(r),
    desc: 'Vue.js i MEVN',
  },
  // 80 – State management (NO)
  {
    q: 'Sammenlign Redux (React) og Pinia (Vue) for state management.',
    followUp: 'Hvorfor erstattet Pinia Vuex som standard state management i Vue?',
    validate: r => /Redux|Pinia|Vuex|state|tilstand/i.test(r),
    validateFU: r => /(?:enklere|TypeScript|boilerplate|simpler)/i.test(r),
    desc: 'Redux vs Pinia',
  },
  // 81 – Virtual DOM (NO)
  {
    q: 'Hva er virtual DOM? Bruker både React og Vue det?',
    followUp: 'Finnes det frontend-rammeverk som IKKE bruker virtual DOM?',
    validate: r => /(?:virtual\s+DOM|virtuell|lett.*kopi|diff|reconcil)/i.test(r),
    validateFU: r => /Svelte/i.test(r),
    desc: 'Virtual DOM norsk',
  },
  // 82 – Component lifecycle (NO)
  {
    q: 'Forklar komponent-livssyklusen i React og Vue.',
    followUp: 'Hva er "onMounted" i Vue 3?',
    validate: r => /(?:mount|update|unmount|useEffect|lifecycle|livssyklus)/i.test(r),
    validateFU: r => /(?:onMounted|after.*(?:mount|DOM)|callback|etter\s+(?:mount|DOM))/i.test(r),
    desc: 'Livssyklus norsk',
  },
  // 83 – Routing (NO)
  {
    q: 'Sammenlign React Router og Vue Router.',
    followUp: 'Hva er navigasjonsvakter (navigation guards) i Vue Router?',
    validate: r => /React\s+Router|Vue\s+Router|rut/i.test(r),
    validateFU: r => /(?:beforeEach|guard|vakt|navigasjon)/i.test(r),
    desc: 'React Router vs Vue Router',
  },
  // 84 – TypeScript (NO)
  {
    q: 'Hvordan er TypeScript-støtten i React vs Vue 3?',
    followUp: 'Hva er fordelen med TypeScript i et MEVN-prosjekt?',
    validate: r => /TypeScript|TSX|\.tsx|type|script\s+setup\s+lang/i.test(r),
    validateFU: r => /(?:type.?safe|feil|bug|compile|sikkerhet)/i.test(r),
    desc: 'TypeScript i stacks',
  },
  // 85 – Vite (NO)
  {
    q: 'Hva er Vite? Hvorfor er det blitt populært i moderne webutvikling?',
    followUp: 'Hvordan fungerer Vites Hot Module Replacement?',
    validate: r => /(?:build\s+tool|dev\s+server|ES\s+module|fast|rask)/i.test(r),
    validateFU: r => /(?:HMR|Hot\s+Module|endring|oppdater)/i.test(r),
    desc: 'Vite norsk',
  },
  // 86 – SSR (NO)
  {
    q: 'Hva er forskjellen mellom SSR og CSR i webutvikling?',
    followUp: 'Hva brukes for SSR med Vue – og hva med React?',
    validate: r => /(?:Server.*Side|Client.*Side|SSR|CSR|server.*rend|klient.*rend)/i.test(r),
    validateFU: r => /Nuxt|Next/i.test(r),
    desc: 'SSR vs CSR norsk',
  },
  // 87 – Node.js (NO)
  {
    q: 'Hva er rollen til Node.js i en MERN eller MEVN stack?',
    followUp: 'Hva betyr "non-blocking I/O" i Node.js?',
    validate: r => /(?:runtime|server|JavaScript|V8|kjøretid)/i.test(r),
    validateFU: r => /(?:non.?blocking|asynkron|async|vent\w*|blokk\w*)/i.test(r),
    desc: 'Node.js norsk',
  },
  // 88 – Express middleware (NO)
  {
    q: 'Hva er mellomvare (middleware) i Express.js? Gi eksempler.',
    followUp: 'Hva gjør express.json()-mellomvaren?',
    validate: r => /(?:mellomvare|middleware|req.*res|request.*response|funksjon)/i.test(r),
    validateFU: r => /(?:JSON|body|parse|kropp|data)/i.test(r),
    desc: 'Express middleware norsk',
  },
  // 89 – MongoDB collections (NO)
  {
    q: 'Hva er forskjellen mellom en MongoDB-collection og en SQL-tabell?',
    followUp: 'Må alle dokumenter i en MongoDB-collection ha samme struktur?',
    validate: r => /(?:collection|dokument|tabell|table|document|schema)/i.test(r),
    validateFU: r => /(?:nei|no|fleksib|flexible|ulik|different|schema.?less)/i.test(r),
    desc: 'MongoDB collections norsk',
  },
  // 90 – CRUD (NO)
  {
    q: 'Hva betyr CRUD? Forklar med eksempler i en REST API.',
    followUp: 'Hvilke HTTP-metoder tilsvarer CRUD-operasjonene?',
    validate: r => /Create|Read|Update|Delete/i.test(r),
    validateFU: r => /GET|POST|PUT|DELETE/i.test(r),
    desc: 'CRUD norsk',
  },
  // 91 – API endpoints (NO)
  {
    q: 'Hva er et API-endepunkt? Gi eksempler.',
    followUp: 'Hva er forskjellen mellom /api/users og /api/users/:id?',
    validate: r => /(?:endpoint|endepunkt|URL|rute|route)/i.test(r),
    validateFU: r => /(?:alle|all|spesifikk|specific|en\s+bruker|one\s+user|:id)/i.test(r),
    desc: 'API endepunkter norsk',
  },
  // 92 – Frontend vs Backend (NO)
  {
    q: 'Hva er forskjellen mellom frontend og backend i webutvikling?',
    followUp: 'Kan JavaScript brukes på både frontend og backend?',
    validate: r => /(?:frontend|backend|front.?end|back.?end|klient|server|browser|nettleser)/i.test(r),
    validateFU: r => /(?:ja|yes|Node|begge|both)/i.test(r),
    desc: 'Frontend vs Backend norsk',
  },
  // 93 – JSON (NO)
  {
    q: 'Hva er JSON? Hvorfor er det viktig i webutvikling?',
    followUp: 'Hva er forskjellen mellom JSON og XML?',
    validate: r => /(?:JavaScript\s+Object\s+Notation|data.*format|nøkkel|key.*value|lett)/i.test(r),
    validateFU: r => /(?:XML|tag|enklere|ligh|lett)/i.test(r),
    desc: 'JSON norsk',
  },
  // 94 – npm vs pnpm (NO)
  {
    q: 'Sammenlign npm, yarn og pnpm. Hvilket er raskest?',
    followUp: 'Hva er en "phantom dependency" som pnpm unngår?',
    validate: r => /npm|yarn|pnpm/i.test(r),
    validateFU: r => /(?:phantom|node_modules|flat|hoist|tilgang)/i.test(r),
    desc: 'npm vs yarn vs pnpm norsk',
  },
  // 95 – Component (NO)
  {
    q: 'Hva er en komponent i frontend-utvikling? Gi eksempler.',
    followUp: 'Hva er forskjellen mellom en komponent i React og i Vue?',
    validate: r => /(?:gjenbrukbar|reusable|UI|brukergrensesnitt|component|komponent)/i.test(r),
    validateFU: r => /(?:JSX|template|SFC|\.vue|funksjon)/i.test(r),
    desc: 'Komponent norsk',
  },
  // 96 – Props and State (NO)
  {
    q: 'Hva er forskjellen mellom props og state i React/Vue?',
    followUp: 'Hva skjer når state oppdateres i en React-komponent?',
    validate: r => /props.*(?:parent|forelder)|state.*(?:intern|internal)|read.?only|immutable|mutable/i.test(r),
    validateFU: r => /(?:re.?render|oppdater|virtual\s+DOM)/i.test(r),
    desc: 'Props vs State norsk',
  },
  // 97 – Event handling (NO)
  {
    q: 'Forklar event handling i React og Vue.',
    followUp: 'Hva betyr @click.prevent i Vue?',
    validate: r => /(?:onClick|@click|v-on|event|hendelse|kamelCase|camelCase)/i.test(r),
    validateFU: r => /(?:prevent.*Default|preventDefault|forhindre|stoppe)/i.test(r),
    desc: 'Event handling norsk',
  },
  // 98 – Two-way binding (NO)
  {
    q: 'Hva er toveis databinding (two-way data binding)? Gi eksempel fra Vue.',
    followUp: 'Har React innebygd toveis binding?',
    validate: r => /(?:v-model|toveis|two.?way|UI.*data|data.*UI)/i.test(r),
    validateFU: r => /(?:nei|no|one.?way|enveis|kontrollert|controlled|onChange|manuell)/i.test(r),
    desc: 'Two-way binding norsk',
  },
  // 99 – Testing (NO)
  {
    q: 'Hvilke testing-rammeverk brukes ofte for React og Vue?',
    followUp: 'Hva er forskjellen mellom unit testing og end-to-end testing?',
    validate: r => /(?:Vitest|Jest|Playwright|Cypress|Testing\s+Library)/i.test(r),
    validateFU: r => /(?:enhet|unit|end.?to.?end|E2E|isolert|hel\w*\s*app|hele)/i.test(r),
    desc: 'Testing norsk',
  },
  // 100 – Connection pooling & deployment
  {
    q: 'Hva er connection pooling i en database? Hvorfor er det viktig?',
    followUp: 'Hvilke Node.js-verktøy støtter innebygd connection pooling?',
    validate: r => /(?:pool|gjenbruk|reuse|connection|tilkoblinger|ytelse|performance)/i.test(r),
    validateFU: r => /(?:Prisma|Mongoose|pg.?pool|innebygd|built.?in)/i.test(r),
    desc: 'Connection pooling norsk',
  },
];

const ALL_QUESTIONS = [
  ...norwegianQuestions,
  ...englishQuestions,
  ...mernPernQuestions,
  ...mernMevnNorwegian,
];

/* ═══════════════ Helpers ═══════════════ */

async function createConversation(title) {
  const res = await fetch(`${API}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title }),
  });
  const data = await res.json();
  return data.id;
}

function askWS(conversationId, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    let answer = '';
    const timer = setTimeout(() => { ws.close(); resolve(answer || '(timeout)'); }, TIMEOUT);
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content })));
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'text_delta') answer += msg.textDelta;
      if (msg.type === 'done') { clearTimeout(timer); ws.close(); resolve(answer); }
      if (msg.type === 'error') { clearTimeout(timer); ws.close(); resolve('(error)'); }
    });
    ws.on('error', () => { clearTimeout(timer); resolve('(ws-error)'); });
  });
}

function clr(ok) { return ok ? '\x1b[32m' : '\x1b[31m'; }
const RST = '\x1b[0m';

/* ═══════════════ Runner ═══════════════ */

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Language & Web-Stack Benchmark — 100 + 100 FU     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Health check
  try {
    const hc = await fetch(`${API}/health`);
    const hj = await hc.json();
    console.log(`Engine: ${hj.engine} │ vocab=${hj.stats.vocabSize} knowledge=${hj.stats.knowledgeEntries}\n`);
  } catch { console.log('⚠  Could not reach server – is it running?\n'); }

  const categories = [
    { name: 'Norwegian Grammar', start: 0, count: 25 },
    { name: 'English Grammar', start: 25, count: 25 },
    { name: 'MERN vs PERN (EN)', start: 50, count: 25 },
    { name: 'MERN vs MEVN (NO)', start: 75, count: 25 },
  ];

  let totalPass = 0, totalFail = 0;
  let fuPass = 0, fuFail = 0;
  const failures = [];

  for (const cat of categories) {
    console.log(`\n══ ${cat.name} (${cat.count} questions + ${cat.count} follow-ups) ══\n`);
    let catPass = 0, catFUPass = 0;

    for (let i = 0; i < cat.count; i++) {
      const idx = cat.start + i;
      const t = ALL_QUESTIONS[idx];
      const qNum = idx + 1;

      // Create conversation
      const convId = await createConversation(`Bench Q${qNum}`);

      // Main question
      const answer = await askWS(convId, t.q);
      const ok = t.validate(answer);

      // Follow-up
      const fuAnswer = await askWS(convId, t.followUp);
      const fuOk = t.validateFU(fuAnswer);

      const tag = ok ? 'PASS' : 'FAIL';
      const fuTag = fuOk ? 'PASS' : 'FAIL';

      console.log(`  Q${String(qNum).padStart(3)}: ${clr(ok)}${tag}${RST} │ FU: ${clr(fuOk)}${fuTag}${RST}  ${t.desc}`);

      if (ok) { totalPass++; catPass++; } else {
        totalFail++;
        failures.push({ qNum, desc: t.desc, type: 'main', snippet: answer.slice(0, 120) });
      }
      if (fuOk) { fuPass++; catFUPass++; } else {
        fuFail++;
        failures.push({ qNum, desc: t.desc, type: 'followUp', snippet: fuAnswer.slice(0, 120) });
      }
    }

    console.log(`  ── ${cat.name}: ${catPass}/${cat.count} main, ${catFUPass}/${cat.count} follow-ups`);
  }

  console.log('\n' + '═'.repeat(56));
  console.log(`  Main questions : ${totalPass}/100 (${totalFail} failures)`);
  console.log(`  Follow-ups     : ${fuPass}/100 (${fuFail} failures)`);
  console.log(`  TOTAL          : ${totalPass + fuPass}/200`);
  console.log('═'.repeat(56));

  if (failures.length) {
    console.log('\n── Failures ──');
    for (const f of failures) {
      console.log(`  Q${f.qNum} [${f.type}] ${f.desc}`);
      console.log(`    → ${f.snippet.replace(/\n/g, ' ')}`);
    }
  }

  const perfect = totalPass + fuPass === 200;
  console.log(perfect ? '\n✅  PERFECT SCORE  200/200' : '\n❌  Not perfect yet.');
  process.exit(perfect ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
