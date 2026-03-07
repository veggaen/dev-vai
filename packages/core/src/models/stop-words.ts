/**
 * Bilingual Stop Words — English + Norwegian (Bokmål + Nynorsk)
 *
 * These are "closed-class" words (pronouns, prepositions, conjunctions,
 * auxiliaries) that serve as grammar glue. They rarely change over decades,
 * making this set timeless and stable.
 *
 * Design:
 *   - Separated by language for toggling per-text-language
 *   - Only structural/grammar words — no subjective terms (good, know, well)
 *   - Covers both Bokmål and Nynorsk for full Norwegian inclusivity
 *   - Q&A action verbs included separately for query normalization
 *
 * Sources: NLTK (English), Snowball/Tartarus (Norwegian), Språkrådet
 */

// ── English: NLTK-inspired functional/grammar core ──────────────

export const STOP_WORDS_EN = new Set([
  // Articles & Determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those',
  // Conjunctions
  'and', 'or', 'but', 'nor', 'if', 'because', 'as', 'until', 'while',
  'so', 'yet', 'both', 'either', 'neither',
  // Prepositions
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  // Be / Have / Do auxiliaries
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  // Modal verbs
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  // Pronouns
  'i', 'me', 'my', 'myself', 'we', 'us', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  // Interrogatives
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  // Quantifiers & Others
  'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
  'each', 'every', 'no', 'not', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once',
]);

// ── Norwegian: Bokmål + Nynorsk functional/grammar core ─────────

export const STOP_WORDS_NO = new Set([
  // Conjunctions & Particles
  'og', 'eller', 'men', 'om', 'hvis', 'dersom', 'da', 'då', 'at',
  'fordi', 'enn', 'som', 'så', 'likevel', 'enten', 'verken', 'både',
  // Prepositions
  'i', 'på', 'til', 'fra', 'frå', 'med', 'av', 'for', 'under', 'over',
  'hos', 'ved', 'mellom', 'gjennom', 'etter', 'mot', 'langs', 'blant',
  'innen', 'utenom', 'unntatt',
  // Auxiliary verbs
  'er', 'var', 'vore', 'skal', 'skulle', 'vil', 'ville', 'har', 'hadde',
  'bli', 'blir', 'ble', 'blei', 'blitt', 'vorte',
  'kan', 'kunne', 'må', 'måtte', 'bør', 'burde',
  // Pronouns
  'jeg', 'eg', 'du', 'han', 'hun', 'ho', 'det', 'den', 'vi', 'me',
  'de', 'dei', 'dere', 'dykk', 'meg', 'deg', 'seg', 'oss', 'dem', 'deim',
  'henne', 'hennar', 'hans', 'deira', 'sin', 'si', 'sitt', 'sine',
  // Articles
  'en', 'et', 'ei', 'eit', 'man',
  // Interrogatives
  'hvem', 'kven', 'hva', 'kva', 'hvor', 'kor', 'hvordan', 'korleis',
  'hvorfor', 'kvifor', 'når',
  // Quantifiers & Others
  'alle', 'alt', 'andre', 'noen', 'nokon', 'noe', 'noko',
  'ingen', 'ikkje', 'ikke', 'bare', 'berre', 'også', 'sjølv', 'selv',
]);

// ── Merged bilingual set (English + Norwegian) ──────────────────

export const STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_NO]);

// ── Q&A action verbs (query markers, not topical content) ───────
// These are stripped during query normalization for matching purposes.

export const QUERY_ACTION_WORDS = new Set([
  'explain', 'describe', 'define', 'compare', 'tell', 'show', 'give', 'list',
  'forklar', 'beskriv', 'definer', 'sammenlign', 'fortell', 'vis', 'oppgi',
]);

// ── Topic detection stop words (superset for detectTopic) ───────
// Includes STOP_WORDS + Q&A verbs + common filler words.

export const TOPIC_STOP_WORDS = new Set([
  ...STOP_WORDS,
  ...QUERY_ACTION_WORDS,
  'use', 'using', 'used', 'difference', 'best', 'like',
  'bruk', 'bruker', 'brukt', 'forskjell', 'beste',
]);
