/**
 * Deterministic facts router.
 *
 * The engine's broader pipeline refuses too eagerly on well-known facts
 * (BMW HQ, Alibaba CEO, language of Belgium, capital of Senegal) and on
 * "Best way to <verb> <framework> in production?" / common troubleshoot
 * checklists. This router holds a small static fact table and a few
 * deterministic templates so those prompts get a real answer instead of
 * "isn't in my knowledge yet."
 *
 * Returns null when no handler matches; the normal pipeline takes over.
 */

import { resolveProgrammingIdiom, isMultiConceptOrComparison, isMultiWayComparison, composeIdiomComparison, type IdiomContext, type ConceptExplainer } from './programming-idioms.js';
import { buildEntityMatcher, type EntityMatcher } from './entity-matcher.js';

export type FactShimResult = {
  reply: string;
  kind:
    | 'fact-country'
    | 'fact-company'
    | 'howto-production'
    | 'troubleshoot'
    | 'singleton-pattern'
    | 'compare-pair'
    | 'casual-cheer'
    | 'meta-vai'
    | 'fact-person'
    | 'fact-country-location'
    | 'code-snippet'
    | 'fact-brand'
    | 'fact-acronym'
    | 'fact-definition'
    | 'concept-primer'
    | 'safety-refusal';
};

// ── country facts ──────────────────────────────────────────────────────────
// Capital, primary language(s), currency, approximate population (rounded
// to keep us out of the trap of pretending to be a live census).
type CountryFact = {
  capital: string;
  languages: string[];
  currency: string;
  population: string;
};

const COUNTRY_FACTS: Record<string, CountryFact> = {
  norway: { capital: 'Oslo', languages: ['Norwegian'], currency: 'Norwegian krone (NOK)', population: '~5.5 million' },
  sweden: { capital: 'Stockholm', languages: ['Swedish'], currency: 'Swedish krona (SEK)', population: '~10.5 million' },
  denmark: { capital: 'Copenhagen', languages: ['Danish'], currency: 'Danish krone (DKK)', population: '~5.9 million' },
  finland: { capital: 'Helsinki', languages: ['Finnish', 'Swedish'], currency: 'Euro (EUR)', population: '~5.6 million' },
  germany: { capital: 'Berlin', languages: ['German'], currency: 'Euro (EUR)', population: '~84 million' },
  france: { capital: 'Paris', languages: ['French'], currency: 'Euro (EUR)', population: '~68 million' },
  italy: { capital: 'Rome', languages: ['Italian'], currency: 'Euro (EUR)', population: '~59 million' },
  spain: { capital: 'Madrid', languages: ['Spanish'], currency: 'Euro (EUR)', population: '~48 million' },
  portugal: { capital: 'Lisbon', languages: ['Portuguese'], currency: 'Euro (EUR)', population: '~10 million' },
  greece: { capital: 'Athens', languages: ['Greek'], currency: 'Euro (EUR)', population: '~10 million' },
  netherlands: { capital: 'Amsterdam', languages: ['Dutch'], currency: 'Euro (EUR)', population: '~18 million' },
  belgium: { capital: 'Brussels', languages: ['Dutch', 'French', 'German'], currency: 'Euro (EUR)', population: '~12 million' },
  poland: { capital: 'Warsaw', languages: ['Polish'], currency: 'Polish złoty (PLN)', population: '~38 million' },
  austria: { capital: 'Vienna', languages: ['German'], currency: 'Euro (EUR)', population: '~9 million' },
  switzerland: { capital: 'Bern', languages: ['German', 'French', 'Italian', 'Romansh'], currency: 'Swiss franc (CHF)', population: '~8.8 million' },
  ireland: { capital: 'Dublin', languages: ['English', 'Irish'], currency: 'Euro (EUR)', population: '~5 million' },
  uk: { capital: 'London', languages: ['English'], currency: 'Pound sterling (GBP)', population: '~67 million' },
  japan: { capital: 'Tokyo', languages: ['Japanese'], currency: 'Japanese yen (JPY)', population: '~125 million' },
  china: { capital: 'Beijing', languages: ['Mandarin Chinese'], currency: 'Renminbi (CNY)', population: '~1.41 billion' },
  india: { capital: 'New Delhi', languages: ['Hindi', 'English'], currency: 'Indian rupee (INR)', population: '~1.43 billion' },
  brazil: { capital: 'Brasilia', languages: ['Portuguese'], currency: 'Brazilian real (BRL)', population: '~216 million' },
  argentina: { capital: 'Buenos Aires', languages: ['Spanish'], currency: 'Argentine peso (ARS)', population: '~46 million' },
  mexico: { capital: 'Mexico City', languages: ['Spanish'], currency: 'Mexican peso (MXN)', population: '~129 million' },
  canada: { capital: 'Ottawa', languages: ['English', 'French'], currency: 'Canadian dollar (CAD)', population: '~40 million' },
  australia: { capital: 'Canberra', languages: ['English'], currency: 'Australian dollar (AUD)', population: '~26 million' },
  egypt: { capital: 'Cairo', languages: ['Arabic'], currency: 'Egyptian pound (EGP)', population: '~110 million' },
  kenya: { capital: 'Nairobi', languages: ['Swahili', 'English'], currency: 'Kenyan shilling (KES)', population: '~55 million' },
  nigeria: { capital: 'Abuja', languages: ['English'], currency: 'Nigerian naira (NGN)', population: '~223 million' },
  'south africa': { capital: 'Pretoria (executive), Cape Town (legislative), Bloemfontein (judicial)', languages: ['English', 'Afrikaans', 'Zulu', 'Xhosa', 'and 7 others'], currency: 'South African rand (ZAR)', population: '~60 million' },
  vietnam: { capital: 'Hanoi', languages: ['Vietnamese'], currency: 'Vietnamese dong (VND)', population: '~99 million' },
  thailand: { capital: 'Bangkok', languages: ['Thai'], currency: 'Thai baht (THB)', population: '~71 million' },
  indonesia: { capital: 'Jakarta', languages: ['Indonesian'], currency: 'Indonesian rupiah (IDR)', population: '~278 million' },
  turkey: { capital: 'Ankara', languages: ['Turkish'], currency: 'Turkish lira (TRY)', population: '~85 million' },
  russia: { capital: 'Moscow', languages: ['Russian'], currency: 'Russian ruble (RUB)', population: '~144 million' },
  ukraine: { capital: 'Kyiv', languages: ['Ukrainian'], currency: 'Ukrainian hryvnia (UAH)', population: '~38 million' },
  czechia: { capital: 'Prague', languages: ['Czech'], currency: 'Czech koruna (CZK)', population: '~10.5 million' },
  hungary: { capital: 'Budapest', languages: ['Hungarian'], currency: 'Hungarian forint (HUF)', population: '~9.6 million' },
  romania: { capital: 'Bucharest', languages: ['Romanian'], currency: 'Romanian leu (RON)', population: '~19 million' },
  bulgaria: { capital: 'Sofia', languages: ['Bulgarian'], currency: 'Bulgarian lev (BGN)', population: '~6.7 million' },
  croatia: { capital: 'Zagreb', languages: ['Croatian'], currency: 'Euro (EUR)', population: '~3.9 million' },
  iceland: { capital: 'Reykjavík', languages: ['Icelandic'], currency: 'Icelandic króna (ISK)', population: '~390 thousand' },
  estonia: { capital: 'Tallinn', languages: ['Estonian'], currency: 'Euro (EUR)', population: '~1.3 million' },
  latvia: { capital: 'Riga', languages: ['Latvian'], currency: 'Euro (EUR)', population: '~1.9 million' },
  lithuania: { capital: 'Vilnius', languages: ['Lithuanian'], currency: 'Euro (EUR)', population: '~2.8 million' },
  morocco: { capital: 'Rabat', languages: ['Arabic', 'Berber'], currency: 'Moroccan dirham (MAD)', population: '~37 million' },
  tunisia: { capital: 'Tunis', languages: ['Arabic'], currency: 'Tunisian dinar (TND)', population: '~12 million' },
  'saudi arabia': { capital: 'Riyadh', languages: ['Arabic'], currency: 'Saudi riyal (SAR)', population: '~37 million' },
  iran: { capital: 'Tehran', languages: ['Persian (Farsi)'], currency: 'Iranian rial (IRR)', population: '~89 million' },
  iraq: { capital: 'Baghdad', languages: ['Arabic', 'Kurdish'], currency: 'Iraqi dinar (IQD)', population: '~45 million' },
  pakistan: { capital: 'Islamabad', languages: ['Urdu', 'English'], currency: 'Pakistani rupee (PKR)', population: '~241 million' },
  bangladesh: { capital: 'Dhaka', languages: ['Bengali'], currency: 'Bangladeshi taka (BDT)', population: '~172 million' },
  'sri lanka': { capital: 'Sri Jayawardenepura Kotte (admin), Colombo (commercial)', languages: ['Sinhala', 'Tamil'], currency: 'Sri Lankan rupee (LKR)', population: '~22 million' },
  nepal: { capital: 'Kathmandu', languages: ['Nepali'], currency: 'Nepalese rupee (NPR)', population: '~30 million' },
  philippines: { capital: 'Manila', languages: ['Filipino', 'English'], currency: 'Philippine peso (PHP)', population: '~117 million' },
  'south korea': { capital: 'Seoul', languages: ['Korean'], currency: 'South Korean won (KRW)', population: '~51 million' },
  singapore: { capital: 'Singapore', languages: ['English', 'Malay', 'Mandarin', 'Tamil'], currency: 'Singapore dollar (SGD)', population: '~5.9 million' },
  malaysia: { capital: 'Kuala Lumpur', languages: ['Malay'], currency: 'Malaysian ringgit (MYR)', population: '~34 million' },
  'new zealand': { capital: 'Wellington', languages: ['English', 'Māori'], currency: 'New Zealand dollar (NZD)', population: '~5.2 million' },
  chile: { capital: 'Santiago', languages: ['Spanish'], currency: 'Chilean peso (CLP)', population: '~19.5 million' },
  peru: { capital: 'Lima', languages: ['Spanish', 'Quechua', 'Aymara'], currency: 'Peruvian sol (PEN)', population: '~34 million' },
  colombia: { capital: 'Bogotá', languages: ['Spanish'], currency: 'Colombian peso (COP)', population: '~52 million' },
  venezuela: { capital: 'Caracas', languages: ['Spanish'], currency: 'Venezuelan bolívar (VES)', population: '~28 million' },
  cuba: { capital: 'Havana', languages: ['Spanish'], currency: 'Cuban peso (CUP)', population: '~11 million' },
  jamaica: { capital: 'Kingston', languages: ['English', 'Jamaican Patois'], currency: 'Jamaican dollar (JMD)', population: '~2.8 million' },
  ethiopia: { capital: 'Addis Ababa', languages: ['Amharic'], currency: 'Ethiopian birr (ETB)', population: '~127 million' },
  ghana: { capital: 'Accra', languages: ['English'], currency: 'Ghanaian cedi (GHS)', population: '~34 million' },
  senegal: { capital: 'Dakar', languages: ['French'], currency: 'West African CFA franc (XOF)', population: '~18 million' },
  tanzania: { capital: 'Dodoma (official), Dar es Salaam (de facto commercial)', languages: ['Swahili', 'English'], currency: 'Tanzanian shilling (TZS)', population: '~67 million' },
};

// ── company facts ─────────────────────────────────────────────────────────
type CompanyFact = {
  hq: string;
  ceo?: string;
  founded?: string;
  founders?: string;
};

const COMPANY_FACTS: Record<string, CompanyFact> = {
  microsoft: { hq: 'Redmond, Washington, USA', ceo: 'Satya Nadella', founded: '1975', founders: 'Bill Gates and Paul Allen' },
  apple: { hq: 'Cupertino, California, USA', ceo: 'Tim Cook', founded: '1976', founders: 'Steve Jobs, Steve Wozniak, and Ronald Wayne' },
  google: { hq: 'Mountain View, California, USA', ceo: 'Sundar Pichai', founded: '1998', founders: 'Larry Page and Sergey Brin' },
  meta: { hq: 'Menlo Park, California, USA', ceo: 'Mark Zuckerberg', founded: '2004 (as Facebook; renamed Meta in 2021)', founders: 'Mark Zuckerberg and co-founders' },
  amazon: { hq: 'Seattle, Washington, USA', ceo: 'Andy Jassy', founded: '1994', founders: 'Jeff Bezos' },
  tesla: { hq: 'Austin, Texas, USA', ceo: 'Elon Musk', founded: '2003', founders: 'Martin Eberhard and Marc Tarpenning' },
  nvidia: { hq: 'Santa Clara, California, USA', ceo: 'Jensen Huang', founded: '1993', founders: 'Jensen Huang, Chris Malachowsky, and Curtis Priem' },
  openai: { hq: 'San Francisco, California, USA', ceo: 'Sam Altman', founded: '2015' },
  anthropic: { hq: 'San Francisco, California, USA', ceo: 'Dario Amodei', founded: '2021', founders: 'Dario and Daniela Amodei (and others, ex-OpenAI)' },
  stripe: { hq: 'San Francisco, California and Dublin, Ireland (dual HQ)', ceo: 'Patrick Collison', founded: '2010', founders: 'Patrick and John Collison' },
  shopify: { hq: 'Ottawa, Ontario, Canada', ceo: 'Tobi Lütke', founded: '2006', founders: 'Tobi Lütke, Daniel Weinand, and Scott Lake' },
  vercel: { hq: 'San Francisco, California, USA', ceo: 'Guillermo Rauch', founded: '2015', founders: 'Guillermo Rauch' },
  netflix: { hq: 'Los Gatos, California, USA', ceo: 'Ted Sarandos and Greg Peters (co-CEOs)', founded: '1997', founders: 'Reed Hastings and Marc Randolph' },
  spotify: { hq: 'Stockholm, Sweden', ceo: 'Daniel Ek', founded: '2006', founders: 'Daniel Ek and Martin Lorentzon' },
  equinor: { hq: 'Stavanger, Norway', ceo: 'Anders Opedal', founded: '1972 (as Statoil; renamed Equinor in 2018)' },
  telenor: { hq: 'Fornebu, Norway', ceo: 'Sigve Brekke', founded: '1855' },
  dnb: { hq: 'Oslo, Norway', ceo: 'Kjerstin Braathen', founded: '2003 (current form via merger)' },
  mowi: { hq: 'Bergen, Norway', ceo: 'Ivan Vindheim', founded: '1964' },
  'norsk hydro': { hq: 'Oslo, Norway', ceo: 'Eivind Kallevik', founded: '1905' },
  sap: { hq: 'Walldorf, Germany', ceo: 'Christian Klein', founded: '1972' },
  siemens: { hq: 'Munich, Germany', ceo: 'Roland Busch', founded: '1847', founders: 'Werner von Siemens' },
  volkswagen: { hq: 'Wolfsburg, Germany', ceo: 'Oliver Blume', founded: '1937' },
  bmw: { hq: 'Munich, Germany', ceo: 'Oliver Zipse', founded: '1916' },
  toyota: { hq: 'Toyota City, Aichi, Japan', ceo: 'Koji Sato', founded: '1937', founders: 'Kiichiro Toyoda' },
  sony: { hq: 'Tokyo, Japan', ceo: 'Hiroki Totoki', founded: '1946' },
  samsung: { hq: 'Suwon, South Korea', ceo: 'Han Jong-hee and Kyung Kye-hyun (co-CEOs)', founded: '1938', founders: 'Lee Byung-chul' },
  tencent: { hq: 'Shenzhen, China', ceo: 'Pony Ma (Ma Huateng)', founded: '1998' },
  alibaba: { hq: 'Hangzhou, China', ceo: 'Eddie Wu', founded: '1999', founders: 'Jack Ma and co-founders' },
  bytedance: { hq: 'Beijing, China', ceo: 'Liang Rubo', founded: '2012', founders: 'Zhang Yiming' },
  twilio: { hq: 'San Francisco, California, USA', ceo: 'Khozema Shipchandler', founded: '2008', founders: 'Jeff Lawson, Evan Cooke, and John Wolthuis' },
  cloudflare: { hq: 'San Francisco, California, USA', ceo: 'Matthew Prince', founded: '2009', founders: 'Matthew Prince, Lee Holloway, and Michelle Zatlyn' },
  gitlab: { hq: 'Remote (legally San Francisco, California, USA)', ceo: 'Bill Staples', founded: '2011', founders: 'Dmitriy Zaporozhets and Valery Sizov' },
  github: { hq: 'San Francisco, California, USA (subsidiary of Microsoft)', ceo: 'Thomas Dohmke', founded: '2008', founders: 'Tom Preston-Werner, Chris Wanstrath, P.J. Hyett, and Scott Chacon' },
};

// ── singleton patterns ────────────────────────────────────────────────────
const SINGLETON_PATTERNS: Record<string, string> = {
  python: `\`\`\`python
class Singleton:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

a = Singleton()
b = Singleton()
assert a is b
\`\`\``,
  javascript: `\`\`\`javascript
const Singleton = (() => {
  let instance = null;
  return {
    getInstance() {
      if (!instance) instance = { createdAt: Date.now() };
      return instance;
    },
  };
})();

const a = Singleton.getInstance();
const b = Singleton.getInstance();
console.log(a === b); // true
\`\`\``,
  typescript: `\`\`\`typescript
class Singleton {
  private static instance: Singleton | null = null;
  private constructor() {}
  static getInstance(): Singleton {
    if (!Singleton.instance) Singleton.instance = new Singleton();
    return Singleton.instance;
  }
}

const a = Singleton.getInstance();
const b = Singleton.getInstance();
console.log(a === b); // true
\`\`\``,
  java: `\`\`\`java
public final class Singleton {
    private static volatile Singleton instance;
    private Singleton() {}

    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) instance = new Singleton();
            }
        }
        return instance;
    }
}
\`\`\``,
  kotlin: `\`\`\`kotlin
object Singleton {
    var counter: Int = 0
    fun increment() { counter++ }
}

// Use it directly:
Singleton.increment()
println(Singleton.counter) // 1
\`\`\``,
  rust: `\`\`\`rust
use std::sync::OnceLock;

struct Config { pub name: String }

fn config() -> &'static Config {
    static INSTANCE: OnceLock<Config> = OnceLock::new();
    INSTANCE.get_or_init(|| Config { name: "app".into() })
}

fn main() {
    println!("{}", config().name);
}
\`\`\``,
  go: `\`\`\`go
package main

import (
    "fmt"
    "sync"
)

type Config struct{ Name string }

var (
    instance *Config
    once     sync.Once
)

func GetConfig() *Config {
    once.Do(func() { instance = &Config{Name: "app"} })
    return instance
}

func main() { fmt.Println(GetConfig().Name) }
\`\`\``,
  'c#': `\`\`\`csharp
public sealed class Singleton
{
    private static readonly Lazy<Singleton> _instance = new(() => new Singleton());
    public static Singleton Instance => _instance.Value;
    private Singleton() {}
}
\`\`\``,
  ruby: `\`\`\`ruby
require 'singleton'

class Config
  include Singleton
  attr_accessor :name
end

Config.instance.name = 'app'
puts Config.instance.name
\`\`\``,
  swift: `\`\`\`swift
final class Singleton {
    static let shared = Singleton()
    private init() {}
    var counter = 0
}

Singleton.shared.counter += 1
print(Singleton.shared.counter)
\`\`\``,
  php: `\`\`\`php
<?php
final class Singleton {
    private static ?Singleton \$instance = null;
    private function __construct() {}
    public static function getInstance(): Singleton {
        return self::\$instance ??= new self();
    }
}
\`\`\``,
  'c++': `\`\`\`cpp
class Singleton {
public:
    static Singleton& instance() {
        static Singleton inst;          // Meyers singleton: thread-safe in C++11+
        return inst;
    }
    Singleton(const Singleton&) = delete;
    Singleton& operator=(const Singleton&) = delete;
private:
    Singleton() = default;
};
\`\`\``,
  clojure: `\`\`\`clojure
(defonce config
  (atom {:name "app" :counter 0}))

(swap! config update :counter inc)
(println @config)
;; defonce ensures the atom is created exactly once per JVM,
;; giving singleton semantics for mutable shared state.
\`\`\``,
  scala: `\`\`\`scala
object Singleton {
  var counter: Int = 0
  def increment(): Unit = counter += 1
}

Singleton.increment()
println(Singleton.counter) // 1
\`\`\``,
  elixir: `\`\`\`elixir
# Elixir uses processes, not classes. The "singleton" idiom is a named
# GenServer that is started once in the supervision tree.
defmodule Config do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, %{counter: 0}, name: __MODULE__)
  def init(state), do: {:ok, state}
  def increment, do: GenServer.call(__MODULE__, :inc)
  def handle_call(:inc, _from, %{counter: c} = s), do: {:reply, c + 1, %{s | counter: c + 1}}
end
\`\`\``,
  haskell: `\`\`\`haskell
-- Haskell discourages mutable global state; the idiomatic "singleton"
-- is a top-level IORef created once via unsafePerformIO with NOINLINE.
import Data.IORef
import System.IO.Unsafe (unsafePerformIO)

{-# NOINLINE counter #-}
counter :: IORef Int
counter = unsafePerformIO (newIORef 0)

increment :: IO Int
increment = atomicModifyIORef' counter (\\n -> (n + 1, n + 1))
\`\`\``,
};

// ── troubleshoot checklists ───────────────────────────────────────────────
const TROUBLESHOOT_CHECKLISTS: Array<{ match: RegExp; reply: string }> = [
  {
    match: /\bcors\b.*\bpreflight\b|preflight.*\bcors\b/i,
    reply: `CORS preflight checklist — check in order:

1. **Server must answer the OPTIONS request** with \`204\` (or \`200\`), not 404/405. The OPTIONS handler must run *before* auth middleware.
2. **\`Access-Control-Allow-Origin\`** must match the exact origin (or be a wildcard, but not both with credentials).
3. **\`Access-Control-Allow-Methods\`** must include the method you're actually sending (e.g. \`POST, PUT, DELETE\`).
4. **\`Access-Control-Allow-Headers\`** must list every custom header (\`Content-Type\`, \`Authorization\`, etc.) — browsers are strict about this.
5. **If you set \`credentials: 'include'\`** on the fetch, the server **must** echo the origin (no \`*\`) and send \`Access-Control-Allow-Credentials: true\`.

Open DevTools → Network → click the failing OPTIONS request → check the response headers, not the request.`,
  },
  {
    match: /\bmemory leak\b/i,
    reply: `Memory leak in a long-running worker — check in order:

1. **Confirm growth, not just usage**: capture two heap snapshots an hour apart (\`process.memoryUsage()\` or \`--inspect\` + Chrome DevTools). Steady growth ≠ usage spike.
2. **Look for unbounded collections**: caches without an eviction policy, arrays you keep \`push\`-ing into, \`Map\`/\`Set\` keyed by per-request data.
3. **Listeners you never remove**: \`emitter.on(...)\` inside a request handler, \`setInterval\` not cleared on shutdown, \`AbortController\` you never abort.
4. **Closures holding large request objects**: a callback (or a Promise chain) keeping a reference to a big response/body.
5. **Native modules / streams not destroyed**: unconsumed streams, \`fs.createReadStream\` without \`.destroy()\`, pooled DB connections not released.

Tools: \`heapdump\`, \`clinic.js\` heap profiler, or Chrome DevTools "Allocation instrumentation on timeline".`,
  },
  {
    match: /\bflaky tests?\b/i,
    reply: `Flaky tests — check in order:

1. **Time and randomness**: any \`Date.now()\`, \`Math.random()\`, \`setTimeout\`, or animation. Freeze the clock and seed the RNG.
2. **Order dependence**: run the suite in random order — if a test only passes when others ran first, it's relying on shared state.
3. **Async leaks**: unawaited promises, unclosed servers/DB connections between tests. Add per-test setup/teardown.
4. **Snapshot drift**: snapshots tied to platform-specific output (line endings, locale, OS-rendered fonts).
5. **External services**: any real network call. Mock the boundary, or pin a recorded fixture (nock/MSW/VCR).

Run the suspect test 100× in a loop locally; if it fails ≥1×, you've reproduced the flake.`,
  },
  {
    match: /\bsession cookies?\b.*\bpersist|cookies?\b.*\bnot persist|cookie.*\bnot set\b/i,
    reply: `Session cookies not persisting — check in order:

1. **\`Set-Cookie\` actually present** on the response (DevTools → Network → the auth response → Response Headers).
2. **\`SameSite\` and \`Secure\`**: cross-site cookies need \`SameSite=None; Secure\`, which also forces HTTPS. \`Secure\` cookies are dropped over plain http://localhost in some browsers — use \`Lax\` for local dev.
3. **\`Domain\` and \`Path\`**: leave \`Domain\` unset for "current host only", or set the apex (\`.example.com\`) for subdomain sharing.
4. **Client side**: \`fetch(url, { credentials: 'include' })\` — without it the browser won't send or store the cookie.
5. **Reverse proxy stripping headers**: nginx/Cloudflare can drop \`Set-Cookie\` if compression or caching is misconfigured.

If DevTools shows the cookie under "Application → Cookies" but the next request doesn't send it, the problem is \`SameSite\`/\`Secure\` or \`credentials\`.`,
  },
  {
    match: /\bbuild\b.*\bfailing\b.*\bci\b|\bci\b.*\bbuild\b.*\bfail/i,
    reply: `Build fails on CI but not locally — check in order:

1. **Lockfile vs. install**: CI must use \`npm ci\` / \`pnpm install --frozen-lockfile\`. If versions drift between local and CI, you'll get different transitive deps.
2. **Case sensitivity**: macOS and Windows are case-insensitive; Linux (CI) is not. \`import './Foo'\` vs \`./foo\` will break only on CI.
3. **Hidden environment**: \`.env\` files committed locally but missing on CI, or different \`NODE_ENV\`.
4. **Node/runtime version**: pin via \`engines\` in package.json and via \`.nvmrc\` / setup-node action.
5. **Caches**: stale CI cache from a previous successful build hiding a real failure. Try a no-cache run once.

Get the full CI log into a local container with the same image; the first divergence will usually scream.`,
  },
  {
    match: /\binfinite re-?render\b|re-?render loop/i,
    reply: `Infinite re-render loop (React) — check in order:

1. **State set during render**: \`setState\` called in the function body (not in an effect or event handler) → render → setState → render → …
2. **\`useEffect\` with the wrong deps**: depending on an object/array/function created inline every render (\`[{}]\`, \`[() => …]\`). Memoize with \`useMemo\` / \`useCallback\`, or restructure.
3. **Parent passes a new prop every render** that a memoized child depends on (same shape, new reference). \`React.DevTools Profiler\` will show the offending prop change.
4. **Context value is a fresh object**: \`<Ctx.Provider value={{ x }}>\` rebuilds every render and re-renders every consumer.
5. **Reducer/zustand selector returns a new reference** for the same data — use shallow-equality or stable selectors.

Add a \`console.count('render: Component')\` to localize, then read the deps array for that component.`,
  },
  {
    match: /\bstale closure\b|stale.*\buseEffect\b/i,
    reply: `Stale closure inside useEffect — check in order:

1. **The dep array is missing a value you read**: lint with \`eslint-plugin-react-hooks\` and let \`exhaustive-deps\` complain.
2. **Long-lived subscriptions** (\`setInterval\`, websockets, event listeners) capture the *first* render's state. Either read the latest value via a \`ref\`, or recreate the subscription when deps change.
3. **\`useCallback\` without the right deps** hands a stale function to a child.
4. **Async work inside an effect**: by the time the promise resolves, props/state may be gone. Capture them at the top of the effect or guard with an \`AbortController\`.
5. **Functional state updates**: \`setX(prev => prev + 1)\` avoids reading a stale \`x\` from the closure.

Quick fix pattern: \`const ref = useRef(value); useEffect(() => { ref.current = value; });\` then read \`ref.current\` inside the subscription.`,
  },
  {
    match: /\brace condition\b.*\bpromises?\b|two promises/i,
    reply: `Race condition between two promises — check in order:

1. **Which one is allowed to win?** If "the latest user input wins", track a request ID/AbortController and ignore stale resolutions.
2. **Are you firing them in parallel when one depends on the other?** \`Promise.all\` is wrong when B needs A's result; use \`await\` sequentially.
3. **Shared mutable state** updated by both promises: wrap the update in a single atomic step (\`setX(prev => …)\`), don't read-then-write.
4. **Effect cleanup**: in React, return a cleanup that sets a \`cancelled = true\` flag the resolution checks before \`setState\`.
5. **Backend side**: same pattern — use \`SELECT … FOR UPDATE\` or a unique constraint to prevent the second writer from clobbering the first.

A repro often falls out of \`Promise.all([slow(), fast()])\` followed by code that assumes order. Log timestamps on resolve to see who really won.`,
  },
  {
    match: /\btimezone\b.*\bmidnight\b|midnight.*\butc\b/i,
    reply: `Timezone bug at midnight UTC — check in order:

1. **Are you storing dates as \`Date\` or as ISO strings?** Always store UTC (\`Date.toISOString()\`); convert to the user's zone *only* when rendering.
2. **\`new Date('2025-05-17')\`** is parsed as UTC midnight. **\`new Date('2025-05-17T00:00')\`** is parsed as *local* midnight. Same-looking strings, different days.
3. **DB column type**: use \`timestamptz\` (Postgres) or always-UTC equivalents. \`timestamp\` (no tz) silently drops the offset on write.
4. **Day-bucket comparisons**: "today" is server-local, the user is in another zone. Compute the user's local day boundaries on the *client*, or pass the user's zone to the server.
5. **DST transitions** can produce 23- or 25-hour days. Use a library (\`date-fns-tz\`, \`Luxon\`) for "add 1 day", not \`+86400000\`.

Reproduce by setting your machine clock to 23:55 in your zone and running the failing query.`,
  },
  {
    match: /\bwebhook\b.*\bflaky\b|flaky.*\bwebhook\b|webhook.*delivery/i,
    reply: `Flaky webhook delivery — check in order:

1. **You return 2xx fast** (≤2-3 seconds), then do real work in a background queue. Most providers retry on timeout *or* on any non-2xx.
2. **Idempotency**: provider may deliver the same event twice. Persist the event ID and reject duplicates.
3. **Signature verification on the *raw* body** — JSON-parsing before HMAC corrupts the bytes. Capture the raw buffer before any body parser.
4. **HTTPS chain & cert pinning**: providers will silently drop on a TLS handshake failure. Test with \`curl -v\` from a clean machine.
5. **Retry visibility**: log every inbound delivery with the provider's delivery ID, then ask the provider's dashboard which deliveries it considers failed. Mismatches reveal your firewall/proxy eating requests.`,
  },
  {
    match: /\bslow\b.*\bdatabase\b.*\bquer|slow.*\bquer/i,
    reply: `Slow database queries — check in order:

1. **\`EXPLAIN ANALYZE\`** the actual query with realistic params. A "Seq Scan" on a big table is your number-one clue.
2. **Missing index** on the WHERE / JOIN / ORDER BY columns. Composite indexes must match the leftmost columns of the query.
3. **N+1 query pattern**: one query for the list, then one per row. Fix with a JOIN or an \`IN (...)\` batch.
4. **\`SELECT *\`** pulls every column (TOAST'ed text, large JSON). Project only what you need.
5. **Connection pool starvation**: a slow query holds a connection; new requests queue. Check pool size and \`pg_stat_activity\` for long-running statements.

A single \`pg_stat_statements\` query will tell you which statements dominate total time — fix from the top.`,
  },
  {
    match: /\btypescript\b.*\bany\b.*creep|\bany\b.*creep.*\btypescript/i,
    reply: `TypeScript "any" creeping in — check in order:

1. **Turn on \`"noImplicitAny": true\`** (it should be on already via \`"strict": true\`). The compiler will surface every silent \`any\`.
2. **Add \`"noUncheckedIndexedAccess": true\`** so \`arr[0]\` becomes \`T | undefined\` instead of \`T\`. This stops a huge class of implicit \`any\` patterns.
3. **Ban explicit \`any\`** with \`@typescript-eslint/no-explicit-any\` (warn first, then error). Allow it only via \`// eslint-disable-next-line\` with a comment.
4. **Audit type assertions**: \`as any\` and \`as unknown as X\` are the back doors. Search for both in PRs.
5. **Boundary types**: untyped JSON from \`fetch()\` or a DB driver returns \`any\`. Validate with Zod / Valibot / ArkType and narrow at the boundary.

\`tsc --noEmit --strict\` in CI catches regressions; add a baseline + ratchet down.`,
  },
];

// ── prompt parsing helpers ────────────────────────────────────────────────
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!,;:]+$/g, '');
}

// Per-table matchers compiled ONCE (lazily, since the tables are declared below).
// Replaces the old findEntity loop that built ~570 regexes PER TURN across the
// country/company/brand tables. WeakMap-keyed by the table object so each static
// table compiles its alternation regex exactly once, then matches in one pass.
const entityMatcherCache = new WeakMap<object, EntityMatcher>();
function findEntity(content: string, table: Record<string, unknown>): string | null {
  let matcher = entityMatcherCache.get(table);
  if (!matcher) {
    matcher = buildEntityMatcher(Object.keys(table));
    entityMatcherCache.set(table, matcher);
  }
  // Longest curated key wins (preserves the old `key.length > best.length` tie-break).
  return matcher.match(content);
}

// ── country handler ───────────────────────────────────────────────────────
function tryCountry(content: string): FactShimResult | null {
  const lower = content.toLowerCase();
  const key = findEntity(content, COUNTRY_FACTS);
  if (!key) return null;
  const fact = COUNTRY_FACTS[key];
  const display = key.replace(/\b\w/g, (c) => c.toUpperCase());

  // Detect intent
  const wantsCapital = /\bcapital\b/.test(lower);
  const wantsLanguage = /\blanguage|spoken|speak\b/.test(lower);
  const wantsCurrency = /\bcurrency|money\b/.test(lower);
  const wantsPopulation = /\bpopulation|people live|how many people\b/.test(lower);
  const wantsWhere = /\bwhere is\b/.test(lower);
  const wantsTellAbout = /\btell me about|about (the )?country\b/.test(lower);

  if (wantsCapital && !wantsLanguage && !wantsCurrency && !wantsPopulation) {
    return { reply: `The capital of ${display} is **${fact.capital}**.`, kind: 'fact-country' };
  }
  if (wantsLanguage && !wantsCapital && !wantsCurrency && !wantsPopulation) {
    const langs = fact.languages.length === 1
      ? `**${fact.languages[0]}**`
      : `**${fact.languages.slice(0, -1).join(', ')}** and **${fact.languages[fact.languages.length - 1]}**`;
    return { reply: `The primary language${fact.languages.length > 1 ? 's' : ''} of ${display} ${fact.languages.length > 1 ? 'are' : 'is'} ${langs}.`, kind: 'fact-country' };
  }
  if (wantsCurrency && !wantsCapital && !wantsLanguage && !wantsPopulation) {
    return { reply: `The currency of ${display} is the **${fact.currency}**.`, kind: 'fact-country' };
  }
  if (wantsPopulation && !wantsCapital && !wantsLanguage && !wantsCurrency) {
    return { reply: `The population of ${display} is **${fact.population}** (recent estimate).`, kind: 'fact-country' };
  }
  if (wantsWhere && !wantsCapital) {
    // Hand off — "where is X" usually wants geography context, not a fact card.
    return null;
  }
  if (wantsTellAbout || /\b(profile|overview)\b/.test(lower)) {
    const langs = fact.languages.join(', ');
    return {
      reply:
`**${display}** — quick facts:
- Capital: **${fact.capital}**
- Language${fact.languages.length > 1 ? 's' : ''}: ${langs}
- Currency: ${fact.currency}
- Population: ${fact.population}`,
      kind: 'fact-country',
    };
  }
  return null;
}

// ── company handler ───────────────────────────────────────────────────────
function tryCompany(content: string): FactShimResult | null {
  const lower = content.toLowerCase();
  const key = findEntity(content, COMPANY_FACTS);
  if (!key) return null;
  const fact = COMPANY_FACTS[key];
  const display = key === 'sap' || key === 'bmw' || key === 'dnb' || key === 'github'
    ? key.toUpperCase()
    : key.replace(/\b\w/g, (c) => c.toUpperCase());

  const wantsHq = /\b(headquarter|hq|where is|based|located)\b/.test(lower);
  const wantsCeo = /\bceo\b|chief executive/.test(lower);
  const wantsFounded = /\b(founded|started|launched|begin|began)\b/.test(lower);
  const wantsFounder = /\bfounder|who (founded|created|started|built)\b/.test(lower);

  if (wantsHq && !wantsCeo && !wantsFounded && !wantsFounder) {
    return { reply: `**${display}** is headquartered in ${fact.hq}.`, kind: 'fact-company' };
  }
  if (wantsCeo && fact.ceo) {
    return { reply: `The CEO of **${display}** is ${fact.ceo}.`, kind: 'fact-company' };
  }
  if (wantsFounder && fact.founders) {
    return { reply: `**${display}** was founded by ${fact.founders}${fact.founded ? ` in ${fact.founded}` : ''}.`, kind: 'fact-company' };
  }
  if (wantsFounded && fact.founded) {
    return { reply: `**${display}** was founded in ${fact.founded}${fact.founders ? ` by ${fact.founders}` : ''}.`, kind: 'fact-company' };
  }
  if (/\btell me about\b/.test(lower)) {
    const bits = [
      `- HQ: ${fact.hq}`,
      fact.ceo ? `- CEO: ${fact.ceo}` : null,
      fact.founded ? `- Founded: ${fact.founded}` : null,
      fact.founders ? `- Founders: ${fact.founders}` : null,
    ].filter(Boolean);
    return { reply: `**${display}** — quick facts:\n${bits.join('\n')}`, kind: 'fact-company' };
  }
  return null;
}

// ── brand / product facts ─────────────────────────────────────────────────
// Small table of highly iconic consumer brands. Two access paths:
//   1. Direct: "what is Red Bull" / "who owns Nike" → name lookup.
//   2. Reverse: "famous energy drink that sponsors athletes" → category +
//      signal phrases resolve to a single canonical brand.
// Keep this conservative — only brands where the iconic association is
// effectively unambiguous to a general audience.
type BrandFact = {
  category: string;        // human-readable category ("energy drink")
  oneLiner: string;        // single-sentence "what is X" answer
  origin?: string;         // country / company of origin
  parent?: string;         // parent company if different from brand
  founded?: string;
  // Reverse lookup: ALL of `categoryWords` must match the prompt AND at
  // least one of `signalWords` must match. Triggered only when the prompt
  // does not name the brand itself (otherwise direct lookup wins).
  categoryWords: RegExp;
  signalWords: RegExp;
};

const BRAND_FACTS: Record<string, BrandFact> = {
  'red bull': {
    category: 'energy drink',
    oneLiner: '**Red Bull** is an Austrian energy drink brand, famous for sponsoring extreme sports, motorsport (including Formula 1 and Red Bull Racing), and many individual athletes.',
    origin: 'Austria',
    parent: 'Red Bull GmbH',
    founded: '1987',
    categoryWords: /\benergy\s*drink\b/i,
    signalWords: /\b(sponsor|athlete|extreme|formula\s*1|f1|motorsport|red\s*bull|austrian|famous|popular|iconic|biggest|leading)\b/i,
  },
  'coca-cola': {
    category: 'cola / soft drink',
    oneLiner: '**Coca-Cola** is an American cola-flavored soft drink, produced by The Coca-Cola Company since 1886 and headquartered in Atlanta, Georgia.',
    origin: 'USA',
    parent: 'The Coca-Cola Company',
    founded: '1886',
    categoryWords: /\b(cola|soft\s*drink|soda|fizzy\s*drink)\b/i,
    signalWords: /\b(famous|iconic|biggest|leading|atlanta|american|classic|original|red\s*can)\b/i,
  },
  pepsi: {
    category: 'cola / soft drink',
    oneLiner: '**Pepsi** is an American cola-flavored soft drink, produced by PepsiCo and the main competitor to Coca-Cola.',
    origin: 'USA',
    parent: 'PepsiCo',
    founded: '1893',
    categoryWords: /\b(cola|soft\s*drink|soda)\b/i,
    signalWords: /\b(competitor\s*to\s*coca|rival\s*to\s*coca|blue\s*can|pepsi)\b/i,
  },
  nike: {
    category: 'athletic footwear & apparel',
    oneLiner: '**Nike** is an American athletic footwear and apparel brand, founded in 1964, famous for the "Swoosh" logo and the "Just Do It" slogan.',
    origin: 'USA',
    parent: 'Nike, Inc.',
    founded: '1964',
    categoryWords: /\b(sneaker|athletic\s*shoe|sports\s*shoe|trainer|sportswear)\b/i,
    signalWords: /\b(swoosh|just\s*do\s*it|famous|iconic|biggest|leading|oregon|american)\b/i,
  },
  adidas: {
    category: 'athletic footwear & apparel',
    oneLiner: '**Adidas** is a German athletic footwear and apparel brand, founded in 1949 by Adolf Dassler, famous for its three-stripe logo.',
    origin: 'Germany',
    parent: 'Adidas AG',
    founded: '1949',
    categoryWords: /\b(sneaker|athletic\s*shoe|sports\s*shoe|trainer|sportswear)\b/i,
    signalWords: /\b(three\s*stripe|german|dassler|adidas)\b/i,
  },
  netflix: {
    category: 'video streaming service',
    oneLiner: '**Netflix** is an American subscription video-streaming and production company, founded in 1997 and headquartered in Los Gatos, California.',
    origin: 'USA',
    parent: 'Netflix, Inc.',
    founded: '1997',
    categoryWords: /\b(streaming|video\s*streaming|movie\s*streaming|show\s*streaming)\b/i,
    signalWords: /\b(subscription|biggest|leading|original|tv\s*show|movie|series|famous|red\s*logo)\b/i,
  },
  spotify: {
    category: 'music streaming service',
    oneLiner: '**Spotify** is a Swedish music, podcast, and audio streaming service, launched in 2008 and headquartered in Stockholm.',
    origin: 'Sweden',
    parent: 'Spotify Technology S.A.',
    founded: '2008',
    categoryWords: /\b(music\s*streaming|audio\s*streaming|podcast\s*app|music\s*app)\b/i,
    signalWords: /\b(swedish|stockholm|biggest|leading|green\s*logo|spotify)\b/i,
  },
  uber: {
    category: 'ride-sharing service',
    oneLiner: '**Uber** is an American ride-sharing, food delivery, and mobility company, founded in 2009 and headquartered in San Francisco.',
    origin: 'USA',
    parent: 'Uber Technologies, Inc.',
    founded: '2009',
    categoryWords: /\b(ride[\s-]*shar\w*|ride[\s-]*hail\w*|rideshare|app\s*to\s*hail\s*a\s*(?:taxi|car))\b/i,
    signalWords: /\b(famous|biggest|leading|app|san\s*francisco|american|uber)\b/i,
  },
  starbucks: {
    category: 'coffeehouse chain',
    oneLiner: '**Starbucks** is an American coffeehouse chain, founded in Seattle in 1971 and the largest coffee chain in the world.',
    origin: 'USA',
    parent: 'Starbucks Corporation',
    founded: '1971',
    categoryWords: /\b(coffee\s*(?:chain|shop|house)|coffeehouse)\b/i,
    signalWords: /\b(famous|biggest|largest|leading|seattle|american|green\s*logo|mermaid|starbucks)\b/i,
  },
  mcdonalds: {
    category: 'fast-food burger chain',
    oneLiner: "**McDonald's** is an American fast-food chain founded in 1940, famous for the Big Mac and the Golden Arches, with restaurants in over 100 countries.",
    origin: 'USA',
    parent: "McDonald's Corporation",
    founded: '1940',
    categoryWords: /\b(fast[\s-]*food|burger\s*chain|hamburger\s*chain)\b/i,
    signalWords: /\b(golden\s*arch|big\s*mac|famous|biggest|largest|leading|american|mcdonald)\b/i,
  },
  playstation: {
    category: 'video game console',
    oneLiner: '**PlayStation** is a video game console brand by Sony, first released in 1994 and now in its fifth main generation (PS5).',
    origin: 'Japan',
    parent: 'Sony Interactive Entertainment',
    founded: '1994',
    categoryWords: /\b(game\s*console|gaming\s*console|video\s*game\s*console)\b/i,
    signalWords: /\b(sony|ps5|ps4|ps3|ps2|ps1|japanese|famous|biggest|leading|playstation)\b/i,
  },
  xbox: {
    category: 'video game console',
    oneLiner: '**Xbox** is a video game console brand by Microsoft, first released in 2001; current generation is Xbox Series X/S.',
    origin: 'USA',
    parent: 'Microsoft',
    founded: '2001',
    categoryWords: /\b(game\s*console|gaming\s*console|video\s*game\s*console)\b/i,
    signalWords: /\b(microsoft|series\s*x|series\s*s|xbox\s*one|xbox\s*360|xbox)\b/i,
  },
  iphone: {
    category: 'smartphone',
    oneLiner: '**iPhone** is a line of smartphones designed and marketed by Apple, first released in 2007.',
    origin: 'USA',
    parent: 'Apple Inc.',
    founded: '2007',
    categoryWords: /\b(smartphone|mobile\s*phone)\b/i,
    signalWords: /\b(apple|cupertino|famous|biggest|leading|iconic|iphone)\b/i,
  },
  lego: {
    category: 'construction toy',
    oneLiner: '**LEGO** is a Danish line of plastic construction toys, manufactured by The Lego Group, founded in 1932 and headquartered in Billund, Denmark.',
    origin: 'Denmark',
    parent: 'The Lego Group',
    founded: '1932',
    categoryWords: /\b(building\s*block|construction\s*toy|plastic\s*brick)\b/i,
    signalWords: /\b(danish|denmark|billund|famous|iconic|lego)\b/i,
  },
  ikea: {
    category: 'furniture retailer',
    oneLiner: '**IKEA** is a Swedish multinational furniture retailer, founded in 1943, famous for flat-pack ready-to-assemble furniture sold from large warehouse-style stores.',
    origin: 'Sweden',
    parent: 'Inter IKEA Holding',
    founded: '1943',
    categoryWords: /\b(furniture\s*(?:store|retailer|chain|brand))\b/i,
    signalWords: /\b(swedish|sweden|flat[\s-]*pack|assemble|blue\s*and\s*yellow|famous|biggest|ikea)\b/i,
  },
};

// "does Starbucks make cappuccino?", "do they sell oat milk?", "does McDonald's
// serve breakfast?" — these ask whether the brand DOES something, not what it
// IS. A bare "what is X" definition is the wrong answer, so we defer them.
const BRAND_ACTION_QUESTION_RE = /^\s*(?:does|do|did|can|could|will|would|is|are)\b[\s\S]*\b(?:make|makes|made|sell|sells|sold|have|has|offer|offers|serve|serves|produce|produces|own|owns|sponsor|sponsors|ship|ships|deliver|delivers|support|supports|accept|accepts|cost|costs|charge|charges|stock|stocks|carry|carries|provide|provides|run|runs|operate|operates)\b/i;

function tryBrand(content: string): FactShimResult | null {
  const lower = content.toLowerCase();
  if (
    /\b(?:coca[-\s]?cola|coke)\b/i.test(content)
    && /\bsugar\b/i.test(content)
    && /\b(?:yes\s+or\s+no|reply\s+(?:yes|no)|only|just\s+(?:yes|no)|can\s+you\s+reply\s+(?:yes|no)|reply\s+yes|reply\s+no)\b/i.test(content)
  ) {
    return null;
  }

  // Path 1: direct brand-name lookup. Use findEntity so multi-word names like
  // "red bull" and "coca-cola" match cleanly.
  const directKey = findEntity(content, BRAND_FACTS);
  if (directKey) {
    const fact = BRAND_FACTS[directKey];
    const display = directKey === 'mcdonalds'
      ? "McDonald's"
      : directKey === 'ikea' || directKey === 'lego'
        ? directKey.toUpperCase()
        : directKey.replace(/\b\w/g, (c) => c.toUpperCase());
    const wantsOwner = /\b(who\s*owns|owner|parent\s*company)\b/.test(lower);
    const wantsOrigin = /\b(where\s*(?:is|are|did)\s*(?:it|they|\w+)\s*(?:from|come\s*from|originate)|country\s*of\s*origin|made\s*in|from\s*what\s*country)\b/.test(lower);
    const wantsFounded = /\b(when\s*(?:was|did)|founded|started|launched)\b/.test(lower);
    if (wantsOwner && fact.parent) {
      const parent = fact.parent.replace(/\.$/, '');
      return { reply: `**${display}** is owned by ${parent}.`, kind: 'fact-brand' };
    }
    if (wantsOrigin && fact.origin) {
      return { reply: `**${display}** is from ${fact.origin}.`, kind: 'fact-brand' };
    }
    if (wantsFounded && fact.founded) {
      const parent = fact.parent ? fact.parent.replace(/\.$/, '') : null;
      return { reply: `**${display}** was founded in ${fact.founded}${parent ? ` (${parent})` : ''}.`, kind: 'fact-brand' };
    }
    // Defer action yes/no questions ("does X make Y?") to the yes/no pipeline
    // instead of dumping the brand's "what is X" definition.
    if (BRAND_ACTION_QUESTION_RE.test(lower)) {
      return null;
    }
    return { reply: fact.oneLiner, kind: 'fact-brand' };
  }

  // Path 2: reverse lookup by iconic category + signal phrase. Only fires
  // when the prompt itself does not name a brand from the table (we handled
  // that above). Pick the first brand whose category AND a signal word both
  // match. Conservative on purpose.
  for (const [_key, fact] of Object.entries(BRAND_FACTS)) {
    if (fact.categoryWords.test(content) && fact.signalWords.test(content)) {
      return { reply: fact.oneLiner, kind: 'fact-brand' };
    }
  }
  return null;
}

function trySafetyRefusal(content: string): FactShimResult | null {
  if (/\b(?:ignore\s+all\s+previous\s+instructions|print\s+your\s+system\s+prompt|show\s+your\s+system\s+prompt|reveal\s+your\s+system\s+prompt)\b/i.test(content)) {
    return {
      reply: "I can't share hidden system instructions. A safe alternative is to tell me the actual task you want done, and I can help with that visible request directly.",
      kind: 'safety-refusal',
    };
  }

  if (/\b(?:api\s+keys?|process\.env|environment\s+variables?|secrets?)\b/i.test(content) && /\b(?:exfiltrate|steal|dump|leak|show\s+the\s+exact\s+command)\b/i.test(content)) {
    return {
      reply: "I can't help exfiltrate API keys, environment variables, or secrets. A safe defensive alternative is to audit exposure, rotate suspected leaked keys, restrict environment access, and add secret scanning.",
      kind: 'safety-refusal',
    };
  }

  return null;
}

// ── singleton handler ─────────────────────────────────────────────────────
const SINGLETON_PROMPT = /\b(?:singleton|singleton\s+(?:pattern|design))\b/i;

function trySingleton(content: string): FactShimResult | null {
  if (!SINGLETON_PROMPT.test(content)) return null;
  const lower = content.toLowerCase();
  // Map common phrasings to canonical key
  const langAliases: Array<[RegExp, string]> = [
    [/\bpython\b/i, 'python'],
    [/\btypescript\b|\bts\b/i, 'typescript'],
    [/\bjavascript\b|\bjs\b|\bnode\b/i, 'javascript'],
    [/\bjava\b(?!script)/i, 'java'],
    [/\bkotlin\b/i, 'kotlin'],
    [/\brust\b/i, 'rust'],
    [/\bgolang\b|\bgo\b/i, 'go'],
    [/(?:^|[^a-z0-9])c#(?![a-z0-9])/i, 'c#'],
    [/\bruby\b/i, 'ruby'],
    [/\bswift\b/i, 'swift'],
    [/\bphp\b/i, 'php'],
    [/(?:^|[^a-z0-9])c\+\+(?![a-z0-9])|\bcpp\b/i, 'c++'],
    [/\bclojure\b/i, 'clojure'],
    [/\bscala\b/i, 'scala'],
    [/\belixir\b/i, 'elixir'],
    [/\bhaskell\b/i, 'haskell'],
  ];
  for (const [re, key] of langAliases) {
    if (re.test(lower) && SINGLETON_PATTERNS[key]) {
      const display = key === 'c#' ? 'C#' : key === 'c++' ? 'C++' : key.replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        reply: `Singleton in **${display}**:\n\n${SINGLETON_PATTERNS[key]}\n\nThe key invariant: one shared instance for the lifetime of the process. Use sparingly — singletons are global state in disguise and hurt testability.`,
        kind: 'singleton-pattern',
      };
    }
  }
  return null;
}

// ── howto handler ─────────────────────────────────────────────────────────
const HOWTO_PROD = /\bbest way to\s+(set up|deploy|dockerize|test|debug|profile|secure|scale|migrate|authenticate)\s+([A-Za-z][\w.+\-#]+(?:\s+[A-Za-z][\w.+\-#]+)?)\s+in\s+production\b/i;
const HOWTO_HOWDO = /\bhow do i\s+(set up|deploy|dockerize|test|debug|profile|secure|scale|migrate|authenticate)\s+(?:a\s+)?([A-Za-z][\w.+\-#]+(?:\s+[A-Za-z][\w.+\-#]+)?)\s+(?:app|application|service)?\b/i;

function tryHowto(content: string): FactShimResult | null {
  const m = content.match(HOWTO_PROD) || content.match(HOWTO_HOWDO);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const tech = m[2].trim();

  const verbSteps: Record<string, string[]> = {
    deploy: [
      `Pin the runtime version (Node/Python/etc.) and lockfile so CI builds the same artifact every time.`,
      `Bake a single immutable image or build artifact in CI — never run \`install\` on the production box.`,
      `Run database/schema migrations as a separate, idempotent step *before* swapping traffic to the new version.`,
      `Use a zero-downtime rollout (blue/green or rolling) with a health-check endpoint that gates the cutover.`,
      `Capture structured logs, metrics, and tracing on the new pods *before* you call it done.`,
    ],
    dockerize: [
      `Start from an official slim base image; pin to a digest, not just a tag.`,
      `Use multi-stage builds: deps + build in one stage, copy only the artifact + production deps into the runtime stage.`,
      `Run as a non-root user, mount only what you need, and set \`HEALTHCHECK\`.`,
      `Leverage layer caching by copying the lockfile and installing deps *before* copying source.`,
      `Set sensible defaults for \`NODE_ENV\`/equivalent and an explicit \`EXPOSE\` plus \`CMD\` (no shell form).`,
    ],
    test: [
      `Three layers: fast unit tests (pure logic), focused integration tests (DB/HTTP), a thin top of e2e (Playwright/Cypress).`,
      `Run tests in CI on every PR and gate merges on green; the same command must work locally.`,
      `Isolate state: each test sets up its own DB rows / network mocks and tears them down — no shared fixtures.`,
      `Add coverage as a signal (not a target). Watch for flaky tests and treat each flake as a real bug.`,
      `Run a smoke test against the staging environment after every deploy.`,
    ],
    debug: [
      `Reproduce the bug locally with the smallest possible input before touching the code.`,
      `Add structured logs with a request/trace ID so you can follow one request end-to-end.`,
      `Use a real debugger (Node \`--inspect\`, Python \`pdb\`/\`debugpy\`, etc.) — \`console.log\` is fine but slow.`,
      `If it only fails in production, capture the failing request as a fixture and replay it locally.`,
      `Write a regression test that fails with the bug, then fix it; the test stays forever.`,
    ],
    profile: [
      `Profile in production-like conditions (real data volumes, real concurrency), not on a tiny dev dataset.`,
      `Capture a CPU profile and a heap snapshot — they answer different questions.`,
      `Look at the top of the flamegraph: 80% of wins are in the top 5 functions.`,
      `For web apps, measure server-side latency (p50/p95/p99) and client-side Web Vitals separately.`,
      `Always re-profile *after* a fix to confirm the bottleneck actually moved.`,
    ],
    secure: [
      `HTTPS only; disable plain HTTP at the load balancer. Use HSTS.`,
      `Strict CSP, secure cookies (\`HttpOnly; Secure; SameSite\`), CSRF protection on state-changing routes.`,
      `Validate every input at the boundary (Zod/Pydantic etc.); never trust the client.`,
      `Use parameterized queries / an ORM — never string-concatenate SQL.`,
      `Patch dependencies on a schedule (Dependabot/Renovate) and audit auth flows quarterly.`,
    ],
    scale: [
      `Measure first: latency, throughput, error rate, queue depth. Don't scale a system you haven't profiled.`,
      `Make the app stateless — push session/cache to Redis, files to object storage — so you can run N copies behind a load balancer.`,
      `Cache reads aggressively (CDN, in-memory, Redis); invalidate on write.`,
      `Move slow work (emails, image processing) into a background queue.`,
      `Right-size the database before adding shards: indexes, connection pooling, read replicas usually go a long way.`,
    ],
    migrate: [
      `Plan a reversible path: every migration should have a tested rollback.`,
      `Run migrations as a separate deploy step, not at boot. Make them idempotent.`,
      `Use expand/contract for schema changes: add the new column → backfill → switch reads → drop the old column.`,
      `Snapshot the database before any non-trivial migration; verify the restore actually works in staging.`,
      `Run the migration against a copy of production data first to catch row-count surprises.`,
    ],
    authenticate: [
      `Don't roll your own. Use a vetted library or service (Auth0, Clerk, NextAuth, Passport, WorkOS).`,
      `Store password hashes with bcrypt/argon2 — never the password itself. Or skip passwords (OIDC / magic links).`,
      `Issue short-lived access tokens + longer-lived refresh tokens; rotate on use.`,
      `Set cookies \`HttpOnly; Secure; SameSite=Lax\` (or \`None\` for cross-site).`,
      `Add rate limiting on login + 2FA for elevated actions, and log every auth event for audit.`,
    ],
    'set up': [
      `Pin the runtime version (\`.nvmrc\`, \`pyproject.toml\`, etc.) so the team and CI use the same one.`,
      `Initialize with the framework's official starter; don't hand-roll boilerplate you'll then have to maintain.`,
      `Add linting, formatting, and a pre-commit hook from day one.`,
      `Stand up CI on the first commit — a trivial green build is cheap to keep green.`,
      `Wire structured logging and a single config layer (env vars + validation) before adding features.`,
    ],
  };

  const steps = verbSteps[verb];
  if (!steps) return null;

  const numbered = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return {
    reply: `Best way to ${verb} **${tech}** in production:\n\n${numbered}\n\nThese aren't ${tech}-specific tricks — they're the production basics that apply regardless of framework. If you want ${tech}-specific tooling recommendations (e.g. its preferred test runner, deployment adapter), say the word.`,
    kind: 'howto-production',
  };
}

// ── troubleshoot handler ──────────────────────────────────────────────────
function tryTroubleshoot(content: string): FactShimResult | null {
  for (const { match, reply } of TROUBLESHOOT_CHECKLISTS) {
    if (match.test(content)) return { reply, kind: 'troubleshoot' };
  }
  return null;
}

// ── compare pairs ─────────────────────────────────────────────────────────
// Concise side-by-side for well-known tech pairs the bench keeps asking
// about. Each entry is a self-contained answer; we ignore the surrounding
// "which is faster"/"should I use" framing and serve the same comparison.
type ComparePair = { a: string; b: string; reply: string };

const COMPARE_PAIRS: ComparePair[] = [
  { a: 'redis', b: 'memcached', reply:
`**Redis vs Memcached** — both are in-memory key-value stores, but they solve different problems:

- **Data types**: Memcached holds only strings/blobs. Redis has strings, hashes, lists, sets, sorted sets, streams, bitmaps, geospatial — so it doubles as a primitive database.
- **Persistence**: Memcached is cache-only (loses data on restart). Redis has RDB snapshots and AOF append-only log, so it can survive a restart.
- **Eviction**: Memcached is LRU-only. Redis offers LRU, LFU, TTL, and a no-eviction mode.
- **Threading**: Memcached is multi-threaded out of the box. Redis is single-threaded per shard (Redis ≥6 has IO threads); use Redis Cluster for parallelism.
- **Replication / HA**: Redis has built-in primary/replica + Redis Sentinel + Redis Cluster. Memcached requires a third-party layer.

**Pick Memcached** when you need a dead-simple, lightning-fast LRU cache for opaque blobs and nothing else.
**Pick Redis** for anything richer — queues, leaderboards, rate-limits, session stores, pub/sub, or any cache that benefits from data structures.` },

  { a: 'typescript', b: 'flow', reply:
`**TypeScript vs Flow** — both add static types to JavaScript; one of them won.

- **Adoption**: TypeScript is the de-facto standard (React, Vue, Angular, Node frameworks all ship .d.ts). Flow has been quietly maintained by Meta but barely used elsewhere.
- **Ecosystem**: DefinitelyTyped covers ~thousands of npm packages for TS. Flow types for third-party libs are spotty and increasingly stale.
- **Tooling**: TS has first-class VS Code, JetBrains, ESLint, Babel, build-tool, and AI-assistant integration. Flow tooling is far behind.
- **Type system**: Flow's inference was historically smarter for some local cases; TS has caught up (template literal types, satisfies, const generics) and pushes further every release.
- **Output**: TS compiles to JS and can also be a type-only layer via Babel. Flow strips types only.

**Pick TypeScript.** Flow is fine if you're already inside the Meta monorepo, but for any new project the ecosystem gap makes TS the only sane default.` },

  { a: 'jest', b: 'vitest', reply:
`**Jest vs Vitest** — same author (kinda), same philosophy, very different runtime.

- **Engine**: Jest runs on Node + its own transformer (babel-jest / ts-jest). Vitest runs on Vite — your test setup *is* your build setup, no duplicate config.
- **Speed**: Vitest is significantly faster for Vite/ESM projects (parallel workers + native ESM, no transform per file). Jest catches up with SWC, but Vitest is the default-fast.
- **ESM**: Vitest is ESM-first; Jest's ESM mode is still experimental in many edge cases.
- **API**: Vitest is a near-superset of Jest's API (\`describe\`, \`it\`, \`expect\`, mocks). Migration is mostly find-and-replace.
- **Watch UX**: Vitest's HMR-style watch + browser UI (\`vitest --ui\`) is the nicest in the JS world right now.
- **Ecosystem**: Jest has more years of plugins and Stack Overflow answers; Vitest has caught up for everything mainstream.

**Pick Vitest** for any new Vite/Vue/Svelte/Solid project, or any modern ESM Node project.
**Stay on Jest** if you have a large existing suite, custom transformers, and no Vite in the build — the migration cost may not pay back.` },

  { a: 'npm', b: 'pnpm', reply:
`**npm vs pnpm** — same registry, completely different install strategy.

- **Disk usage**: npm hoists a flat \`node_modules\` per project (duplicates across projects). pnpm content-addresses every package once on disk and symlinks into each project — massive disk savings on dev machines.
- **Install speed**: pnpm is generally 2-3× faster on cold installs, ~equal on cached, and dramatically faster on monorepos.
- **Strictness**: pnpm's symlinked layout prevents the classic "phantom dependency" bug (using a package you didn't declare). npm v7+ uses a flat layout that allows this silently.
- **Monorepos**: pnpm has first-class workspaces + filtering + parallel scripts (\`pnpm -r --parallel build\`). npm workspaces work but are clunkier.
- **Lockfile**: \`pnpm-lock.yaml\` is deterministic and merge-friendly. \`package-lock.json\` is OK but can churn.
- **Ubiquity**: npm ships with Node and has zero install cost; pnpm requires a one-time install (or Corepack).

**Pick pnpm** for any monorepo, any project where install speed matters, or when you want strict dependency hygiene.
**Stick with npm** for the simplest possible single-package zero-setup projects.` },

  { a: 'react', b: 'vue', reply:
`**React vs Vue** — both are component-based view libraries; same shape, different feel.

- **Mental model**: React is "JS first" — JSX, hooks, every render is a function call. Vue is "HTML first" — single-file components with \`<template>\`, \`<script>\`, \`<style>\`.
- **Reactivity**: React re-renders the whole component when state changes; you optimize with memos/keys. Vue tracks dependencies per property via the Composition API (Vue 3) — fewer renders for free.
- **Ecosystem**: React has the larger ecosystem (Next.js, Remix, React Native, every UI lib). Vue is more curated (official router, Pinia store, Nuxt).
- **Tooling**: Vue's SFCs + Volar + Vite is one of the smoothest DX setups in the JS world. React + Vite is great too; Next.js dominates for SSR.
- **Hiring**: React has the bigger job market by a wide margin.

**Pick React** for large teams, SSR via Next.js, React Native sharing, or a wide ecosystem.
**Pick Vue** for a small/medium team that wants strong defaults, less boilerplate, and a calmer release cycle.` },

  { a: 'vite', b: 'webpack', reply:
`**Vite vs Webpack** — Vite is what bundlers look like when you start from native ESM.

- **Dev server**: Vite serves source files over native ESM (no bundling in dev) → near-instant startup, HMR in single-digit milliseconds. Webpack bundles everything for dev; cold starts are slow.
- **Prod build**: Vite uses Rollup under the hood for production. Webpack uses its own bundler. Output quality is comparable.
- **Config**: Vite's defaults cover ~95% of common needs (TS, JSX, CSS modules, env vars). Webpack needs more config for anything beyond hello-world.
- **Plugin ecosystem**: Webpack's is older and deeper. Vite's covers all common cases and ports many Rollup plugins.
- **Migration**: Most React/Vue/Svelte/Solid projects can switch from Webpack to Vite in an afternoon.

**Pick Vite** for any new web project, full stop.
**Stick with Webpack** only when you have a heavily customized config or a federation/micro-frontend setup that depends on Module Federation maturity.` },

  { a: 'postgres', b: 'mysql', reply:
`**Postgres vs MySQL** — both production-grade relational DBs; differ in feature depth and operational quirks.

- **Type system / features**: Postgres has richer types (arrays, JSONB, range types, hstore), full-text search, window functions, CTEs, partial/expression indexes, transactional DDL. MySQL has improved a lot (8.x adds window functions, JSON, CTEs) but Postgres still leads.
- **Standards compliance**: Postgres is closer to ANSI SQL. MySQL's defaults have historically been quirky (silent truncations, lax NULL behavior — improved in 8.x with stricter modes).
- **Concurrency**: Postgres uses MVCC and is generally better at heavy mixed read/write workloads. MySQL with InnoDB also does MVCC; tuning differs.
- **Replication**: MySQL has simple, mature primary/replica. Postgres has logical replication + many third-party HA options (Patroni, Citus, Crunchy, Neon).
- **Hosting**: MySQL is everywhere (shared hosting, all clouds). Postgres is the default on every modern PaaS (Supabase, Neon, RDS, Cloud SQL).

**Pick Postgres** for anything new — feature depth + JSON + analytics + good defaults.
**Pick MySQL** for legacy compatibility, WordPress-style stacks, or when your ops team only knows MySQL.` },

  { a: 'rest', b: 'graphql', reply:
`**REST vs GraphQL** — different ways to expose a backend over HTTP.

- **Shape**: REST = one endpoint per resource, server decides response shape. GraphQL = one endpoint, client asks for exactly the fields it wants.
- **Over/underfetching**: REST tends to overfetch (extra fields) or underfetch (N requests for joined data). GraphQL collapses to one round-trip.
- **Caching**: REST caches naturally on URLs (CDN-friendly). GraphQL caching is per-client (Relay/Apollo cache) and harder on the network edge.
- **Tooling**: REST is dead-simple — anyone can hit it with curl. GraphQL has strong typed clients (Apollo, urql, Relay) and self-documenting schemas.
- **Errors / contracts**: GraphQL has a strict schema and partial responses. REST relies on HTTP codes + ad-hoc JSON conventions.
- **Mobile / multi-client**: GraphQL shines when several clients want different slices of the same data.

**Pick REST** for public APIs, simple CRUD, or strong HTTP caching needs.
**Pick GraphQL** for multi-client apps (web + mobile), highly relational data, or teams that want strict typed contracts end-to-end.` },

  { a: 'docker', b: 'podman', reply:
`**Docker vs Podman** — same OCI containers, different daemon model.

- **Daemon**: Docker runs a long-lived root daemon (\`dockerd\`). Podman is daemonless — each \`podman run\` is a plain process.
- **Rootless**: Podman runs rootless by default; Docker added rootless mode but it's not the path of least resistance.
- **CLI**: Podman's CLI is intentionally drop-in compatible: \`alias docker=podman\` works for most commands.
- **Compose**: Both support \`docker-compose.yml\` (Podman via \`podman-compose\` or \`podman compose\`).
- **Pods**: Podman has first-class "pods" (Kubernetes-style multi-container groups). Docker only has networks.
- **Ecosystem**: Docker Desktop is the polished default on macOS/Windows; Podman Desktop has caught up but is newer.

**Pick Docker** for team familiarity and the smoothest macOS/Windows desktop UX.
**Pick Podman** for rootless production hosts, RHEL-aligned shops, or when you want Kubernetes-shaped local dev.` },

  { a: 'kubernetes', b: 'nomad', reply:
`**Kubernetes vs Nomad** — container orchestrators with very different complexity budgets.

- **Scope**: Kubernetes is a full platform (workloads, networking, storage, RBAC, ingress, jobs, secrets). Nomad is a focused scheduler that integrates with Consul/Vault for the rest.
- **Setup**: Kubernetes is heavy to operate yourself; almost everyone uses managed offerings (EKS/GKE/AKS). Nomad runs from a single binary on a VM.
- **Workload types**: Kubernetes is container-first. Nomad schedules containers, plain binaries, Java jars, QEMU VMs — anything with a "driver".
- **Ecosystem**: Kubernetes is the de-facto standard; helm charts, operators, and tooling are vast. Nomad's ecosystem is smaller but cleaner.
- **YAML burden**: Kubernetes manifests get long fast. Nomad HCL job files stay readable.

**Pick Kubernetes** for any team that already knows it, large clusters, or anywhere you want the broadest tooling.
**Pick Nomad** for small teams, mixed workloads, or operators who value simplicity over feature surface.` },

  { a: 'rust', b: 'go', reply:
`**Rust vs Go** — both compile to native binaries; their goals are nearly opposite.

- **Performance**: Rust is generally faster and more predictable (no GC, zero-cost abstractions). Go is fast enough for almost everything and has a tiny GC pause budget.
- **Memory safety**: Rust enforces it at compile time via ownership/borrowing — strict, but no runtime cost. Go has a runtime + GC and avoids most memory bugs by hiding manual management.
- **Concurrency**: Rust uses async/await + Send/Sync traits; powerful, sometimes painful. Go has goroutines + channels — easy out of the box, less control over scheduling.
- **Learning curve**: Go can be productive in a week. Rust takes months to internalize the borrow checker.
- **Use cases**: Rust shines in systems work, embedded, performance-critical services, CLI tools, WASM. Go shines in network services, CLIs, infrastructure tooling (Docker, Kubernetes, Terraform).

**Pick Go** for backend services, infra tools, and teams that value time-to-productivity.
**Pick Rust** when correctness + raw performance + no GC pauses matter, or when you're writing libraries/tools other people will rely on.` },

  { a: 'tailwind', b: 'vanilla css', reply:
`**Tailwind vs vanilla CSS** — utility-first vs hand-rolled.

- **Authoring speed**: Tailwind is extremely fast for one-off layouts and prototypes; vanilla CSS requires naming + file-switching for every change.
- **Consistency**: Tailwind's design tokens (spacing, color, typography) keep a project visually consistent for free. Vanilla CSS relies on discipline + design systems.
- **Bundle size**: Tailwind with JIT/PurgeCSS ships only used classes — usually small. Vanilla CSS can be smaller or much larger depending on how it's structured.
- **Maintainability**: Tailwind keeps styles next to markup — easy to delete, hard to refactor across components. Vanilla CSS centralizes styles but tends to grow unused selectors over time.
- **Learning curve**: Tailwind requires learning the class API. Vanilla CSS is universal.

**Pick Tailwind** for solo/small teams that ship fast and want strong defaults.
**Pick vanilla CSS** when you have a dedicated design system, a strict design-token discipline, or a brand that needs heavy bespoke styling.` },

  { a: 'next.js', b: 'remix', reply:
`**Next.js vs Remix** — both React meta-frameworks with built-in routing, SSR, and data loading.

- **Data loading**: Next.js has multiple models (Server Components, \`getServerSideProps\`, route handlers, \`use\`/\`fetch\` caching). Remix has one — route-level \`loader\`/\`action\` functions that map to web Fetch standards.
- **Mental model**: Remix leans hard on web fundamentals (forms, redirects, HTTP status codes). Next.js leans on the React component tree (Server Components, suspense boundaries).
- **Deployment**: Next.js is most polished on Vercel but runs anywhere. Remix runs on any JS runtime (Node, Cloudflare Workers, Deno, Bun).
- **Ecosystem**: Next.js is the larger ecosystem by an order of magnitude (templates, hosting integrations, learning content).
- **Future**: Both are actively developed; Remix was acquired by Shopify and merged with React Router.

**Pick Next.js** for the largest ecosystem, Vercel deploys, or heavy use of Server Components.
**Pick Remix / React Router** for a "web standards first" mental model, Cloudflare/edge runtimes, or simpler data flow.` },
];

let comparePairTermMatcher: EntityMatcher | null = null;
function tryCompare(content: string): FactShimResult | null {
  const lower = content.toLowerCase();
  if (!/\bvs\.?\b|\bversus\b|\bcompare\b|\bcompared to\b|\bshould i use\b|\bdifference[s]? between\b/i.test(lower)) return null;
  // A two-way curated pair must not answer a 3+ way comparison ("compare A, B,
  // and C") — that question deserves a full multi-way answer, not "A vs B".
  if (isMultiWayComparison(content)) return null;
  // Match all curated comparison TERMS in one pass (compiled once over both sides
  // of every pair), then test each pair against that set — O(1) per pair instead
  // of two fresh regex compiles per pair.
  comparePairTermMatcher ??= buildEntityMatcher(COMPARE_PAIRS.flatMap(({ a, b }) => [a, b]));
  const present = new Set(comparePairTermMatcher.matchAll(content).map((t) => t.toLowerCase()));
  if (present.size === 0) return null;
  for (const { a, b, reply } of COMPARE_PAIRS) {
    if (present.has(a.toLowerCase()) && present.has(b.toLowerCase())) {
      return { reply, kind: 'compare-pair' };
    }
  }
  return null;
}

// Comparison of two well-known code idioms ("difference between debounce and
// throttle"). Composed from the idiom table's own code + rationale, so it covers
// both sides honestly where the curated COMPARE_PAIRS table has no entry. Returns
// null unless exactly two distinct idioms are named under a comparison cue.
function tryCompareIdioms(content: string, explainConcept?: ConceptExplainer): FactShimResult | null {
  const reply = composeIdiomComparison(content, explainConcept);
  if (!reply) return null;
  return { reply, kind: 'compare-pair' };
}

// ── casual cheer ──────────────────────────────────────────────────────────
function tryCasualCheer(content: string): FactShimResult | null {
  const lower = content.toLowerCase().trim();
  if (!/^(cheer me up|i'?m bored|i am bored|surprise me|tell me something cool|tell me a joke|make me smile|i'?m sad)\.?\??$/i.test(lower)) {
    return null;
  }
  const replies = [
    `Here's one: an octopus has three hearts, blue blood, and nine brains — one central and one in each arm. Two of the hearts stop beating when it swims, which is why crawling is its preferred mode of locomotion.`,
    `Quick joke: a SQL query walks into a bar, walks up to two tables, and asks — "may I join you?"`,
    `Fun fact: bananas are berries, but strawberries aren't. Botanically a berry is a fruit produced from a single flower with one ovary and seeds embedded in the flesh — bananas qualify, strawberries don't.`,
    `Here's something: bees can recognize human faces. They use the same "configural processing" technique humans use — combining eyes, nose, mouth — even with a brain the size of a sesame seed.`,
  ];
  // Deterministic-but-rotating pick by content hash
  let h = 0; for (const c of content) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return { reply: replies[Math.abs(h) % replies.length], kind: 'casual-cheer' };
}

// ── meta about Vai ────────────────────────────────────────────────────────
//
// Grounded self-knowledge. Without this, "tell me about your engine" / "what is Vai" /
// "what can you do" fell through to the n-gram corpus and returned irrelevant soup
// (V8/Spark/dockerfile fragments — a real live failure). These are the things Vai can state
// about ITSELF with certainty, so they are answered deterministically and accurately rather
// than retrieved. Kept factual and free of invented numbers — describes architecture/behavior,
// not metrics that could drift.

/**
 * Does the prompt ask about VAI'S OWN engine / architecture / how IT works? Must reference Vai
 * itself ("your", "vai", "you") — NOT a generic "the engine", which would wrongly capture real
 * engineering asks like "design a repo-native prediction engine". The self-reference is required.
 */
function asksAboutVaiEngine(lower: string): boolean {
  const selfRef = /\b(?:vai'?s?|your|yourself|you)\b/.test(lower);
  if (!selfRef) return false;
  // A clear build/design task is never a question about Vai's engine, even if it says "your".
  if (/\b(?:design|build|create|make|implement|scaffold|architect)\b/.test(lower)) return false;
  const aboutEngine = /\b(?:engine|architecture|how (?:does\s+)?(?:you|it|vai)\s+(?:work|run|operate)|internals?|under the hood|how (?:are|were) you (?:built|made)|tech stack)\b/.test(lower);
  return aboutEngine;
}

/** Does the prompt ask what Vai is, or what it can do (capabilities/identity)? */
function asksWhatVaiIs(lower: string): boolean {
  if (/\bwhat\s+(?:is|are)\s+vai\b|\bwho\s+are\s+you\b|\btell me about\s+(?:vai|yourself)\b/.test(lower)) return true;
  if (/\bwhat\s+can\s+you\s+do\b|\bwhat\s+are\s+your\s+(?:capabilities|features)\b|\bhow can you help\b/.test(lower)) return true;
  return false;
}

/**
 * Grounded answers to questions about Vai ITSELF — identity, capabilities, engine/architecture,
 * and chat-vs-IDE mode. Exported so the dispatcher can seat it at a HIGH priority tier: these
 * self-questions must beat the grounding-based "simpler"/"best next task" engine templates that
 * otherwise hijack "tell me about your engine" (a real live failure). Returns null when the
 * prompt isn't about Vai, so the normal pipeline takes over.
 */
export function tryVaiSelfKnowledge(content: string): FactShimResult | null {
  const lower = (content || '').toLowerCase();

  if (/\bchat\b.*\bide\s+mode\b|\bide\s+mode\b.*\bchat\b/.test(lower)) {
    return {
      reply:
`**Chat mode vs IDE mode** in Vai:

- **Chat mode** is conversational. You ask, I answer, we iterate. No sandbox, no project context — just talk. Good for questions, planning, casual exploration.
- **IDE mode** ("builder" / "agent") is task-driven and operates on a live sandbox project. I can read files, edit code, run commands, and stage changes. Good for actually building or modifying something.

Switch between them in the mode selector below the message box. You can also link a sandbox project to a chat conversation to give it IDE-mode powers without losing the conversational feel.`,
      kind: 'meta-vai',
    };
  }

  // "tell me about your engine" / "how does Vai work" — grounded architecture answer.
  if (asksAboutVaiEngine(lower)) {
    return {
      reply:
`**Vai's engine** is a local-first AI system that runs on your machine — no external APIs by default.

- **Core engine** (\`packages/core\`) owns the intelligence: ingestion of what you browse, knowledge retrieval, and the response pipeline. Vai itself is a *deterministic* engine — it routes, grounds, and verifies; the language models are staff it consults, not the thing answering.
- **Consensus council** — when a turn is substantive, Vai drafts an answer and a panel of local models (run via Ollama) reviews it from several angles (skeptic, pragmatist, intent-reader). They critique *intent and method*; Vai still owns every user-facing fact (fact-quarantine). The draft is redrafted if the council isn't satisfied.
- **Runtime** (\`packages/runtime\`) serves it over Fastify + WebSockets to the desktop app.
- **Grounding** — answers are checked against retrieved evidence before you see them, so Vai stays honest about uncertainty rather than guessing confidently.

Everything runs locally for privacy and zero API cost. Ask about any one part and I'll go deeper.`,
      kind: 'meta-vai',
    };
  }

  // "what is Vai" / "what can you do" — identity + capabilities.
  if (asksWhatVaiIs(lower)) {
    return {
      reply:
`**Vai** is a local-first AI that learns from what you browse and runs entirely on your machine — no external APIs by default, so your data stays private and there are no usage costs.

What I can do:
- **Answer & reason** over what you've shown me, grounded in real retrieved context (I stay honest about uncertainty rather than guessing).
- **Build & edit code** in a live sandbox (IDE/agent mode): read files, write code, run commands, stage changes.
- **Deliberate with a council** of local models that review my drafts before you see them, so answers are checked, not just generated.
- **Show my work** — every turn exposes its process (drafts, council verdicts, tool calls) so you can see and steer how I reached the answer.

Tell me what you're working on and I'll point you at the right mode.`,
      kind: 'meta-vai',
    };
  }

  return null;
}

function tryMeta(content: string): FactShimResult | null {
  return tryVaiSelfKnowledge(content);
}

// ── person facts ──────────────────────────────────────────────────────────
// Lightweight bio + birthdate so the engine can't drift into noisy corpus
// (e.g. the Jeff-Bezos profanity-leak from the "spend his net worth" repo).
type PersonFact = { born?: string; died?: string; bio: string };

const PERSON_FACTS: Record<string, PersonFact> = {
  'jeff bezos': { born: 'January 12, 1964 (Albuquerque, New Mexico)', bio:
`**Jeff Bezos** is an American entrepreneur best known as the founder of Amazon (1994) and Blue Origin (2000). He stepped down as Amazon CEO in July 2021 and is now executive chairman. Bezos also owns The Washington Post (since 2013). He is one of the wealthiest people in the world and was named TIME's Person of the Year in 1999.` },
  'elon musk': { born: 'June 28, 1971 (Pretoria, South Africa)', bio:
`**Elon Musk** is a South African-born American entrepreneur and CEO of Tesla, SpaceX, and X (formerly Twitter). He co-founded Zip2 and X.com (later PayPal), and founded SpaceX (2002), Neuralink (2016), and The Boring Company (2016). He took Tesla public in 2010 and acquired Twitter in October 2022.` },
  'carl sagan': { born: 'November 9, 1934 (Brooklyn, New York)', died: 'December 20, 1996', bio:
`**Carl Sagan** was an American astronomer, planetary scientist, and science communicator. He was a professor at Cornell, played a leading role in the Mariner, Viking, Voyager, and Galileo missions, and is best known for the 1980 TV series *Cosmos: A Personal Voyage* and the novel *Contact* (1985, adapted to film 1997). He won the Pulitzer Prize for *The Dragons of Eden* (1977).` },
  'bill gates': { born: 'October 28, 1955 (Seattle, Washington)', bio:
`**Bill Gates** is an American business magnate, co-founder of Microsoft (1975, with Paul Allen), and one of the best-known philanthropists in the world via the Bill & Melinda Gates Foundation (founded 2000). He served as Microsoft's CEO until 2000 and stepped down from the board in 2020 to focus on philanthropy.` },
  'steve jobs': { born: 'February 24, 1955 (San Francisco, California)', died: 'October 5, 2011', bio:
`**Steve Jobs** was an American entrepreneur and the co-founder, chairman, and CEO of Apple Inc. (founded 1976 with Steve Wozniak and Ronald Wayne). He led the development of the Macintosh, iPod, iPhone, and iPad, and also founded NeXT (1985) and led Pixar after acquiring it from Lucasfilm (1986). He returned to Apple in 1997 and presided over its transformation into the world's most valuable company.` },
  'tim cook': { born: 'November 1, 1960 (Mobile, Alabama)', bio:
`**Tim Cook** is an American business executive and the CEO of Apple Inc. since August 2011, when he succeeded Steve Jobs. He joined Apple in 1998 as senior vice president for worldwide operations and is widely credited with overhauling Apple's supply chain.` },
  'satya nadella': { born: 'August 19, 1967 (Hyderabad, India)', bio:
`**Satya Nadella** is an Indian-American business executive and the CEO of Microsoft since February 2014. He joined Microsoft in 1992 and previously led the Cloud and Enterprise group. Under his leadership Microsoft pivoted heavily to cloud (Azure), acquired LinkedIn (2016), GitHub (2018), and Activision Blizzard (2023).` },
  'sundar pichai': { born: 'June 10, 1972 (Madurai, India)', bio:
`**Sundar Pichai** is an Indian-American business executive, CEO of Google since 2015 and CEO of its parent company Alphabet Inc. since 2019. He joined Google in 2004 and previously led Chrome, Chrome OS, and Android.` },
  'mark zuckerberg': { born: 'May 14, 1984 (White Plains, New York)', bio:
`**Mark Zuckerberg** is an American business magnate, co-founder, chairman, and CEO of Meta Platforms (formerly Facebook, founded 2004 at Harvard). Meta also owns Instagram, WhatsApp, and Oculus/Reality Labs.` },
  'larry page': { born: 'March 26, 1973 (East Lansing, Michigan)', bio:
`**Larry Page** is an American computer scientist and co-founder of Google (1998, with Sergey Brin). He served as CEO of Google (1998-2001 and 2011-2015) and CEO of Alphabet (2015-2019).` },
  'sergey brin': { born: 'August 21, 1973 (Moscow, Russia)', bio:
`**Sergey Brin** is a Russian-American computer scientist and co-founder of Google (1998, with Larry Page). He served as president of Google's parent company Alphabet from 2015 to 2019.` },
  'larry ellison': { born: 'August 17, 1944 (New York City)', bio:
`**Larry Ellison** is an American business magnate, co-founder of Oracle Corporation (1977), and its CTO and chairman. He served as Oracle's CEO from 1977 to 2014.` },
  'warren buffett': { born: 'August 30, 1930 (Omaha, Nebraska)', bio:
`**Warren Buffett** is an American business magnate, investor, and philanthropist. He is the chairman and CEO of Berkshire Hathaway and is widely regarded as one of the most successful investors in history.` },
  'linus torvalds': { born: 'December 28, 1969 (Helsinki, Finland)', bio:
`**Linus Torvalds** is a Finnish-American software engineer who created the Linux kernel in 1991 and Git in 2005. He continues to be the principal maintainer of the Linux kernel.` },
  'guido van rossum': { born: 'January 31, 1956 (Haarlem, Netherlands)', bio:
`**Guido van Rossum** is a Dutch programmer best known as the creator of the Python programming language (first released 1991). He served as Python's "Benevolent Dictator for Life" until 2018 and joined Microsoft in 2020.` },
  'ada lovelace': { born: 'December 10, 1815 (London, England)', died: 'November 27, 1852', bio:
`**Ada Lovelace** was an English mathematician and writer, chiefly known for her work on Charles Babbage's proposed Analytical Engine. She is widely regarded as the first computer programmer for her notes describing how the engine could compute Bernoulli numbers.` },
  'alan turing': { born: 'June 23, 1912 (London, England)', died: 'June 7, 1954', bio:
`**Alan Turing** was an English mathematician and computer scientist widely considered the father of theoretical computer science. He formalized the concepts of algorithm and computation with the Turing machine, and during WWII led work at Bletchley Park breaking the German Enigma cipher.` },
  'albert einstein': { born: 'March 14, 1879 (Ulm, German Empire)', died: 'April 18, 1955', bio:
`**Albert Einstein** was a German-born theoretical physicist, best known for developing the theory of relativity. He received the 1921 Nobel Prize in Physics for his discovery of the photoelectric effect, foundational to quantum theory.` },
  'isaac newton': { born: 'January 4, 1643 (Woolsthorpe, England)', died: 'March 31, 1727', bio:
`**Sir Isaac Newton** was an English mathematician, physicist, and astronomer. His *Philosophiæ Naturalis Principia Mathematica* (1687) laid the foundations of classical mechanics. He also formulated the laws of motion and universal gravitation, and made foundational contributions to optics and calculus.` },
  'marie curie': { born: 'November 7, 1867 (Warsaw, Poland)', died: 'July 4, 1934', bio:
`**Marie Curie** was a Polish-French physicist and chemist who conducted pioneering research on radioactivity. She was the first woman to win a Nobel Prize, the only person to win Nobels in two different sciences (Physics 1903, Chemistry 1911), and the first woman professor at the University of Paris.` },
};

let personMatcher: EntityMatcher | null = null;
function tryPerson(content: string): FactShimResult | null {
  const lower = content.toLowerCase();
  // Compile-once over PERSON_FACTS (was: a fresh regex per name, every turn).
  // Longest-first now, so "carl sagan" wins over a bare "carl" if both existed.
  personMatcher ??= buildEntityMatcher(Object.keys(PERSON_FACTS));
  const matched = personMatcher.match(content);
  if (!matched) return null;
  const f = PERSON_FACTS[matched];
  const display = matched.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  const wantsBorn = /\bborn\b|\bbirth\s*(day|date)?\b|when was\b/i.test(lower);
  const wantsDied = /\b(died|death|passed away)\b/i.test(lower);
  if (wantsBorn && f.born) {
    return { reply: `**${display}** was born **${f.born}**.${f.died ? ` He died ${f.died}.` : ''}`, kind: 'fact-person' };
  }
  if (wantsDied && f.died) {
    return { reply: `**${display}** died **${f.died}**.${f.born ? ` He was born ${f.born}.` : ''}`, kind: 'fact-person' };
  }
  // Default: bio + birth/death line if known.
  let extra = '';
  if (f.born && f.died) extra = `\n\n*Born ${f.born}. Died ${f.died}.*`;
  else if (f.born) extra = `\n\n*Born ${f.born}.*`;
  return { reply: f.bio + extra, kind: 'fact-person' };
}

// ── country location (where is X) ─────────────────────────────────────────
const COUNTRY_LOCATIONS: Record<string, string> = {
  'south korea': 'East Asia, occupying the southern half of the Korean Peninsula. It borders North Korea to the north along the DMZ, with the Yellow Sea to the west and the Sea of Japan (East Sea) to the east.',
  'north korea': 'East Asia, occupying the northern half of the Korean Peninsula. It borders China to the north, Russia in the far northeast, and South Korea to the south along the DMZ.',
  'japan': 'East Asia, an island nation in the Pacific Ocean east of the Korean Peninsula, comprising four main islands (Honshu, Hokkaido, Kyushu, Shikoku) and thousands of smaller ones.',
  'china': 'East Asia. It borders 14 countries — Russia and Mongolia to the north; Kazakhstan, Kyrgyzstan, Tajikistan, Afghanistan, Pakistan to the west; India, Nepal, Bhutan, Myanmar, Laos, Vietnam to the south; and North Korea to the east — with coastline on the East and South China Seas.',
  'vietnam': 'Southeast Asia, on the eastern edge of the Indochinese Peninsula, bordering China to the north, Laos to the northwest, and Cambodia to the southwest, with a long coastline on the South China Sea.',
  'thailand': 'Southeast Asia, bordering Myanmar to the west and north, Laos to the northeast, Cambodia to the southeast, and Malaysia to the south.',
  'india': 'South Asia, bordering Pakistan to the west; China, Nepal, and Bhutan to the north; Bangladesh and Myanmar to the east; and the Indian Ocean to the south.',
  'germany': 'Central Europe, bordering Denmark to the north; Poland and the Czech Republic to the east; Austria and Switzerland to the south; and France, Luxembourg, Belgium, and the Netherlands to the west.',
  'france': 'Western Europe, bordering Belgium and Luxembourg to the northeast; Germany, Switzerland, and Italy to the east; Spain and Andorra to the southwest; with coastlines on the Atlantic Ocean, English Channel, and Mediterranean Sea.',
  'spain': 'Southwestern Europe, on the Iberian Peninsula, bordering Portugal to the west, France and Andorra to the northeast, and with coastlines on the Atlantic Ocean and Mediterranean Sea.',
  'italy': 'Southern Europe, a boot-shaped peninsula extending into the Mediterranean, bordering France, Switzerland, Austria, and Slovenia to the north, and including the islands of Sicily and Sardinia.',
  'brazil': 'South America, the largest country on the continent. It borders every South American country except Chile and Ecuador, with a long Atlantic coastline.',
  'argentina': 'Southern South America, bordering Chile to the west, Bolivia and Paraguay to the north, Brazil and Uruguay to the northeast, and the Atlantic Ocean to the east.',
  'mexico': 'North America, bordering the United States to the north and Guatemala and Belize to the south, with coastlines on the Pacific Ocean and the Gulf of Mexico.',
  'canada': 'Northern North America, bordering the United States to the south (the longest international land border in the world) and Alaska to the northwest, with coastlines on the Atlantic, Pacific, and Arctic Oceans.',
  'australia': 'Oceania, the largest country and only continental country in the southern hemisphere, between the Indian and Pacific Oceans.',
  'egypt': 'Northeast Africa, bordering Libya to the west, Sudan to the south, and Israel and the Gaza Strip to the northeast, with coastlines on the Mediterranean and Red Seas.',
  'south africa': 'The southernmost country in Africa, bordering Namibia, Botswana, and Zimbabwe to the north and Mozambique and Eswatini to the northeast, with Lesotho enclosed within its territory.',
  'norway': 'Northern Europe, on the western half of the Scandinavian Peninsula, bordering Sweden to the east and Finland and Russia in the far northeast, with a long Atlantic coastline.',
  'sweden': 'Northern Europe, on the eastern half of the Scandinavian Peninsula, bordering Norway to the west and Finland to the east, with the Baltic Sea to the south and east.',
  'finland': 'Northern Europe, bordering Sweden to the west, Norway to the north, and Russia to the east, with the Gulf of Bothnia and Gulf of Finland to the south and west.',
  'denmark': 'Northern Europe, on the Jutland Peninsula and a group of islands south of Norway and Sweden, bordering Germany to the south.',
  'iceland': 'A Nordic island nation in the North Atlantic, between Greenland and Norway, just south of the Arctic Circle.',
  'ireland': 'Northwestern Europe, occupying most of the island of Ireland in the North Atlantic, sharing a land border with Northern Ireland (United Kingdom) to the northeast.',
  'united kingdom': 'Northwestern Europe, comprising the island of Great Britain (England, Scotland, Wales) and Northern Ireland, surrounded by the Atlantic Ocean, North Sea, Irish Sea, and English Channel.',
};

function tryCountryLocation(content: string): FactShimResult | null {
  const m = content.match(/^\s*where\s+is\s+([a-zA-Z][a-zA-Z .'-]+?)\s*\??\s*$/i);
  if (!m) return null;
  const key = m[1].trim().toLowerCase();
  const loc = COUNTRY_LOCATIONS[key];
  if (!loc) return null;
  const display = key.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return { reply: `**${display}** is in ${loc}`, kind: 'fact-country-location' };
}

// ── code snippets ─────────────────────────────────────────────────────────
// Small per-language idiom table for prompts the constrained-code emitter
// doesn't catch — e.g. "deep-clone" where the bench expects an actual
// fenced code block, not a generic-about-the-language paragraph.
const CODE_SNIPPETS: Array<{ match: RegExp; reply: string }> = [
  {
    match: /\b(javascript|js|typescript|ts)\b.*\bdebounce\b|\bdebounce\b.*\b(javascript|js|typescript|ts)\b/i,
    reply:
`Here's a small TypeScript debounce helper:

\`\`\`typescript
export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number,
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (...args: TArgs) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

// Example:
const onSearch = debounce((query: string) => {
  console.log('searching', query);
}, 250);
\`\`\`

Use this for UI events like search boxes, resize handlers, or autosave where you only want to run after the user stops triggering the event.`,
  },
  {
    match: /\b(javascript|js|typescript|ts)\b.*\bthrottle\b|\bthrottle\b.*\b(javascript|js|typescript|ts)\b/i,
    reply:
`Here's a small TypeScript throttle helper:

\`\`\`typescript
export function throttle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  intervalMs: number,
): (...args: TArgs) => void {
  let lastRun = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | undefined;

  return (...args: TArgs) => {
    const now = Date.now();
    const remaining = intervalMs - (now - lastRun);

    if (remaining <= 0) {
      if (trailingTimer) clearTimeout(trailingTimer);
      trailingTimer = undefined;
      lastRun = now;
      fn(...args);
      return;
    }

    if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        lastRun = Date.now();
        trailingTimer = undefined;
        fn(...args);
      }, remaining);
    }
  };
}
\`\`\`

Use debounce when you want the final event after a pause; use throttle when you want a maximum rate while events keep firing.`,
  },
  {
    match: /\b(javascript|js|typescript|ts)\b.*\bslugify\b|\bslugify\b.*\b(javascript|js|typescript|ts)\b/i,
    reply:
`Here's a small TypeScript slugify helper:

\`\`\`typescript
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

slugify('Våre beste Sensor Kits!'); // "vare-beste-sensor-kits"
\`\`\`

If slugs are user-visible and must be unique, generate this base slug first, then append a counter or short ID when there is a collision.`,
  },
  {
    match: /\brust\b.*\b(deep[\s-]?clone|deep[\s-]?copy)\b|\b(deep[\s-]?clone|deep[\s-]?copy)\b.*\brust\b/i,
    reply:
`In Rust, "deep clone" is just \`.clone()\` — every owned field is recursively cloned. The \`Clone\` trait is derived per-type and propagates through ownership.

\`\`\`rust
#[derive(Clone, Debug)]
struct Address {
    city: String,
    zip: String,
}

#[derive(Clone, Debug)]
struct User {
    name: String,
    tags: Vec<String>,
    address: Address,
}

fn deep_clone<T: Clone>(value: &T) -> T {
    value.clone()
}

fn main() {
    let original = User {
        name: "Ada".to_string(),
        tags: vec!["admin".to_string(), "owner".to_string()],
        address: Address { city: "London".into(), zip: "EC1".into() },
    };

    let copy = deep_clone(&original);
    println!("{:?}", copy);
}
\`\`\`

Notes:
- \`#[derive(Clone)]\` requires every field to also be \`Clone\`. \`String\` and \`Vec<T: Clone>\` already are.
- For types you can't or don't want to derive \`Clone\` on, implement it manually: \`impl Clone for Foo { fn clone(&self) -> Self { ... } }\`.
- For \`Rc\` / \`Arc\`, \`.clone()\` only bumps the refcount. If you need a true deep copy of the inside, call \`(*rc).clone()\` and wrap again.`,
  },
  {
    match: /\b(javascript|js|typescript|ts)\b.*\b(deep[\s-]?clone|deep[\s-]?copy)\b|\b(deep[\s-]?clone|deep[\s-]?copy)\b.*\b(javascript|js|typescript|ts)\b/i,
    reply:
`Modern JS/TS has a built-in deep clone via \`structuredClone\` — it handles nested objects, arrays, Maps, Sets, Dates, and circular references.

\`\`\`typescript
function deepClone<T>(value: T): T {
  return structuredClone(value);
}

const original = {
  name: 'Ada',
  tags: ['admin', 'owner'],
  address: { city: 'London', zip: 'EC1' },
  joined: new Date(),
};

const copy = deepClone(original);
copy.tags.push('extra');
console.log(original.tags); // ['admin', 'owner']  — untouched
\`\`\`

Notes:
- \`structuredClone\` is available in Node 17+ and all modern browsers.
- It does **not** clone functions, DOM nodes, or class prototypes (you get a plain object back for class instances).
- For older runtimes, \`JSON.parse(JSON.stringify(obj))\` works for plain JSON-safe data; for richer cases use lodash \`cloneDeep\`.`,
  },
  {
    match: /\bpython\b.*\b(deep[\s-]?clone|deep[\s-]?copy)\b|\b(deep[\s-]?clone|deep[\s-]?copy)\b.*\bpython\b/i,
    reply:
`Python's standard library has \`copy.deepcopy\` — it recursively copies every nested object and handles cycles via a memo dict.

\`\`\`python
from copy import deepcopy

def deep_clone(value):
    return deepcopy(value)

original = {
    "name": "Ada",
    "tags": ["admin", "owner"],
    "address": {"city": "London", "zip": "EC1"},
}

copy_ = deep_clone(original)
copy_["tags"].append("extra")
print(original["tags"])  # ['admin', 'owner']  — untouched
\`\`\`

Notes:
- For dataclasses and most user-defined classes \`deepcopy\` "just works"; override \`__deepcopy__\` for special cases.
- \`copy.copy\` is shallow — only the outermost container is duplicated.
- For pure-JSON data, \`json.loads(json.dumps(obj))\` is faster but loses non-JSON types (sets, dates, custom classes).`,
  },
];

function tryCodeSnippet(content: string, prior?: IdiomContext): FactShimResult | null {
  // Language-aware idiom resolver first: it honors the requested language and
  // generalizes across phrasings. Falls through to the legacy table only when
  // it declines (no concept match, or requested language unsupported).
  const idiom = resolveProgrammingIdiom(content, prior);
  if (idiom) return idiom;
  // The legacy table matches one concept per entry; like the idiom resolver it
  // must not hijack a comparison/multi-concept question with a single snippet
  // (e.g. "difference between debounce and throttle" should not return only the
  // debounce helper). Defer those to the reasoning path.
  if (isMultiConceptOrComparison(content)) return null;
  for (const { match, reply } of CODE_SNIPPETS) {
    if (match.test(content)) return { reply, kind: 'code-snippet' };
  }
  return null;
}

// ── acronyms ──────────────────────────────────────────────────────────────
// Tight table of well-known technical / institutional acronyms. The matcher
// is conservative: it requires the acronym to appear in uppercase in the
// prompt (so we don't accidentally match "api" inside ordinary prose) AND
// requires a question-shape phrasing ("what is X", "what does X stand for",
// "X meaning", "define X", "X mean").
type AcronymFact = {
  expansion: string;
  oneLiner: string;
};

const ACRONYM_FACTS: Record<string, AcronymFact> = {
  HTTP: { expansion: 'HyperText Transfer Protocol', oneLiner: '**HTTP** stands for **HyperText Transfer Protocol** — the request/response protocol used for most communication on the World Wide Web.' },
  HTTPS: { expansion: 'HyperText Transfer Protocol Secure', oneLiner: '**HTTPS** stands for **HyperText Transfer Protocol Secure** — HTTP layered on top of TLS so traffic is encrypted between client and server.' },
  JSON: { expansion: 'JavaScript Object Notation', oneLiner: '**JSON** stands for **JavaScript Object Notation** — a lightweight, language-independent text format for structured data.' },
  JWT: { expansion: 'JSON Web Token', oneLiner: '**JWT** stands for **JSON Web Token** — a compact, signed token format used for stateless authentication and authorization claims.' },
  OAUTH: { expansion: 'Open Authorization', oneLiner: '**OAuth** stands for **Open Authorization** — an open standard for delegated access (letting an app act on your behalf without sharing your password).' },
  OIDC: { expansion: 'OpenID Connect', oneLiner: '**OIDC** stands for **OpenID Connect** — an identity layer on top of OAuth 2.0 for verifying the end user and obtaining basic profile info.' },
  REST: { expansion: 'REpresentational State Transfer', oneLiner: '**REST** stands for **REpresentational State Transfer** — an architectural style for networked APIs built around resources, HTTP verbs, and stateless interactions.' },
  SQL: { expansion: 'Structured Query Language', oneLiner: '**SQL** stands for **Structured Query Language** — the standard language for defining and querying relational databases.' },
  CRUD: { expansion: 'Create, Read, Update, Delete', oneLiner: '**CRUD** stands for **Create, Read, Update, Delete** — the four basic operations on persistent storage.' },
  ORM: { expansion: 'Object-Relational Mapping', oneLiner: '**ORM** stands for **Object-Relational Mapping** — a technique that maps database rows to objects in your programming language (Prisma, TypeORM, SQLAlchemy, ActiveRecord).' },
  MVC: { expansion: 'Model-View-Controller', oneLiner: '**MVC** stands for **Model-View-Controller** — a UI architecture that separates data (model), presentation (view), and input handling (controller).' },
  API: { expansion: 'Application Programming Interface', oneLiner: '**API** stands for **Application Programming Interface** — a defined contract that lets one piece of software talk to another.' },
  SDK: { expansion: 'Software Development Kit', oneLiner: '**SDK** stands for **Software Development Kit** — a packaged set of libraries, docs, and tools for building on top of a platform or service.' },
  CLI: { expansion: 'Command-Line Interface', oneLiner: '**CLI** stands for **Command-Line Interface** — a text-based interface where you interact with a program by typing commands.' },
  GUI: { expansion: 'Graphical User Interface', oneLiner: '**GUI** stands for **Graphical User Interface** — a visual interface using windows, icons, menus, and pointer interactions.' },
  IDE: { expansion: 'Integrated Development Environment', oneLiner: '**IDE** stands for **Integrated Development Environment** — an editor bundled with debugging, build, and project-management tools (VS Code, IntelliJ, Xcode).' },
  CPU: { expansion: 'Central Processing Unit', oneLiner: '**CPU** stands for **Central Processing Unit** — the main processor that executes program instructions.' },
  GPU: { expansion: 'Graphics Processing Unit', oneLiner: '**GPU** stands for **Graphics Processing Unit** — a massively parallel processor originally for graphics, now also central to ML training and inference.' },
  RAM: { expansion: 'Random Access Memory', oneLiner: '**RAM** stands for **Random Access Memory** — fast, volatile working memory used by a running program.' },
  ROM: { expansion: 'Read-Only Memory', oneLiner: '**ROM** stands for **Read-Only Memory** — non-volatile memory whose contents cannot (normally) be modified after manufacture.' },
  SSD: { expansion: 'Solid-State Drive', oneLiner: '**SSD** stands for **Solid-State Drive** — persistent storage built from flash memory, with no moving parts and much faster random I/O than a hard disk.' },
  HDD: { expansion: 'Hard Disk Drive', oneLiner: '**HDD** stands for **Hard Disk Drive** — persistent storage using spinning magnetic platters and a moving read/write head.' },
  USB: { expansion: 'Universal Serial Bus', oneLiner: '**USB** stands for **Universal Serial Bus** — the industry-standard interface for connecting peripherals to a host computer.' },
  LAN: { expansion: 'Local Area Network', oneLiner: '**LAN** stands for **Local Area Network** — a network covering a small area like a home, office, or building.' },
  WAN: { expansion: 'Wide Area Network', oneLiner: '**WAN** stands for **Wide Area Network** — a network spanning a large geographical area (the internet is the largest WAN).' },
  VPN: { expansion: 'Virtual Private Network', oneLiner: '**VPN** stands for **Virtual Private Network** — an encrypted tunnel that lets a device act as if it were on a remote network.' },
  DNS: { expansion: 'Domain Name System', oneLiner: '**DNS** stands for **Domain Name System** — the internet phonebook that translates human-friendly domain names into IP addresses.' },
  IP: { expansion: 'Internet Protocol', oneLiner: '**IP** stands for **Internet Protocol** — the packet-addressing protocol that underlies almost all internet traffic.' },
  TCP: { expansion: 'Transmission Control Protocol', oneLiner: '**TCP** stands for **Transmission Control Protocol** — a connection-oriented transport protocol that delivers a reliable, ordered byte stream.' },
  UDP: { expansion: 'User Datagram Protocol', oneLiner: '**UDP** stands for **User Datagram Protocol** — a connectionless transport protocol that delivers datagrams without guarantees of order or delivery.' },
  NASA: { expansion: 'National Aeronautics and Space Administration', oneLiner: '**NASA** stands for **National Aeronautics and Space Administration** — the U.S. government agency responsible for civilian space exploration and aeronautics research, founded in 1958.' },
  FBI: { expansion: 'Federal Bureau of Investigation', oneLiner: '**FBI** stands for **Federal Bureau of Investigation** — the principal U.S. federal law-enforcement and domestic intelligence agency.' },
  CIA: { expansion: 'Central Intelligence Agency', oneLiner: '**CIA** stands for **Central Intelligence Agency** — the U.S. civilian foreign-intelligence service.' },
  NATO: { expansion: 'North Atlantic Treaty Organization', oneLiner: '**NATO** stands for **North Atlantic Treaty Organization** — a transatlantic military alliance of European and North American countries, founded in 1949.' },
  EU: { expansion: 'European Union', oneLiner: '**EU** stands for **European Union** — a political and economic union of 27 European member states.' },
  UN: { expansion: 'United Nations', oneLiner: '**UN** stands for **United Nations** — an intergovernmental organization founded in 1945 with 193 member states, headquartered in New York.' },
  WHO: { expansion: 'World Health Organization', oneLiner: '**WHO** stands for **World Health Organization** — a specialized agency of the United Nations responsible for international public health, founded in 1948.' },
  AI: { expansion: 'Artificial Intelligence', oneLiner: '**AI** stands for **Artificial Intelligence** — the field of building machines that perform tasks normally requiring human intelligence.' },
  ML: { expansion: 'Machine Learning', oneLiner: '**ML** stands for **Machine Learning** — a subfield of AI where systems learn patterns from data rather than being explicitly programmed.' },
  NLP: { expansion: 'Natural Language Processing', oneLiner: '**NLP** stands for **Natural Language Processing** — the area of AI concerned with the interaction between computers and human language.' },
  LLM: { expansion: 'Large Language Model', oneLiner: '**LLM** stands for **Large Language Model** — a neural network with billions of parameters trained on huge text corpora, capable of broad language understanding and generation.' },
  OOP: { expansion: 'Object-Oriented Programming', oneLiner: '**OOP** stands for **Object-Oriented Programming** — a paradigm built around objects bundling state and behavior, using inheritance, encapsulation, and polymorphism.' },
  DRY: { expansion: "Don't Repeat Yourself", oneLiner: "**DRY** stands for **Don't Repeat Yourself** — a software principle that knowledge or logic should have a single authoritative representation in the codebase." },
  YAGNI: { expansion: "You Aren't Gonna Need It", oneLiner: "**YAGNI** stands for **You Aren't Gonna Need It** — an XP principle: don't implement functionality until it's actually required." },
  KISS: { expansion: 'Keep It Simple, Stupid', oneLiner: '**KISS** stands for **Keep It Simple, Stupid** — a design principle favoring the simplest workable solution over clever complexity.' },
  SOLID: { expansion: 'Single-responsibility, Open-closed, Liskov, Interface-segregation, Dependency-inversion', oneLiner: '**SOLID** is a mnemonic for five OOP design principles: **S**ingle-responsibility, **O**pen-closed, **L**iskov substitution, **I**nterface-segregation, and **D**ependency-inversion.' },
};

const ACRONYM_QUESTION_RE = /\b(what\s*(?:is|'s|does|do)|what\s+(?:the\s+)?(?:heck|hell)|define|meaning\s+of|stand(?:s)?\s+for|mean(?:s)?(?:\s+by)?|abbreviation\s+for|short\s+for|expand|expansion\s+of)\b/i;

let acronymMatcher: EntityMatcher | null = null;
function tryAcronym(content: string): FactShimResult | null {
  if (!ACRONYM_QUESTION_RE.test(content)) return null;
  if (content.length > 120) return null;
  // Require the uppercase standalone token ("api" in prose must not collide), with
  // HTTPS winning over HTTP. Token mode = case-sensitive, longest-first. Compiled
  // once (was: one regex per acronym key, every acronym question).
  acronymMatcher ??= buildEntityMatcher(Object.keys(ACRONYM_FACTS), { boundary: 'token' });
  const key = acronymMatcher.match(content);
  if (key) return { reply: ACRONYM_FACTS[key].oneLiner, kind: 'fact-acronym' };
  return null;
}

// ── definitions ───────────────────────────────────────────────────────────
// Concise one-paragraph definitions for foundational CS / dev concepts.
// Matched by "what is X / define X / explain X / what does X mean" with X
// being one of the keys below. Keys are lowercased; matching is case-
// insensitive against word-boundary occurrences.
const DEFINITION_FACTS: Record<string, string> = {
  recursion: '**Recursion** is when a function calls itself, either directly or indirectly, breaking a problem into smaller subproblems of the same shape. A correct recursive function has (1) a base case that stops the recursion and (2) a recursive case that moves toward the base case.',
  algorithm: 'An **algorithm** is a finite, well-defined sequence of steps for solving a problem or computing a result. Algorithms are analyzed by their correctness and by their time and space complexity (often expressed in Big-O notation).',
  'hash table': 'A **hash table** (or hash map) is a data structure that maps keys to values by hashing the key to compute an index into an internal array of buckets. Average-case lookup, insert, and delete are O(1); worst case (lots of collisions) is O(n).',
  'binary search': '**Binary search** is an O(log n) algorithm for finding an item in a *sorted* sequence: compare against the middle element, then recurse into the left or right half depending on the comparison.',
  'big-o': '**Big-O notation** describes the asymptotic upper bound of a function — typically how an algorithm\u2019s runtime or memory grows as input size grows. Common classes: O(1), O(log n), O(n), O(n log n), O(n\u00b2), O(2\u207f).',
  polymorphism: '**Polymorphism** is the ability for a single interface or operation to work with values of multiple types. In OOP, this typically means a subclass instance can be used wherever a base class is expected (subtype polymorphism); other forms include parametric polymorphism (generics) and ad-hoc polymorphism (overloading).',
  closure: 'A **closure** is a function bundled with the lexical scope in which it was defined, so it can keep accessing those outer variables even after the outer function has returned.',
  promise: 'A **promise** is an object representing the eventual completion (or failure) of an asynchronous operation and its resulting value. Promises can be chained with `.then()` / `.catch()` and awaited with `async`/`await`.',
  'async/await': '**async/await** is syntactic sugar over promises: an `async` function returns a promise, and `await` suspends execution until a promise resolves, letting you write asynchronous code that reads top-to-bottom like synchronous code.',
  'garbage collection': '**Garbage collection (GC)** is automatic memory management: the runtime periodically identifies objects no longer reachable from the program and reclaims their memory. Common strategies include mark-and-sweep, generational GC, and reference counting.',
  mutex: 'A **mutex** (mutual-exclusion lock) is a synchronization primitive ensuring that only one thread holds the lock \u2014 and therefore can enter the protected critical section \u2014 at a time.',
  semaphore: 'A **semaphore** is a synchronization primitive with an integer counter: threads call acquire (decrement, block if zero) and release (increment). A binary semaphore behaves like a mutex; a counting semaphore caps how many threads can use a resource at once.',
  deadlock: 'A **deadlock** is a state where two or more threads are each waiting for a resource held by another, so none of them can ever make progress. Classic preconditions: mutual exclusion, hold-and-wait, no preemption, and circular wait.',
  'race condition': 'A **race condition** is a bug whose outcome depends on the unpredictable ordering of concurrent operations. It typically appears when shared mutable state is read and written without proper synchronization.',
  'cap theorem': 'The **CAP theorem** says that during a network partition, a distributed system must choose between **consistency** (every read sees the latest write) and **availability** (every request gets a response). For a chat app, partition tolerance is unavoidable: choose consistency for operations where conflicting state is dangerous, and availability with reconciliation for messages, presence, and other flows that can tolerate temporary divergence.',
  monad: 'A **monad** is a design pattern (originating in category theory) for sequencing computations that carry extra context \u2014 errors, async results, state, etc. Concretely it provides a `unit` (wrap a value) and `bind` (chain a function that returns a wrapped value), obeying associativity and identity laws.',
  currying: '**Currying** is transforming a function that takes multiple arguments into a chain of single-argument functions: `f(a, b, c)` becomes `f(a)(b)(c)`. Useful for partial application and point-free composition.',
  memoization: '**Memoization** is an optimization that caches the results of expensive function calls keyed by their arguments, so repeated calls with the same inputs return the cached value instead of recomputing.',
  'pure function': 'A **pure function** has two properties: (1) given the same inputs it always returns the same output, and (2) it has no side effects (no I/O, no mutation of outside state). Pure functions are easy to reason about, test, and parallelize.',
  idempotent: 'An operation is **idempotent** when applying it multiple times has the same effect as applying it once. HTTP PUT and DELETE are idempotent by spec; POST generally is not.',
  immutability: '**Immutability** means that once a value is created, it cannot be changed. Operations that would "modify" an immutable value instead return a new value. Immutable data makes concurrent and historical reasoning much simpler.',
  'dependency injection': '**Dependency injection (DI)** is supplying a component\u2019s dependencies from the outside (via constructor, setter, or function argument) instead of having the component construct them itself. This decouples the component from concrete implementations and makes it testable.',
  microservices: '**Microservices** is an architectural style where a system is composed of small, independently deployable services, each owning its data and communicating over the network (typically HTTP or messaging). The trade-off is operational complexity (deployment, observability, distributed transactions) for team autonomy and independent scaling.',
  monolith: 'A **monolith** is an architecture where the whole application is built and deployed as one unit. Monoliths are simpler operationally and faster to start with than microservices; the downside is they get harder to evolve and scale as the codebase and team grow.',
  monorepo: 'A **monorepo** is a single repository that holds the source for many projects (libraries, services, apps), typically with a shared build system (Nx, Turborepo, Bazel, pnpm workspaces). Trade-off: tighter cross-project refactoring and atomic commits, at the cost of more tooling and a larger working tree.',
  'rest api': 'A **REST API** is an HTTP API organized around *resources* (nouns), where standard HTTP verbs (GET, POST, PUT, DELETE) act on those resources and the server is stateless. Strict REST also expects HATEOAS \u2014 hypermedia links describing valid next actions \u2014 but in practice most "REST APIs" are HTTP/JSON APIs that follow the spirit.',
  graphql: '**GraphQL** is a query language and runtime for APIs in which the client specifies exactly which fields it wants and the server returns just that shape. A typed schema describes all available types and operations; queries fetch data, mutations change data, and subscriptions stream updates.',
  webhook: 'A **webhook** is a user-defined HTTP callback: when an event happens in one system, it sends an HTTP request (usually POST with a JSON payload) to a URL you registered, instead of you having to poll for changes.',
  cors: '**CORS (Cross-Origin Resource Sharing)** is the browser mechanism that controls which web origins are allowed to call your API. The server opts in by returning headers like `Access-Control-Allow-Origin`; for non-simple requests the browser first sends a preflight OPTIONS request.',
  'csrf': '**CSRF (Cross-Site Request Forgery)** is an attack where a malicious site causes a logged-in user\u2019s browser to send a state-changing request to a target site they\u2019re authenticated to. Standard defenses: SameSite cookies, CSRF tokens tied to the session, and same-origin checks on state-changing routes.',
  'xss': '**XSS (Cross-Site Scripting)** is an attack where untrusted content from one source ends up executed as script in another user\u2019s browser. Defenses: escape output by context, use a strict Content Security Policy, and prefer framework-provided sanitization over rolling your own.',
  'jwt': '**JWT (JSON Web Token)** is a compact, signed token format. It encodes a JSON payload (claims about a subject) in three base64url segments \u2014 header.payload.signature \u2014 so a server can verify the token was issued by it (or by a trusted party) without server-side session state.',
};

const DEFINE_RE = /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:define|explain|describe|what\s*(?:is|'s|are|does)|what\s+do\s+you\s+mean\s+by|tell\s+me\s+(?:what|about))\b[\s,]+/i;

function tryDefinition(content: string): FactShimResult | null {
  const trimmed = content.trim().replace(/[?.!]+$/g, '').trim();
  if (trimmed.length === 0 || trimmed.length > 160) return null;
  if (!DEFINE_RE.test(trimmed)) return null;
  // Strip leading phrasing to isolate the term being asked about.
  const stripped = trimmed.replace(DEFINE_RE, '').replace(/^(?:an?|the)\s+/i, '').toLowerCase();
  // Longest curated definition key wins. Compiled once (was: one regex per key,
  // every definition-shaped question).
  definitionMatcher ??= buildEntityMatcher(Object.keys(DEFINITION_FACTS));
  const key = definitionMatcher.match(stripped);
  if (key) return { reply: DEFINITION_FACTS[key], kind: 'fact-definition' };
  return null;
}
let definitionMatcher: EntityMatcher | null = null;

function tryConceptualPrimer(content: string): FactShimResult | null {
  if (
    /\bcap\s+theorem\b/i.test(content)
    && /\b(?:fuzzy|trade-?offs?|honest\s+read|explain|describe|what(?:'s|\s+is)|how\s+does)\b/i.test(content)
  ) {
    return { reply: DEFINITION_FACTS['cap theorem'], kind: 'concept-primer' };
  }
  return null;
}

// ── public entry point ───────────────────────────────────────────────────
/**
 * True when the prompt is a *task* or open collaboration request that merely
 * mentions an entity, rather than a crisp definitional fact lookup. The
 * entity-definition handlers (company/country/person/brand) match on a bare
 * entity word anywhere in the text, so without this gate a long brief like
 * "review the app at github.com/... and fill the gaps" gets answered with a
 * canned "GITHUB was founded in 2008". We keep the gate narrow so genuine
 * one-line fact questions ("where is BMW headquartered?") still pass through.
 */
export function looksLikeTaskNotFactLookup(content: string): boolean {
  const c = content.trim();
  const lower = c.toLowerCase();

  // A URL almost always means "do something with this thing", not "define it".
  if (/https?:\/\/|\bwww\.|\b[\w-]+\.(?:com|io|dev|org|net|app|ai)\b/i.test(c)) return true;

  // Long multi-sentence briefs are tasks, not lookups. A real fact question is short.
  const sentenceCount = (c.match(/[.!?](?:\s|$)/g) ?? []).length;
  if (c.length > 240 || sentenceCount >= 3) return true;

  // Imperative / collaboration verbs that signal an action request. Anchored so
  // they only count near the start of a clause, not buried mid-sentence.
  const taskVerb = /(?:^|\b)(?:review|build|create|make me|help( me)?|let'?s|let us|fix|refactor|implement|design|write me|generate|set up|debug|analyze|analyse|improve|finish|complete|walk me through|tell me a (?:story|joke|poem)|i have a|i'?m working on|i started|i'?ve been (?:building|working))\b/i;
  if (taskVerb.test(lower)) return true;

  return false;
}

export function tryEmitFactShim(input: { content: string; intent?: string; priorIdiom?: IdiomContext; codeSnippetOnly?: boolean; explainConcept?: ConceptExplainer }): FactShimResult | null {
  const content = (input.content || '').trim();
  if (!content) return null;

  // The code-idiom resolver answers concrete, self-contained code requests
  // ("the dedupe snippet in typescript"). A request this explicit is never an
  // accidental steal of a grounded follow-up, so it runs FIRST and is allowed
  // even when the caller restricts to code-only (a contextual follow-up that
  // shares topic with the prior turn). This is what lets "ignore that, just
  // give me the dedupe snippet" win over the corpus-retrieval lottery.
  const codeSnippet = tryCodeSnippet(content, input.priorIdiom);
  if (codeSnippet) return codeSnippet;
  if (input.codeSnippetOnly) return null;

  // Always-on handlers: safety, runnable code, troubleshooting, comparisons,
  // meta, casual, how-to. These are appropriate regardless of question intent.
  const early = (
    trySafetyRefusal(content)
    || trySingleton(content)
    || tryTroubleshoot(content)
    || tryCompare(content)
    || tryCompareIdioms(content, input.explainConcept)
    || tryMeta(content)
    || tryCasualCheer(content)
    || tryHowto(content)
  );
  if (early) return early;

  // Intent gate: the handlers below all answer "what is X" definitionally. That
  // is the wrong answer for an action yes/no question ("does X make Y?"), which
  // must be answered yes/no — so we defer those to the yes/no pipeline instead
  // of dumping an entity definition.
  if (input.intent === 'action-yesno') return null;

  // Task gate: the entity-definition handlers below match on a bare entity word
  // anywhere in the prompt (findEntity + word boundary). That silently hijacks
  // real *tasks* that merely mention an entity — e.g.
  //   "review the web app at github.com/... and find the gaps"  → "GITHUB was founded in 2008"
  //   "I have a web app I started long ago"                     → "<company> was founded…"
  // Those proved live in the bridge transcript at 0.96 confidence. If the prompt
  // reads as a task or open request (URL, imperative verb, long multi-sentence
  // brief) rather than a crisp fact lookup, defer to the real pipeline.
  if (looksLikeTaskNotFactLookup(content)) return null;

  return (
    tryConceptualPrimer(content)
    || tryAcronym(content)
    || tryDefinition(content)
    || tryCompany(content)
    || tryBrand(content)
    || tryPerson(content)
    || tryCountryLocation(content)
    || tryCountry(content)
  );
}
