/**
 * Bulk curated facts — Round 22 extensions.
 *
 * Companion module to curated-facts-bulk.ts. Adds more entries to the
 * existing topic classes (countries, elements, animals, programming
 * languages, planets, cities) and introduces a new class for US states.
 *
 * Called from bulkFactsLookup after the main COMPILED loop falls
 * through, so all the question-shape gating in the main file applies
 * uniformly to these entries too.
 */

interface Country2 {
  names: string[];
  display: string;
  capital: string;
  language: string;
  population: string;
  area: string;
  currency: string;
  continent: string;
  founded: string;
  government: string;
  notes: string;
}

interface Element2 {
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

interface Animal2 {
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

interface ProgLang2 {
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

interface Planet2 {
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

interface City2 {
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

interface USState {
  names: string[];
  display: string;
  abbr: string;
  capital: string;
  largestCity: string;
  population: string;
  area: string;
  joined: string;
  notes: string;
}

interface CompiledEntry2 {
  match: RegExp;
  render: () => string;
}

const COUNTRIES_2: Country2[] = [
  { names: ['greece', 'hellenic republic', 'hellas'], display: 'Greece', capital: 'Athens', language: 'Greek', population: '~10.4 million', area: '~131,960 km²', currency: 'Euro (EUR)', continent: 'Southeastern Europe', founded: '25 March 1821 (independence from the Ottoman Empire); current republic 1974', government: 'Parliamentary republic',
    notes: `Greece is a country in southeastern **Europe** at the southern tip of the Balkan Peninsula, with thousands of islands across the Aegean and Ionian seas. **Athens**, the capital, is one of the world's oldest cities and the cradle of Western civilization, philosophy, drama, the Olympic Games and democracy. **Greek** is the official language. The country is the birthplace of figures including Homer, Socrates, Plato, Aristotle and Alexander the Great. Greece joined the European Union in 1981 and the eurozone in 2001, and is a member of NATO.` },
  { names: ['portugal', 'portuguese republic'], display: 'Portugal', capital: 'Lisbon', language: 'Portuguese', population: '~10.3 million', area: '~92,210 km²', currency: 'Euro (EUR)', continent: 'Southwestern Europe (Iberian Peninsula)', founded: '1143 (Treaty of Zamora); current republic 1974 (Carnation Revolution)', government: 'Semi-presidential republic',
    notes: `Portugal occupies the western edge of the Iberian Peninsula in southwestern **Europe**, plus the Atlantic archipelagos of Madeira and the Azores. **Lisbon** is the capital and largest city; Porto is the second-largest. **Portuguese**, the official language, is spoken by ~260 million people worldwide thanks to the country's colonial empire, which was the first global maritime empire and at its height included Brazil, Angola, Mozambique, Goa, Macau and East Timor. Portugal is a founding member of NATO and joined the European Union in 1986.` },
  { names: ['switzerland', 'swiss confederation', 'schweiz', 'suisse'], display: 'Switzerland', capital: 'Bern (de facto)', language: 'German, French, Italian, Romansh (all official)', population: '~8.8 million', area: '~41,290 km²', currency: 'Swiss franc (CHF, Fr.)', continent: 'Central Europe (Alps)', founded: '1 August 1291 (Federal Charter); current federal state 1848', government: 'Federal directorial republic with semi-direct democracy',
    notes: `Switzerland is a landlocked country in the heart of the **Alps** in central **Europe**. It is a federation of 26 cantons. The country is famously **multilingual** — German, French, Italian and Romansh are all official languages. **Bern** is the de facto capital (the seat of the federal government); Zurich and Geneva are the largest cities and major global financial centres. Switzerland has been famously **neutral** since the Congress of Vienna in 1815 and is not a member of the European Union or NATO, though it joined the United Nations in 2002.` },
  { names: ['belgium', 'kingdom of belgium'], display: 'Belgium', capital: 'Brussels', language: 'Dutch, French, German (all official)', population: '~11.7 million', area: '~30,690 km²', currency: 'Euro (EUR)', continent: 'Western Europe', founded: '4 October 1830 (independence from the Netherlands)', government: 'Federal parliamentary constitutional monarchy',
    notes: `Belgium is a federal country in northwestern **Europe**, divided culturally and linguistically between **Dutch**-speaking Flanders in the north, **French**-speaking Wallonia in the south, and the small German-speaking community in the east. **Brussels**, the capital, is officially bilingual French/Dutch and is the de facto capital of the European Union — host to the European Commission, the Council of the EU and one of the European Parliament's two seats — as well as the headquarters of NATO. Belgium is a founding member of the EU, NATO and the eurozone.` },
  { names: ['austria', 'republic of austria'], display: 'Austria', capital: 'Vienna', language: 'German', population: '~9.0 million', area: '~83,880 km²', currency: 'Euro (EUR)', continent: 'Central Europe (Alps)', founded: 'First Austrian Republic 1918; Second Republic 1955', government: 'Federal parliamentary republic',
    notes: `Austria is a landlocked Alpine country in central **Europe**, the heartland of the former Habsburg Austro-Hungarian Empire that dominated central Europe for centuries until its collapse at the end of World War I in 1918. **Vienna**, the capital and largest city, was the imperial seat and is famously a global capital of classical music — Mozart, Haydn, Beethoven, Schubert, Brahms, Mahler, Strauss and Schoenberg all lived and worked there. **German** is the official language. Austria has been constitutionally neutral since 1955 and joined the European Union in 1995.` },
  { names: ['ireland', 'republic of ireland', 'eire'], display: 'Ireland', capital: 'Dublin', language: 'Irish (Gaeilge) and English (both official)', population: '~5.3 million', area: '~70,270 km²', currency: 'Euro (EUR)', continent: 'Northwestern Europe (British Isles)', founded: '6 December 1922 (Irish Free State); republic declared 1949', government: 'Parliamentary republic',
    notes: `Ireland occupies most of the island of Ireland off the northwest coast of continental **Europe**, with the six counties of **Northern Ireland** (part of the United Kingdom) in the northeast. **Dublin** is the capital and largest city. **Irish** (Gaeilge) and **English** are both official languages, though English is dominant in everyday use. Ireland gained independence from the United Kingdom in 1922 after the Irish War of Independence. The country joined the European Union in 1973 and the eurozone in 1999, and has become a major hub for multinational technology and pharmaceutical companies.` },
  { names: ['denmark', 'kingdom of denmark', 'danmark'], display: 'Denmark', capital: 'Copenhagen', language: 'Danish', population: '~5.9 million', area: '~42,930 km²', currency: 'Danish krone (DKK, kr)', continent: 'Northern Europe (Scandinavia)', founded: 'Unification ~10th century (Harald Bluetooth); current constitution 1849', government: 'Constitutional monarchy with parliamentary democracy',
    notes: `Denmark is the southernmost of the Scandinavian countries, comprising the Jutland peninsula and a great many islands between the North Sea and the Baltic Sea, plus the autonomous territories of **Greenland** and the **Faroe Islands**. **Copenhagen**, on the island of Zealand, is the capital and largest city. **Danish** is the official language. Denmark joined the European Union in 1973 but, unusually, has retained its national currency, the krone. The Danish monarchy is one of the oldest continuously reigning in Europe, with roots going back over 1,000 years.` },
  { names: ['finland', 'republic of finland', 'suomi'], display: 'Finland', capital: 'Helsinki', language: 'Finnish and Swedish (both official)', population: '~5.6 million', area: '~338,420 km²', currency: 'Euro (EUR)', continent: 'Northern Europe', founded: '6 December 1917 (independence from Russia)', government: 'Parliamentary republic',
    notes: `Finland is a Nordic country in northern **Europe**, bordered by Sweden, Norway and Russia. **Helsinki** is the capital and largest city. **Finnish** is the dominant official language; **Swedish** is also official, reflecting centuries of Swedish rule before Finland passed to the Russian Empire in 1809 and gained independence in 1917. Finnish is a Uralic language not related to its Scandinavian neighbours' Indo-European tongues. The country joined the European Union in 1995, the eurozone in 1999, and NATO in 2023 in response to the Russian invasion of Ukraine.` },
  { names: ['czechia', 'czech republic', 'cesko'], display: 'Czechia (Czech Republic)', capital: 'Prague', language: 'Czech', population: '~10.5 million', area: '~78,870 km²', currency: 'Czech koruna (CZK, Kč)', continent: 'Central Europe', founded: '1 January 1993 (peaceful dissolution of Czechoslovakia)', government: 'Parliamentary republic',
    notes: `Czechia is a landlocked country in central **Europe**, formed from the historical lands of Bohemia, Moravia and Czech Silesia. **Prague**, the capital and largest city on the Vltava River, is one of the best-preserved historic cities in Europe with a medieval Old Town, Charles Bridge and Prague Castle. **Czech** is the official language. The Czech Republic was created on 1 January 1993 by the *Velvet Divorce*, the peaceful dissolution of Czechoslovakia into Czechia and Slovakia. The country joined NATO in 1999 and the European Union in 2004.` },
  { names: ['ukraine', 'ukrayina'], display: 'Ukraine', capital: 'Kyiv', language: 'Ukrainian', population: '~37 million (estimated, post-2022)', area: '~603,550 km²', currency: 'Ukrainian hryvnia (UAH, ₴)', continent: 'Eastern Europe', founded: '24 August 1991 (independence from the Soviet Union)', government: 'Semi-presidential republic',
    notes: `Ukraine is the second-largest country in **Europe** by area (after Russia) and one of the largest entirely within Europe. **Kyiv** (often historically transliterated *Kiev*) is the capital and largest city, on the Dnipro River. **Ukrainian** is the official language. Modern Ukraine declared independence from the Soviet Union on 24 August 1991. Russia annexed Crimea in 2014 and launched a full-scale invasion of the rest of Ukraine in February 2022; the war has been ongoing since, with Ukraine receiving extensive military and economic support from the United States, the European Union and other Western countries.` },
];

const ELEMENTS_2: Element2[] = [
  { names: ['sodium'], display: 'Sodium', symbol: 'Na', atomicNumber: 11, atomicMass: '22.990 u', group: 'Group 1', period: 'Period 3', category: 'Alkali metal', state: 'Solid (soft, silvery-white metal)', discovered: 'Sir Humphry Davy by electrolysis of caustic soda in 1807',
    uses: 'Sodium chloride (table salt), sodium hydroxide (lye/caustic soda) and sodium carbonate (soda ash) for soap, glass and paper; sodium-vapour street lamps; sodium-cooled fast nuclear reactors; biological electrolyte.',
    notes: `Sodium is the sixth-most-abundant element in the Earth's crust and one of the most reactive metals — it is so reactive that it is never found free in nature, only as compounds (most familiarly as sodium chloride, NaCl, common table salt). The symbol **Na** comes from the Latin *natrium*. Sodium reacts vigorously with water, releasing hydrogen and enough heat to ignite it. Together with potassium, sodium ions are essential to nerve impulses and the electrical signalling of all animal life.` },
  { names: ['sulfur', 'sulphur'], display: 'Sulfur', symbol: 'S', atomicNumber: 16, atomicMass: '32.06 u', group: 'Group 16', period: 'Period 3', category: 'Reactive non-metal (chalcogen)', state: 'Solid (bright yellow crystalline)', discovered: 'Known since antiquity (biblical *brimstone*)',
    uses: 'Sulfuric acid (H₂SO₄, the most-produced industrial chemical in the world), gunpowder, vulcanization of rubber, fertilizers, fungicides, matches, fireworks.',
    notes: `Sulfur is one of the **first** elements known to humans — the biblical *brimstone* — and has been mined and used for thousands of years. It is a bright yellow non-metal that occurs naturally near volcanoes and hot springs and as part of many sulfide and sulfate minerals. Sulfuric acid (H₂SO₄), the most-produced industrial chemical, is so central to chemistry that historically a country's level of industrialization was sometimes measured by its sulfuric-acid production. Amino acids cysteine and methionine contain sulfur.` },
  { names: ['calcium'], display: 'Calcium', symbol: 'Ca', atomicNumber: 20, atomicMass: '40.078 u', group: 'Group 2', period: 'Period 4', category: 'Alkaline earth metal', state: 'Solid (silvery-white reactive metal)', discovered: 'Sir Humphry Davy by electrolysis in 1808',
    uses: 'Building materials (limestone, marble, cement, plaster of Paris), bones and teeth in vertebrates (calcium phosphate as hydroxyapatite), eggshells (calcium carbonate), milk fortification, antacids.',
    notes: `Calcium is the fifth-most-abundant element in the Earth's crust and the most abundant metal in the human body — adult humans contain about a kilogram of it, the great majority in bones and teeth as the mineral hydroxyapatite. The symbol **Ca** is from the Latin *calx* (lime). Calcium ions are also essential signalling molecules in cells, controlling muscle contraction, neurotransmitter release and blood clotting. Limestone, chalk and marble are all calcium carbonate (CaCO₃) and have shaped human architecture for millennia.` },
  { names: ['aluminium', 'aluminum'], display: 'Aluminium (Aluminum)', symbol: 'Al', atomicNumber: 13, atomicMass: '26.982 u', group: 'Group 13', period: 'Period 3', category: 'Post-transition metal', state: 'Solid (silvery-white lightweight metal)', discovered: 'Hans Christian Ørsted 1825; isolated in pure form by Friedrich Wöhler 1827',
    uses: 'Aircraft and aerospace structures, beverage cans, foil, window frames, electrical transmission cables, automotive components, cookware. The most-used non-ferrous metal.',
    notes: `Aluminium is the most abundant metal in the Earth's crust (~8% by mass) but was not isolated as a pure element until the early 19th century because of its strong chemical bonding to oxygen. For decades it was so difficult to produce that it was more valuable than gold — the cap of the Washington Monument was made of aluminium in 1884 as a precious-metal flourish. The Hall–Héroult electrolytic process (1886) made aluminium cheap to produce, and it is now the most-used non-ferrous metal.` },
  { names: ['lead element', 'plumbum'], display: 'Lead', symbol: 'Pb', atomicNumber: 82, atomicMass: '207.2 u', group: 'Group 14', period: 'Period 6', category: 'Post-transition metal (heavy metal)', state: 'Solid (dense, soft, malleable bluish-grey metal)', discovered: 'Known since antiquity (~7000 BCE)',
    uses: 'Lead-acid car batteries (the largest single use), radiation shielding, ammunition, weights and ballast, solder, historically pipes and paint and petrol additives (now phased out for toxicity).',
    notes: `Lead is one of the metals known since antiquity. The Romans used lead for water pipes (the symbol **Pb** is from Latin *plumbum*, the source of *plumbing*). Lead is highly **toxic**, especially to the developing nervous system of children — leaded petrol, leaded paint and lead pipes have been progressively banned worldwide since the late 20th century, but lead-acid car batteries remain its dominant modern use, with the lead heavily recycled.` },
  { names: ['mercury element', 'quicksilver', 'hydrargyrum'], display: 'Mercury (element)', symbol: 'Hg', atomicNumber: 80, atomicMass: '200.592 u', group: 'Group 12', period: 'Period 6', category: 'Transition metal', state: 'Liquid (silvery, dense — the only metal liquid at room temperature)', discovered: 'Known since antiquity',
    uses: 'Historically thermometers, barometers, mercury-vapor lamps, dental amalgams, chlor-alkali process; now largely phased out for toxicity. Still used in some scientific instruments and fluorescent lamps.',
    notes: `Mercury is the only metal that is **liquid** at room temperature, hence its old English name *quicksilver* (living silver). The symbol **Hg** is from the Latin *hydrargyrum* (liquid silver). Mercury is highly toxic to the nervous system and bioaccumulates in food chains (especially in tuna and other large predatory fish), and most former uses (thermometers, barometers, dental amalgams) are being phased out under the 2013 Minamata Convention. The planet Mercury and the Roman god are namesakes.` },
  { names: ['platinum'], display: 'Platinum', symbol: 'Pt', atomicNumber: 78, atomicMass: '195.084 u', group: 'Group 10', period: 'Period 6', category: 'Transition metal (precious metal)', state: 'Solid (dense, silvery-white)', discovered: 'Pre-Columbian South America; introduced to European science by Antonio de Ulloa 1735',
    uses: 'Catalytic converters in petrol cars, jewellery, laboratory equipment, electrical contacts, anti-cancer drugs (cisplatin), Pt-based hydrogen fuel-cell catalysts.',
    notes: `Platinum is one of the rarest and most valuable precious metals — annual world production is only about 200 tonnes, compared to ~3,000 tonnes for gold. It is exceptionally resistant to corrosion and a remarkable catalyst, which is why most modern petrol cars carry a platinum-group catalytic converter to clean their exhaust. Platinum has been worked since pre-Columbian times in South America and gives its name to the *platinum* trophies of the music industry (sales above gold).` },
  { names: ['lithium'], display: 'Lithium', symbol: 'Li', atomicNumber: 3, atomicMass: '6.94 u', group: 'Group 1', period: 'Period 2', category: 'Alkali metal', state: 'Solid (soft, silvery, the lightest metal)', discovered: 'Johan August Arfwedson 1817',
    uses: 'Lithium-ion rechargeable batteries (phones, laptops, electric vehicles, grid storage), aerospace alloys, ceramics and glass, lithium-based mood-stabilising drugs in psychiatry.',
    notes: `Lithium is the **lightest metal** and the third-lightest element overall (after hydrogen and helium). It was created in tiny amounts during Big Bang nucleosynthesis, making it one of the few elements present at the very beginning of the universe. Lithium has become a critical strategic resource of the 21st century because of its central role in **lithium-ion batteries** for portable electronics and electric vehicles; major reserves are in Chile, Australia, Argentina and China.` },
  { names: ['neon'], display: 'Neon', symbol: 'Ne', atomicNumber: 10, atomicMass: '20.180 u', group: 'Group 18', period: 'Period 2', category: 'Noble gas', state: 'Gas (colourless, odourless, completely inert)', discovered: 'Sir William Ramsay and Morris Travers 1898',
    uses: 'Neon advertising signs (the iconic orange-red glow), high-voltage indicators, vacuum tubes, plasma displays, helium-neon lasers, cryogenic refrigerant.',
    notes: `Neon is one of the noble gases — chemically inert and present in the Earth's atmosphere only in tiny amounts (~18 parts per million). It is famous for the bright orange-red glow it gives off when an electric current is passed through it at low pressure, the basis of *neon signs* — discovered by Georges Claude in 1910 and an iconic visual element of urban nightscapes. The name comes from the Greek *neos* (new), as it was a newly discovered gas when isolated in 1898.` },
  { names: ['chlorine'], display: 'Chlorine', symbol: 'Cl', atomicNumber: 17, atomicMass: '35.45 u', group: 'Group 17', period: 'Period 3', category: 'Halogen (reactive non-metal)', state: 'Gas (yellow-green, pungent, highly toxic)', discovered: 'Carl Wilhelm Scheele 1774; recognised as element by Davy 1810',
    uses: 'Disinfection of drinking water and swimming pools, bleach (sodium hypochlorite), PVC plastic, hydrochloric acid, table salt (NaCl), pharmaceuticals.',
    notes: `Chlorine is a yellow-green, pungent, highly toxic gas at room temperature, but in the form of chloride ions and chlorine compounds it is essential to life and to modern civilization — most notably for the disinfection of drinking water, which has saved billions of lives by suppressing waterborne diseases such as cholera and typhoid. The symbol **Cl** stands for chlorine. Chlorine was used as a chemical weapon at the Second Battle of Ypres in 1915, the first large-scale use of chemical warfare.` },
];

const ANIMALS_2: Animal2[] = [
  { names: ['wolf', 'gray wolf', 'grey wolf'], display: 'Wolf', scientific: 'Canis lupus', class: 'Mammalia', family: 'Canidae (dog family)', habitat: 'Forests, tundra, grasslands, mountains, deserts', diet: 'Carnivore — large ungulates (deer, elk, moose, bison), smaller mammals, occasional carrion', lifespan: '6–8 years in the wild; up to 16 in captivity', range: 'Holarctic — North America, Europe, Asia, parts of the Middle East', status: 'Least Concern (IUCN, globally); regionally extinct or threatened in many countries',
    notes: `The wolf is the largest wild member of the **Canidae** dog family and the ancestor of the domestic dog (*Canis lupus familiaris*), which was domesticated from grey wolves at least 15,000 years ago. Wolves are highly social pack animals, typically living in family groups of 5–10 led by a breeding pair, and communicate through complex vocalisations including the iconic howl. Wolves were extirpated from much of their original range in the 19th and 20th centuries; reintroduction efforts (most famously in Yellowstone in 1995) have shown how a top predator can transform an entire ecosystem.` },
  { names: ['dolphin', 'bottlenose dolphin'], display: 'Dolphin', scientific: 'Tursiops truncatus (common bottlenose; ~90 species in family Delphinidae)', class: 'Mammalia', family: 'Delphinidae (oceanic dolphins)', habitat: 'Oceans and seas worldwide; some river species', diet: 'Carnivore — fish, squid, occasionally crustaceans', lifespan: '~40–50 years (bottlenose); some species longer', range: 'Worldwide in tropical and temperate seas', status: 'Mostly Least Concern; some species Endangered',
    notes: `Dolphins are highly intelligent marine **mammal**s in the family **Delphinidae**, with about 90 species ranging from the tiny Hector's dolphin to the orca (killer whale, the largest dolphin). They are famous for their playful behaviour, complex social structures, sophisticated echolocation, and individual *signature whistles* that act much like names. Bottlenose dolphins have demonstrated mirror self-recognition, tool use, cooperative hunting and the ability to learn arbitrary symbols, and are widely regarded as among the most cognitively advanced non-human animals on Earth.` },
  { names: ['crocodile', 'saltwater crocodile', 'nile crocodile'], display: 'Crocodile', scientific: 'Family Crocodylidae (~16 species)', class: 'Reptilia', family: 'Crocodylidae', habitat: 'Rivers, swamps, estuaries, brackish coastal waters', diet: 'Carnivore — fish, mammals, birds, reptiles; ambush predators', lifespan: '~70 years; some larger species over 100', range: 'Tropical regions of Africa, Asia, the Americas and Australia', status: 'Variable — some species Least Concern, some Critically Endangered',
    notes: `Crocodiles are large, semi-aquatic **reptile**s in the family **Crocodylidae** — about 16 species, including the massive saltwater crocodile (the largest living reptile, up to ~7 m), the Nile crocodile of Africa, and the American crocodile. They are apex ambush predators with bone-crushing bite force and are part of the order Crocodilia, which also includes alligators, caimans and gharials. Crocodiles have changed remarkably little in form over 200 million years and are sometimes called *living fossils* — they outlived the non-avian dinosaurs at the K-Pg extinction event 66 million years ago.` },
  { names: ['komodo dragon'], display: 'Komodo dragon', scientific: 'Varanus komodoensis', class: 'Reptilia', family: 'Varanidae (monitor lizards)', habitat: 'Tropical savannah and forest', diet: 'Carnivore — deer, pigs, water buffalo, carrion; sometimes humans', lifespan: '~30 years', range: 'A few small Indonesian islands — Komodo, Rinca, Flores, Gili Motang, Padar', status: 'Endangered (IUCN)',
    notes: `The Komodo dragon is the **largest** living **lizard** **species** — adults reach up to 3 m in length and 70 kg in weight. They are found only on a handful of small Indonesian islands and are apex predators in their ecosystems, capable of bringing down prey as large as water buffalo with a venomous bite that causes massive bleeding and shock. Despite their reptilian appearance, Komodo dragons are surprisingly fast runners over short distances and are good swimmers. The species is endangered, with only ~3,000 individuals left in the wild.` },
  { names: ['gorilla', 'mountain gorilla', 'western gorilla'], display: 'Gorilla', scientific: 'Gorilla beringei (eastern) / Gorilla gorilla (western)', class: 'Mammalia', family: 'Hominidae (great apes)', habitat: 'Tropical and subtropical rainforest', diet: 'Mostly herbivorous — leaves, stems, shoots, fruit, bamboo; some insects', lifespan: '~35–40 years in the wild; up to 50 in captivity', range: 'Equatorial Africa — the Congo Basin and the Albertine Rift', status: 'Endangered to Critically Endangered (depending on subspecies)',
    notes: `Gorillas are the **largest** living **primate**s — adult males (silverbacks) can reach over 1.7 m standing height and weigh up to ~200 kg. There are two species, the eastern and western gorilla, each with two subspecies; the mountain gorilla of the Virunga volcanoes is the most famous, made widely known by Dian Fossey's research. Gorillas share roughly 98% of their DNA with humans and are members of the great ape family **Hominidae** alongside chimpanzees, bonobos, orangutans and humans. They are highly social, living in family groups led by a single dominant silverback.` },
  { names: ['kangaroo', 'red kangaroo'], display: 'Kangaroo', scientific: 'Macropus rufus (red kangaroo) and others', class: 'Mammalia', family: 'Macropodidae', habitat: 'Open grassland, savannah, scrub, arid plains', diet: 'Herbivore — grasses, leaves, shrubs', lifespan: '~10 years in the wild', range: 'Australia and New Guinea', status: 'Least Concern (IUCN) for the four large species',
    notes: `Kangaroos are large hopping **marsupial** **mammal**s native to **Australia** and the largest living members of the family **Macropodidae** (big foot). The red kangaroo is the largest kangaroo and the largest marsupial in the world, with adult males reaching up to ~2 m tall and weighing up to ~90 kg. Kangaroos famously carry their young (called *joeys*) in a pouch (*marsupium*) on the female's belly for ~6 months after birth. The kangaroo is the national animal of Australia and appears on the country's coat of arms.` },
  { names: ['hippopotamus', 'hippo'], display: 'Hippopotamus', scientific: 'Hippopotamus amphibius', class: 'Mammalia', family: 'Hippopotamidae', habitat: 'Rivers, lakes, swamps and floodplains in sub-Saharan Africa', diet: 'Herbivore — primarily grasses, grazed at night on land', lifespan: '~40–50 years', range: 'Sub-Saharan Africa', status: 'Vulnerable (IUCN)',
    notes: `The hippopotamus is a large, semi-aquatic **mammal** native to sub-Saharan Africa and one of the largest land mammals — adults can weigh up to ~1,500–1,800 kg. Despite their plump, peaceful appearance, hippos are extremely territorial and are responsible for more human deaths in Africa each year than any other large animal. Their closest living relatives are not pigs or other ungulates but **whales** and dolphins, from which they diverged about 55 million years ago. Hippos spend most of the day submerged in water to keep cool and graze on land at night.` },
  { names: ['bald eagle'], display: 'Bald eagle', scientific: 'Haliaeetus leucocephalus', class: 'Aves', family: 'Accipitridae (hawks and eagles)', habitat: 'Forests near large bodies of open water', diet: 'Carnivore — primarily fish; also waterfowl, small mammals, carrion', lifespan: '~20 years in the wild; up to 50 in captivity', range: 'Throughout most of North America', status: 'Least Concern (IUCN); recovered from near-extinction',
    notes: `The bald eagle is a large bird of prey native to **North America** and the **national bird and symbol of the United States** since 1782. It is not actually bald — the name comes from an old meaning of *bald* (white-headed), describing the adult's striking white head and tail against a dark brown body. Bald eagles were nearly driven to extinction in the contiguous US by 20th-century pesticide DDT (which thinned their eggshells); after DDT was banned in 1972, populations rebounded dramatically and the species was removed from the US endangered-species list in 2007.` },
  { names: ['honey bee', 'honeybee', 'european honey bee'], display: 'Honey bee', scientific: 'Apis mellifera', class: 'Insecta', family: 'Apidae', habitat: 'Worldwide — wherever flowering plants grow', diet: 'Herbivore — nectar and pollen', lifespan: 'Workers ~6 weeks in summer; queens up to 5 years', range: 'Native to Europe, Asia, Africa; introduced worldwide', status: 'Least Concern (managed populations); threatened by colony collapse disorder',
    notes: `The honey bee is the most economically important pollinating **insect** in the world — entire agricultural systems depend on managed honey-bee colonies pollinating crops including almonds, apples, blueberries, melons and many others. Honey bees live in highly organised colonies of tens of thousands of female workers, a single egg-laying queen and a small number of male drones, communicating the location of food via the *waggle dance* decoded by Karl von Frisch (Nobel Prize 1973). The species *Apis mellifera* originated in Africa or western Asia.` },
  { names: ['anaconda', 'green anaconda'], display: 'Anaconda', scientific: 'Eunectes murinus (green anaconda)', class: 'Reptilia', family: 'Boidae (boas)', habitat: 'Swamps, marshes, slow-moving streams in tropical South America', diet: 'Carnivore — fish, birds, mammals, reptiles; non-venomous constrictor', lifespan: '~10 years in the wild; up to 30 in captivity', range: 'Tropical South America (Amazon and Orinoco basins, the Pantanal)', status: 'Least Concern (IUCN)',
    notes: `The green anaconda is the **heaviest snake** in the world and one of the longest — adult females can reach up to ~5 m in length and weigh over 100 kg, dwarfing the reticulated python in mass even though the python can be slightly longer. Anacondas are non-venomous boa constrictors that ambush prey in or near water, kill by squeezing, and swallow it whole. They are largely aquatic, propelled efficiently by their muscular bodies through the swamps and slow rivers of tropical **South America**. Females are dramatically larger than males.` },
];

const PROG_LANGS_2: ProgLang2[] = [
  { names: ['php'], display: 'PHP', designer: 'Rasmus Lerdorf (Denmark/Canada)', yearFirst: '1995', paradigm: 'Multi-paradigm — imperative, object-oriented, functional, procedural, reflective', typing: 'Dynamic, weak, gradual (type declarations since 7.0)', uses: 'Server-side web development; powers WordPress, Wikipedia, Facebook (originally), Slack and much of the web back-end',
    influences: 'Influenced by Perl, C, C++, Java, Tcl, JavaScript; influencing Hack',
    notes: `PHP was **created** by Rasmus Lerdorf in **1995** as a small set of *Personal Home Page* tools, which evolved into the recursive acronym *PHP: Hypertext Preprocessor*. The **language** is purpose-built for server-side web development — embedded in HTML and executed on the server to produce dynamic pages. PHP runs roughly 75% of all websites with a known server-side language, including WordPress (which alone powers ~40% of the web), Wikipedia (via MediaWiki), Drupal, Joomla and countless small-business sites. Modern PHP (7.x and 8.x) is dramatically faster and more type-safe than earlier versions.` },
  { names: ['kotlin'], display: 'Kotlin', designer: 'Andrey Breslav and team (JetBrains)', yearFirst: '2011 (announced); 1.0 in February 2016', paradigm: 'Multi-paradigm — object-oriented, functional, imperative; null-safe by default', typing: 'Static, strong, inferred', uses: 'Android app development (Google preferred language since 2019), server-side back-end (Spring, Ktor), multiplatform (KMM), data science',
    influences: 'Influenced by Java, Scala, C#, Groovy, JavaScript, Swift; influencing Android development',
    notes: `Kotlin was **created** by JetBrains and publicly announced in **2011**; version 1.0 was released in February 2016. The **language** runs primarily on the **JVM** (and is fully interoperable with Java, allowing gradual migration of existing Java codebases) but also targets JavaScript, native code via LLVM, and WebAssembly. Google announced Kotlin as the preferred language for Android development at I/O 2019, and most new Android apps are now written in Kotlin rather than Java.` },
  { names: ['scala'], display: 'Scala', designer: 'Martin Odersky (École Polytechnique Fédérale de Lausanne)', yearFirst: '2004', paradigm: 'Multi-paradigm — object-oriented, functional, strongly statically typed, imperative; concurrent', typing: 'Static, strong, inferred; powerful structural and dependent typing', uses: 'Big-data systems (Apache Spark is written in Scala), distributed systems, server-side back-end, financial systems',
    influences: 'Influenced by Java, ML, Haskell, Erlang, Smalltalk, Pizza, F#; influencing Kotlin, Swift, Ceylon',
    notes: `Scala was **created** by Martin Odersky at EPFL and first released in **2004**. The **language** runs on the **JVM** (and historically also on .NET) and combines object-oriented and functional programming in a single elegant syntax. Scala's most influential industrial deployment is **Apache Spark**, the distributed big-data analytics engine, which is itself written in Scala. Twitter, LinkedIn, Netflix, the Guardian and many other large engineering organisations have used Scala extensively for back-end systems.` },
  { names: ['haskell'], display: 'Haskell', designer: 'Haskell committee (academic working group)', yearFirst: '1990', paradigm: 'Purely functional, lazy evaluation, strongly statically typed', typing: 'Static, strong, inferred; with one of the most sophisticated type systems of any practical language', uses: 'Compiler implementation, financial modelling, formal verification, research; production use at Facebook, GitHub (Semantic), Standard Chartered, Tesla',
    influences: 'Influenced by ML, Miranda, Lisp; influencing Scala, F#, Rust, PureScript, Elm, Idris',
    notes: `Haskell was **created** by an academic committee in the late 1980s to consolidate research on lazy purely functional **language**s; the first standard, Haskell 1.0, was published in **1990**. It is named after the American logician Haskell Curry. Haskell is purely functional — every expression evaluates to a value with no side effects unless explicitly typed in the *IO* monad — and lazily evaluated, meaning expressions are computed only as their results are needed. It has had a disproportionate influence on the design of newer languages.` },
  { names: ['lua'], display: 'Lua', designer: 'Roberto Ierusalimschy and team (PUC-Rio, Brazil)', yearFirst: '1993', paradigm: 'Multi-paradigm — imperative, functional, object-oriented (prototype-based via metatables), data-driven', typing: 'Dynamic, weak; small set of types', uses: 'Embedded scripting in larger applications — game engines (Roblox uses a Lua dialect, World of Warcraft, many indie games), network appliances, Adobe Photoshop Lightroom, Wireshark',
    influences: 'Influenced by C, Modula, Scheme, SNOBOL; influencing Roblox Luau and MoonScript',
    notes: `Lua was **created** at the Pontifical Catholic University of Rio de Janeiro (PUC-Rio) in **1993** by Roberto Ierusalimschy and colleagues, primarily to provide a small, fast, embeddable scripting **language** that could be linked into larger C/C++ host applications. The name *Lua* means *moon* in Portuguese. Lua is famous as the dominant scripting language inside game engines — Roblox uses a Lua dialect called Luau, and World of Warcraft, Garry's Mod, the Source engine, and many other games script their gameplay in Lua.` },
  { names: ['perl'], display: 'Perl', designer: 'Larry Wall', yearFirst: '1987', paradigm: 'Multi-paradigm — imperative, functional, object-oriented, procedural, reflective', typing: 'Dynamic, weak; with sigils that hint at type ($, @, %)', uses: 'Text processing, system administration, bioinformatics, web CGI scripting (historically dominant), one-liners and ad-hoc scripts',
    influences: 'Influenced by C, awk, sed, sh, Lisp; influencing PHP, Ruby, Python, Raku',
    notes: `Perl was **created** by Larry Wall in **1987** as a more powerful alternative to awk and shell for text-processing tasks. The **language** motto is *There is more than one way to do it (TIMTOWTDI)*, and Perl became famous (or infamous) for the very wide range of styles it permits. In the late 1990s and early 2000s Perl was the dominant language for CGI web development before PHP and Ruby on Rails took over. The Perl regular-expression dialect, *PCRE*, is the de facto standard for regex syntax across most modern languages.` },
  { names: ['r language', 'r programming', 'r-lang'], display: 'R', designer: 'Ross Ihaka and Robert Gentleman (University of Auckland)', yearFirst: '1993', paradigm: 'Multi-paradigm — array-oriented, functional, object-oriented, procedural, reflective', typing: 'Dynamic, strong, vector-based', uses: 'Statistical computing, data analysis, scientific graphics; the dominant language of academic statistics and biostatistics',
    influences: 'Influenced by S, Scheme, Lisp, APL; influencing Julia and the ggplot grammar of graphics',
    notes: `R was **created** by Ross Ihaka and Robert Gentleman at the University of Auckland and first publicly released in **1993** as a free, open-source implementation of the S **language** for statistical computing. R has become the standard language of academic statistics and biostatistics, with a vast package ecosystem (CRAN) covering nearly every statistical method. The *tidyverse* family of packages (dplyr, ggplot2, tidyr, purrr) has shaped how a generation of data analysts think about data.` },
  { names: ['dart language', 'dart programming'], display: 'Dart', designer: 'Lars Bak and Kasper Lund (Google)', yearFirst: '2011', paradigm: 'Multi-paradigm — object-oriented, class-based, functional, imperative, reactive', typing: 'Static, strong, sound (since Dart 2.12 with null safety)', uses: 'Cross-platform mobile, web and desktop apps via Flutter; back-end services',
    influences: 'Influenced by JavaScript, Java, C#, Smalltalk, Erlang, Strongtalk; influencing Flutter app development worldwide',
    notes: `Dart was **created** by Google and announced in **2011** as a new client-side **language** intended to address some of JavaScript design issues. Dart found its real audience with the launch of the **Flutter** UI framework in 2017: Flutter compiles Dart to native code on iOS, Android, web, Windows, macOS and Linux, allowing a single Dart codebase to ship as a high-performance app on every major platform. Dart 2 (2018) made the language soundly statically typed, and Dart 2.12 (2021) added sound null safety.` },
  { names: ['elixir language', 'elixir programming'], display: 'Elixir', designer: 'José Valim (Brazil)', yearFirst: '2012', paradigm: 'Functional, concurrent, distributed; runs on the Erlang BEAM virtual machine', typing: 'Dynamic, strong; with optional gradual typing via Dialyzer', uses: 'Highly concurrent and fault-tolerant back-end services, real-time chat (Discord), web back-end (Phoenix framework), telecommunications, IoT',
    influences: 'Influenced by Erlang, Ruby, Clojure, Haskell, Lisp; in turn influencing modern functional back-end design',
    notes: `Elixir was **created** by José Valim (formerly a core Ruby on Rails contributor) and publicly released in **2012**. The **language** runs on the **BEAM** virtual machine — the same runtime that powers Erlang, originally developed by Ericsson for telecommunications switches — inheriting BEAM exceptional support for massive concurrency (lightweight processes), distribution and fault tolerance via OTP. Elixir powers Discord real-time chat for hundreds of millions of users.` },
  { names: ['clojure'], display: 'Clojure', designer: 'Rich Hickey', yearFirst: '2007', paradigm: 'Functional, immutable, dynamic; a dialect of Lisp on the JVM', typing: 'Dynamic, strong; with optional spec-based contracts', uses: 'Server-side back-end, data engineering, finance, web (ClojureScript on the front-end)',
    influences: 'Influenced by Lisp, Scheme, Haskell, ML, Erlang; influencing modern functional design',
    notes: `Clojure was **created** by Rich Hickey and first released in **2007**. The **language** is a modern dialect of **Lisp** that runs on the **JVM** (with sister implementations on JavaScript via ClojureScript and on .NET via ClojureCLR). It treats immutable data as the default and provides excellent built-in concurrency primitives. Clojure has been adopted at companies including Walmart, Nubank, CircleCI and many financial firms for its emphasis on simplicity, immutability and functional design.` },
];

const PLANETS_2: Planet2[] = [
  { names: ['earth planet', 'planet earth'], display: 'Earth', order: 'third', diameter: '12,742 km (mean)', mass: '5.97 × 10²⁴ kg', day: '23 hours 56 minutes 4 seconds (sidereal); 24 hours (solar)', year: '365.256 days (sidereal year)', moons: 'One — the Moon (Luna)', atmosphere: '~78% nitrogen, ~21% oxygen, ~1% argon, traces of CO₂, water vapour and others', surface: '~71% liquid water (oceans); ~29% land in 7 continents; the only known body with surface liquid water and life',
    notes: `Earth is the **third** planet from the Sun and the only astronomical body currently known to harbour **life**. Surface temperatures range from about −89 °C in Antarctica to over +56 °C in the hottest deserts; the atmosphere, magnetic field and surface liquid water all contribute to the habitable conditions. Earth single natural satellite, the **Moon**, is unusually large for a rocky planet (about 1/4 the diameter of the Earth) and stabilises the planet axial tilt, smoothing the climate over geological time. The age of the Earth is about 4.54 billion years.` },
  { names: ['uranus planet', 'planet uranus'], display: 'Uranus', order: 'seventh', diameter: '50,724 km (~4× Earth)', mass: '8.68 × 10²⁵ kg (~14.5× Earth)', day: '~17 hours 14 minutes (retrograde)', year: '~84 Earth years', moons: '28 known, named mostly after Shakespeare and Pope characters (Miranda, Ariel, Umbriel, Titania, Oberon and others)', atmosphere: 'Hydrogen, helium, methane; pale blue-green colour from methane absorption of red light', surface: 'Ice giant — no solid surface; rotates on its side (axial tilt ~98°)',
    notes: `Uranus is the **seventh** planet from the Sun and the third-largest in the Solar System by diameter. It was discovered by **William Herschel** in **1781** — the first planet discovered with a telescope, expanding the known Solar System beyond what had been visible to the naked eye since antiquity. Uranus is unique in having an axial tilt of about 98° — it rotates almost on its side relative to its orbit, probably due to a giant impact early in its history. Its faint ring system was discovered in 1977 by stellar occultation.` },
];

const CITIES_2: City2[] = [
  { names: ['berlin'], display: 'Berlin', country: 'Germany', population: '~3.8 million (city); ~6 million (metro)', area: '~891 km² (city)', founded: 'First documented in 1237', river: 'River Spree; Havel', notable: 'Capital of Germany; centre of 20th-century European history',
    notes: `Berlin is the capital and largest city of **Germany**, situated on the River **Spree** in the northeast of the country. It became the capital of the Kingdom of Prussia in 1701, then of the unified German Empire in 1871, the Weimar Republic, Nazi Germany, and (after reunification) the Federal Republic of Germany in 1990. The **Berlin Wall** divided the city from 1961 to 1989. Modern Berlin is famous for the Brandenburg Gate, the Reichstag, the East Side Gallery, Museum Island, Checkpoint Charlie, and one of the most vibrant cultural scenes in Europe.` },
  { names: ['rome', 'roma'], display: 'Rome', country: 'Italy', population: '~2.8 million (city); ~4.3 million (metro)', area: '~1,285 km² (city)', founded: 'Traditionally founded by Romulus on **21 April 753 BCE**', river: 'River Tiber', notable: 'Capital of Italy; capital of the Roman Empire; seat of the Vatican',
    notes: `Rome is the capital and largest city of **Italy**, situated on the River **Tiber** in the centre of the country. By tradition the city was founded by Romulus on 21 April 753 BCE; it grew to become the capital of the **Roman Empire**, which at its 2nd-century peak ruled an area from Britain to Mesopotamia and from the Rhine to the Sahara. The city is sometimes called the *Eternal City* and contains the Colosseum, the Pantheon, the Roman Forum, the Trevi Fountain, and the independent enclave of **Vatican City**, the smallest country in the world and the headquarters of the Roman Catholic Church.` },
  { names: ['sydney'], display: 'Sydney', country: 'Australia', population: '~5.3 million (metro)', area: '~12,367 km² (Greater Sydney)', founded: 'Founded as a British penal colony on 26 January 1788', river: 'Parramatta River; Sydney Harbour (Port Jackson)', notable: 'Largest city in Australia; capital of New South Wales',
    notes: `Sydney is the largest city in **Australia** and the capital of the state of New South Wales. It is built around one of the world most magnificent natural harbours, **Sydney Harbour** (Port Jackson). The city was **founded** on 26 January 1788 by the British First Fleet under Captain Arthur Phillip as a penal colony — that date is now commemorated as Australia Day. Sydney most famous landmarks are the **Sydney Opera House** (a UNESCO World Heritage site designed by Danish architect Jørn Utzon, opened in 1973) and the **Sydney Harbour Bridge** (opened in 1932).` },
  { names: ['mumbai', 'bombay'], display: 'Mumbai (Bombay)', country: 'India', population: '~12.5 million (city); ~22 million (metro)', area: '~603 km² (city)', founded: 'Long pre-colonial settlement; ceded to Britain in 1661 (dowry of Catherine of Braganza)', river: 'Mithi River; Arabian Sea coastline', notable: 'Largest city and financial capital of India; centre of Bollywood',
    notes: `Mumbai (called Bombay until 1995) is the largest city and the financial, commercial and entertainment capital of **India**. It is built on what was originally a group of seven islands off the west coast, since reclaimed and joined into a single peninsula. Mumbai is the headquarters of the Reserve Bank of India, the National Stock Exchange and the Bombay Stock Exchange (founded 1875, the oldest in Asia), and is home to **Bollywood**, the Hindi-language film industry that produces more films per year than any other in the world.` },
  { names: ['beijing', 'peking'], display: 'Beijing (Peking)', country: 'China', population: '~21.5 million (metro)', area: '~16,410 km² (municipality)', founded: 'Settlement since ~1000 BCE; capital under the Yuan, Ming, Qing dynasties and the modern PRC', river: 'Tonghui Canal; near the Yongding River', notable: 'Capital of China; home of the Forbidden City, Tiananmen Square and the Great Wall nearby',
    notes: `Beijing is the capital of the People Republic of **China** and the second-largest Chinese city by population after Shanghai. It has served as the imperial capital under the Yuan (Mongol), Ming and Qing dynasties, and has been the capital of the People Republic since its founding in 1949. The historic centre includes the **Forbidden City** (Imperial Palace, the largest preserved palace complex in the world, a UNESCO World Heritage site), **Tiananmen Square**, the Temple of Heaven and the Summer Palace. The Great Wall of China runs through the surrounding mountains.` },
  { names: ['dubai'], display: 'Dubai', country: 'United Arab Emirates', population: '~3.6 million (city); ~3.8 million (metro)', area: '~4,114 km² (emirate)', founded: 'Settlement from at least the 18th century; modern city took off after oil discovery in 1966', river: 'Dubai Creek; Persian Gulf coastline', notable: 'Largest city in the UAE; global business and tourism hub',
    notes: `Dubai is the largest city and most populous emirate of the **United Arab Emirates**, on the southeast coast of the Persian Gulf. While Abu Dhabi is the federal capital, Dubai is the country commercial, financial and tourism centre and one of the most important global cities of the early 21st century. Dubai is famously home to the **Burj Khalifa** (at 828 m the tallest building in the world since 2010), the artificial Palm Jumeirah islands, the Dubai Mall, and one of the world busiest international airports. Originally a pearling and fishing town, Dubai was transformed by oil from 1966 and by aggressive diversification thereafter.` },
];

const US_STATES: USState[] = [
  { names: ['california'], display: 'California', abbr: 'CA', capital: 'Sacramento', largestCity: 'Los Angeles', population: '~39 million (the most populous US state)', area: '~423,970 km² (third-largest by area)', joined: '9 September 1850 (31st state)',
    notes: `California is the most populous state of the **United States** and, on its own, the world fifth-largest economy by GDP. The state capital is **Sacramento**, but its largest cities are Los Angeles, San Diego, San Jose and San Francisco. California is home to **Hollywood** (the global centre of the film industry), **Silicon Valley** (the global centre of the technology industry), some of the world most iconic national parks (Yosemite, Sequoia, Joshua Tree, Death Valley), and the Pacific coastline from the Mexican border to Oregon. California joined the Union as the 31st state on 9 September 1850.` },
  { names: ['texas'], display: 'Texas', abbr: 'TX', capital: 'Austin', largestCity: 'Houston', population: '~30 million (second-most populous)', area: '~696,200 km² (second-largest by area, after Alaska)', joined: '29 December 1845 (28th state)',
    notes: `Texas is the second-most populous and second-largest **US state**. The state capital is **Austin**; the largest cities are Houston, San Antonio and Dallas. Texas was originally part of Mexico, became the independent **Republic of Texas** in 1836 after the Texas Revolution, and joined the Union as the 28th state on 29 December 1845. The state is the largest oil and gas producer in the US, the largest agricultural producer of cattle and cotton, and home to NASA Johnson Space Center in Houston, the SpaceX launch facility at Starbase, and a fast-growing technology sector.` },
  { names: ['florida'], display: 'Florida', abbr: 'FL', capital: 'Tallahassee', largestCity: 'Jacksonville', population: '~22 million (third-most populous)', area: '~170,310 km²', joined: '3 March 1845 (27th state)',
    notes: `Florida is the third-most populous **US state**, occupying a long peninsula in the southeast that separates the Gulf of Mexico from the Atlantic Ocean. The state capital is **Tallahassee**; the largest cities are Jacksonville, Miami, Tampa and Orlando. Florida is famous for its warm climate, beaches, the Everglades wetlands, **Walt Disney World** and Universal Studios in Orlando, and **Cape Canaveral**, NASA principal launch site for crewed and uncrewed spaceflight since the early 1960s. Florida joined the Union as the 27th state on 3 March 1845.` },
  { names: ['new york state'], display: 'New York (state)', abbr: 'NY', capital: 'Albany', largestCity: 'New York City', population: '~19.5 million', area: '~141,300 km²', joined: '26 July 1788 (11th state)',
    notes: `The State of New York is one of the original Thirteen Colonies and joined the Union as the 11th **US state** on 26 July 1788. The state capital is **Albany**, but New York City — the largest city in the United States, on the Hudson River and New York Harbor — dwarfs every other settlement in the state. New York is the financial centre of the United States (Wall Street and the New York Stock Exchange) and a global capital of media, fashion, the arts and the United Nations. The state natural attractions include the Adirondack and Catskill mountains, the Finger Lakes and Niagara Falls.` },
  { names: ['alaska'], display: 'Alaska', abbr: 'AK', capital: 'Juneau', largestCity: 'Anchorage', population: '~733,000 (the least densely populated state)', area: '~1,723,340 km² (the largest US state, by far)', joined: '3 January 1959 (49th state)',
    notes: `Alaska is by far the largest **US state** by area — about twice the size of Texas — and the least densely populated. It was purchased from the Russian Empire in 1867 for $7.2 million (the *Alaska Purchase*, sometimes mocked at the time as *Seward Folly*) and joined the Union as the 49th state on 3 January 1959. The capital is **Juneau** (accessible only by sea or air), the largest city is Anchorage. Alaska contains the highest peak in North America (Denali, 6,190 m), the largest national parks in the United States, and is a leading oil, fishing and tourism state.` },
  { names: ['hawaii'], display: 'Hawaii', abbr: 'HI', capital: 'Honolulu', largestCity: 'Honolulu', population: '~1.4 million', area: '~28,310 km² (a chain of volcanic islands)', joined: '21 August 1959 (50th state)',
    notes: `Hawaii is the most recent **US state** — admitted as the 50th state on 21 August 1959 — and the only state located entirely outside North America, in the central Pacific Ocean. It is also the only US state composed entirely of islands (a chain of volcanic islands stretching ~2,400 km). The capital and largest city is **Honolulu** on the island of Oahu. Hawaii is home to active volcanoes (Kilauea, Mauna Loa) on the Big Island, the Pearl Harbor naval base (attacked on 7 December 1941, bringing the US into World War II), and one of the most ethnically diverse populations of any US state.` },
  { names: ['illinois'], display: 'Illinois', abbr: 'IL', capital: 'Springfield', largestCity: 'Chicago', population: '~12.5 million', area: '~149,990 km²', joined: '3 December 1818 (21st state)',
    notes: `Illinois is a Midwestern **US state** that joined the Union as the 21st state on 3 December 1818. The state capital is **Springfield** (Abraham Lincoln adult home and burial place), but **Chicago**, on the southwestern shore of Lake Michigan, is the third-largest city in the United States and the dominant economic and cultural centre of the Midwest. Illinois is a major agricultural producer (corn, soybeans), a transportation hub (the Mississippi River, the busiest container railway hub at Chicago, and O'Hare International Airport), and home to the University of Chicago, Northwestern University and Argonne National Laboratory.` },
  { names: ['pennsylvania'], display: 'Pennsylvania', abbr: 'PA', capital: 'Harrisburg', largestCity: 'Philadelphia', population: '~13 million', area: '~119,280 km²', joined: '12 December 1787 (2nd state)',
    notes: `Pennsylvania was the second of the original Thirteen Colonies to ratify the United States Constitution, joining the Union as the 2nd **US state** on 12 December 1787. The state capital is **Harrisburg**, but **Philadelphia** (the largest city) was the meeting place of the Continental Congress, the city where the **Declaration of Independence** (1776) and the **United States Constitution** (1787) were signed, and the original capital of the United States. Pittsburgh, in the west of the state, was historically the centre of American steelmaking. Pennsylvania is also famous for the Amish communities of Lancaster County.` },
  { names: ['ohio'], display: 'Ohio', abbr: 'OH', capital: 'Columbus', largestCity: 'Columbus', population: '~11.8 million', area: '~116,100 km²', joined: '1 March 1803 (17th state)',
    notes: `Ohio is a Midwestern **US state** that joined the Union as the 17th state on 1 March 1803. The state capital and largest city is **Columbus**; other major cities are Cleveland, Cincinnati, Toledo and Akron. Ohio has produced more US Presidents than any state except Virginia (eight, including Ulysses S. Grant, Rutherford B. Hayes, James Garfield, Benjamin Harrison, William McKinley, William Howard Taft and Warren Harding). Ohio is a key swing state in US presidential elections and has long been an industrial and agricultural heartland.` },
  { names: ['washington state'], display: 'Washington (state)', abbr: 'WA', capital: 'Olympia', largestCity: 'Seattle', population: '~7.8 million', area: '~184,830 km²', joined: '11 November 1889 (42nd state)',
    notes: `The State of Washington is the only **US state** named after a US president — George Washington — and joined the Union as the 42nd state on 11 November 1889. It is in the Pacific Northwest, separated from the District of Columbia by the entire continent (a frequent source of confusion). The state capital is **Olympia**; the largest city is **Seattle**, on Puget Sound, headquarters of Boeing, Amazon, Microsoft (in nearby Redmond), Starbucks and Costco. Washington is famous for its rainy climate west of the Cascade Mountains, the volcanoes Mount Rainier and Mount St. Helens (which erupted catastrophically in 1980), and Olympic National Park.` },
];

function renderCountry2(c: Country2): string {
  return `**${c.display}** is a country in **${c.continent}**.\n\n` +
    `- **Capital:** ${c.capital}\n` +
    `- **Official language:** ${c.language}\n` +
    `- **Population:** ${c.population}\n` +
    `- **Area:** ${c.area}\n` +
    `- **Currency:** ${c.currency}\n` +
    `- **Government:** ${c.government}\n` +
    `- **Founded:** ${c.founded}\n` +
    `\n${c.notes}`;
}

function renderElement2(e: Element2): string {
  return `**${e.display}** (symbol **${e.symbol}**, atomic number **${e.atomicNumber}**) is a chemical element.\n\n` +
    `- **Symbol:** ${e.symbol}\n` +
    `- **Atomic number:** ${e.atomicNumber}\n` +
    `- **Atomic mass:** ${e.atomicMass}\n` +
    `- **Group / period:** ${e.group} / ${e.period}\n` +
    `- **Category:** ${e.category}\n` +
    `- **State at room temperature:** ${e.state}\n` +
    `- **Discovered:** ${e.discovered}\n` +
    `- **Common uses:** ${e.uses}\n` +
    `\n${e.notes}`;
}

function renderAnimal2(a: Animal2): string {
  return `The **${a.display}** (*${a.scientific}*) is an animal.\n\n` +
    `- **Scientific name:** ${a.scientific}\n` +
    `- **Class:** ${a.class}\n` +
    `- **Family:** ${a.family}\n` +
    `- **Habitat:** ${a.habitat}\n` +
    `- **Diet:** ${a.diet}\n` +
    `- **Lifespan:** ${a.lifespan}\n` +
    `- **Range:** ${a.range}\n` +
    `- **Conservation status:** ${a.status}\n` +
    `\n${a.notes}`;
}

function renderProgLang2(p: ProgLang2): string {
  return `**${p.display}** is a programming language.\n\n` +
    `- **Designer:** ${p.designer}\n` +
    `- **First appeared:** ${p.yearFirst}\n` +
    `- **Paradigm:** ${p.paradigm}\n` +
    `- **Typing:** ${p.typing}\n` +
    `- **Common uses:** ${p.uses}\n` +
    `- **Influences:** ${p.influences}\n` +
    `\n${p.notes}`;
}

function renderPlanet2(p: Planet2): string {
  return `**${p.display}** is the **${p.order}** planet from the Sun.\n\n` +
    `- **Order from Sun:** ${p.order}\n` +
    `- **Diameter:** ${p.diameter}\n` +
    `- **Mass:** ${p.mass}\n` +
    `- **Day length:** ${p.day}\n` +
    `- **Year length:** ${p.year}\n` +
    `- **Moons:** ${p.moons}\n` +
    `- **Atmosphere:** ${p.atmosphere}\n` +
    `- **Surface:** ${p.surface}\n` +
    `\n${p.notes}`;
}

function renderCity2(c: City2): string {
  return `**${c.display}** is a city in **${c.country}**.\n\n` +
    `- **Country:** ${c.country}\n` +
    `- **Population (metro):** ${c.population}\n` +
    `- **Area:** ${c.area}\n` +
    `- **Founded:** ${c.founded}\n` +
    `- **River / location:** ${c.river}\n` +
    `- **Notable for:** ${c.notable}\n` +
    `\n${c.notes}`;
}

function renderUSState(s: USState): string {
  return `**${s.display}** (${s.abbr}) is a **state of the United States**.\n\n` +
    `- **Capital:** ${s.capital}\n` +
    `- **Largest city:** ${s.largestCity}\n` +
    `- **Population:** ${s.population}\n` +
    `- **Area:** ${s.area}\n` +
    `- **Joined the Union:** ${s.joined}\n` +
    `\n${s.notes}`;
}

function topicWord2(name: string): string {
  return name.replace(/[.+*?^$()|[\]\\]/g, (m) => '\\' + m);
}

function makeMatcher2(names: string[]): RegExp {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(topicWord2).join('|');
  return new RegExp(`(?<![a-zA-Z0-9_])(?:${escaped})s?(?![a-zA-Z0-9_])`, 'i');
}

const COMPILED_2: CompiledEntry2[] = [];

for (const c of COUNTRIES_2) {
  COMPILED_2.push({ match: makeMatcher2(c.names), render: () => renderCountry2(c) });
}
for (const e of ELEMENTS_2) {
  COMPILED_2.push({ match: makeMatcher2(e.names), render: () => renderElement2(e) });
}
for (const a of ANIMALS_2) {
  COMPILED_2.push({ match: makeMatcher2(a.names), render: () => renderAnimal2(a) });
}
for (const p of PROG_LANGS_2) {
  COMPILED_2.push({ match: makeMatcher2(p.names), render: () => renderProgLang2(p) });
}
for (const p of PLANETS_2) {
  COMPILED_2.push({ match: makeMatcher2(p.names), render: () => renderPlanet2(p) });
}
for (const c of CITIES_2) {
  COMPILED_2.push({ match: makeMatcher2(c.names), render: () => renderCity2(c) });
}
for (const s of US_STATES) {
  COMPILED_2.push({ match: makeMatcher2(s.names), render: () => renderUSState(s) });
}

/**
 * Pure compiled lookup — no question-shape gating. The caller (the main
 * bulkFactsLookup in curated-facts-bulk.ts) is expected to gate first.
 */
export function bulkFactsLookup2Compiled(lower: string): string | null {
  for (const entry of COMPILED_2) {
    if (entry.match.test(lower)) return entry.render();
  }
  return null;
}
