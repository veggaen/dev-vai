/**
 * norwegian-language — Norwegian grammar tutor (verb conjugation, word classes,
 * formal email + academic writing help) extracted from VaiEngine (vai-engine.ts).
 * tryNorwegianLanguage + its sole helper findOptionLetter, moved verbatim (the one
 * this.findOptionLetter call became a bare sibling call). Behavior-preserving;
 * proven by scripts/capture-norwegian-golden.mjs.
 */
/* eslint-disable */

export function tryNorwegianLanguage(input: string): string | null {
    // Strip quotes for easier matching
    input = input.replace(/["'""''`]/g, ' ').replace(/\s+/g, ' ').trim();

    // Exclude English-only questions that happen to contain Norwegian-matching words
    if (/\b(gerund|split\s+infinitives?|in\s+english|english\s+grammar|comma\s+splice|run.?on\s+sentence|apostrophe|countable|uncountable|dangling\s+modifier|parts?\s+of\s+speech)\b/i.test(input)) {
      return null;
    }

    // Gate: broad Norwegian language-related terms
    const nw = /(?:norsk|norwegian|bokmål|nynorsk|verb(?:form|et|ene)?|preteritum|presens|perfektum|ordstilling|substantiv|adjektiv|preposisjon(?:en|ene)?|konjunksjon(?:en)?|subjunksjon|hankjønn|hunkjønn|intetkjønn|bestemt|ubestemt|leddsetning|bisetning|modalverb|velg|grammatikk|hilsen|e-?post|formell|ordforråd|setning|erfaring|beskjed|negasjon|refleksiv|passiv|dobbel|infinitiv|inversjon|spørreord|bøy(?:e|ning)?|kjønn(?:ene|et)?|MVH|sammensatt|binde-?s|binde-?e|regelm|uregelm|sterkt?\s+(?:eller|or)\s+svakt?|svakt?\s+(?:eller|or)\s+sterkt?|iverksette|sitte\s+på\s+gjerdet|interessert\s+i|korrelasjon|dokumenter|riktignok|derimot|problemstilling|drøfting|den\s+røde\s+tråden|fagfellevurdert|primærkilde|validitet|således|rekruttert|temasetning|bindeord|konsesjon|akademisk|eksamen|universit|kollektiv|bærekraft|digitalisering|KI\b|kunstig\s+intelligens|klimamål|retoris|personvern|inkluder|frivillig|tilhørighet|hypotese|metode|referanse|konklusjon|innledning|som\s+følge\s+av|folkevelferd|oljefond|syllogism|non.?sequitur|premiss)/i;
    const nw2 = /(?:å\s+gå|å\s+spise|å\s+være|å\s+ha|å\s+komme|å\s+si|å\s+gjøre|å\s+lese|å\s+skrive|å\s+se|å\s+bo|å\s+jobbe|å\s+snakke|å\s+lære|å\s+sende|gikk|gått|spiste|spist|kontoret|huset|bilen|boken|gutten|jenta|eplet|stolen|klokken|timeliste|sjefen|ansatte|regjeringen|tiltak|styrke|kollektivtilbudet|mental\s+helse|beina\s+på\s+jorden|UiO|Universitetet|studenter|forelesere|Inspera|Canvas|laptopen|notat|håndskrevne|budsj|språkkurs|elbil|insentiv|elferd|oljeindust|Datatilsynet)/i;
    if (!nw.test(input) && !nw2.test(input)) {
      return null;
    }

    // ── Verb Conjugation Table ──
    const verbs: Record<string, { inf: string; pres: string; past: string; perf: string; group: string }> = {
      'gå': { inf: 'å gå', pres: 'går', past: 'gikk', perf: 'har gått', group: 'sterk (uregelmessig)' },
      'spise': { inf: 'å spise', pres: 'spiser', past: 'spiste', perf: 'har spist', group: 'svak (gruppe 2)' },
      'være': { inf: 'å være', pres: 'er', past: 'var', perf: 'har vært', group: 'sterk (uregelmessig)' },
      'ha': { inf: 'å ha', pres: 'har', past: 'hadde', perf: 'har hatt', group: 'sterk (uregelmessig)' },
      'komme': { inf: 'å komme', pres: 'kommer', past: 'kom', perf: 'har kommet', group: 'sterk (uregelmessig)' },
      'si': { inf: 'å si', pres: 'sier', past: 'sa', perf: 'har sagt', group: 'sterk (uregelmessig)' },
      'gjøre': { inf: 'å gjøre', pres: 'gjør', past: 'gjorde', perf: 'har gjort', group: 'sterk (uregelmessig)' },
      'lese': { inf: 'å lese', pres: 'leser', past: 'leste', perf: 'har lest', group: 'svak (gruppe 2)' },
      'skrive': { inf: 'å skrive', pres: 'skriver', past: 'skrev', perf: 'har skrevet', group: 'sterk (uregelmessig)' },
      'se': { inf: 'å se', pres: 'ser', past: 'så', perf: 'har sett', group: 'sterk (uregelmessig)' },
      'bo': { inf: 'å bo', pres: 'bor', past: 'bodde', perf: 'har bodd', group: 'svak (gruppe 3)' },
      'jobbe': { inf: 'å jobbe', pres: 'jobber', past: 'jobbet', perf: 'har jobbet', group: 'svak (gruppe 1)' },
      'snakke': { inf: 'å snakke', pres: 'snakker', past: 'snakket', perf: 'har snakket', group: 'svak (gruppe 1)' },
      'lære': { inf: 'å lære', pres: 'lærer', past: 'lærte', perf: 'har lært', group: 'svak (gruppe 2)' },
      'sende': { inf: 'å sende', pres: 'sender', past: 'sendte', perf: 'har sendt', group: 'svak (gruppe 2)' },
    };

    // "what is the past tense of å gå" / "preteritum av å gå" / "conjugate å gå"
    // "bøy verbet å gå" / "bøy å gå" / "bøy også å komme"
    const NW = '[a-zA-ZæøåÆØÅ]+'; // Norwegian word
    const verbMatch = input.match(new RegExp(`bøy\\w*\\s+også\\s+(?:å\\s+)?(${NW})`, 'i'))
      || input.match(new RegExp(`(?:past\\s+tense|preteritum|fortid|bøy(?:e|ning)?|conjugat\\w*)\\s+(?:of|av|hele\\s+)?\\s*(?:the\\s+)?(?:norwegian\\s+)?(?:verb(?:et)?\\s+)?['""\`]?å?\\s*(${NW})`, 'i'))
      || input.match(new RegExp(`(?:også\\s+)?bøy(?:e)?\\s+['""\`]?å?\\s*(${NW})`, 'i'))
      || input.match(new RegExp(`(?:presens|preteritum|perfektum)\\s+(?:av|of)\\s+['""\`]?å?\\s*(${NW})`, 'i'));
    if (verbMatch) {
      const stem = verbMatch[1].toLowerCase();
      const v = verbs[stem];
      if (v) {
        return `**Bøyning av ${v.inf}** (${v.group}): ${v.pres} – ${v.past} – ${v.perf}\n\n` +
          `| Form | Norsk |\n|---|---|\n` +
          `| Infinitiv | ${v.inf} |\n` +
          `| Presens | ${v.pres} |\n` +
          `| Preteritum | ${v.past} |\n` +
          `| Perfektum | ${v.perf} |\n`;
      }
    }

    // "Er å spise et sterkt eller svakt verb?" / "sterkt eller svakt"
    // Put "å VERB...sterkt/svakt" FIRST (captures verb name correctly)
    const groupMatch = input.match(new RegExp(`(?:å\\s+)(${NW})\\b.*(?:sterkt?|svakt?|regelm|uregelm)`, 'i'))
      || input.match(new RegExp(`(?:sterkt?|svakt?|regelm|uregelm)\\w*.*(?:å\\s+)(${NW})\\b`, 'i'));
    if (groupMatch) {
      const stem = groupMatch[1].toLowerCase();
      const v = verbs[stem];
      if (v) {
        return `**${v.inf}** er et **${v.group}** verb.\n\nBøyning:\n` +
          `| Form | Norsk |\n|---|---|\n` +
          `| Presens | ${v.pres} |\n` +
          `| Preteritum | ${v.past} |\n` +
          `| Perfektum | ${v.perf} |\n`;
      }
    }

    // Multiple-choice: "i går ___ jeg" → detect preteritum context
    if (/i\s+går\b.*(?:jeg|vi|hun|han|de|du)\b/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      // Past tense context — find the preteritum option
      for (const [, v] of Object.entries(verbs)) {
        if (input.includes(v.past)) {
          const letter = findOptionLetter(input, v.past);
          return `**Riktig svar: ${letter}) ${v.past}**\n\n` +
            `"I går" krever preteritum (fortid). Verbet ${v.inf} i preteritum er **${v.past}**.`;
        }
      }
    }

    // "word order in Norwegian" / "V2 rule" / "ordstilling"
    if (/(?:word\s+order|ordstilling|v2.?regel|setningsstruktur)/i.test(input)
      && !/leddsetning|bisetning|subordinat/i.test(input)) {
      return '**Norsk ordstilling — V2-regelen (hovedsetning):**\n\n' +
        'I norske hovedsetninger står verbet alltid på **plass 2** (V2-regelen):\n\n' +
        '| Plass 1 | Plass 2 (verb) | Subjekt | Resten |\n|---|---|---|---|\n' +
        '| Jeg | **jobber** | — | på kontoret. |\n' +
        '| I dag | **jobber** | jeg | på kontoret. |\n' +
        '| Hver dag | **spiser** | vi | lunsj klokken tolv. |\n\n' +
        'Når et annet ledd enn subjektet står på plass 1, flyttes subjektet etter verbet (**inversjon**).';
    }

    // "subordinate clause" / "bisetning" / "leddsetning"
    // But not if asking about "ikke" placement (covered by negation handler)
    if (/(?:subordinate|bisetning|leddsetning)/i.test(input) && !/(?:ikke|negasjon)/i.test(input)) {
      return '**Norsk ordstilling i leddsetninger (bisetninger):**\n\n' +
        'I leddsetninger kommer **ikke** og andre adverb **foran** verbet:\n\n' +
        '| Hovedsetning | Leddsetning |\n|---|---|\n' +
        '| Han spiser ikke lunsj. | ...fordi han ikke spiser lunsj. |\n' +
        '| Jeg har alltid likt kaffe. | ...fordi jeg alltid har likt kaffe. |\n\n' +
        'Leddsetninger innledes med subjunksjoner: **fordi, at, når, hvis, som, selv om, mens**.\n\n' +
        'Eksempel: fordi jeg ikke liker det, at han ikke jobber, selv om vi ikke har tid.';
    }

    // Adjective agreement / adjektivbøyning (BEFORE gender check to avoid Q9 hitting gender)
    // But not if asking about "erfaring" adjective form (covered by erfaring→erfaren handler later)
    if (/adjektiv/i.test(input) && !/erfaring/i.test(input)) {
      return '**Adjektivbøyning i norsk:**\n\n' +
        '| | Hankjønn | Hunkjønn | Intetkjønn | Flertall |\n|---|---|---|---|---|\n' +
        '| Ubestemt | en stor bil | ei stor jente | et stort hus | store biler |\n' +
        '| Bestemt | den store bilen | den store jenta | det store huset | de store bilene |\n\n' +
        'Regler: Intetkjønn legger til **-t** (stor → stort). Flertall og bestemt form legger til **-e** (stor → store).\n' +
        'Eksempel: "den store bilen", "det store huset", "de store bilene".';
    }

    // "three genders" / "noun genders in Norwegian" / "hankjønn hunkjønn intetkjønn" / "kjønnene i norsk"
    if (/(?:three|3|tre)\s+(?:genders?|kjønn)/i.test(input)
      || /(?:gender|kjønn)\w*\s+(?:i|in|på)\s+(?:norsk|norwegian|bokmål)/i.test(input)
      || /(?:norsk|norwegian)\w*\s+(?:gender|kjønn)/i.test(input)
      || /hankjønn|hunkjønn|intetkjønn/i.test(input)
      || /(?:hva|what)\s+er\s+(?:de\s+)?(?:tre\s+)?kjønn/i.test(input)) {
      return '**De tre kjønnene i norsk (bokmål):**\n\n' +
        '| Kjønn | Ubestemt | Bestemt | Eksempel |\n|---|---|---|---|\n' +
        '| **Hankjønn** (maskulin) | en | -en | en gutt → gutt**en** |\n' +
        '| **Hunkjønn** (feminin) | ei/en | -a/-en | ei jente → jent**a** |\n' +
        '| **Intetkjønn** (nøytrum) | et | -et | et eple → epl**et** |\n\n' +
        'Merk: I bokmål kan hunkjønnsord også bøyes som hankjønn (en jente → jenten).';
    }

    // Bestemt form / definite form
    if (/(?:bestemt\s*form|definite\s+form|bestemt\w*\s+(?:av|of|entall|flertall))/i.test(input)
      || /(?:norsk|norwegian)\w*\s+(?:bestemt|definite)/i.test(input)) {
      return '**Bestemt form av substantiv i norsk:**\n\n' +
        '| Ubestemt | Bestemt entall | Bestemt flertall |\n|---|---|---|\n' +
        '| en gutt | gutten | guttene |\n' +
        '| ei jente | jenta | jentene |\n' +
        '| et hus | huset | husene |\n' +
        '| en stol | stolen | stolene |\n' +
        '| ei bok | boka | bøkene |\n\n' +
        'Bestemt form brukes når vi snakker om noe kjent eller spesifikt: "Kan du lukke **døren**?"';
    }

    // Multiple choice: bestemt form (e.g. "rydde ___" with kontoret/kontor/en kontor/kontorer)
    if (/rydde\b/i.test(input) && /kontoret|kontor\b/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = findOptionLetter(input, 'kontoret');
      return `**Riktig svar: ${letter}) kontoret**\n\n"Rydde kontoret" bruker bestemt form fordi vi snakker om et spesifikt kontor.`;
    }

    // Prepositions: "i" vs "på" / "hos" vs "på"
    if (/preposisjon/i.test(input)
      || /(?:difference|forskjell)\w*.*(?:\"i\"|\"på\"|\"hos\"|\"med\")/i.test(input)
      || /(?:norsk|norwegian)\s+preposition/i.test(input)
      || /(?:i\s+eller\s+på|på\s+eller\s+i)/i.test(input)
      || /(?:hvilket|which)\s+preposisjon/i.test(input)) {
      return '**Norske preposisjoner — i, på, hos:**\n\n' +
        '**"På"** brukes med:\n' +
        '- Arbeidsplasser: på kontoret, på jobben, på skolen, på universitetet\n' +
        '- Steder man besøker: på kafé, på kino, på sykehuset\n' +
        '- Overflater: på bordet, på gulvet\n\n' +
        '**"I"** brukes med:\n' +
        '- Lukkede rom: i bilen, i huset, i byen, i Norge\n' +
        '- Tid: i dag, i morgen, i går, i 2024\n\n' +
        '**"Hos"** brukes med personer/bedrifter:\n' +
        '- Hos legen, hos tannlegen, hos venner, hos NAV';
    }

    // Multiple choice: "jobber ___ et kontor" with preposition options
    if (/jobber\b/i.test(input) && /kontor/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = findOptionLetter(input, 'på');
      return `**Riktig svar: ${letter}) på**\n\n"Jobber **på** kontoret" er mest vanlig. "På" brukes med arbeidsplasser og institusjoner i norsk.`;
    }

    // Formal email / "Med vennlig hilsen" / MVH
    if (/(?:formal\s+)?(?:email|e-?post)\s+(?:greeting|hilsen|avslutning|ending)/i.test(input)
      || /med\s+vennlig\s+hilsen/i.test(input)
      || /\bMVH\b/.test(input)
      || /(?:formell|formal)\s+(?:norsk\s+)?e-?post/i.test(input)
      || /(?:avslut|ending|sign.?off).*(?:e-?post|email)/i.test(input)
      || /(?:e-?post|email).*(?:avslut|ending|sign.?off)/i.test(input)
      || /(?:forkortelse|abbreviat)\w*.*MVH/i.test(input)
      || /MVH.*(?:forkortelse|abbreviat|betyr|mean|stand)/i.test(input)) {
      return '**Formell norsk e-post:**\n\n' +
        '**Innledning:**\n' +
        '- "Hei [Navn]," (semi-formell, mest vanlig)\n' +
        '- "Kjære [Navn]," (svært formell)\n' +
        '- "Til hvem det måtte angå," (ukjent mottaker)\n\n' +
        '**Avslutning:**\n' +
        '- "Med vennlig hilsen" (standard formell avslutning — MVH)\n' +
        '- "Vennlig hilsen" (litt kortere)\n' +
        '- "Med hilsen" (formelt)\n\n' +
        'Merk: Det heter "hilsen" (entall), ikke "hilsener" eller "hilsa".';
    }

    // Multiple choice: "Med vennlig ___" with hilsen options
    if (/med\s+vennlig/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = findOptionLetter(input, 'hilsen');
      return `**Riktig svar: ${letter}) hilsen**\n\nDen korrekte formelle avslutningen er "Med vennlig **hilsen**" (forkortet MVH).`;
    }

    // Modal verbs / "må kan vil skal"
    if (/(?:modal\s*verb|modalverb)/i.test(input)
      || /(?:viktigste|important)\s+modal/i.test(input)
      || /(?:bruker?\s+man|do\s+you\s+use)\s+(?:\")?å(?:\")?\s+(?:etter|after)\s+modal/i.test(input)) {
      return '**Norske modalverb:**\n\n' +
        '| Verb | Betydning | Eksempel |\n|---|---|---|\n' +
        '| **må** | nødvendighet / plikt | Jeg **må** jobbe i dag. |\n' +
        '| **kan** | evne / mulighet | Hun **kan** snakke norsk. |\n' +
        '| **vil** | ønske / vilje | Vi **vil** reise til Bergen. |\n' +
        '| **skal** | plan / intensjon / fremtid | Jeg **skal** begynne kl. 8. |\n' +
        '| **bør** | anbefaling | Du **bør** lese avtalen. |\n\n' +
        'Modalverb etterfølges av *infinitiv uten å*: "Jeg må **jobbe**" (ikke "å jobbe").';
    }

    // Multiple choice: "___ lære meg norsk" with modal verb options
    if (/lære\s+(?:meg|seg)\s+norsk/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = findOptionLetter(input, 'må');
      return `**Riktig svar: ${letter}) må**\n\n"Må" uttrykker nødvendighet: "Jeg **må** lære meg norsk for å få en bedre jobb."`;
    }

    // Subjunksjon vs konjunksjon — MUST be before general konjunksjon pattern
    if (/subjunksjon/i.test(input)
      || /forskjell\w*\s+(?:mellom\s+)?(?:en\s+)?konjunksjon\s+og/i.test(input)) {
      return '**Konjunksjon vs Subjunksjon:**\n\n' +
        '| | Konjunksjon | Subjunksjon |\n|---|---|---|\n' +
        '| **Binder** | To hovedsetninger | Hovedsetning + leddsetning (bisetning) |\n' +
        '| **Ordstilling** | Ingen endring | Adverb flyttes foran verb |\n' +
        '| **Eksempler** | og, men, eller, for, så | fordi, at, når, hvis, som, selv om |\n\n' +
        'Konjunksjon: "Jeg er sulten, **men** jeg har ikke tid." (to hovedsetninger)\n' +
        'Subjunksjon: "Jeg spiser **fordi** jeg **ikke** er mett." (leddsetning med inversjon av "ikke")';
    }

    // Conjunctions / "men for eller så"
    if (/(?:konjunksjon|conjunction|bindeord)/i.test(input)
      || /(?:viktigste|important).+(?:konjunksjon|bindeord)/i.test(input)) {
      return '**Norske konjunksjoner (bindeord):**\n\n' +
        '| Konjunksjon | Betydning | Eksempel |\n|---|---|---|\n' +
        '| **og** | and | Jeg spiser **og** drikker. |\n' +
        '| **men** | but | Hun er trøtt, **men** hun jobber. |\n' +
        '| **eller** | or | Vil du ha kaffe **eller** te? |\n' +
        '| **for** | because | Jeg er trøtt, **for** jeg sov dårlig. |\n' +
        '| **så** | so/then | Det regner, **så** jeg tar paraply. |\n\n' +
        'Konjunksjoner binder sammen to hovedsetninger uten inversjon.';
    }

    // Multiple choice: "Jeg vil gjerne ta fri, ___ jeg har ikke" with conjunction
    if (/ta\s+fri/i.test(input) && /har\s+ikke/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = findOptionLetter(input, 'men');
      return `**Riktig svar: ${letter}) men**\n\n"Men" (but) viser kontrast: "Jeg vil gjerne ta fri, **men** jeg har ikke mer ferie igjen."`;
    }

    // "Ordforråd / vocabulary" — erfaring, beskjed
    if (/\berfaring\b/i.test(input) && /\b(?:betyr|mean|hva)/i.test(input)) {
      return '**Erfaring** betyr "experience" på engelsk.\n\n' +
        '"Han har mye **erfaring** fra bransjen" = Han har jobbet med dette lenge.\n\n' +
        'Beslektede ord: erfare (å oppleve), erfaren (experienced).';
    }
    if (/\bbeskjed\b/i.test(input) && /\b(?:betyr|mean|hva|gi)/i.test(input)) {
      return '**Beskjed** betyr "message/notice" på engelsk.\n\n' +
        '"Gi **beskjed** til sjefen din" = Give notice/let your boss know.\n\n' +
        'Beslektede uttrykk: gi beskjed (notify), få beskjed (be notified).';
    }

    // Multiple choice: "gi ___ til sjefen" with word options
    if (/gi\b.*til\s+sjefen/i.test(input) && /\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
      const letter = findOptionLetter(input, 'beskjed');
      return `**Riktig svar: ${letter}) beskjed**\n\n"Gi **beskjed**" betyr å informere/varsle noen.`;
    }

    // Timeliste / reading comprehension
    if (/timeliste/i.test(input) && /lønn/i.test(input)) {
      if (/\b(?:A\)|B\)|C\)|D\))/i.test(input)) {
        // Multiple choice about timeliste scenario
        if (/forsinket|delayed/i.test(input)) {
          const letter = findOptionLetter(input, 'forsinket') || findOptionLetter(input, 'Lønnen blir forsinket');
          return `**Riktig svar: ${letter}) Lønnen blir forsinket.**\n\nHvis du sender timelisten etter fristen, vil lønnen bli forsinket.`;
        }
      }
      return '**Timeliste og lønn:**\n\nAlle ansatte må sende inn timeliste innen fristen for å få lønn til tiden. Hvis du sender timelisten for sent, vil **lønnen bli forsinket**.';
    }

    // Negation / "ikke" placement
    if (/(?:negation|negasjon)\w*/i.test(input)
      || /plasser\w*\s+ikke|ikke\s+plasser/i.test(input)
      || /(?:hvor|where)\s+(?:plasseres|goes|kommer?)\s+ikke/i.test(input)
      || /ikke\s+i\s+(?:norsk|hovedsetning|leddsetning)/i.test(input)
      || /leddsetning\w*\s+(?:med\s+)?ikke|eksempel.*leddsetning.*ikke|eksempel.*ikke.*leddsetning/i.test(input)) {
      return '**Plassering av "ikke" i norsk:**\n\n' +
        '"Ikke" plasseres etter verbet i hovedsetninger:\n' +
        '- Jeg spiser ikke fisk.\n' +
        '- Han jobber ikke i dag.\n\n' +
        '"Ikke" plasseres foran (før) verbet i leddsetninger:\n' +
        '- ...fordi jeg ikke spiser fisk.\n' +
        '- ...fordi han ikke jobber i dag.';
    }

    // Norwegian question formation
    if (/(?:question\s+formation|spørsmål\w*form)/i.test(input)
      || /(?:danne|lage)\w*\s+spørsmål/i.test(input)
      || /ordstilling\w*\s+(?:i\s+)?(?:norsk\w*\s+)?spørsmål/i.test(input)
      || /spørsmål\s+(?:i\s+)?norsk/i.test(input)
      || (/inversjon/i.test(input) && /norsk|grammatikk/i.test(input))) {
      return '**Spørsmålsformasjon i norsk:**\n\n' +
        'Ja/nei-spørsmål: Verb på **plass 1**:\n' +
        '- **Jobber** du i dag? (Do you work today?)\n' +
        '- **Har** du spist? (Have you eaten?)\n\n' +
        'Spørreord-spørsmål: Spørreord + verb + subjekt:\n' +
        '- **Hvor** bor du? (Where do you live?)\n' +
        '- **Hva** gjør du? (What do you do?)\n' +
        '- **Når** kommer du? (When are you coming?)';
    }

    // Dobbel bestemmelse for alle kjønn — BEFORE general dobbel bestemmelse
    if (/dobbel\s+bestem/i.test(input) && /(?:alle\s+kjønn|kjønn|gjelder)/i.test(input)) {
      return '**Dobbel bestemmelse gjelder for alle kjønn i norsk:**\n\n' +
        '| Kjønn | Eksempel |\n|---|---|\n' +
        '| Hankjønn | **den** store bil**en** |\n' +
        '| Hunkjønn | **den** store jent**a** |\n' +
        '| Intetkjønn | **det** store hus**et** |\n' +
        '| Flertall | **de** store bil**ene** |\n\n' +
        'Ja, dobbel bestemmelse gjelder for alle kjønn: hankjønn (den), hunkjønn (den), intetkjønn (det), flertall (de).';
    }

    // Double definite / dobbel bestemmelse
    if (/(?:double\s+definite|dobbel\s+bestem)/i.test(input)) {
      return '**Dobbel bestemmelse i norsk:**\n\n' +
        'Når et adjektiv står mellom artikkel og substantiv, brukes BÅDE artikkel OG bestemt substantiv:\n\n' +
        '| Eksempel | Forklaring |\n|---|---|\n' +
        '| **Den** stor**e** bil**en** | den + store + bilen |\n' +
        '| **Det** stor**e** hus**et** | det + store + huset |\n' +
        '| **De** stor**e** bil**ene** | de + store + bilene |\n\n' +
        'Dette kalles "dobbel bestemmelse" — determinativ + adjektiv + bestemt substantiv.';
    }

    // S-passive / passiv
    if (/s-passiv|bli-passiv/i.test(input)
      || /passiv\w*\s+(?:i\s+|in\s+)?(?:norwegian|norsk)/i.test(input)
      || /(?:norwegian|norsk)\s+passiv/i.test(input)
      || /passivform/i.test(input)) {
      return '**Passiv på norsk:**\n\n' +
        '**S-passiv** (legger til -s på verbet):\n' +
        '- Boken lese**s** av mange. (The book is read by many.)\n' +
        '- Døren åpne**s** kl. 8. (The door opens at 8.)\n\n' +
        '**Bli-passiv** (bli + perfektum partisipp):\n' +
        '- Boken **blir lest** av mange.\n' +
        '- Døren **ble åpnet** kl. 8.\n\n' +
        'S-passiv er mer formell/skriftlig. Bli-passiv er vanligere i dagligtale.';
    }

    // "å bli" vs "å være"
    if (/(?:å\s+)?(?:bli|være)\s+(?:vs\.?|versus|og|and|eller)\s+(?:å\s+)?(?:bli|være)/i.test(input)
      || /forskjell.*(?:å\s+)?bli.*(?:å\s+)?være|forskjell.*(?:å\s+)?være.*(?:å\s+)?bli/i.test(input)
      || /begge\s+brukes?\s+i\s+samme/i.test(input)) {
      return '**"Å være" vs "å bli" i norsk:**\n\n' +
        '**Å være** = to be (tilstand):\n' +
        '- Jeg **er** glad. (I am happy.)\n' +
        '- Han **er** lege. (He is a doctor.)\n\n' +
        '**Å bli** = to become (endring):\n' +
        '- Jeg **blir** glad. (I become happy.)\n' +
        '- Han **ble** lege. (He became a doctor.)\n\n' +
        '"Være" = eksisterende tilstand. "Bli" = forandring/overgang.\n\n' +
        'Eksempel med begge: "Han er syk, men han blir bedre." / "Hun var student, men ble lege."';
    }

    // Compound words / sammensatte ord
    if (/sammensatt\w*\s+ord/i.test(input)
      || /binde-?[se]/i.test(input)
      || /arbeidstillatelse/i.test(input)) {
      return '**Sammensatte ord i norsk:**\n\n' +
        'Norsk bygger ofte nye ord ved å sette sammen eksisterende ord uten mellomrom:\n\n' +
        '| Sammensatt | Deler | Betydning |\n|---|---|---|\n' +
        '| **arbeidstillatelse** | arbeid + s + tillatelse | work permit |\n' +
        '| **sykehus** | syke + hus | hospital |\n' +
        '| **barnehage** | barn + e + hage | kindergarten |\n' +
        '| **datamaskin** | data + maskin | computer |\n' +
        '| **høyskole** | høy + skole | university college |\n\n' +
        'Binde-s eller binde-e brukes mellom ordene i mange tilfeller.';
    }

    // Reflexive verbs + reflexive pronouns
    if (/refleksiv\w*\s+(?:verb|pronomen)/i.test(input)
      || /reflexive\s+(?:verb|pronoun)/i.test(input)
      || /refleksiv\w*\s+(?:i\s+)?(?:norwegian|norsk)/i.test(input)) {
      return '**Refleksive verb i norsk:**\n\n' +
        'Refleksive verb har pronomen som viser tilbake til subjektet:\n\n' +
        '| Verb | Eksempel | Engelsk |\n|---|---|---|\n' +
        '| sette seg | Hun setter seg ned. | She sits down. |\n' +
        '| legge seg | Barna legger seg kl. 8. | The children go to bed. |\n' +
        '| glede seg | Vi gleder oss til ferien. | We look forward to the holiday. |\n' +
        '| føle seg | Jeg føler meg bra. | I feel good. |\n\n' +
        'Refleksive pronomen: meg, deg, seg, oss, dere, seg.';
    }

    // Erfaring → erfaren (adjective form) — BEFORE general adjektiv pattern
    if (/adjektiv\w*\s+(?:av|of|fra|til)\s+erfaring/i.test(input)
      || /erfaren\b/i.test(input)
      || (/erfaring/i.test(input) && /adjektiv/i.test(input))) {
      return '**Adjektivet av "erfaring":**\n\n' +
        'En person som har mye erfaring er **erfaren** (experienced).\n\n' +
        '| Form | Eksempel |\n|---|---|\n' +
        '| Hankjønn/Hunkjønn | en erfaren lege |\n' +
        '| Intetkjønn | et erfarent team |\n' +
        '| Flertall/Bestemt | de erfarne legene |';
    }

    // Infinitive marker "å"
    if (/infinitiv\w*/i.test(input)
      || /(?:brukes?\s+)?(?:ikke\s+)?å\s+foran\s+(?:et\s+)?verb/i.test(input)
      || /når\s+brukes\s+ikke\s+å/i.test(input)) {
      return '**Infinitivsmerket "å" i norsk:**\n\n' +
        '"Å" brukes foran verb i infinitiv (som "to" på engelsk):\n' +
        '- Jeg liker **å** lese. (I like **to** read.)\n' +
        '- Det er viktig **å** lære norsk.\n\n' +
        '**NB:** Etter modalverb brukes IKKE "å":\n' +
        '- Jeg kan ~~å~~ svømme. → Jeg kan **svømme**.\n' +
        '- Du må ~~å~~ jobbe. → Du må **jobbe**.';
    }

    // Article usage en/ei/et
    if (/(?:artikkel|article)\w*/i.test(input)
      || /\ben\b.*\bei\b.*\bet\b/i.test(input)
      || /\ben\b\s+(?:i\s+stedet|instead)\s+(?:for\s+)?\bei\b/i.test(input)
      || /\ben\b.*\bei\b.*bokmål/i.test(input)
      || /ubestemt\w*\s+(?:artikl|article)/i.test(input)) {
      return '**Norske ubestemte artikler:**\n\n' +
        '| Artikkel | Kjønn | Eksempel |\n|---|---|---|\n' +
        '| **en** | hankjønn | en gutt, en stol, en bil |\n' +
        '| **ei** | hunkjønn | ei jente, ei bok, ei dør |\n' +
        '| **et** | intetkjønn | et hus, et eple, et barn |\n\n' +
        'I bokmål kan "en" brukes i stedet for "ei": en jente (vanlig) / ei jente (tradisjonelt). Det er vanlig å bruke "en" i stedet for "ei" i bokmål.';
    }

    // Multiple choice: "Hvilken setning er riktig" — ordstilling
    if (/(?:hvilken|which)\s+(?:setning|sentence)\s+(?:er\s+)?(?:riktig|korrekt|correct|grammatisk)/i.test(input)) {
      // Look for word order question — detect correct V2 pattern
      if (/ikke\s+spist\s+lunsj/i.test(input)) {
        // "har ikke spist lunsj" is correct (ikke after auxiliary)
        for (const opt of ['A', 'B', 'C', 'D']) {
          const optRegex = new RegExp(`${opt}\\)\\s*(.+?)(?=[A-D]\\)|$)`, 'i');
          const m = input.match(optRegex);
          if (m && /jeg\s+har\s+ikke\s+spist\s+lunsj\s+i\s+dag/i.test(m[1].trim())) {
            return `**Riktig svar: ${opt}) ${m[1].trim()}**\n\nV2-regelen: Verbet (har) står på plass 2. "Ikke" kommer etter det finitte verbet i hovedsetninger.`;
          }
        }
      }
    }

    // Spørreord (follow-up for Q12)
    if (/spørreord/i.test(input)) {
      return '**De vanligste spørreordene i norsk:**\n\n' +
        '| Spørreord | Engelsk | Eksempel |\n|---|---|---|\n' +
        '| **Hva** | What | Hva gjør du? |\n' +
        '| **Hvor** | Where | Hvor bor du? |\n' +
        '| **Når** | When | Når kommer du? |\n' +
        '| **Hvem** | Who | Hvem er det? |\n' +
        '| **Hvorfor** | Why | Hvorfor er du her? |\n' +
        '| **Hvordan** | How | Hvordan har du det? |\n' +
        '| **Hvilken/Hvilket/Hvilke** | Which | Hvilken bok liker du? |';
    }

    // Inversjon (follow-up for Q24)
    if (/inversjon/i.test(input)) {
      return '**Inversjon i norsk grammatikk:**\n\n' +
        'Inversjon betyr at subjektet og verbet bytter plass. I norsk skjer inversjon når:\n\n' +
        '1. **Spørsmål:** Verb kommer på plass 1:\n' +
        '   - **Jobber** du i dag? (verb → subjekt)\n\n' +
        '2. **Annet ledd på plass 1:** Subjektet flyttes etter verbet:\n' +
        '   - I dag **jobber** jeg. (tidsledd → verb → subjekt)\n' +
        '   - Her **bor** vi. (stedsledd → verb → subjekt)\n\n' +
        'Inversjon = subjekt kommer etter verbet, ikke før.';
    }

    // Bestemt form follow-up: flertall av "en gutt"
    if (/bestemt\s*form\s+flertall/i.test(input) && /gutt/i.test(input)) {
      return '**Bestemt form flertall av "en gutt":**\n\n' +
        'Bøyning: en gutt → gutten (bestemt entall) → gutter (ubestemt flertall) → **guttene** (bestemt flertall)\n\n' +
        '| Form | Eksempel |\n|---|---|\n' +
        '| Ubestemt entall | en gutt |\n' +
        '| Bestemt entall | gutten |\n' +
        '| Ubestemt flertall | gutter |\n' +
        '| Bestemt flertall | guttene |';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Del 1: Tekstforståelse og Grammatikk
    // ══════════════════════════════════════════════════════════════

    // Q1: "iverksette" synonym
    if (/iverksette/i.test(input) && /(?:betyr|mean|synonym|samme\s+som|understreke|tiltak|regjeringen)/i.test(input)) {
      return '**Riktig svar: C) Gjennomføre**\n\n' +
        'Å **iverksette** betyr å sette i gang eller utføre en planlagt handling.\n\n' +
        '- A) Avlyse — betyr å stoppe/kansellere\n' +
        '- B) Planlegge — betyr å forberede, ikke gjennomføre\n' +
        '- C) ✅ **Gjennomføre** — betyr å sette i gang, utføre\n' +
        '- D) Diskutere — betyr å samtale om noe\n\n' +
        'De andre alternativene beskriver enten å stoppe, planlegge eller samtale om noe, ikke selve utførelsen.';
    }

    // Q2: "selv om" + V2 word order
    if (/selv\s+om.*regnet.*gikk|grammatisk\s+korrekt.*selv\s+om|selv\s+om.*grammati/i.test(input)) {
      return '**Riktig svar: A) Selv om det regnet, gikk vi på tur.**\n\n' +
        'I en leddsetning med "selv om" følger vi vanlig ordstilling, og hovedsetningen etterpå skal ha subjektet etter verbet hvis leddsetningen kommer først (V2-regelen).\n\n' +
        '- A) ✅ **Selv om det regnet, gikk vi på tur.** — Korrekt V2-ordstilling\n' +
        '- B) «…så vi gikk på tur» — feil ordstilling etter leddsetning\n' +
        '- C) «Vi gikk på tur selv om regnet det» — galt subjekt-verb-rekkefølge i leddsetningen\n' +
        '- D) «Regnet det, selv om vi gikk…» — ugrammatisk';
    }

    // Q3: "sitte på gjerdet" idiom
    if (/sitte\s+på\s+gjerdet/i.test(input)) {
      return '**Riktig svar: B) Å være ubesluttsom eller vente med å ta et valg.**\n\n' +
        '«Å sitte på gjerdet» er et vanlig norsk idiom som brukes når noen ikke vil ta standpunkt i en sak ennå.\n\n' +
        '- A) Å være fysisk aktiv — nei\n' +
        '- B) ✅ **Å være ubesluttsom eller vente med å ta et valg**\n' +
        '- C) Å ha god oversikt over en situasjon — nei\n' +
        '- D) Å være utestengt fra et fellesskap — nei';
    }

    // Q4: "interessert i" preposition
    if (/interessert\s+___?\s*(?:bærekraft|utvikling)|(?:preposisjon|preposition).*interessert/i.test(input)) {
      return '**Riktig svar: C) i**\n\n' +
        'Uttrykket er «å være interessert **i** noe».\n\n' +
        '- A) på — feil preposisjon\n- B) for — feil\n- C) ✅ **i** — korrekt\n- D) til — feil\n\n' +
        '«Mange studenter ved UiO er interessert **i** bærekraftig utvikling.»';
    }

    // Q5: "korrelasjon" academic vocabulary
    if (/korrelasjon|søvnkvalitet.*eksamensresultat|tydelig\s+___.*mellom/i.test(input)) {
      return '**Riktig svar: B) Korrelasjon**\n\n' +
        'I akademisk norsk brukes «korrelasjon» for å beskrive en statistisk sammenheng mellom to variabler.\n\n' +
        '- A) blanding — for uformelt\n- B) ✅ **korrelasjon** — akademisk term for statistisk sammenheng\n- C) vennskap — irrelevant\n- D) motsetning — betyr noe annet\n\n' +
        '«Forskerne fant en tydelig **korrelasjon** mellom lav søvnkvalitet og dårlige eksamensresultater.»';
    }

    // Extended Del 1 Q6: "dokumentert" synonym
    if (/dokumenter(?:t|e)\b.*(?:betyr|beviste|antatt|sammenheng|fysisk\s+aktiv|mental\s+helse)/i.test(input)) {
      return '**Riktig svar: B) Beviste**\n\n' +
        '«Dokumentere» betyr å vise med fakta eller bevis, ikke bare å anta eller avvise.\n\n' +
        '- A) Avvist — betyr å forkaste\n- B) ✅ **Beviste** — å vise med bevis\n- C) Antatt — betyr å anta uten bevis\n- D) Ignorert — betyr å overse';
    }

    // Extended Del 1 Q7: "hjelpe ham" object pronoun
    if (/hjelpe\s+(?:han|ham|seg)\s+med\s+oppgaven|objektpronomen.*hjelpe/i.test(input)) {
      return '**Riktig svar: B) Han spurte om jeg kunne hjelpe ham med oppgaven.**\n\n' +
        'Etter «hjelpe» brukes objektpronomenet «ham» (ikke refleksiv «seg» når subjektet er en annen person).\n\n' +
        '- A) «…hjelpe han…» — «han» er subjektform, feil\n' +
        '- B) ✅ **«…hjelpe ham…»** — «ham» er korrekt objektform\n' +
        '- C) «…hjelpe seg…» — refleksiv form er feil her (ulike subjekt)\n' +
        '- D) «…oppgaven sin» — feil refleksivt eiendomspronomen';
    }

    // Extended Del 1 Q8: "ha beina på jorden" idiom
    if (/beina\s+på\s+jorden/i.test(input)) {
      return '**Riktig svar: B) Å være realistisk og praktisk.**\n\n' +
        '«Å ha beina på jorden» er et vanlig norsk idiom som beskriver en person som tenker praktisk og ikke har urealistiske forestillinger.\n\n' +
        '- A) Å være veldig sporty — nei\n' +
        '- B) ✅ **Å være realistisk og praktisk**\n' +
        '- C) Å reise mye — nei\n' +
        '- D) Å være lat — nei';
    }

    // Extended Del 1 Q9: "kjent med" preposition
    if (/UiO\s+er\s+kjent\s+___?\s*(?:sin|sterke|forskningsprofil)|kjent\s+(?:med|for|på|av).*forskningsprofil/i.test(input)) {
      return '**Riktig svar: A) for**\n\n' +
        '«Kjent for» brukes når noe er karakteristisk for eller assosiert med noe.\n\n' +
        '«UiO er kjent **for** sin sterke forskningsprofil innen klima og miljø.»\n\n' +
        'NB: «kjent med» = familiar with, «kjent for» = known for.';
    }

    // Extended Del 1 Q10: "markant" academic word
    if (/markant|markant.*økning|internasjonale\s+studenter.*tiår.*passer\s+best/i.test(input)) {
      return '**Riktig svar: B) Markant**\n\n' +
        '«Markant» er et typisk akademisk ord som betyr «tydelig» eller «betydelig» og brukes ofte i rapporter og artikler.\n\n' +
        '- A) liten — for svak\n- B) ✅ **markant** — tydelig, betydelig\n- C) middelmådig — betyr gjennomsnittlig\n- D) ubetydelig — betyr det motsatte\n\n' +
        '«Studien viser en **markant** økning i antall internasjonale studenter det siste tiåret.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 2: Logical Organization & Cohesion
    // ══════════════════════════════════════════════════════════════

    // P2-Q1: Reorganize sentences (digital eksamen)
    if (/(?:reorgani|rekkefølge|logisk.*strukturert).*(?:digital\s+eksamen|teknologien\s+endret|utdanningssektoren|Canvas.*Inspera)/i.test(input)) {
      return '**Riktig rekkefølge: 2 – 4 – 1 – 3**\n\n' +
        '1. Start med den **generelle trenden** (2): «I løpet av det siste tiåret har teknologien endret utdanningssektoren drastisk.»\n' +
        '2. Deretter den **spesifikke institusjonelle responsen** (4): «UiO har derfor investert tungt i nye plattformer som Canvas og Inspera.»\n' +
        '3. Vis det **direkte resultatet** (1): «Dette har ført til en økning i digital eksamensgjennomføring.»\n' +
        '4. Avslutt med den **bredere implikasjonen** (3): «Samtidig krever denne utviklingen høyere digital kompetanse hos både studenter og forelesere.»';
    }

    // P2-Q2: "derimot" transition word for counter-argument
    if (/(?:bindeord|transition).*(?:counter|mot.?argument)|hjemmekontor.*produktivitet.*(?:sosiale?\s+isolasjon|innovasjon)/i.test(input)) {
      return '**Riktig svar: B) Derimot**\n\n' +
        '«Derimot» (on the other hand) signaliserer en kontrast, som er nødvendig her.\n\n' +
        '- A) Dessuten — legger til (additive)\n- B) ✅ **Derimot** — kontrast/motsetning\n- C) Følgelig — årsak–virkning\n- D) Dermed — konklusjon\n\n' +
        '«Mange mener at hjemmekontor øker produktiviteten. **Derimot** viser nyere studier at den sosiale isolasjonen kan svekke innovasjonsevnen over tid.»';
    }

    // P2-Q3: Topic sentence identification (håndskrevne notater)
    if (/(?:temasetning|topic\s+sentence).*(?:håndskrevne|notater|pensum|husker)|håndskrevne\s+notater.*husker\s+pensum/i.test(input)) {
      return '**Riktig svar: Setning A**\n\n' +
        '«Forskning viser at studenter som tar håndskrevne notater ofte husker pensum bedre enn de som skriver på PC.»\n\n' +
        'Setning A introduserer **hovedpåstanden** som resten av setningene (B, C, D) støtter eller utdyper:\n' +
        '- B: forklarer hvorfor\n- C: gir kontrast (PC-brukere)\n- D: gir anbefaling basert på A\n\n' +
        'En **temasetning** presenterer hovedideen i et avsnitt.';
    }

    // P2-Q4: "som følge av dette" cause-effect
    if (/(?:cause|årsak).*(?:effect|virkning).*(?:budsjet|kuttet|språkkurs)|budsjet.*kuttet.*språkkurs|universitetet.*kuttet.*budsj/i.test(input)) {
      return '**Riktig svar: C) Som følge av dette**\n\n' +
        '«Som følge av dette» (as a result of this) etablerer den **kausale sammenhengen** mellom budsjettkutt og avlyste kurs.\n\n' +
        '- A) i motsetning til — kontrast\n- B) forutsatt at — betingelse\n- C) ✅ **som følge av dette** — årsak–virkning\n- D) til tross for at — innrømmelse\n\n' +
        '«Universitetet har kuttet i budsjettene, **som følge av dette** ble flere språkkurs avlyst dette semesteret.»';
    }

    // P2-Q5: Drøfting structure
    if (/(?:drøfting|discussion).*(?:essay|structure|struktur|oppbygging)|struktur.*drøft|(?:argumenter\s+for|argumenter\s+imot).*(?:konklusjon|syntese)/i.test(input)) {
      return '**Riktig svar: C) Introduksjon – Argumenter for – Argumenter imot – Drøfting/Syntese – Konklusjon**\n\n' +
        'Dette følger den akademiske standarden for objektivitet og balansert analyse.\n\n' +
        '- A) Feil — konklusjonen kan ikke komme først\n' +
        '- B) Delvis riktig, men mangler syntese/drøftingsdel\n' +
        '- C) ✅ **Standard akademisk drøftingsstruktur**\n' +
        '- D) Feil — personlig historie og punktliste er ikke akademisk form';
    }

    // P2-Q6: Syllogism (Maria UiO bibliotek)
    if (/(?:syllogism|premiss).*(?:Maria|UiO|bibliotek)|alle\s+studenter.*UiO.*bibliotek.*Maria/i.test(input)) {
      return '**Konklusjon: Maria har tilgang til universitetsbiblioteket.**\n\n' +
        'Logisk deduksjon (syllogisme):\n' +
        '- **Premiss 1:** Alle studenter ved UiO har tilgang til universitetsbiblioteket.\n' +
        '- **Premiss 2:** Maria er student ved UiO.\n' +
        '- **Konklusjon:** Maria har tilgang til universitetsbiblioteket.\n\n' +
        'Dette er en **deduktiv slutning** — hvis begge premissene er sanne, er konklusjonen nødvendigvis sann.';
    }

    // P2-Q7: Problemstilling purpose
    if (/problemstilling.*(?:formål|purpose|hensikt|funksjon)|hva\s+er.*problemstilling|purpose.*research\s+question/i.test(input)) {
      return '**Riktig svar: B) Å avgrense temaet og styre retningen for hele teksten.**\n\n' +
        'En **problemstilling** (research question) i en akademisk introduksjon har som oppgave å snevre inn temaet slik at teksten forblir fokusert.\n\n' +
        '- A) Nei — oppsummering hører til konklusjonen\n' +
        '- B) ✅ **Avgrense og styre retningen**\n' +
        '- C) Nei — personlige meninger hører ikke i problemstillingen\n' +
        '- D) Nei — dette er ikke akademisk formål';
    }

    // P2-Q8: Logical flow breaker (elbiler + parker)
    if (/(?:bryter|breaks?).*logisk.*(?:flow|flyt)|norge.*(?:ledende|elektriske\s+biler).*(?:parker|vakker\s+by)/i.test(input)) {
      return '**Riktig svar: Setning 3 — «Oslo er en vakker by med mange parker.»**\n\n' +
        'Setning 3 handler om byens skjønnhet/parker, som er **irrelevant** for det logiske argumentet om elbil-insentiver og -salg.\n\n' +
        '(1) Norge er ledende på elektriske biler. ✓\n(2) Staten tilbyr mange insentiver… ✓\n(3) ❌ Oslo er en vakker by med mange parker. — **bryter flyten**\n(4) Dette har resultert i at over 80% av nybilsalget er elektrisk. ✓';
    }

    // P2-Q9: Signal words intensity order
    if (/(?:signal\s*ord|signal\s+words).*(?:svakest|sterkest|emphasis|intensity)|ganske.*ekstremt.*noe.*særdeles/i.test(input)) {
      return '**Riktig rekkefølge (svakest → sterkest):**\n\n' +
        '**Noe → Ganske → Særdeles → Ekstremt**\n\n' +
        '| Ord | Intensitet | Engelsk |\n|---|---|---|\n' +
        '| Noe | Svakest | Somewhat |\n' +
        '| Ganske | Moderat | Quite / Rather |\n' +
        '| Særdeles | Sterk | Particularly / Exceptionally |\n' +
        '| Ekstremt | Sterkest | Extremely |\n\n' +
        'Å forstå intensiteten av adverb er viktig for nyansert akademisk argumentasjon.';
    }

    // P2-Q10: "riktignok" function (concession)
    if (/riktignok.*(?:funksjon|function|logical|logisk|betyr|hva)|hva\s+(?:er|betyr).*riktignok/i.test(input)) {
      return '**Riktig svar: B) Å innrømme et poeng (konsesjon) før man presenterer et viktigere motpoeng.**\n\n' +
        '«Riktignok» (admittedly / true enough) brukes for å innrømme et mindre poeng før man vrir til hovedargumentet.\n\n' +
        '- A) Å konkludere — nei\n- B) ✅ **Konsesjon** — innrømmelse før motpoeng\n- C) Å legge til et ekstra argument — nei\n- D) Å beskrive tidsrekkefølge — nei\n\n' +
        '«Det er **riktignok** dyrt å bo i Oslo, **men** lønningene er også høyere enn i mange andre byer.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 3: Advanced Logical Organization
    // ══════════════════════════════════════════════════════════════

    // P3-Q1: Chronological order (Welfare State)
    if (/(?:kronologisk|chronological).*(?:welfare|velferd|folketrygd)|folketrygd.*1967|arbeiderbeveg.*(?:rekkefølge|order)/i.test(input)) {
      return '**Riktig rekkefølge: 4 – 2 – 1 – 3**\n\n' +
        '1. (4) Tidlige arbeiderbevegelser tidlig på 1900-tallet\n' +
        '2. (2) Gjenoppbygging etter 2. verdenskrig og bygging av sosiale sikkerhetsnett\n' +
        '3. (1) Innføring av Folketrygdloven i 1967\n' +
        '4. (3) Moderne utfordringer med en aldrende befolkning i 2026\n\n' +
        'Kronologisk rekkefølge krever å starte med de tidligste historiske røttene og bevege seg mot nåtiden.';
    }

    // P3-Q2: "Den røde tråden"
    if (/den\s+røde\s+tråden|red\s+thread.*norwegian|rød\w*\s+tråd/i.test(input)) {
      return '**Riktig svar: B) Å sikre en konsistent logisk sammenheng fra innledning til konklusjon.**\n\n' +
        '«Den røde tråden» er det norske uttrykket for den **logiske flyten** som binder en akademisk tekst sammen.\n\n' +
        '- A) Nei — bruk av metaforer er noe annet\n' +
        '- B) ✅ **Konsistent logisk sammenheng** gjennom hele teksten\n' +
        '- C) Nei — det handler ikke om rød skrift\n' +
        '- D) Nei — det handler om sammenheng, ikke ulike temaer\n\n' +
        'Uten den røde tråden blir teksten fragmentert og vanskelig å følge.';
    }

    // P3-Q3: Implicit causality (result relationship)
    if (/implicit\s+causality|result.*relationship.*sentence|failed\s+to\s+cite.*plagiarism|consequence.*pair/i.test(input)) {
      return '**Riktig svar: B) «The student failed to cite sources. Consequently, the paper was flagged for plagiarism.»**\n\n' +
        'Bruk av «Consequently» (Følgelig) skaper en direkte **logisk konsekvens**.\n\n' +
        '- A) Bibliotek stengt → svømming — ingen logisk sammenheng\n' +
        '- B) ✅ Manglende kildehenvisning → plagiat — **direkte kausal sammenheng**\n' +
        '- C) Snø → laptop — ingen sammenheng\n' +
        '- D) Professor sen → kald kaffe — svak/ingen kausal kobling';
    }

    // P3-Q4: General-to-Specific / Topic sentence placement
    if (/general.?to.?specific|topic\s+sentence.*(?:placed|plassere|beginning)|inverted\s+pyramid.*paragraph/i.test(input)) {
      return '**Riktig svar: B) I begynnelsen, for å gi leseren et rammeverk.**\n\n' +
        'I standard akademisk skriving (norsk og engelsk) foretrekkes den «omvendte pyramiden» der **hovedpåstanden åpner avsnittet**.\n\n' +
        '- A) Til slutt for overraskelse — ikke akademisk stil\n' +
        '- B) ✅ **I begynnelsen** — gir leseren umiddelbar kontekst\n' +
        '- C) I midten — gjemmer hovedpoenget\n' +
        '- D) Utelates — uakseptabelt i akademisk skriving';
    }

    // P3-Q5: Sentence insertion (infrastructure investment)
    if (/(?:where|hvor).*sentence.*(?:infrastructure\s+invest|tilstrekkelig\s+opplæring)|carbon\s+neutral.*2050.*(?:insert|fit|passer)/i.test(input)) {
      return '**Riktig svar: Posisjon (3)**\n\n' +
        '«However, this transition requires significant infrastructure investment» passer best mellom:\n' +
        '- (2) Strategien (skifte fra olje til grønn energi)\n' +
        '- (4) Spesifikk referanse til «these funds»\n\n' +
        'Setningen bygger **bro** mellom strategien og den konkrete omtalen av «these funds» i setning (4).';
    }

    // P3-Q6: Point-by-point comparison
    if (/point.?by.?point.*(?:compari|organiz|struktur)|sammenlikn.*(?:punkt\s+for\s+punkt|point.?by.?point)/i.test(input)) {
      return '**Riktig svar: B) Diskuter «Tema 1» for begge forfattere, deretter «Tema 2» for begge forfattere.**\n\n' +
        'Point-by-point er en sofistikert logisk struktur som sammenligner spesifikke elementer **side om side**.\n\n' +
        '- A) Alt om Forfatter A, deretter alt om B — dette er **blokkstruktur**, ikke point-by-point\n' +
        '- B) ✅ **Point-by-point**: Tema 1 (A+B) → Tema 2 (A+B)\n' +
        '- C) Bare én forfatter — ikke sammenligning\n' +
        '- D) Biografi uten sammenligning — ikke akademisk komparativ analyse';
    }

    // P3-Q7: Conclusion rules (never introduce new data)
    if (/conclusion.*(?:never|aldri|should\s+not)|konklusjon.*(?:aldri|introdusere\s+nye|brand\s+new\s+argument)/i.test(input)) {
      return '**Riktig svar: C) Introdusere helt nye argumenter eller data som ikke er nevnt i hoveddelen.**\n\n' +
        'Å introdusere ny informasjon i konklusjonen bryter den logiske strukturen i teksten.\n\n' +
        'En logisk konklusjon på universitetsnivå **skal:**\n' +
        '- A) ✓ Oppsummere hovedfunnene\n' +
        '- B) ✓ Svare på problemstillingen\n' +
        '- D) ✓ Peke mot videre forskning\n\n' +
        'Men **ALDRI:**\n- C) ❌ Introdusere nye argumenter eller data — dette bryter hele papirets logiske oppbygning.';
    }

    // P3-Q8: Conversely (contrastive connector for methods)
    if (/quantitative.*qualitative.*(?:moreover|conversely|similarly|therefore)|(?:conversely|innvending|i\s+motsetning).*(?:connector|bindeord)/i.test(input)) {
      return '**Riktig svar: B) Conversely (Innvending / I motsetning)**\n\n' +
        'Setningen sammenligner to ulike tilnærminger og krever en **kontrastiv kobling**.\n\n' +
        '- A) Moreover — additivt (legger til), feil her\n' +
        '- B) ✅ **Conversely** — kontrast mellom to metoder\n' +
        '- C) Similarly — likhet, motsatt av hva som trengs\n' +
        '- D) Therefore — konklusjon, ikke kontrast\n\n' +
        '«Quantitative methods provide broad data sets; **conversely**, qualitative methods offer deep, individual insights.»';
    }

    // P3-Q9: Hierarchical logic (sub-point of Norwegian Economy)
    if (/(?:sub.?point|underpunkt).*(?:norwegian\s+economy|norsk\s+økonomi)|hierarchi.*logic.*(?:oil\s+revenue|oljefond|sovereign\s+wealth)/i.test(input)) {
      return '**Riktig svar: B) Oil Revenue and the Sovereign Wealth Fund.**\n\n' +
        'Logisk hierarki krever at underpunkter er **direkte delmengder** av hovedoverskriften.\n\n' +
        '- A) Det svenske helsesystemet — feil land\n' +
        '- B) ✅ **Oljeinntekter og Statens pensjonsfond utland** — direkte del av norsk økonomi\n' +
        '- C) Vikingskipenes historie — annet fagfelt\n' +
        '- D) Klimamønstre i Sahara — helt irrelevant';
    }

    // P3-Q10: Non-sequitur (skiing → Tesla)
    if (/non.?sequitur|nordmenn.*skiing.*tesla|(?:lovbreak|flaw).*(?:norwegian|nordmenn).*ski.*tesla/i.test(input)) {
      return '**Riktig svar: B) Konklusjonen (å eie en Tesla) har ingen logisk forbindelse til premisset (å like ski).**\n\n' +
        'Dette er en **non-sequitur** — konklusjonen følger ikke av premissene.\n\n' +
        '- Premiss 1: Alle nordmenn liker ski.\n' +
        '- Premiss 2: Lars er norsk.\n' +
        '- Konklusjon: Lars har en Tesla. ❌\n\n' +
        'Å like ski har **ingen logisk kobling** til å eie en elbil. Korrekt konklusjon ville vært: «Lars liker ski.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 4: Academic Vocabulary & Phraseology
    // ══════════════════════════════════════════════════════════════

    // P4-Q1: "indikerer at" formal replacement
    if (/(?:indikerer|peker\s+på|sier\s+at|tror\s+at).*(?:akademisk|formal|erstatt|replace).*sammenheng|studien\s+viser.*(?:indiker|peker|sier|tror)/i.test(input)) {
      return '**Riktig svar: B) indikerer at**\n\n' +
        '«Indikerer at» er mer formelt og presist enn «viser at» i akademisk sammenheng.\n\n' +
        '- A) peker på at — akseptabelt men svakere\n- B) ✅ **indikerer at** — formelt og akademisk\n- C) sier at — for uformelt\n- D) tror at — subjektivt, uakademisk';
    }

    // P4-Q2: "teste en hypotese" collocation
    if (/(?:teste|lage|finne|skrive)\s+en\s+hypotese|collocation.*hypotese/i.test(input)) {
      return '**Riktig svar: B) teste**\n\n' +
        'Korrekt kollokasjon er «å **teste** en hypotese».\n\n' +
        '- A) lage — man «formulerer» eller «setter opp» en hypotese\n- B) ✅ **teste** — verifisere om hypotesen holder\n- C) finne — man finner resultater, ikke hypoteser\n- D) skrive — man skriver en oppgave, ikke tester en hypotese';
    }

    // P4-Q3: "validitet" definition
    if (/validitet.*(?:betyr|mean|definisjon|norsk\s+forskning)|hva\s+(?:er|betyr)\s+validitet/i.test(input)) {
      return '**Validitet** = Gyldighet — hvor godt en studie måler det den skal måle.\n\n' +
        'I norsk forskningskontekst:\n' +
        '- **Intern validitet:** Kan vi stole på årsaksforholdet i studien?\n' +
        '- **Ekstern validitet:** Kan resultatene generaliseres til andre situasjoner?\n' +
        '- **Begrepsvaliditet:** Måler instrumentet det teoretiske begrepet korrekt?\n\n' +
        'Motsetning: **Reliabilitet** = pålitelighet (konsistens i målingene).';
    }

    // P4-Q4: "således" formal transition
    if (/således.*(?:formell|transition|overgang)|resultate?n?e?.*(?:hypotese.*forkast|således|derfor|dessuten)/i.test(input)) {
      return '**Riktig svar: B) Således**\n\n' +
        '«Således» er det mest formelle overgangsordet i akademisk norsk for å introdusere en konsekvens.\n\n' +
        '- A) Derfor — korrekt men mindre formelt\n- B) ✅ **Således** — formelt og akademisk\n- C) Også — additivt, ikke konkluderende\n- D) Dessuten — additivt, feil funksjon\n\n' +
        '«**Således** viser resultatene at hypotesen må forkastes.»';
    }

    // P4-Q5: "rekruttert" in methods section
    if (/rekruttert.*(?:metode|methods|spørreundersøkelse)|deltaker.*(?:rekruttert|funnet|møtt|sett).*(?:online|spørre)/i.test(input)) {
      return '**Riktig svar: B) rekruttert**\n\n' +
        '«Rekruttert» er det mest passende ordet i en metodeseksjon.\n\n' +
        '- A) funnet — for uformelt i akademisk kontekst\n- B) ✅ **rekruttert** — standard akademisk terminologi\n- C) møtt — impliserer fysisk møte, feil her\n- D) sett — irrelevant\n\n' +
        '«Deltakerne ble **rekruttert** via en online spørreundersøkelse.»';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Part 5: Source Criticism & Citation
    // ══════════════════════════════════════════════════════════════

    // P5-Q1: Most reliable source
    if (/(?:pålitelig|reliable).*(?:kilde|source).*(?:akademisk|academic)|fagfellevurdert.*(?:tidsskrift|artikkel)|blogg.*wikipedia.*youtube.*(?:artikkel|tidsskrift)/i.test(input)) {
      return '**Riktig svar: B) En fagfellevurdert artikkel i Tidsskrift for samfunnsforskning fra 2025**\n\n' +
        'I norsk akademisk skriving er **fagfellevurderte** (peer-reviewed) artikler den mest pålitelige kildetypen.\n\n' +
        '- A) Blogg — ikke verifisert, ofte subjektiv\n- B) ✅ **Fagfellevurdert artikkel** — gjennomgått av eksperter\n- C) Wikipedia — kan redigeres av hvem som helst\n- D) YouTube-video — usikker kildekvalitet\n\n' +
        '**Tip:** I akademisk arbeid prioriterer man alltid fagfellevurderte, vitenskapelige publikasjoner.';
    }

    // P5-Q2: In-text citation APA
    if (/(?:in-text\s+citation|kildehenvisning).*APA.*(?:Smith|correct|korrekt)|ifølge\s+Smith.*2025.*s\.\s*47/i.test(input)) {
      return '**Korrekt!**\n\n' +
        '«Ifølge Smith (2025, s. 47) …» er riktig APA in-text referanse.\n\n' +
        '**APA-format for kildehenvisning:**\n' +
        '- Direkte sitat: (Smith, 2025, s. 47)\n' +
        '- Parafrase: (Smith, 2025)\n' +
        '- Forfatter i teksten: Ifølge Smith (2025, s. 47)…\n\n' +
        'UiO og de fleste norske universiteter bruker APA 7th edition.';
    }

    // P5-Q3: "primærkilde" definition
    if (/primærkilde|primary\s+source.*(?:norsk|norwegian|betyr|mean|definisjon)/i.test(input)) {
      return '**Primærkilde** = Originalkilde — f.eks. et brev, en intervjuutskrift, et offisielt dokument, originalforskning.\n\n' +
        '**Typer primærkilder:**\n' +
        '- Originalforskning (studier, eksperimenter)\n' +
        '- Historiske dokumenter (brev, dagbøker, taler)\n' +
        '- Intervjuer og feltnotater\n' +
        '- Lover og offentlige dokumenter (NOU, Stortingsmeldinger)\n\n' +
        '**Motsetning:** Sekundærkilde — analyserer eller refererer til primærkilder (f.eks. lærebøker, review-artikler).';
    }

    // P5-Q4: Missing reference problem
    if (/(?:mangler|missing).*(?:referanse|reference).*(?:forfatter|årstall|author|year)|uten\s+forfatter\s+eller\s+årstall/i.test(input)) {
      return '**Problem: Mangler full referanse → brudd på akademisk standard.**\n\n' +
        '«Som det står i artikkelen (uten forfatter eller årstall)…» er **uakseptabelt** i akademisk skriving.\n\n' +
        '**Krav til kildehenvisning:**\n' +
        '- Forfatter(e) — hvem skrev det?\n' +
        '- Årstall — når ble det publisert?\n' +
        '- Tittel — hva heter verket?\n' +
        '- Utgiver/tidsskrift — hvor er det publisert?\n\n' +
        'Uten disse elementene kan leseren ikke verifisere kilden, og det kan betraktes som **plagiat**.';
    }

    // P5-Q5: Correct reference list entry (Harvard)
    if (/(?:reference\s+list|referanseliste|litteraturliste).*(?:harvard|korrekt|correct|formatert)|Skaranger.*Universitetsforlaget/i.test(input)) {
      return '**Korrekt referanseoppføring (Harvard/APA):**\n\n' +
        'Skaranger, M. N. (2024). *Norsk for internasjonale studenter*. Oslo: Universitetsforlaget.\n\n' +
        '**Format:** Etternavn, Initialer. (År). *Tittel i kursiv*. Sted: Forlag.\n\n' +
        '**Vanlige feil:**\n' +
        '- Manglende kursivering av tittel\n' +
        '- Feil rekkefølge på elementene\n' +
        '- Manglende årstall eller utgiver\n' +
        '- Inkonsekvent formatering i referanselisten';
    }

    // ══════════════════════════════════════════════════════════════
    //  Extended Part 2: Logical Organization (questions 11–15)
    // ══════════════════════════════════════════════════════════════

    // Ext P2-Q1: KI/ChatGPT paragraph reorganization
    if (/(?:reorgani|rekkefølge).*(?:KI.?verktøy|ChatGPT|retningslinjer|kritisk\s+tenkning)|(?:ChatGPT|KI).*(?:oppgaveskriving|retningslinjer).*(?:reorgani|order|rekkefølge)/i.test(input)) {
      return '**Riktig rekkefølge: 3 – 1 – 2 – 4**\n\n' +
        '1. (3) Mange studenter bruker ChatGPT til oppgaveskriving. [utgangspunkt]\n' +
        '2. (1) Dette har ført til økt bruk av KI-verktøy. [resultat]\n' +
        '3. (2) Universitetet har innført nye retningslinjer for bruk av KI. [respons]\n' +
        '4. (4) Likevel er det viktig å beholde kritisk tenkning. [konklusjon/implikasjon]\n\n' +
        'Logikk: Start med fenomenet, vis resultatet, institusjonell respons, så bredere implikasjon.';
    }

    // Ext P2-Q2: concession "riktignok … men"
    if (/KI.*spare\s+tid.*(?:men|riktignok|dessuten|derfor).*(?:forstå\s+innholdet|selv)/i.test(input)) {
      return '**Riktig svar: C) riktignok**\n\n' +
        '«KI kan **riktignok** spare tid, **men** studentene må fortsatt forstå innholdet selv.»\n\n' +
        '«Riktignok … men» er et klassisk norsk konsesjonspar (innrømmelse + motpoeng).\n\n' +
        '- A) dessuten — additivt, feil\n- B) men — alene er for brått\n- C) ✅ **riktignok** — innrømmelse\n- D) derfor — årsak–virkning, feil';
    }

    // Ext P2-Q3: Cohesion breaker (digitalisering + fjorder)
    if (/(?:cohesion|sammenheng).*(?:break|bryter).*(?:digitalis|forelesning|fjord)|digitalis.*forelesning.*fjord.*ferdig/i.test(input)) {
      return '**Riktig svar: Setning 3 — «Oslo har fine fjorder.»**\n\n' +
        'Setning 3 handler om Oslos geografi og er **irrelevant** for temaet om digitalisering av undervisning.\n\n' +
        '(1) Digitalisering endrer undervisningen. ✓\n(2) Flere forelesninger er nå hybrid. ✓\n(3) ❌ Oslo har fine fjorder. — **bryter sammenhengen**\n(4) Dette krever nye digitale ferdigheter. ✓';
    }

    // Ext P2-Q4: Conclusion paragraph structure
    if (/(?:logical\s+order|rekkefølge).*conclusion.*paragraph|konklusjon.*avsnitt.*(?:struktur|rekkefølge)/i.test(input)) {
      return '**Logisk rekkefølge for et konklusjonsavsnitt:**\n\n' +
        '1. **Oppsummering** — kort om hovedfunn\n' +
        '2. **Svar på problemstillingen** — direkte kobling til forskningsspørsmålet\n' +
        '3. **Implikasjoner** — hva betyr funnene i praksis?\n' +
        '4. **Forslag til videre forskning** — hva bør undersøkes videre?\n\n' +
        '**Viktig:** Aldri introduser nye argumenter eller data i konklusjonen.';
    }

    // Ext P2-Q5: Logical flaw (KI + bedre karakterer)
    if (/alle.*(?:bruker\s+KI|KI).*bedre\s+karakter.*Maria|hasty\s+generaliz.*KI/i.test(input)) {
      return '**Logisk feil: Forhastet generalisering + non-sequitur.**\n\n' +
        '«Alle som bruker KI får bedre karakterer. Maria bruker KI. Derfor får Maria A på alle oppgaver.»\n\n' +
        '**Problemer:**\n' +
        '1. **Forhastet generalisering** — premisset «alle som bruker KI får bedre karakterer» er udokumentert\n' +
        '2. **Non-sequitur** — selv om KI gir bedre karakterer, følger ikke «A på alle oppgaver» logisk\n\n' +
        'Korrekt logikk ville kreve: dokumentert premiss → avgrenset konklusjon.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Extended Part 3: Advanced Logical Organization (questions 11–15)
    // ══════════════════════════════════════════════════════════════

    // Ext P3-Q1: Problemstilling structure in introduction
    if (/(?:structure|struktur).*problemstilling.*(?:introduksjon|introduction|innledning)|problemstilling.*(?:general\s+background|smalner|narrowing)/i.test(input)) {
      return '**Korrekt struktur for problemstilling i innledningen:**\n\n' +
        '1. **Generell bakgrunn** — introduser det brede temaet\n' +
        '2. **Innsmalning** — avgrens til spesifikt fokus\n' +
        '3. **Klar problemstilling** — formuler forskningsspørsmålet\n\n' +
        '**Eksempel:**\n' +
        '- Generelt: «Digitalisering endrer utdanningssektoren.»\n' +
        '- Smalner: «Særlig bruk av KI reiser nye spørsmål.»\n' +
        '- Problemstilling: «Hvordan påvirker bruk av KI-verktøy studenters læringsutbytte?»';
    }

    // Ext P3-Q2: When "den røde tråden" breaks
    if (/den\s+røde\s+tråden.*(?:break|brytes|bryte|broken)|(?:break|brytes).*den\s+røde\s+tråden/i.test(input)) {
      return '**«Den røde tråden» brytes når:**\n\n' +
        '- Et **nytt hovedargument** dukker opp i konklusjonen\n' +
        '- Avsnitt mangler logisk forbindelse til hverandre\n' +
        '- Problemstillingen aldri besvares\n' +
        '- Teksten hopper mellom urelaterte temaer\n\n' +
        '**Hvordan opprettholde den:**\n' +
        '- Hvert avsnitt bygger på det forrige\n' +
        '- Bruk overgangssord (videre, dessuten, derimot)\n' +
        '- Hold fokus på problemstillingen hele veien\n' +
        '- Konklusjonen svarer på innledningens spørsmål.';
    }

    // Ext P3-Q3: Point-by-point comparison for two texts (reiteration)
    if (/point.?by.?point.*two\s+texts|to\s+tekster.*punkt\s+for\s+punkt/i.test(input)) {
      return '**Beste punkt-for-punkt-sammenligningsstruktur for to tekster:**\n\n' +
        '**Tema 1** (Tekst A + Tekst B) → **Tema 2** (Tekst A + Tekst B) → **Tema 3** (Tekst A + Tekst B)\n\n' +
        '**Fordeler:**\n' +
        '- Direkte sammenligning av elementer side om side\n' +
        '- Lettere for leseren å se likheter og forskjeller\n' +
        '- Mer analytisk og sofistikert enn blokkstruktur\n\n' +
        '**Alternativ:** Blokkstruktur — alt om Tekst A, deretter alt om Tekst B (enklere men svakere analyse).';
    }

    // Ext P3-Q4: Sentence insertion (KI opplæring)
    if (/(?:forutsetter|imidlertid).*(?:tilstrekkelig\s+opplæring|sufficient\s+training).*(?:insert|fit|passer|belong)|KI.*muligheter.*opplæring.*misbruk/i.test(input)) {
      return '**Riktig svar: Posisjon 2**\n\n' +
        '«Dette forutsetter imidlertid tilstrekkelig opplæring» passer best mellom:\n' +
        '- (1) KI åpner nye muligheter. [påstand]\n' +
        '- (2) ✅ **[HER]** — forbehold/betingelse\n' +
        '- (3) Uten opplæring kan det føre til misbruk. [konsekvens av manglende (2)]\n\n' +
        'Setningen fungerer som en **bro** mellom muligheten (1) og advarselen (3).';
    }

    // Ext P3-Q5: Appeal to popularity (argumentum ad populum)
    if (/(?:studentene\s+liker\s+KI|fordi.*liker.*pedagogisk\s+bra)|(?:appeal\s+to\s+popularity|argumentum\s+ad\s+populum)/i.test(input)) {
      return '**Logisk feil: Appeal to popularity (argumentum ad populum)**\n\n' +
        '«Fordi studentene liker KI, må det være pedagogisk bra.» ❌\n\n' +
        '**Problemet:** At noe er **populært** betyr ikke at det er **effektivt** eller bedre.\n\n' +
        '**Eksempler på denne feilslutningen:**\n' +
        '- «Alle bruker det, så det må være bra.»\n' +
        '- «Det er populært, derfor er det riktig.»\n\n' +
        'Korrekt akademisk tilnærming krever **empirisk evidens**, ikke popularitet.';
    }

    // ══════════════════════════════════════════════════════════════
    //  Norwegian Academic Exam – Writing Tasks (Del 2: Skriftlig produksjon)
    // ══════════════════════════════════════════════════════════════

    // General drøfting about KI in universities
    if (/(?:drøft|diskut|discuss).*(?:KI|kunstig\s+intelligens|AI).*(?:emner|universit|læring|trussel|integrere)/i.test(input)) {
      return '**Drøfting: Bør KI integreres i alle emner ved universitetet?**\n\n' +
        '**Argumenter FOR:**\n' +
        '- Forbedrer tilgangen til kunnskap og individuell tilpasning\n' +
        '- Effektiviserer repetitive oppgaver (oppsummering, søk)\n' +
        '- Forbereder studenter på arbeidslivet der KI er standard\n' +
        '- Kan gi umiddelbar tilbakemelding på studentarbeid\n\n' +
        '**Argumenter IMOT:**\n' +
        '- Risiko for avhengighet og svekket kritisk tenkning\n' +
        '- Plagiatproblematikk og akademisk integritet\n' +
        '- Ujevn tilgang kan forsterke sosiale forskjeller\n' +
        '- Fare for hallusinerte/feil svar som studenter godtar ukritisk\n\n' +
        '**Syntese:** KI bør integreres, men med klare retningslinjer, opplæring i kildekritikk, og fokus på analytisk tenkning fremfor ren reproduksjon.';
    }

    // Gratis kollektivtransport argumentasjon
    if (/(?:gratis\s+kollektiv|free\s+public\s+transport).*(?:klima|argumenter|byer|norge)|kollektiv.*(?:klimamål|gratis)/i.test(input)) {
      return '**Argumentasjon: Bør Norge innføre gratis kollektivtransport?**\n\n' +
        '**FOR:**\n' +
        '- Reduserer bilbruk → lavere CO₂-utslipp\n' +
        '- Sosialt utjevnende — alle får tilgang\n' +
        '- Reduserer trafikkork i byene\n' +
        '- Tallinn (Estland) har vist vellykket modell\n\n' +
        '**IMOT:**\n' +
        '- Enorme kostnader — hvem skal betale?\n' +
        '- Kapasitetsproblemer ved økt etterspørsel\n' +
        '- Bedre investeringer kan være utbygging og hyppigere avganger\n' +
        '- Rurale områder har begrenset kollektivtilbud uansett\n\n' +
        '**Konklusjon:** En balansert tilnærming med reduserte priser, ikke nødvendigvis gratis, kombinert med utbygging av infrastruktur.';
    }

    // Bachelor på engelsk vs norsk drøfting
    if (/bachelor.*(?:engelsk|english).*(?:norsk|norwegian|internasjonal\s+synl)|bacheloroppgaver.*(?:skrives|engelsk)/i.test(input)) {
      return '**Drøfting: Bør bacheloroppgaver skrives på engelsk?**\n\n' +
        '**FOR engelsk:**\n' +
        '- Økt internasjonal synlighet og sitering\n' +
        '- Forbereder studenter på internasjonal akademisk karriere\n' +
        '- Tilgjengelig for internasjonale medstudenter og veiledere\n\n' +
        '**FOR norsk:**\n' +
        '- Bevarer norsk som akademisk fagspråk (domenetap)\n' +
        '- Studenter utrykker seg mer presist på morsmålet\n' +
        '- Relevant for norsk arbeidsliv og forvaltning\n' +
        '- Mange fagtermer mangler gode engelske oversettelser\n\n' +
        '**Syntese:** Valgfrihet med tilpasset veiledning. Engelskspråklige programmer bør ha engelske oppgaver; norskspråklige bør beholde norsk.';
    }

    // Digitalisering og inkludering refleksjon
    if (/digitalisering.*(?:inkludering|nye\s+innbygger|integrering)|(?:inkluder|nye\s+innbygger).*digitalisering.*(?:reflekt|norsk\s+samfunn)/i.test(input)) {
      return '**Refleksjon: Digitalisering og inkludering av nye innbyggere**\n\n' +
        '**Fordeler:**\n' +
        '- Digitale tjenester gir enklere tilgang til offentlige tjenester (NAV, Skatteetaten)\n' +
        '- Norskkurs og integreringsprogram tilgjengelig online\n' +
        '- Apper og nettsider kan oversettes og tilpasses\n\n' +
        '**Utfordringer:**\n' +
        '- Digital kompetanse varierer — ikke alle er digitalt innfødte\n' +
        '- BankID-krav kan være en barriere for nyankomne\n' +
        '- Språkbarrierer i digitale løsninger\n' +
        '- Eldre og sårbare grupper kan falle utenfor\n\n' +
        '**Konklusjon:** Digitaliseringen krever parallelle tilbud — digitalt + fysisk — for å sikre reell inkludering.';
    }

    // Obligatorisk frivillig arbeid for studenter
    if (/(?:obligatorisk\s+frivillig|mandatory\s+volunteering).*(?:student|universit)|frivillig\s+arbeid.*student.*(?:argumenter|bør)/i.test(input)) {
      return '**Argumentasjon: Obligatorisk frivillig arbeid for studenter**\n\n' +
        '**FOR:**\n' +
        '- Bygger empati og samfunnsengasjement\n' +
        '- Relevant arbeidserfaring og nettverksbygging\n' +
        '- Styrker CV og personlig utvikling\n' +
        '- Bidrar positivt til lokalsamfunnet\n\n' +
        '**IMOT:**\n' +
        '- «Obligatorisk frivillig» er en selvmotsigelse\n' +
        '- Studenter har allerede tidspress med studier og jobb\n' +
        '- Kan bli overfladisk hvis folk gjør det bare for å krysse av\n' +
        '- Bør stimuleres med insentiver, ikke tvang\n\n' +
        '**Syntese:** Frivillig arbeid bør oppmuntres gjennom studiepoeng eller stipend, ikke pålegges som obligatorisk.';
    }

    return null;
  }

export function findOptionLetter(input: string, text: string): string {
    const letters = ['A', 'B', 'C', 'D'];
    for (const letter of letters) {
      const regex = new RegExp(`${letter}\\)\\s*([^A-D)]+)`, 'i');
      const m = input.match(regex);
      if (m && m[1].toLowerCase().includes(text.toLowerCase())) {
        return letter;
      }
    }
    return 'A'; // fallback
  }
