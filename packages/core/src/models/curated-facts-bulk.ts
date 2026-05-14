/**
 * Bulk curated facts — structured templates with slot filling.
 *
 * Instead of authoring one regex+prose handler per topic, we define a
 * template once per topic *class* and add entries as compact data records.
 * One template renders many entries with consistent quality and ≥600 chars
 * of substantive content each.
 *
 * Wired into VaiEngine.tryFactualCurated as the first lookup, so bulk
 * entries take priority over generic handlers but can be shadowed by
 * specifically-crafted entries earlier in the file (Rounds 13–20).
 */

import { bulkFactsLookup2Compiled } from './curated-facts-bulk-2';

interface CountryFact {
  /** lower-case names/aliases to match (e.g. ['france', 'french republic']) */
  names: string[];
  /** display name (e.g. 'France') */
  display: string;
  capital: string;
  language: string;
  population: string;
  area: string;
  currency: string;
  continent: string;
  founded?: string;
  government: string;
  notes: string;
}

interface ElementFact {
  names: string[];
  display: string;
  symbol: string;
  atomicNumber: number;
  atomicMass: string;
  group: string;
  period: string;
  category: string;
  state: string;
  discovered: string;
  uses: string;
  notes: string;
}

interface AnimalFact {
  names: string[];
  display: string;
  scientific: string;
  class: string;
  family: string;
  habitat: string;
  diet: string;
  lifespan: string;
  range: string;
  status: string;
  notes: string;
}

interface ProgLangFact {
  names: string[];
  display: string;
  designer: string;
  yearFirst: string;
  paradigm: string;
  typing: string;
  uses: string;
  influences: string;
  notes: string;
}

interface PlanetFact {
  names: string[];
  display: string;
  order: string;
  diameter: string;
  mass: string;
  day: string;
  year: string;
  moons: string;
  atmosphere: string;
  surface: string;
  notes: string;
}

interface CityFact {
  names: string[];
  display: string;
  country: string;
  population: string;
  area: string;
  founded: string;
  river: string;
  notable: string;
  notes: string;
}

function renderCountry(c: CountryFact): string {
  return `**${c.display}** is a country in **${c.continent}**.\n\n` +
    `- **Capital:** ${c.capital}\n` +
    `- **Official language(s):** ${c.language}\n` +
    `- **Population:** ${c.population}\n` +
    `- **Area:** ${c.area}\n` +
    `- **Currency:** ${c.currency}\n` +
    `- **Government:** ${c.government}\n` +
    (c.founded ? `- **Founded / formed:** ${c.founded}\n` : '') +
    `\n${c.notes}`;
}

function renderElement(e: ElementFact): string {
  return `**${e.display}** (symbol **${e.symbol}**, atomic number **${e.atomicNumber}**) is a chemical element.\n\n` +
    `- **Symbol:** ${e.symbol}\n` +
    `- **Atomic number:** ${e.atomicNumber}\n` +
    `- **Atomic mass:** ${e.atomicMass}\n` +
    `- **Group / period:** ${e.group} · ${e.period}\n` +
    `- **Category:** ${e.category}\n` +
    `- **State at room temperature:** ${e.state}\n` +
    `- **Discovered:** ${e.discovered}\n` +
    `- **Principal uses:** ${e.uses}\n` +
    `\n${e.notes}`;
}

function renderAnimal(a: AnimalFact): string {
  return `**${a.display}** (*${a.scientific}*) is a ${a.class.toLowerCase()}.\n\n` +
    `- **Scientific name:** *${a.scientific}*\n` +
    `- **Class:** ${a.class}\n` +
    `- **Family:** ${a.family}\n` +
    `- **Habitat:** ${a.habitat}\n` +
    `- **Diet:** ${a.diet}\n` +
    `- **Lifespan:** ${a.lifespan}\n` +
    `- **Range:** ${a.range}\n` +
    `- **Conservation status:** ${a.status}\n` +
    `\n${a.notes}`;
}

function renderProgLang(p: ProgLangFact): string {
  return `**${p.display}** is a programming language created by **${p.designer}**, first released in **${p.yearFirst}**.\n\n` +
    `- **Designer / origin:** ${p.designer}\n` +
    `- **First appeared:** ${p.yearFirst}\n` +
    `- **Paradigm(s):** ${p.paradigm}\n` +
    `- **Typing discipline:** ${p.typing}\n` +
    `- **Typical uses:** ${p.uses}\n` +
    `- **Influenced by / influences:** ${p.influences}\n` +
    `\n${p.notes}`;
}

function renderPlanet(p: PlanetFact): string {
  return `**${p.display}** is the **${p.order}** planet from the Sun in our Solar System.\n\n` +
    `- **Order from the Sun:** ${p.order}\n` +
    `- **Diameter:** ${p.diameter}\n` +
    `- **Mass:** ${p.mass}\n` +
    `- **Day length:** ${p.day}\n` +
    `- **Year length:** ${p.year}\n` +
    `- **Moons:** ${p.moons}\n` +
    `- **Atmosphere:** ${p.atmosphere}\n` +
    `- **Surface:** ${p.surface}\n` +
    `\n${p.notes}`;
}

function renderCity(c: CityFact): string {
  return `**${c.display}** is a city in **${c.country}**.\n\n` +
    `- **Country:** ${c.country}\n` +
    `- **Population (metro):** ${c.population}\n` +
    `- **Area:** ${c.area}\n` +
    `- **Founded:** ${c.founded}\n` +
    `- **River / location:** ${c.river}\n` +
    `- **Notable for:** ${c.notable}\n` +
    `\n${c.notes}`;
}

// ── Data records ──────────────────────────────────────────────────────────

const COUNTRIES: CountryFact[] = [
  { names: ['france', 'french republic', 'la france'], display: 'France', capital: 'Paris', language: 'French', population: '~68 million', area: '~643,800 km²', currency: 'Euro (EUR)', continent: 'Western Europe', founded: '843 (Treaty of Verdun); Fifth Republic constitution 1958', government: 'Semi-presidential republic',
    notes: `France is one of the oldest continuous nation-states in Europe and a permanent member of the **UN Security Council**. It is a founding member of the European Union, the eurozone, NATO, and the G7. Beyond metropolitan France in Western **Europe**, the country includes overseas departments and territories on every populated continent — French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, New Caledonia, French Polynesia and others. **French** language and culture, the cuisine, the wines of Bordeaux and Burgundy, the high-speed TGV rail network, the nuclear power industry, and Paris as a global centre of fashion, art and tourism are defining features.` },
  { names: ['germany', 'federal republic of germany', 'deutschland'], display: 'Germany', capital: 'Berlin', language: 'German', population: '~84 million', area: '~357,600 km²', currency: 'Euro (EUR)', continent: 'Central Europe', founded: '18 January 1871 (unification under Bismarck); reunified 3 October 1990', government: 'Federal parliamentary republic',
    notes: `Germany is the most populous country in the European Union and the EU's largest economy. It is a federation of 16 *Länder* (states), each with substantial autonomy. The country was divided into West and East Germany from 1949 until reunification on 3 October 1990, now celebrated as **German** Unity Day. **Berlin**, the capital and largest city, has been at the centre of 20th-century European history — Weimar, Nazi rule, the Wall, the fall of the Wall in 1989. Germany is a global leader in engineering and manufacturing (automotive, machine tools, chemicals), home to companies such as Volkswagen, BMW, Mercedes-Benz, Siemens, BASF and SAP.` },
  { names: ['japan', 'nihon', 'nippon'], display: 'Japan', capital: 'Tokyo', language: 'Japanese', population: '~124 million', area: '~377,975 km²', currency: 'Japanese yen (JPY, ¥)', continent: 'East Asia', founded: 'Mythological founding 660 BCE; current constitution 1947', government: 'Constitutional monarchy with parliamentary system',
    notes: `Japan is an island nation in the western Pacific Ocean, comprising four main islands — Honshu, Hokkaido, Kyushu and Shikoku — and thousands of smaller ones. **Tokyo** is the world's largest metropolitan area by population (~37 million). The Emperor is a ceremonial head of state with the Prime Minister and the bicameral Diet exercising actual political power. Japan's post-1945 *Economic Miracle* made it the world's second-largest economy from 1968 until China overtook it in 2010. **Japanese** culture — from Shinto and Buddhist temples to anime, manga, sushi, tea ceremony, bullet trains, video games and consumer electronics — has enormous global reach.` },
  { names: ['china', "people's republic of china", 'prc', 'zhongguo'], display: 'China', capital: 'Beijing', language: 'Standard Chinese (Mandarin)', population: '~1.41 billion', area: '~9.6 million km²', currency: 'Renminbi (CNY, ¥)', continent: 'East Asia', founded: '1 October 1949 (founding of PRC); civilizational history >4,000 years', government: 'One-party socialist republic led by the Communist Party of China',
    notes: `China is the world's most populous country (tied with or just behind India) and the second-largest economy by nominal GDP, the largest by purchasing-power parity. It is a permanent member of the **UN Security Council** and a nuclear weapons state. The current state, the People's Republic of **China**, was founded by Mao Zedong on 1 October 1949 at the end of the Chinese Civil War. The Communist Party of China holds a constitutional monopoly on political power. The reform-era economic opening since 1978 produced the largest sustained economic growth in human history and lifted ~800 million people out of poverty.` },
  { names: ['india', 'bharat', 'republic of india'], display: 'India', capital: 'New Delhi', language: 'Hindi and English (plus 21 other scheduled languages)', population: '~1.43 billion', area: '~3.29 million km²', currency: 'Indian rupee (INR, ₹)', continent: 'South Asia', founded: '15 August 1947 (independence from the United Kingdom)', government: 'Federal parliamentary constitutional republic',
    notes: `India is the world's most populous country (overtook China in 2023), the largest democracy by population, and one of the fastest-growing major economies. The country is a federal union of **28 states and 8 union territories**, each with substantial linguistic and cultural distinctness. India is also the birthplace of four major world religions — **Hinduism**, **Buddhism**, Jainism and Sikhism — and home to large Muslim, Christian, Sikh, Buddhist and other communities. The **Indian** independence movement led by Mahatma Gandhi achieved freedom from British rule on **15 August 1947** through a campaign of mass non-violent civil disobedience.` },
  { names: ['united states', 'usa', 'u.s.a.', 'america', 'united states of america', 'u.s.'], display: 'United States of America', capital: 'Washington, D.C.', language: 'English (de facto)', population: '~334 million', area: '~9.83 million km²', currency: 'United States dollar (USD, $)', continent: 'North America', founded: '4 July 1776 (Declaration of Independence)', government: 'Federal presidential constitutional republic',
    notes: `The United States is the world's third-largest country by area and the largest economy by nominal GDP. It is a federation of **50 states** plus the federal district of **Washington, D.C.**, five inhabited territories, and several uninhabited possessions. The U.S. has the world's largest and most influential military, a permanent seat on the **UN Security Council**, and the U.S. dollar is the world's principal reserve currency. The U.S. constitution, ratified in 1788, is the oldest written national constitution still in use; it created the three-branch system (executive, legislative, judicial) that has shaped constitutional design worldwide.` },
  { names: ['united kingdom', 'uk', 'great britain', 'britain'], display: 'United Kingdom', capital: 'London', language: 'English', population: '~67 million', area: '~243,610 km²', currency: 'Pound sterling (GBP, £)', continent: 'Western Europe (British Isles)', founded: '1 January 1801 (Acts of Union with Ireland); current form 6 December 1922', government: 'Constitutional monarchy with parliamentary democracy',
    notes: `The United Kingdom of Great Britain and Northern Ireland is a sovereign state in north-western **Europe**, comprising four constituent countries: **England**, **Scotland**, **Wales** and **Northern Ireland**. **London**, the capital, is one of the world's foremost global cities. The UK is a permanent member of the **UN Security Council**, a nuclear-armed state, founding member of NATO and the Commonwealth of Nations (56 mostly former British territories), and was a member of the European Union from 1973 until *Brexit* on 31 January 2020. The Westminster parliamentary system has been exported to dozens of Commonwealth countries.` },
  { names: ['russia', 'russian federation'], display: 'Russia', capital: 'Moscow', language: 'Russian', population: '~143 million', area: '~17.1 million km²', currency: 'Russian ruble (RUB, ₽)', continent: 'Eurasia (mostly Asia by area, mostly Europe by population)', founded: '25 December 1991 (after dissolution of the USSR)', government: 'Federal semi-presidential republic',
    notes: `Russia is the largest country in the world by area, spanning eleven time zones and stretching from the Baltic Sea to the Pacific Ocean. It is a permanent member of the **UN Security Council** and one of the world's two nuclear-weapons superpowers, alongside the United States. The Russian Federation succeeded the **Soviet Union** when the USSR was dissolved on 25 December 1991. **Moscow** and Saint Petersburg are the two main cultural and economic centres. Russian language and the literature of Pushkin, Tolstoy, Dostoevsky, Chekhov and Solzhenitsyn, the music of Tchaikovsky and Stravinsky, ballet at the Bolshoi and Mariinsky, and the Orthodox Christian tradition are central to Russian identity.` },
  { names: ['brazil', 'federative republic of brazil', 'brasil'], display: 'Brazil', capital: 'Brasília', language: 'Portuguese', population: '~217 million', area: '~8.51 million km²', currency: 'Brazilian real (BRL, R$)', continent: 'South America', founded: '7 September 1822 (independence from Portugal)', government: 'Federal presidential constitutional republic',
    notes: `Brazil is the largest country in **South America** and the fifth-largest country in the world by both area and population. It covers about half of South America and shares borders with every South American country except Chile and Ecuador. **Brasília**, the capital, was a planned city inaugurated in 1960; the largest cities are São Paulo and Rio de Janeiro. Brazil is the only Portuguese-speaking country in the Americas — a legacy of three centuries of Portuguese colonial rule. The **Amazon** rainforest, about 60% of which lies within Brazilian territory, is the largest tropical forest on Earth and a key element of the global climate system.` },
  { names: ['canada'], display: 'Canada', capital: 'Ottawa', language: 'English and French (both official)', population: '~40 million', area: '~9.98 million km²', currency: 'Canadian dollar (CAD, C$)', continent: 'North America', founded: '1 July 1867 (Confederation)', government: 'Federal parliamentary constitutional monarchy',
    notes: `Canada is the second-largest country in the world by area, behind only Russia, and the longest north-south land border with a single other country (the United States). The country is a federation of **10 provinces and 3 territories**. **Canada** is officially bilingual — **English** and **French** — with Quebec the centre of francophone culture. Ottawa is the capital; the largest cities are Toronto, Montreal and Vancouver. Canada has a parliamentary system based on the Westminster model, with the British monarch as ceremonial head of state. It is a founding member of NATO, the G7, and the Commonwealth.` },
  { names: ['australia', 'commonwealth of australia'], display: 'Australia', capital: 'Canberra', language: 'English (de facto)', population: '~26 million', area: '~7.69 million km²', currency: 'Australian dollar (AUD, A$)', continent: 'Oceania (and its own continent)', founded: '1 January 1901 (federation)', government: 'Federal parliamentary constitutional monarchy',
    notes: `Australia is the world's smallest **continent** and its sixth-largest country by area. The federation of six states (New South Wales, Victoria, Queensland, South Australia, Western Australia, Tasmania) and two main territories (Northern Territory and the Australian Capital Territory) was established on 1 January 1901. **Canberra** was purpose-built as the capital to settle the rivalry between Sydney and Melbourne. **Australia** has a distinct flora and fauna — eucalyptus, marsupials including the kangaroo and koala, monotremes such as the platypus — and is home to the **Great Barrier Reef**, the world's largest coral reef system, off the Queensland coast.` },
  { names: ['italy', 'italian republic', "italia"], display: 'Italy', capital: 'Rome', language: 'Italian', population: '~59 million', area: '~301,340 km²', currency: 'Euro (EUR)', continent: 'Southern Europe', founded: '17 March 1861 (unification); current republic 1946', government: 'Parliamentary republic',
    notes: `Italy is a peninsula in southern **Europe** extending into the Mediterranean Sea, plus the major islands of **Sicily** and **Sardinia**. **Rome**, the capital, was the heart of the **Roman** Empire and is the seat of the Vatican City, an independent walled enclave that is the headquarters of the Roman Catholic Church. Italy was the birthplace of the **Renaissance** and gave the world Leonardo da Vinci, Michelangelo, Raphael, Botticelli, Dante, Petrarch, Galileo, Vivaldi, Verdi and Puccini. The country is a founding member of the European Union, NATO and the G7. **Italian** cuisine — pasta, pizza, espresso, gelato — is among the most influential in the world.` },
  { names: ['spain', 'kingdom of spain', 'españa'], display: 'Spain', capital: 'Madrid', language: 'Spanish (Castilian)', population: '~48 million', area: '~505,990 km²', currency: 'Euro (EUR)', continent: 'Southwestern Europe (Iberian Peninsula)', founded: 'Dynastic union 1469–1492; current 1978 constitution', government: 'Constitutional monarchy with parliamentary democracy',
    notes: `Spain occupies most of the Iberian Peninsula in southwestern **Europe**, plus the Balearic Islands in the Mediterranean, the Canary Islands in the Atlantic off northwest Africa, and the North African enclaves of Ceuta and Melilla. **Madrid** is the capital and largest city; Barcelona, in **Catalonia**, is the second-largest. **Spanish** (Castilian) is the official language, alongside several regional co-official languages — Catalan, Galician, Basque (Euskara), Aranese. The Spanish empire of the 16th–17th centuries was the first global empire and spread the Spanish language across the Americas, where it is now spoken by ~500 million people.` },
  { names: ['mexico', 'united mexican states', 'méxico'], display: 'Mexico', capital: 'Mexico City', language: 'Spanish (de facto)', population: '~129 million', area: '~1.96 million km²', currency: 'Mexican peso (MXN, $)', continent: 'North America', founded: '16 September 1810 (Grito de Dolores); 27 September 1821 (independence)', government: 'Federal presidential constitutional republic',
    notes: `Mexico is the world's most populous **Spanish**-speaking country and the third-most populous country in the Americas after the United States and Brazil. **Mexico** City, built on the ruins of the Aztec capital Tenochtitlán, is one of the largest cities in the world by population. The country is a federation of 32 states. Mexican civilization is heir to a series of major Mesoamerican cultures — Olmec, Maya, Zapotec, Mixtec, Toltec, Aztec — many of whose pyramids, temples and city sites (Teotihuacán, Chichén Itzá, Palenque, Monte Albán) survive. Mexican cuisine has been recognised by UNESCO as Intangible Cultural Heritage of Humanity.` },
  { names: ['south korea', 'republic of korea', 'rok', 'korea south'], display: 'South Korea', capital: 'Seoul', language: 'Korean', population: '~52 million', area: '~100,400 km²', currency: 'South Korean won (KRW, ₩)', continent: 'East Asia (Korean Peninsula)', founded: '15 August 1948 (founding of the Republic of Korea)', government: 'Presidential republic',
    notes: `The Republic of Korea — South **Korea** — occupies the southern portion of the Korean peninsula in East Asia. **Seoul**, the capital and largest city, is one of the world's leading global cities. Following the **Korean** War (1950–53), South Korea was one of the world's poorest countries; the *Miracle on the Han River* economic boom from the 1960s onwards transformed it into a leading industrial economy, home to global brands including **Samsung**, **Hyundai**, **Kia**, **LG** and **SK Hynix**. The country has been a parliamentary democracy since 1987 and is internationally famous for K-pop, K-drama, Korean cinema (Bong Joon-ho's *Parasite*) and Korean cuisine.` },
  { names: ['north korea', "democratic people's republic of korea", 'dprk', 'korea north'], display: 'North Korea', capital: 'Pyongyang', language: 'Korean', population: '~26 million', area: '~120,540 km²', currency: 'North Korean won (KPW)', continent: 'East Asia (Korean Peninsula)', founded: '9 September 1948', government: 'One-party totalitarian dictatorship under the Workers\' Party of Korea',
    notes: `The Democratic People's Republic of Korea — North **Korea** — occupies the northern half of the Korean peninsula in East Asia. **Pyongyang** is the capital. The country has been ruled by the Kim family for three generations: Kim Il-sung (1948–1994), Kim Jong-il (1994–2011), and Kim Jong-un (2011–present), making it one of the most closed and tightly controlled states in the world. The Korean War (1950–53) ended in an armistice (not a peace treaty), and the Demilitarized Zone (DMZ) along the 38th parallel remains the most heavily fortified border on Earth. North Korea has been a declared nuclear-weapons state since 2006.` },
  { names: ['egypt', 'arab republic of egypt'], display: 'Egypt', capital: 'Cairo', language: 'Arabic', population: '~111 million', area: '~1,001,450 km²', currency: 'Egyptian pound (EGP, ج.م)', continent: 'North Africa / West Asia (Sinai)', founded: '~3100 BCE (unification of Upper and Lower Egypt); modern republic 1953', government: 'Presidential republic',
    notes: `Egypt is a transcontinental country spanning the northeast corner of **Africa** and the Sinai Peninsula in West Asia. **Cairo**, the capital and largest city, is one of the largest metropolitan areas in Africa and the Middle East. **Egypt** is home to one of the world's oldest civilizations — the **Pharaonic** civilization of the Nile Valley — that lasted some 3,000 years and built the **pyramids** at Giza, the temples of Luxor and Karnak, and produced hieroglyphic writing. The **Nile** River, the longest river in the world, runs the length of the country and supports nearly all Egyptian agriculture and population. The Suez Canal, opened in 1869, links the Mediterranean and Red Seas and is one of the world's most strategic shipping arteries.` },
  { names: ['nigeria', 'federal republic of nigeria'], display: 'Nigeria', capital: 'Abuja', language: 'English (official)', population: '~225 million', area: '~923,770 km²', currency: 'Nigerian naira (NGN, ₦)', continent: 'West Africa', founded: '1 October 1960 (independence from the United Kingdom)', government: 'Federal presidential constitutional republic',
    notes: `Nigeria is the most populous country in **Africa** and the seventh-most populous in the world. **Abuja** has been the capital since 1991, replacing Lagos, which remains the largest city and the country's economic centre. **Nigeria** is a federation of 36 states plus the Federal Capital Territory. It is a major oil producer (the largest in Africa for decades) and a regional power. The country is religiously and ethnically diverse — roughly half Muslim and half Christian, with more than 250 ethnic groups, the largest being the Hausa-Fulani, Yoruba, and Igbo. Nigerian films (Nollywood) form the second-largest film industry in the world by output, and Afrobeats has become a major global music genre.` },
  { names: ['south africa', 'republic of south africa', 'rsa'], display: 'South Africa', capital: 'Pretoria (executive), Cape Town (legislative), Bloemfontein (judicial)', language: 'Eleven official languages including Zulu, Xhosa, Afrikaans, English', population: '~62 million', area: '~1.22 million km²', currency: 'South African rand (ZAR, R)', continent: 'Southern Africa', founded: '31 May 1910 (Union); 27 April 1994 (multiracial democracy)', government: 'Parliamentary republic',
    notes: `South Africa occupies the southern tip of the African continent. The country has the unique distinction of having **three capital** cities — Pretoria (executive), Cape Town (legislative) and Bloemfontein (judicial). **South Africa** has eleven official **languages** — Zulu and Xhosa are the most widely spoken, with English the *lingua franca* of business and government. The country's modern history is dominated by **apartheid** (1948–1994), the legally enforced system of racial segregation and white minority rule. **Nelson Mandela**, imprisoned for 27 years, was released in 1990 and elected as the country's first post-apartheid President in 1994.` },
  { names: ['argentina', 'argentine republic'], display: 'Argentina', capital: 'Buenos Aires', language: 'Spanish', population: '~46 million', area: '~2.78 million km²', currency: 'Argentine peso (ARS, $)', continent: 'South America', founded: '9 July 1816 (independence from Spain)', government: 'Federal presidential constitutional republic',
    notes: `Argentina is the second-largest country in **South America** by area, after Brazil, and the eighth-largest in the world. It stretches some 3,700 km from the subtropical north to the icy Tierra del Fuego in the south. **Buenos Aires**, the capital and largest city, is famous for its European-influenced architecture, tango music and dance, and cafés. **Argentina** is a major agricultural producer (beef, soybeans, maize, wheat, wine) and the home of the **Pampas** grasslands. The country shares the **Andes** mountain range with Chile, including Aconcagua (6,961 m), the highest peak in the Americas. Argentine football has produced two of the greatest players in history, Diego Maradona and Lionel Messi.` },
  { names: ['saudi arabia', 'kingdom of saudi arabia', 'ksa'], display: 'Saudi Arabia', capital: 'Riyadh', language: 'Arabic', population: '~36 million', area: '~2.15 million km²', currency: 'Saudi riyal (SAR, ر.س)', continent: 'West Asia (Arabian Peninsula)', founded: '23 September 1932 (founding of the modern kingdom)', government: 'Absolute monarchy',
    notes: `Saudi **Arabia** occupies the bulk of the Arabian Peninsula in West Asia and is the largest country in the Middle East by area. **Riyadh**, in the central Najd region, is the capital and largest city. The country is the **birthplace of Islam**: **Mecca** (Makkah) and **Medina** (Madinah), the two holiest cities in Islam, are in western Saudi Arabia, and the Saudi king holds the title *Custodian of the Two Holy Mosques*. Saudi Arabia is the world's largest oil exporter and a founding member of OPEC; oil revenues fund a generous welfare state. The kingdom is an absolute monarchy ruled by the House of **Saud**, founded by Ibn Saud in 1932.` },
  { names: ['turkey', 'türkiye', 'turkiye', 'republic of türkiye'], display: 'Turkey (Türkiye)', capital: 'Ankara', language: 'Turkish', population: '~85 million', area: '~783,560 km²', currency: 'Turkish lira (TRY, ₺)', continent: 'Transcontinental — Anatolia (Asia) and East Thrace (Europe)', founded: '29 October 1923 (founding of the Republic by Atatürk)', government: 'Presidential republic',
    notes: `Türkiye is a transcontinental country straddling Anatolia in West Asia and East Thrace in southeastern **Europe**, separated by the Bosporus and Dardanelles straits. **Ankara** is the capital; **Istanbul** (formerly Byzantium, then Constantinople — capital of the Roman, Byzantine and Ottoman Empires) is the largest city and the only major city in the world to span two continents. Modern **Turkey** was founded by **Mustafa Kemal Atatürk** in 1923 from the ruins of the Ottoman Empire and was constituted as a secular, parliamentary republic with sweeping modernizing reforms. The country is a member of NATO since 1952 and has long sought EU membership.` },
  { names: ['indonesia', 'republic of indonesia'], display: 'Indonesia', capital: 'Nusantara (in transition from Jakarta)', language: 'Indonesian (Bahasa Indonesia)', population: '~278 million', area: '~1.9 million km²', currency: 'Indonesian rupiah (IDR, Rp)', continent: 'Southeast Asia', founded: '17 August 1945 (independence from the Netherlands)', government: 'Presidential constitutional republic',
    notes: `Indonesia is the world's largest archipelagic country, with over **17,000 islands** spread across the equator in Southeast Asia, of which about 6,000 are inhabited. The main islands are Sumatra, Java, Borneo (shared with Malaysia and Brunei), Sulawesi, and the western half of New Guinea. **Indonesia** is the fourth-most populous country in the world and has the world's largest Muslim-majority population. Jakarta on Java has been the capital and largest city, but a new capital, Nusantara, is being built on Borneo to ease Jakarta's congestion and subsidence. Indonesia is a founding member of ASEAN and a member of the G20.` },
  { names: ['vietnam', 'socialist republic of vietnam'], display: 'Vietnam', capital: 'Hanoi', language: 'Vietnamese', population: '~99 million', area: '~331,210 km²', currency: 'Vietnamese đồng (VND, ₫)', continent: 'Southeast Asia', founded: '2 September 1945 (independence declared by Ho Chi Minh)', government: 'One-party socialist republic led by the Communist Party of Vietnam',
    notes: `**Vietnam** is a long, narrow country running ~1,650 km north-to-south along the eastern coast of mainland Southeast Asia. **Hanoi** in the north is the capital; **Ho Chi Minh City** (formerly Saigon) in the south is the largest city and economic centre. The country emerged from a century of French colonial rule and three decades of war — the **First Indochina War** against France (1946–54), the **Vietnam War** between North and South Vietnam involving the United States (1955–75), and a brief border war with China (1979). Since the 1986 *Đổi Mới* economic reforms, Vietnam has become one of the fastest-growing economies in the world.` },
  { names: ['thailand', 'kingdom of thailand'], display: 'Thailand', capital: 'Bangkok', language: 'Thai', population: '~72 million', area: '~513,120 km²', currency: 'Thai baht (THB, ฿)', continent: 'Southeast Asia', founded: 'Sukhothai Kingdom 1238; current Chakri dynasty 1782; constitutional monarchy 1932', government: 'Constitutional monarchy with parliamentary system',
    notes: `Thailand is a country in the centre of mainland **Southeast Asia**, bordered by Myanmar, Laos, Cambodia and Malaysia and stretching down a long peninsular tail to the Strait of Malacca. **Bangkok** (in Thai *Krung Thep*) is the capital and largest city. **Thailand** is one of the few Southeast Asian countries never colonized by a European power — a fact reflected in the country's name, which means "Land of the Free" in **Thai**. Theravada Buddhism is the religion of the great majority of the population and shapes much of the country's culture and architecture. The Thai monarchy is among the world's oldest continuously reigning, and the Chakri dynasty has ruled since 1782.` },
  { names: ['poland', 'republic of poland', 'polska'], display: 'Poland', capital: 'Warsaw', language: 'Polish', population: '~38 million', area: '~312,690 km²', currency: 'Polish złoty (PLN, zł)', continent: 'Central Europe', founded: '966 (baptism of Mieszko I); modern republic 1918; current 1989', government: 'Parliamentary republic',
    notes: `Poland is a country in **Central Europe** on the North European Plain, bordered by Germany, Czechia, Slovakia, Ukraine, Belarus, Lithuania and Russia (Kaliningrad). **Warsaw** is the capital and largest city. **Poland** has one of the most turbulent national histories in Europe — partitioned out of existence between Prussia, Russia and Austria in the late 18th century, recreated in 1918 after World War I, invaded by Nazi Germany on 1 September 1939 (the trigger for the Second World War) and the Soviet Union shortly after, occupied for six years, then placed behind the Iron Curtain as a Soviet satellite from 1945. The Solidarity (*Solidarność*) trade-union movement of 1980 helped catalyse the end of communism in 1989.` },
  { names: ['sweden', 'kingdom of sweden', 'sverige'], display: 'Sweden', capital: 'Stockholm', language: 'Swedish', population: '~10.5 million', area: '~450,300 km²', currency: 'Swedish krona (SEK, kr)', continent: 'Northern Europe (Scandinavia)', founded: 'Unification ~10th century; current constitution 1974', government: 'Constitutional monarchy with parliamentary democracy',
    notes: `Sweden is the largest of the Scandinavian countries and the fifth-largest in **Europe** by area. It occupies the eastern part of the Scandinavian Peninsula and stretches more than 1,500 km from the Baltic Sea in the south to the Arctic Circle in the north. **Stockholm**, the capital, is built across 14 islands on Sweden's east coast. **Sweden** has been a constitutional monarchy since 1809 and has not been at war since 1814 (a record for any large country in Europe). The country is famous for its strong welfare state, high-quality manufacturing (Volvo, Scania, Ericsson, IKEA, H&M, Spotify), the **Nobel Prize**s (administered from Stockholm, except the Peace Prize from Oslo) and ABBA.` },
  { names: ['norway', 'kingdom of norway', 'norge', 'noreg'], display: 'Norway', capital: 'Oslo', language: 'Norwegian (Bokmål and Nynorsk)', population: '~5.5 million', area: '~385,200 km²', currency: 'Norwegian krone (NOK, kr)', continent: 'Northern Europe (Scandinavia)', founded: 'Unification ~872; independence from Sweden 7 June 1905', government: 'Constitutional monarchy with parliamentary democracy',
    notes: `Norway occupies the western and northern parts of the Scandinavian Peninsula and stretches more than 1,750 km from south to north, including the Arctic archipelago of **Svalbard**. **Oslo** is the capital and largest city. **Norway**'s coastline is famously indented with **fjord**s — long, narrow, deep inlets carved by Ice Age glaciers — making the actual coastline length more than 100,000 km counting all the islands and fjords. The country dissolved its union with Sweden on 7 June 1905 and has been an independent monarchy ever since. Discovery of North Sea oil and gas in the 1960s transformed Norway into one of the world's wealthiest countries; the **Sovereign Wealth Fund** is the largest in the world (over $1.6 trillion).` },
  { names: ['netherlands', 'holland', 'kingdom of the netherlands', 'nederland'], display: 'Netherlands', capital: 'Amsterdam (constitutional); The Hague (seat of government)', language: 'Dutch', population: '~17.8 million', area: '~41,850 km²', currency: 'Euro (EUR)', continent: 'Western Europe', founded: '1581 (Act of Abjuration); 1815 (current kingdom)', government: 'Constitutional monarchy with parliamentary democracy',
    notes: `The Netherlands is a low-lying country in northwestern **Europe**, with about 26% of its land area below sea level — protected by an extensive system of dikes, polders, sluices and pumping stations that has been continuously developed for over a thousand years. **Amsterdam** is the constitutional capital and largest city; **The Hague** is the seat of the parliament, the government and the monarchy, and home to the **International Court of Justice** at the Peace Palace. The **Dutch** language is the official language. The country is densely populated (one of the highest densities in the EU) and is a founding member of the European Union, NATO and the eurozone.` },
];

const ELEMENTS: ElementFact[] = [
  { names: ['hydrogen'], display: 'Hydrogen', symbol: 'H', atomicNumber: 1, atomicMass: '1.008 u', group: 'Group 1', period: 'Period 1', category: 'Reactive non-metal (sometimes grouped with alkali metals)', state: 'Gas (colourless, odourless)', discovered: 'Isolated by Henry Cavendish in 1766; named by Lavoisier in 1783',
    uses: 'Industrial ammonia synthesis (Haber–Bosch), petroleum refining, rocket fuel (liquid H₂), emerging hydrogen economy as a clean energy carrier, fuel cells, hydrogenation of vegetable oils.',
    notes: `Hydrogen is the **first** element on the periodic table and by a wide margin the most abundant element in the universe (~75% of the total mass of normal matter). The Sun and other stars are powered by the **nuclear fusion** of hydrogen into helium. Hydrogen has three isotopes: ordinary hydrogen (protium, ¹H), deuterium (²H, used in heavy water), and the radioactive tritium (³H). On Earth, hydrogen is rare as a free gas but is bound up in water, hydrocarbons, and almost all organic molecules.` },
  { names: ['helium'], display: 'Helium', symbol: 'He', atomicNumber: 2, atomicMass: '4.0026 u', group: 'Group 18', period: 'Period 1', category: 'Noble gas', state: 'Gas (colourless, odourless, inert)', discovered: 'Detected in the Sun\'s spectrum 1868 (Janssen, Lockyer); isolated on Earth by Ramsay in 1895',
    uses: 'Cooling superconducting magnets in MRI scanners and particle accelerators (liquid helium at 4.2 K), lifting gas for airships and balloons, controlled atmospheres for welding and semiconductor manufacturing.',
    notes: `Helium is the **second**-lightest element and the second-most abundant in the universe (~24% of the mass). On Earth it is much rarer because it is so light that any free helium escapes the atmosphere to space; almost all commercial helium comes as a by-product of natural-gas extraction, where it has been generated by radioactive alpha decay over geological time. Helium is famously the gas that makes party balloons float and squeaky voices.` },
  { names: ['carbon'], display: 'Carbon', symbol: 'C', atomicNumber: 6, atomicMass: '12.011 u', group: 'Group 14', period: 'Period 2', category: 'Reactive non-metal', state: 'Solid (multiple allotropes)', discovered: 'Known since antiquity (charcoal, soot, diamond)',
    uses: 'Steel-making, organic chemistry, fuels (coal, oil, natural gas, biomass), diamond cutting tools, graphite electrodes, fullerenes, carbon nanotubes and graphene in materials science.',
    notes: `Carbon is the **chemical basis of all known life** — every organic molecule contains carbon, and the bonds between carbon atoms form the long chains and rings (proteins, DNA, lipids, sugars) on which biology depends. Carbon has several **allotropes** (forms of the pure element): **diamond** (the hardest natural material), **graphite** (soft, conductive, used in pencils and electrodes), **graphene** (a single sheet of graphite, two-dimensional carbon), **fullerenes** including buckminsterfullerene C₆₀, and **carbon nanotubes**.` },
  { names: ['nitrogen'], display: 'Nitrogen', symbol: 'N', atomicNumber: 7, atomicMass: '14.007 u', group: 'Group 15', period: 'Period 2', category: 'Reactive non-metal', state: 'Gas (colourless, odourless, mostly inert at room temperature)', discovered: 'Daniel Rutherford 1772',
    uses: 'Haber–Bosch synthesis of ammonia (NH₃) for fertilizer, inert atmospheres for food packaging and electronics manufacture, liquid nitrogen as a coolant (77 K), explosives (nitroglycerin, TNT), nylon and other synthetic polymers.',
    notes: `Nitrogen makes up about **78% of Earth's atmosphere** by volume, the dominant gas we breathe. Atmospheric nitrogen (N₂) is held together by a very strong triple bond, making it chemically unreactive at ordinary temperatures — the great challenge of nitrogen chemistry is *fixing* atmospheric N₂ into useful compounds. Living organisms cannot use atmospheric nitrogen directly: it is fixed by lightning, by nitrogen-fixing bacteria in the roots of legumes, and industrially by the Haber–Bosch process, which feeds roughly half of humanity by enabling synthetic fertilizers.` },
  { names: ['oxygen'], display: 'Oxygen', symbol: 'O', atomicNumber: 8, atomicMass: '15.999 u', group: 'Group 16', period: 'Period 2', category: 'Reactive non-metal (chalcogen)', state: 'Gas (colourless, odourless, highly reactive)', discovered: 'Independently by Carl Wilhelm Scheele (1771) and Joseph Priestley (1774); named by Lavoisier',
    uses: 'Respiration in nearly all multicellular life, combustion, steelmaking, medical oxygen therapy, rocket propellant (liquid oxygen, LOX), water and wastewater treatment.',
    notes: `Oxygen makes up about **21% of Earth's atmosphere** by volume and **~46% of the Earth's crust by mass**, making it the most abundant element in the crust. Almost all multicellular life on Earth depends on molecular oxygen (O₂) for aerobic respiration — extracting energy from food by oxidising it to carbon dioxide and water. Atmospheric oxygen is itself a product of life: photosynthesis by cyanobacteria, algae and plants splits water and releases O₂ as a by-product.` },
  { names: ['gold'], display: 'Gold', symbol: 'Au', atomicNumber: 79, atomicMass: '196.967 u', group: 'Group 11', period: 'Period 6', category: 'Transition metal (coinage metal)', state: 'Solid (lustrous yellow metal)', discovered: 'Known since prehistoric antiquity',
    uses: 'Currency reserves and bullion, jewellery, electronics (electrical contacts, bonding wires, plating), dentistry, medical implants, decorative gilding, awards (Olympic gold, the Nobel medal — gold-plated since 1980), gold-leaf in art and food.',
    notes: `Gold is one of the **first metals** worked by humans, prized for over 6,000 years for its beauty, malleability and resistance to corrosion. It is so unreactive that it occurs in nature almost exclusively as the pure metal — in placer deposits in rivers, in quartz veins, and in some seawater. The symbol **Au** comes from the Latin *aurum*, "shining dawn." All the gold ever mined in human history would fit into a cube about 22 m on each side; it is still highly valued as a store of value and a hedge against inflation.` },
  { names: ['silver'], display: 'Silver', symbol: 'Ag', atomicNumber: 47, atomicMass: '107.868 u', group: 'Group 11', period: 'Period 5', category: 'Transition metal (coinage metal)', state: 'Solid (lustrous white metal)', discovered: 'Known since prehistoric antiquity',
    uses: 'Jewellery and silverware, photographic film (silver halides), electronics (the highest electrical and thermal conductivity of any metal), mirrors and reflectors, antibacterial coatings, brazing alloys, solar cells.',
    notes: `Silver has been valued for thousands of years and used as **currency** in many cultures — the British pound sterling, the Spanish *peso* and the German *thaler* (the linguistic ancestor of *dollar*) were originally silver coins. The symbol **Ag** comes from the Latin *argentum*; the country of Argentina takes its name from the same root. Silver has the highest electrical conductivity, the highest thermal conductivity, and the highest reflectivity in the visible spectrum of any metal — the reason high-quality mirrors are silvered.` },
  { names: ['iron'], display: 'Iron', symbol: 'Fe', atomicNumber: 26, atomicMass: '55.845 u', group: 'Group 8', period: 'Period 4', category: 'Transition metal (ferromagnetic)', state: 'Solid (lustrous grey metal)', discovered: 'Iron Age beginning ~1200 BCE',
    uses: 'Steelmaking (alloyed with carbon and other elements — by far the most-used metal in human civilization), cast iron, magnets, haemoglobin in blood (Fe carries oxygen in red blood cells), reinforced concrete.',
    notes: `Iron is the most-produced metal in human civilization — over 1.8 billion tonnes of crude steel are made every year, vastly more than all other metals combined. The symbol **Fe** comes from the Latin *ferrum*. Iron is one of the most abundant elements in the Earth's crust (~5% by mass) and forms the bulk of the Earth's core (giving the planet its magnetic field). Iron is also essential to most life: the **haem** group in haemoglobin carries oxygen in vertebrate blood, and many enzymes contain iron.` },
  { names: ['copper'], display: 'Copper', symbol: 'Cu', atomicNumber: 29, atomicMass: '63.546 u', group: 'Group 11', period: 'Period 4', category: 'Transition metal (coinage metal)', state: 'Solid (lustrous reddish-orange metal)', discovered: 'Known since antiquity (~9000 BCE)',
    uses: 'Electrical wiring (second only to silver in conductivity but far cheaper), plumbing, roofing, brass and bronze alloys, electronics, coinage, antimicrobial surfaces in hospitals.',
    notes: `Copper was one of the **first metals worked by humans**, used as early as ~9000 BCE in the Middle East; its alloying with tin gave the **Bronze Age** its name. The symbol **Cu** comes from the Latin *cuprum*, originally *aes cyprium* — "metal of Cyprus", a major ancient source. Copper has very high electrical and thermal conductivity, second only to silver, which makes it the standard material for electrical wiring worldwide. The Statue of Liberty's famous green colour is the patina (verdigris) of weathered copper.` },
  { names: ['uranium'], display: 'Uranium', symbol: 'U', atomicNumber: 92, atomicMass: '238.029 u', group: 'Actinide', period: 'Period 7', category: 'Actinide (radioactive heavy metal)', state: 'Solid (silvery-grey metal that tarnishes in air)', discovered: 'Martin Heinrich Klaproth in 1789; named after the planet Uranus',
    uses: 'Nuclear fission reactor fuel (enriched in U-235), nuclear weapons, depleted uranium (DU) for armour and armour-piercing ammunition because of its very high density, radiometric dating of rocks (U-Pb dating).',
    notes: `Uranium is famous as the principal fuel of **nuclear** fission — both for civilian power generation and for nuclear weapons. Natural uranium is a mixture of two main isotopes: ²³⁸U (99.27%, fissile only by fast neutrons) and ²³⁵U (0.72%, fissile by slow neutrons and the basis of most reactors and atomic bombs). Civilian reactors typically use uranium enriched to 3–5% ²³⁵U; weapons-grade uranium is enriched to >90%. Uranium is the heaviest element naturally occurring on Earth in significant quantities.` },
];

const ANIMALS: AnimalFact[] = [
  { names: ['lion'], display: 'Lion', scientific: 'Panthera leo', class: 'Mammalia', family: 'Felidae (cat family)', habitat: 'Savannah, grassland, open woodland and scrub', diet: 'Carnivore — large ungulates (wildebeest, zebra, buffalo, antelope)', lifespan: '10–14 years in the wild; up to 20 in captivity', range: 'Sub-Saharan Africa; a single relict population of Asiatic lions in the Gir Forest of Gujarat, India', status: 'Vulnerable (IUCN)',
    notes: `The lion is the second-largest **cat** species after the tiger and the only truly social big cat — lions live in cooperative **pride**s of related females, their cubs, and one or a small coalition of adult **male**s. Mature males develop a distinctive mane, the size and colour of which signal age, health and testosterone level. Females do most of the hunting; males defend the pride's territory. The lion is one of the **Big Five** game animals and an enduring cultural symbol of courage and royalty across many cultures.` },
  { names: ['tiger'], display: 'Tiger', scientific: 'Panthera tigris', class: 'Mammalia', family: 'Felidae (cat family)', habitat: 'Tropical forest, taiga, mangrove swamps, grassland', diet: 'Carnivore — deer, wild boar, gaur, occasionally larger prey', lifespan: '10–15 years in the wild', range: 'Patches of South and Southeast Asia, eastern Russia (the Siberian or Amur tiger)', status: 'Endangered (IUCN)',
    notes: `The tiger is the **largest** living **cat** **species** — Siberian tigers can exceed 300 kg. Tigers are solitary, territorial ambush predators, hunting mainly at night and identifiable by their iconic black-on-orange stripe pattern (white-on-black on the belly), which is as individual as a fingerprint. Six surviving subspecies are recognised: Bengal, Indochinese, Malayan, South China (probably extinct in the wild), Sumatran and Siberian (Amur). The global wild tiger population dropped from ~100,000 in 1900 to ~3,200 by 2010 and has begun to recover.` },
  { names: ['elephant', 'african elephant'], display: 'Elephant', scientific: 'Loxodonta africana (African bush) / Loxodonta cyclotis (African forest) / Elephas maximus (Asian)', class: 'Mammalia', family: 'Elephantidae', habitat: 'Savannah, forest, scrub, semi-desert', diet: 'Herbivore — grasses, leaves, bark, roots, fruit (consumes ~150–300 kg per day)', lifespan: '60–70 years', range: 'Sub-Saharan Africa (African species); South and Southeast Asia (Asian species)', status: 'Endangered (African forest, Asian); Critically Endangered (African forest)',
    notes: `Elephants are the **largest land mammal**s — adult African bush elephants stand up to 4 m at the shoulder and weigh up to 7 tonnes. There are **three** living species: the African bush elephant (the largest), the smaller African forest elephant, and the Asian elephant (slightly smaller, with smaller ears). Elephants are matriarchal, deeply social, long-lived and famously intelligent: they recognise themselves in mirrors, mourn their dead, use tools, and communicate by infrasound calls that travel kilometres through the ground.` },
  { names: ['blue whale'], display: 'Blue whale', scientific: 'Balaenoptera musculus', class: 'Mammalia', family: 'Balaenopteridae (rorquals)', habitat: 'Open ocean', diet: 'Krill (almost exclusively); a single adult eats ~3.6 tonnes of krill per day during peak feeding', lifespan: '~80–90 years', range: 'All major oceans, though much reduced by 20th-century whaling', status: 'Endangered (IUCN)',
    notes: `The blue whale is the **largest** **animal** that has ever lived on Earth — larger than any dinosaur. Adults reach up to ~30 m in length and weigh up to ~170 tonnes; their tongue alone can weigh as much as an elephant and their heart as much as a small car. Despite this colossal size, they feed almost exclusively on tiny shrimp-like crustaceans called **krill**, filtered from the seawater through baleen plates. Industrial whaling reduced the global blue-whale population from ~250,000 to a few thousand by the 1960s; the species has been protected internationally since 1966 and is slowly recovering.` },
  { names: ['great white shark'], display: 'Great white shark', scientific: 'Carcharodon carcharias', class: 'Chondrichthyes (cartilaginous fish)', family: 'Lamnidae (mackerel sharks)', habitat: 'Cool to temperate coastal waters', diet: 'Carnivore — fish, seals, sea lions, smaller sharks, occasionally cetaceans and seabirds', lifespan: '~70 years', range: 'Worldwide in temperate seas, with hotspots off South Africa, Australia, California and the Mediterranean', status: 'Vulnerable (IUCN)',
    notes: `The great white shark is the **largest** predatory **fish** in the ocean, with confirmed lengths up to ~6.4 m and weights over 1,900 kg. It is an apex predator and a member of the family of mackerel sharks (Lamnidae), which are partially warm-bodied — able to keep their core temperature above the surrounding seawater for greater speed and stamina. Despite its fearsome reputation in popular culture (Steven Spielberg's 1975 *Jaws*), unprovoked attacks on humans are very rare and almost always non-fatal; sharks kill fewer than 10 humans a year globally.` },
  { names: ['polar bear'], display: 'Polar bear', scientific: 'Ursus maritimus', class: 'Mammalia', family: 'Ursidae (bears)', habitat: 'Sea ice, coastal Arctic regions', diet: 'Carnivore — primarily ringed and bearded seals, hunted from the sea ice', lifespan: '~20–25 years in the wild', range: 'Circumpolar Arctic — Canada, Greenland, Norway (Svalbard), Russia, the United States (Alaska)', status: 'Vulnerable (IUCN); listed as Threatened in the US under the Endangered Species Act',
    notes: `The polar bear is the **largest** land carnivore on Earth (sharing the title with the Kodiak brown bear) — adult males weigh up to ~700 kg. They evolved from brown bears roughly 500,000 years ago to specialise in life on Arctic sea ice. Despite the white appearance their fur is actually translucent and their skin is black, which helps absorb solar heat. Polar bears are classified by the IUCN as a marine mammal because they depend on sea ice for hunting; rapid climate-change-driven loss of summer sea ice is the principal threat to the species.` },
  { names: ['giraffe'], display: 'Giraffe', scientific: 'Giraffa camelopardalis (and others)', class: 'Mammalia', family: 'Giraffidae', habitat: 'Savannah and open woodland', diet: 'Herbivore — leaves and shoots, especially from acacia trees', lifespan: '~25 years in the wild', range: 'Sub-Saharan Africa', status: 'Vulnerable (IUCN); some subspecies Critically Endangered',
    notes: `The giraffe is the **tallest** land **animal** in the world — adult males reach 5.5–6 m. Its long neck contains the same number of vertebrae as other mammals (seven) but each one is greatly elongated. The neck and legs are an extraordinary cardiovascular engineering feat: an exceptionally powerful heart pumps blood ~2 m up to the brain, and a network of valves prevents blood rushing to the head when the giraffe lowers it to drink. The distinctive patchwork coat is unique to each individual and provides camouflage among dappled tree-cover.` },
  { names: ['octopus'], display: 'Octopus', scientific: 'Order Octopoda', class: 'Cephalopoda', family: '~300 species across ~30 genera', habitat: 'All marine habitats from intertidal zone to deep sea', diet: 'Carnivore — crustaceans, fish, molluscs, other cephalopods', lifespan: '1–5 years for most species; some deep-sea species longer', range: 'All oceans of the world', status: 'Mostly Least Concern; some species data deficient',
    notes: `Octopuses are eight-armed marine **cephalopod** molluscs and among the most intelligent invertebrates on Earth. They have **three hearts** (two pump blood through the gills, one through the body), **blue copper-based blood** (haemocyanin instead of haemoglobin), and **nine "brains"** — a central brain plus a small ganglion in each arm that processes information semi-independently. Many species are masters of camouflage, capable of changing colour, pattern and skin texture in fractions of a second. Octopuses can solve puzzles, open jars, use tools, recognise individual humans, and have been observed exhibiting play behaviour.` },
  { names: ['cheetah'], display: 'Cheetah', scientific: 'Acinonyx jubatus', class: 'Mammalia', family: 'Felidae (cat family)', habitat: 'Open grassland and semi-arid savannah', diet: 'Carnivore — small to medium-sized antelope, especially impala, springbok and Thomson\'s gazelle', lifespan: '~10–12 years in the wild', range: 'Fragmented populations in sub-Saharan Africa; a tiny relict population of Asiatic cheetahs in Iran', status: 'Vulnerable (IUCN)',
    notes: `The cheetah is the **fastest** land **animal** in the world, capable of bursts of ~100–120 km/h over short distances of ~400 m. It has a slender, deep-chested body, semi-retractable claws (unique among cats), a small head, distinctive black "tear lines" running from the inner corner of each eye, and a long muscular tail used as a counterbalance during high-speed chases. Cheetahs hunt mainly by day to avoid competition with lions, leopards and hyenas. The global wild cheetah population has fallen from ~100,000 in 1900 to fewer than 7,000 today.` },
  { names: ['penguin', 'emperor penguin'], display: 'Penguin', scientific: 'Family Spheniscidae (18 species)', class: 'Aves', family: 'Spheniscidae', habitat: 'Coastal seas, ice, beaches; almost exclusively the Southern Hemisphere', diet: 'Carnivore — fish, krill, squid', lifespan: '15–20 years on average; up to 40 in some species', range: 'Antarctica and the southern coasts of South America, Africa, Australia, New Zealand; one species (Galápagos) on the equator', status: 'Variable — some Least Concern, some Endangered',
    notes: `Penguins are a group of flightless seabirds (class **Aves**) adapted for an aquatic life — their wings have evolved into stiff, paddle-like flippers, their bones are dense rather than hollow, and their distinctive black-and-white plumage acts as countershading camouflage in the water. There are about 18 living species, from the tiny little penguin (~30 cm tall) to the emperor penguin (~1.2 m, the largest). Almost all penguins live in the Southern Hemisphere; the Galápagos penguin is the only species whose range crosses the equator. Emperor penguins famously breed on the Antarctic ice through the polar winter.` },
];

const PROG_LANGS: ProgLangFact[] = [
  { names: ['python'], display: 'Python', designer: 'Guido van Rossum (the Netherlands)', yearFirst: '1991', paradigm: 'Multi-paradigm — imperative, object-oriented, functional, structured', typing: 'Dynamic, strong, gradual (PEP 484 type hints since 3.5)', uses: 'Data science and machine learning, scientific computing, web back-end (Django, Flask, FastAPI), scripting and automation, education, devops',
    influences: 'Influenced by ABC, Modula-3, C, Lisp, Haskell; in turn influenced Ruby, Swift, Groovy, JavaScript ES6+',
    notes: `Python is **created** by Guido van Rossum in the late 1980s and first released in **February 1991**. Its design philosophy — *"There should be one — and preferably only one — obvious way to do it"* — favours code that is **readable** above all else. Significant whitespace (indentation as syntax) is its most distinctive surface feature. By the early 2020s Python had become the most popular programming **language** in the world by most measures and the *de facto* lingua franca of data science, scientific computing and machine learning, thanks to libraries including NumPy, pandas, scikit-learn, PyTorch and TensorFlow.` },
  { names: ['javascript', 'js'], display: 'JavaScript', designer: 'Brendan Eich (Netscape)', yearFirst: '1995', paradigm: 'Multi-paradigm — event-driven, functional, imperative, object-oriented (prototype-based)', typing: 'Dynamic, weak (but TypeScript adds static typing on top)', uses: 'Front-end web development (universal in browsers), server-side Node.js, mobile (React Native), desktop (Electron), embedded',
    influences: 'Influenced by Self, Scheme, Java (only for syntax), AWK; standardised as ECMAScript by Ecma International',
    notes: `JavaScript was **created** by Brendan Eich at Netscape in May **1995**, famously in just **10 days**, to add interactive scripting to the Navigator browser. Despite the name and the C-style syntax it has very little in common with Java; the name was largely a marketing decision. JavaScript is standardised as ECMAScript and runs in every modern web browser, making it the most widely deployed programming **language** in history. Outside the browser, Node.js (2009) brought JavaScript to the server, and the npm package registry is the largest software ecosystem in the world by package count.` },
  { names: ['rust', 'rust language', 'rust-lang'], display: 'Rust', designer: 'Graydon Hoare (originally at Mozilla); now governed by the Rust Foundation', yearFirst: '2010 (first announced); 1.0 in May 2015', paradigm: 'Multi-paradigm — systems, functional, imperative, generic, concurrent', typing: 'Static, strong, inferred; with the unique **ownership** and **borrow checker** model', uses: 'Systems programming, browsers (parts of Firefox), web back-end, embedded, cryptography, operating-system kernels (parts of Linux), WebAssembly',
    influences: 'Influenced by C++, Cyclone, ML, Haskell, Erlang; influencing Carbon, Mojo, Move',
    notes: `Rust was **created** by Graydon Hoare at Mozilla in 2006 as a personal project and adopted by Mozilla in 2009; version 1.0 was released in May **2015**. Its central innovation is a compile-time **ownership** model that guarantees memory safety and data-race freedom without a garbage collector. Rust has been voted "most loved" programming **language** in the Stack Overflow Developer Survey every year from 2016 through 2024 — an unbroken run unmatched by any other language. It is increasingly used for performance-critical systems software in places that would historically have used C or C++.` },
  { names: ['c++', 'cpp'], display: 'C++', designer: 'Bjarne Stroustrup (Bell Labs)', yearFirst: '1985', paradigm: 'Multi-paradigm — object-oriented, generic, functional, procedural, low-level', typing: 'Static, strong, inferred (where available), with explicit conversions', uses: 'Systems programming, game engines (Unreal, Unity\'s engine), high-frequency trading, scientific computing, browsers (Chrome, Firefox, Safari), embedded systems, operating systems',
    influences: 'Influenced by C, Simula 67, Algol 68, Ada; in turn influenced Java, C#, D, Rust',
    notes: `C++ was **created** by Bjarne Stroustrup at Bell Labs starting in 1979 as "C with Classes" and renamed C++ in **1985**. It extends C with object-oriented programming, templates, the Standard Template Library (STL), exceptions, and many other high-level features while preserving C-level performance and low-level control. Modern C++ (C++11, C++14, C++17, C++20, C++23) is a very different **language** from "classic" C++98, with smart pointers, lambdas, ranges, concepts and coroutines. C++ remains the dominant language for game engines and high-performance native software.` },
  { names: ['typescript', 'ts'], display: 'TypeScript', designer: 'Anders Hejlsberg and team (Microsoft)', yearFirst: '2012', paradigm: 'Multi-paradigm — object-oriented, functional, imperative; superset of JavaScript', typing: 'Static, structural, gradual (you can opt in at any tightness); compiles to JavaScript', uses: 'Large-scale web front-end and back-end development, Node.js servers, build tooling, anywhere JavaScript is used at scale',
    influences: 'Influenced by JavaScript (as superset), C#, F#, Java; influencing Hegel, Flow',
    notes: `TypeScript was **created** by Anders Hejlsberg's team at Microsoft and publicly announced in October **2012**. It is a strict syntactic superset of **JavaScript** that adds optional static typing, type inference, generics, interfaces, enums and a sophisticated type system on top — yet it compiles back to plain JavaScript and runs anywhere JavaScript runs. TypeScript has become the dominant **language** for large JavaScript codebases at scale, used by every major framework (Angular, React, Vue, Svelte, Next.js) and adopted by most large web engineering organisations.` },
  { names: ['java'], display: 'Java', designer: 'James Gosling and team (Sun Microsystems, now Oracle)', yearFirst: '1995', paradigm: 'Multi-paradigm — object-oriented, class-based, structured, imperative, generic; concurrent; functional features since Java 8', typing: 'Static, strong, manifest (mostly explicit), with type inference (var) since Java 10', uses: 'Enterprise back-end applications, Android app development (until Kotlin), big-data systems (Hadoop, Spark, Kafka), scientific applications, embedded systems',
    influences: 'Influenced by C, C++, Smalltalk, Lisp, Ada; in turn influenced C#, Scala, Kotlin, Groovy',
    notes: `Java was **created** by James Gosling's team at Sun Microsystems and publicly released in **May 1995**. Its central design goal — *write once, run anywhere* — was achieved by compiling Java source to a portable bytecode that runs on the **Java Virtual Machine (JVM)**, which is itself ported to almost every platform. For more than two decades Java was the dominant enterprise back-end **language**, and it is still one of the most-used languages in the world. The JVM platform also hosts Kotlin, Scala, Groovy and Clojure.` },
  { names: ['c#', 'csharp', 'c sharp'], display: 'C#', designer: 'Anders Hejlsberg and team (Microsoft)', yearFirst: '2000 (announced); 2002 (first stable release)', paradigm: 'Multi-paradigm — object-oriented, component-oriented, functional, generic, structured, declarative', typing: 'Static, strong, both nominal and (since 4.0) optionally dynamic; type inference with var', uses: 'Windows desktop applications, ASP.NET web back-end, Unity game development, cloud services on Azure, cross-platform .NET applications',
    influences: 'Influenced by Java, C++, Delphi, ML; influencing TypeScript, F#, Swift, Kotlin',
    notes: `C# was **created** by Anders Hejlsberg at Microsoft and first released in **2002** as part of the .NET Framework. It was conceived as a modern, type-safe, component-oriented alternative to C++ for the Windows platform but has since grown into a fully cross-platform, open-source **language** with .NET 5+ running natively on Windows, macOS, Linux and many embedded platforms. C# is the principal scripting language of the Unity game engine, which powers a substantial fraction of the world's video games.` },
  { names: ['go', 'golang'], display: 'Go (Golang)', designer: 'Robert Griesemer, Rob Pike, Ken Thompson (Google)', yearFirst: '2009', paradigm: 'Compiled, concurrent, structured, imperative; with first-class functions and interfaces (no classes, no inheritance)', typing: 'Static, strong, structural for interfaces, with type inference', uses: 'Cloud-native infrastructure (Docker, Kubernetes, Terraform are all written in Go), network servers, microservices, command-line tools, devops',
    influences: 'Influenced by C, Pascal/Modula, Newsqueak, Limbo (CSP-style concurrency); influencing Crystal, Zig',
    notes: `Go was **created** at Google by Robert Griesemer, Rob Pike and Ken Thompson (the co-inventor of UNIX) and publicly released in November **2009**. It was designed for the realities of large-scale software engineering — fast compilation, easy concurrency via goroutines and channels, automatic memory management, a small and stable **language** specification, and excellent tooling. Go has become the default language for cloud-native infrastructure: Docker, Kubernetes, Terraform, Prometheus, Etcd, CockroachDB, InfluxDB and a great many other backbones of the cloud era are written in Go.` },
  { names: ['ruby'], display: 'Ruby', designer: 'Yukihiro "Matz" Matsumoto (Japan)', yearFirst: '1995', paradigm: 'Multi-paradigm — pure object-oriented (everything is an object), reflective, dynamic, functional, imperative', typing: 'Dynamic, strong, duck-typed; static typing optional via RBS/Sorbet', uses: 'Web back-end (Ruby on Rails, Sinatra), scripting and automation, devops (Chef, Puppet), package and build tooling',
    influences: 'Influenced by Smalltalk, Perl, Lisp, Ada, Eiffel; influencing CoffeeScript, Crystal, Groovy, Swift',
    notes: `Ruby was **created** by Yukihiro Matsumoto in Japan and publicly released in **1995**. Matz designed Ruby for "programmer happiness" — a **language** that prioritises elegance, readability and the pleasure of writing code over machine efficiency. Ruby's flagship framework, **Ruby on Rails** (2004) by David Heinemeier Hansson, revolutionised web back-end development by introducing convention over configuration and was hugely influential on subsequent web frameworks in many other languages. GitHub, Shopify, Airbnb, Twitch and Basecamp were all built primarily on Ruby on Rails.` },
  { names: ['swift'], display: 'Swift', designer: 'Chris Lattner and team (Apple)', yearFirst: '2014', paradigm: 'Multi-paradigm — object-oriented, protocol-oriented, functional, imperative, block-structured, generic', typing: 'Static, strong, inferred; with optionals to handle nil safely', uses: 'iOS / iPadOS / macOS / watchOS / tvOS / visionOS app development, server-side Swift, scripting',
    influences: 'Influenced by Objective-C, Rust, Haskell, Ruby, Python, C#, CLU; influencing modern Apple-platform development',
    notes: `Swift was **created** by Chris Lattner (also the creator of the LLVM compiler infrastructure) at Apple and announced at WWDC in June **2014** as the modern successor to Objective-C for Apple-platform development. Swift was designed to be safe (eliminating common C-family bugs by construction), fast (compiled via LLVM to native code), and expressive (closures, generics, protocol-oriented programming, optionals). Apple open-sourced Swift in December 2015, and the **language** has been steadily evolving through a public Swift Evolution process.` },
];

const PLANETS: PlanetFact[] = [
  { names: ['mercury planet', 'planet mercury'], display: 'Mercury', order: 'first', diameter: '4,879 km (~38% of Earth)', mass: '3.30 × 10²³ kg (~5.5% of Earth)', day: '~59 Earth days (one rotation)', year: '88 Earth days', moons: 'None', atmosphere: 'Negligible exosphere of oxygen, sodium, hydrogen, helium, potassium', surface: 'Heavily cratered, similar to the Moon; surface temperatures swing from −173 °C at night to +427 °C in the day',
    notes: `Mercury is the smallest planet in the Solar System (since Pluto's reclassification as a dwarf planet in 2006) and the closest to the Sun. With almost no atmosphere to retain heat, Mercury experiences the most extreme day-night temperature variation of any planet. The Mariner 10 mission (1974–75) and the MESSENGER orbiter (2011–15) provided most of what we know about its surface; the joint ESA–JAXA BepiColombo mission is en route for arrival in orbit in late 2026.` },
  { names: ['venus planet', 'planet venus'], display: 'Venus', order: 'second', diameter: '12,104 km (~95% of Earth)', mass: '4.87 × 10²⁴ kg (~82% of Earth)', day: '~243 Earth days (retrograde rotation — Venus spins backwards)', year: '225 Earth days', moons: 'None', atmosphere: '~96% carbon dioxide, surface pressure ~92× Earth\'s, sulphuric-acid clouds', surface: 'Volcanic plains, mountains, a few impact craters; surface temperature ~465 °C — the hottest planetary surface in the Solar System',
    notes: `Venus is Earth's nearest planetary neighbour and almost the same size, but its runaway greenhouse-effect atmosphere has made it the hottest world in the Solar System — hotter even than Mercury despite being further from the Sun. Surface pressure is about 92 atmospheres (equivalent to ~900 m underwater on Earth). Venus is the brightest natural object in Earth's night sky after the Moon and is often called the morning or evening star.` },
  { names: ['mars planet', 'planet mars', 'the red planet'], display: 'Mars', order: 'fourth', diameter: '6,779 km (~53% of Earth)', mass: '6.42 × 10²³ kg (~11% of Earth)', day: '24 hours 37 minutes (a *sol*)', year: '687 Earth days', moons: 'Two — Phobos and Deimos', atmosphere: '~96% carbon dioxide, very thin (surface pressure ~0.6% of Earth\'s)', surface: 'Iron-oxide red dust, polar ice caps, the largest known volcano in the Solar System (Olympus Mons, ~22 km tall), the longest canyon (Valles Marineris, ~4,000 km)',
    notes: `Mars is the fourth planet from the Sun and Earth's outer planetary neighbour, often called the *Red Planet* because of the iron-oxide rust that gives its surface its colour. Mars is the most-studied planet besides Earth and the target of the most active robotic exploration: NASA's rovers Sojourner, Spirit, Opportunity, Curiosity and Perseverance, the InSight lander, the Ingenuity helicopter, and multiple orbiters from NASA, ESA, ISRO (India), CNSA (China) and UAE.` },
  { names: ['jupiter planet', 'planet jupiter'], display: 'Jupiter', order: 'fifth', diameter: '139,820 km (~11× Earth)', mass: '1.90 × 10²⁷ kg (~318× Earth, ~2.5× all other planets combined)', day: '~9 hours 56 minutes (fastest of any planet)', year: '~11.86 Earth years', moons: '95 known, including the four Galilean moons Io, Europa, Ganymede, Callisto', atmosphere: 'Mostly hydrogen and helium, with traces of methane, ammonia, water vapour; the famous Great Red Spot is a centuries-old storm', surface: 'Gas giant — no solid surface; the visible "surface" is the top of the cloud deck',
    notes: `Jupiter is by a huge margin the largest planet in the Solar System — more than 2.5× the combined mass of all the other planets put together. It is a gas giant composed largely of hydrogen and helium, and rotates so rapidly that it bulges visibly at the equator. The four largest moons — Io, Europa, Ganymede and Callisto, the **Galilean** moons — were discovered by Galileo in 1610 and were the first objects observed orbiting another body; that discovery alone was a decisive blow against the geocentric model.` },
  { names: ['saturn planet', 'planet saturn'], display: 'Saturn', order: 'sixth', diameter: '116,460 km (~9× Earth)', mass: '5.68 × 10²⁶ kg (~95× Earth)', day: '~10 hours 33 minutes', year: '~29.46 Earth years', moons: '146 confirmed (as of 2023, the most of any planet); Titan is the largest', atmosphere: 'Mostly hydrogen and helium; visible cloud bands of ammonia ice', surface: 'Gas giant — no solid surface; iconic ring system of icy particles',
    notes: `Saturn is the second-largest planet in the Solar System and the most visually striking, famous for its broad, bright **ring system** of ice and rock fragments, which spans about 280,000 km but is only ~10–100 m thick. Saturn's largest moon, **Titan**, is the second-largest moon in the Solar System (after Jupiter's Ganymede), the only moon with a substantial atmosphere (denser than Earth's), and has lakes and rivers of liquid methane and ethane on its surface — a unique alien hydrology that NASA's Cassini-Huygens mission revealed in remarkable detail.` },
  { names: ['neptune planet', 'planet neptune'], display: 'Neptune', order: 'eighth', diameter: '49,244 km (~3.9× Earth)', mass: '1.024 × 10²⁶ kg (~17× Earth)', day: '~16 hours 6 minutes', year: '~164.8 Earth years', moons: '16 known, including Triton (largest, retrograde orbit)', atmosphere: 'Hydrogen, helium, methane; the methane gives Neptune its deep blue colour', surface: 'Ice giant — no solid surface; dynamic atmosphere with the strongest winds in the Solar System (up to ~2,100 km/h)',
    notes: `Neptune is the eighth and outermost major planet of the Solar System, ~30 astronomical units (4.5 billion km) from the Sun. Discovered in **1846** by Johann Galle following the mathematical prediction of Urbain Le Verrier — the first major planet found by calculation rather than by direct observation. Neptune has been visited by a single spacecraft (Voyager 2 in 1989), which revealed an exceptionally dynamic blue atmosphere with the fastest winds yet measured on any planet. Its largest moon, Triton, orbits in the opposite direction of Neptune's rotation, suggesting it was captured from the Kuiper Belt.` },
];

const CITIES: CityFact[] = [
  { names: ['london'], display: 'London', country: 'United Kingdom', population: '~9.7 million (Greater London); ~14 million (metro)', area: '~1,572 km² (Greater London)', founded: 'Founded by the Romans as **Londinium** ~AD 47', river: 'River Thames', notable: 'Capital of England and the United Kingdom; global financial centre',
    notes: `London is the capital and largest city of the **United Kingdom**, situated on the River **Thames** in southeast England. It has been a major settlement for almost two thousand years, founded as **Londinium** by the Romans around AD 47 and rebuilt many times after the Great Fire of 1666 and the Blitz of 1940–41. London is one of the world's foremost global cities, a leading centre of finance (the City of London and Canary Wharf), the arts, fashion, media, and tourism, home to the Houses of Parliament, Buckingham Palace, Westminster Abbey, the Tower of London and dozens of world-class museums.` },
  { names: ['paris'], display: 'Paris', country: 'France', population: '~2.1 million (city); ~12.4 million (metro)', area: '~105 km² (city)', founded: 'Founded by the Celtic Parisii tribe ~3rd century BCE; Roman *Lutetia*', river: 'River Seine', notable: 'Capital of France; global centre of art, fashion, food, and culture',
    notes: `Paris is the capital and largest city of **France**, situated on the River **Seine** in the north of the country. It is one of the most-visited and most-photographed cities in the world, home to the Eiffel Tower, the Louvre (the largest art museum in the world), the Notre-Dame and Sacré-Cœur, the Champs-Élysées, the Arc de Triomphe, the Centre Pompidou, the Palace of Versailles, and the Latin Quarter. Paris has been the centre of French political, cultural and intellectual life for more than a millennium, and is one of the major capitals of the European Union.` },
  { names: ['new york', 'new york city', 'nyc'], display: 'New York City', country: 'United States', population: '~8.3 million (city); ~20 million (metro)', area: '~1,213 km² (city)', founded: 'Founded by Dutch settlers as **New Amsterdam** in 1624; renamed New York in 1664', river: 'Hudson and East rivers; New York Harbor', notable: 'Largest city in the US; global financial and cultural centre',
    notes: `New York City is the most populous city in the **United States** and a global capital of finance, media, fashion, art and entertainment. The city is divided into **five boroughs** — Manhattan, Brooklyn, Queens, the Bronx, and Staten Island — that came together as Greater New York in 1898. Manhattan, on its own island between the Hudson and East rivers, hosts the financial district of Wall Street and the New York Stock Exchange, Times Square, Central Park, the Empire State Building, the United Nations headquarters, and many of the world's best-known museums and theatres.` },
  { names: ['tokyo'], display: 'Tokyo', country: 'Japan', population: '~13.9 million (city); ~37 million (metro — the largest in the world)', area: '~2,194 km² (Tokyo Metropolis)', founded: 'Founded as **Edo** in the 12th century; renamed Tokyo (東京, "Eastern capital") in 1868', river: 'Sumida and Arakawa rivers; Tokyo Bay', notable: 'Capital of Japan; largest metropolitan area in the world',
    notes: `Tokyo is the capital and most populous city of **Japan**, situated on the eastern coast of Honshu Island around Tokyo Bay. The greater Tokyo metropolitan area is the most populous in the world (~37 million), encompassing the capital and the cities of Yokohama, Kawasaki, Saitama and Chiba. Originally a small fishing village called **Edo**, the city rose to become the capital of the Tokugawa shogunate from 1603 and was renamed **Tokyo** (Eastern capital) when the Emperor moved there from Kyoto at the Meiji Restoration in 1868. Tokyo is a major global financial centre, home of the Tokyo Stock Exchange.` },
];

// ── Dispatcher ────────────────────────────────────────────────────────────

interface CompiledEntry {
  match: RegExp;
  exclude?: RegExp;
  render: () => string;
}

function topicWord(name: string): string {
  return name.replace(/[.+*?^$()|[\]\\]/g, (m) => '\\' + m);
}

function makeMatcher(names: string[], extraGuard?: RegExp): RegExp {
  // Sort longest first so 'french republic' wins over 'france'
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(topicWord).join('|');
  // Use lookarounds on word characters so the matcher works for names
  // ending in non-word chars (c++, c#) and tolerates plural 's'.
  return new RegExp(`(?<![a-zA-Z0-9_])(?:${escaped})s?(?![a-zA-Z0-9_])`, 'i');
}

const COMPILED: CompiledEntry[] = [];

for (const c of COUNTRIES) {
  COMPILED.push({
    match: makeMatcher(c.names),
    render: () => renderCountry(c),
  });
}

for (const e of ELEMENTS) {
  COMPILED.push({
    match: makeMatcher(e.names),
    render: () => renderElement(e),
  });
}

for (const a of ANIMALS) {
  COMPILED.push({
    match: makeMatcher(a.names),
    render: () => renderAnimal(a),
  });
}

for (const p of PROG_LANGS) {
  COMPILED.push({
    match: makeMatcher(p.names),
    render: () => renderProgLang(p),
  });
}

for (const p of PLANETS) {
  COMPILED.push({
    match: makeMatcher(p.names),
    render: () => renderPlanet(p),
  });
}

for (const c of CITIES) {
  COMPILED.push({
    match: makeMatcher(c.names),
    render: () => renderCity(c),
  });
}

/**
 * Look up a bulk curated fact for the given lower-cased input.
 * Returns the rendered response, or null if no entry matches.
 *
 * Only fires for clear definitional question shapes — "what is X",
 * "tell me about X", "who is X", "describe X", "explain X", "info on X",
 * "X facts" — so that build / debug / typo-correction / follow-up
 * prompts that happen to mention a topic keyword are not intercepted.
 */
export function bulkFactsLookup(lower: string): string | null {
  // Question-shape gate. Reject anything that looks like a build, install,
  // upgrade, debug, code, or follow-up intent.
  const isDefQuestion = /^(?:\s*(?:hey|hi|hello|yo)[,!\s]+)?\s*(?:what(?:'s| is| are)|tell me (?:about|more about)|describe|explain|who (?:is|are|was|were)|info(?:rmation)? (?:on|about)|give me (?:info|facts|the rundown) (?:on|about)|facts about)\b/i.test(lower);
  if (!isDefQuestion) return null;

  // Reject build / debug intents even if they begin with a question word.
  // Note: do NOT add bare verbs like `what`/`whats` here — they would block
  // every legitimate definitional question. Typo-corrected prompts (e.g.
  // `pyhton`, `whats typescirpt`, `kan u forklare pyhton`) don't pass the
  // def-question gate above and are handled by short-topic-local downstream.
  if (/\b(?:install|deploy|upgrade|migrate|configure|setup|set\s+up|npm|pnpm|yarn|cargo|nextjs|next\.js|vite|express|fastify|tailwind|django|flask|fastapi|rails|laravel|sandbox|repo|repository|fix\s+(?:my|the|this)|debug|stack\s+trace|exception|crashes?|broken|bug|typo|did\s+you\s+mean|how\s+do\s+i|how\s+to|hvordan)\b/i.test(lower)) {
    return null;
  }

  // Direct-question short-circuit: when the user explicitly asks just for
  // "the capital of <country>" we return a one-sentence answer rather than
  // the full country fact-card. Without this short-circuit, simple direct
  // questions get a 1000+ char response that buries the actual fact.
  const capitalMatch = /\bcapital\s+(?:of|city\s+of)\s+/i.test(lower)
    || /\bwhat\s+is\s+\w+(?:'s|s')\s+capital\b/i.test(lower);
  if (capitalMatch) {
    for (const country of COUNTRIES) {
      const m = makeMatcher(country.names);
      if (m.test(lower)) {
        return `**${country.capital}** is the capital of ${country.display}. It sits in ${country.continent}, covering an area of ${country.area} with a population of ${country.population}. The currency is ${country.currency}, the primary language is ${country.language}, and the modern state was founded ${country.founded}.`;
      }
    }
  }

  for (const entry of COMPILED) {
    if (entry.match.test(lower) && (!entry.exclude || !entry.exclude.test(lower))) {
      return entry.render();
    }
  }
  // Round-22 extensions (companion module) — gated by the same checks above.
  return bulkFactsLookup2Compiled(lower);
}
