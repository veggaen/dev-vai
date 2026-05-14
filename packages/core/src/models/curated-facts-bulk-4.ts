/**
 * Bulk curated facts — Round 26 extensions.
 *
 * Companion module to curated-facts-bulk-3.ts. Adds more entries to the
 * existing R25 topic classes (countries, US states, cities) and introduces
 * two new classes (web/back-end frameworks, tech companies).
 *
 * Called from bulkFactsLookup3Compiled when it falls through, so all the
 * gating in the main bulk lookup applies uniformly here too.
 */

interface Country4 {
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

interface USState4 {
  names: string[];
  display: string;
  abbr: string;
  capital: string;
  largestCity: string;
  population: string;
  area: string;
  admitted: string;
  nickname: string;
  region: string;
  notes: string;
}

interface City4 {
  names: string[];
  display: string;
  country: string;
  population: string;
  founded: string;
  region: string;
  landmarks: string;
  notes: string;
}

interface Framework4 {
  names: string[];
  display: string;
  language: string;
  released: string;
  creator: string;
  category: string;
  uses: string;
  notes: string;
}

interface Company4 {
  names: string[];
  display: string;
  founded: string;
  founders: string;
  headquarters: string;
  industry: string;
  ceo: string;
  notable: string;
  notes: string;
}

const COUNTRIES_4: Country4[] = [
  { names: ['kenya'], display: 'Kenya', capital: 'Nairobi', language: 'Swahili and English (official)', population: '~55 million', area: '~580,000 km^2', currency: 'Kenyan shilling (KES)', continent: 'Africa (East Africa)', founded: 'Independence from the United Kingdom 12 December 1963', government: 'Presidential representative democratic republic', notes: `Kenya straddles the equator and the Great Rift Valley. It is famed for the Maasai Mara and the Great Migration of wildebeest, for distance-running dominance (Kalenjin runners win an outsized share of marathon medals) and for being the headquarters of the United Nations Office at Nairobi - the only major UN office in the global South.` },
  { names: ['morocco'], display: 'Morocco', capital: 'Rabat', language: 'Arabic and Berber (Tamazight) (official); French widely used', population: '~37 million', area: '~447,000 km^2', currency: 'Moroccan dirham (MAD)', continent: 'Africa (North Africa)', founded: 'Idrisid dynasty 788 CE; modern independence from France 2 March 1956', government: 'Constitutional monarchy', notes: `Morocco sits at the western edge of the Arab and Berber worlds, separated from Spain by the Strait of Gibraltar. Marrakesh, Fes and Casablanca are major cultural and economic centres. The Atlas Mountains, the Sahara and the Atlantic and Mediterranean coasts give the country exceptional geographic variety.` },
  { names: ['chile'], display: 'Chile', capital: 'Santiago', language: 'Spanish', population: '~19 million', area: '~756,000 km^2', currency: 'Chilean peso (CLP)', continent: 'South America (Pacific coast)', founded: 'Independence from Spain declared 18 September 1810; consolidated 1818', government: 'Presidential representative democratic republic', notes: `Chile is the longest north-south country in the world (~4,300 km) but only ~177 km wide on average. It contains the Atacama, the driest desert on Earth, the southern Patagonia ice fields and Easter Island in the Pacific. It is the world\u2019s largest copper producer and a major wine exporter.` },
  { names: ['peru'], display: 'Peru', capital: 'Lima', language: 'Spanish, Quechua, Aymara (official)', population: '~34 million', area: '~1,285,000 km^2', currency: 'Peruvian sol (PEN)', continent: 'South America (Pacific coast)', founded: 'Independence from Spain declared 28 July 1821', government: 'Presidential representative democratic republic', notes: `Peru was the heart of the Inca Empire, the largest pre-Columbian state in the Americas. Machu Picchu, the Sacred Valley and Cusco draw millions of visitors. The country spans Pacific desert coast, Andean highlands and Amazon rainforest. Peruvian cuisine (ceviche, lomo saltado) is among the most acclaimed in the world.` },
  { names: ['pakistan'], display: 'Pakistan', capital: 'Islamabad', language: 'Urdu and English (official); Punjabi most widely spoken', population: '~240 million (5th most populous)', area: '~881,000 km^2', currency: 'Pakistani rupee (PKR)', continent: 'Asia (South Asia)', founded: 'Independence from British India 14 August 1947', government: 'Federal parliamentary republic', notes: `Pakistan was created in 1947 as a homeland for the Muslims of British India, partitioned from what became the Republic of India. Karachi is the largest city and economic centre; Lahore is the cultural heart of Punjab. The country contains K2 (the world\u2019s second-highest mountain) and is one of nine declared nuclear powers.` },
  { names: ['bangladesh'], display: 'Bangladesh', capital: 'Dhaka', language: 'Bengali (Bangla)', population: '~170 million (8th most populous; one of the most densely populated)', area: '~148,000 km^2', currency: 'Bangladeshi taka (BDT)', continent: 'Asia (South Asia)', founded: 'Independence from Pakistan 16 December 1971', government: 'Parliamentary republic', notes: `Bangladesh occupies the world\u2019s largest river delta (Ganges-Brahmaputra) and is one of the most populous and densely populated countries on Earth. It is the world\u2019s second-largest exporter of ready-made garments after China and a pioneer of microfinance via the Grameen Bank.` },
  { names: ['malaysia'], display: 'Malaysia', capital: 'Kuala Lumpur (federal); Putrajaya (administrative)', language: 'Malay (Bahasa Malaysia); English, Mandarin, Tamil widely used', population: '~34 million', area: '~330,000 km^2', currency: 'Malaysian ringgit (MYR)', continent: 'Asia (South-East Asia)', founded: 'Federation of Malaya 1957; Malaysia formed 16 September 1963', government: 'Federal parliamentary constitutional monarchy', notes: `Malaysia is split between Peninsular Malaysia and East Malaysia (on Borneo, sharing the island with Indonesia and Brunei). Kuala Lumpur\u2019s Petronas Twin Towers (1998) were the world\u2019s tallest buildings until 2004. Malaysia is the world\u2019s second-largest producer of palm oil and a multi-ethnic, multi-faith society.` },
  { names: ['israel'], display: 'Israel', capital: 'Jerusalem (claimed and seat of government); Tel Aviv often used by foreign embassies', language: 'Hebrew (official); Arabic widely used', population: '~9.8 million', area: '~22,000 km^2', currency: 'Israeli new shekel (ILS)', continent: 'Asia (Levant / Middle East)', founded: 'Declared independence 14 May 1948', government: 'Parliamentary democracy (Knesset)', notes: `Israel is the only Jewish-majority state in the world and a centre for the three Abrahamic faiths. Despite its small size and long-running regional conflicts it is a major hub for technology and applied sciences (often called Start-up Nation), with one of the highest per-capita rates of patents and venture funding.` },
  { names: ['united arab emirates', 'uae'], display: 'United Arab Emirates', capital: 'Abu Dhabi', language: 'Arabic (official); English widely used', population: '~9.5 million (~88% expatriates)', area: '~83,600 km^2', currency: 'UAE dirham (AED)', continent: 'Asia (Arabian Peninsula)', founded: 'Federation of seven emirates 2 December 1971', government: 'Federal absolute monarchy of seven hereditary emirates', notes: `The UAE is a federation of seven emirates - Abu Dhabi (capital), Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah and Fujairah. From a sparsely populated trucial coast it became, on the back of oil and aggressive economic diversification, a global hub for finance, aviation, tourism and trade. Burj Khalifa in Dubai is the world\u2019s tallest building.` },
  { names: ['colombia'], display: 'Colombia', capital: 'Bogota', language: 'Spanish', population: '~52 million', area: '~1,142,000 km^2', currency: 'Colombian peso (COP)', continent: 'South America (Andes and Caribbean)', founded: 'Independence from Spain 20 July 1810; consolidated 1819', government: 'Presidential representative democratic republic', notes: `Colombia is the only South American country with both Pacific and Caribbean coastlines. The Andes split into three ranges crossing the country, and the Amazon basin covers the south. It is the world\u2019s leading producer of high-altitude arabica coffee and emeralds, and a major cultural exporter (Gabriel Garcia Marquez, Shakira, Juanes, Carlos Vives).` }
];

const US_STATES_4: USState4[] = [
  { names: ['north carolina'], display: 'North Carolina', abbr: 'NC', capital: 'Raleigh', largestCity: 'Charlotte', population: '~10.7 million', area: '~140,000 km^2', admitted: '21 November 1789 (12th state)', nickname: 'Tar Heel State; Old North State', region: 'Southeast', notes: `North Carolina is one of the original 13 colonies. Charlotte is the second-largest banking centre in the United States after New York. The Wright brothers made the first powered flight at Kitty Hawk in 1903. The Research Triangle (Raleigh-Durham-Chapel Hill) is a leading hub for biotechnology and information technology.` },
  { names: ['new jersey'], display: 'New Jersey', abbr: 'NJ', capital: 'Trenton', largestCity: 'Newark', population: '~9.3 million', area: '~22,500 km^2', admitted: '18 December 1787 (3rd state)', nickname: 'The Garden State', region: 'Mid-Atlantic / Northeast', notes: `New Jersey is the most densely populated US state. It sits between the New York City and Philadelphia metropolitan areas and contains major financial back-office, pharmaceutical and chemical industries. The Jersey Shore is a long-standing summer destination, and Atlantic City is a historic casino and resort town.` },
  { names: ['tennessee'], display: 'Tennessee', abbr: 'TN', capital: 'Nashville', largestCity: 'Nashville', population: '~7.1 million', area: '~109,000 km^2', admitted: '1 June 1796 (16th state)', nickname: 'The Volunteer State', region: 'Southeast', notes: `Tennessee is the heart of country music (Nashville is "Music City") and a major centre of blues, soul and rock and roll (Memphis: Sun Studio, Stax, Graceland - the home of Elvis Presley). The Great Smoky Mountains are the most-visited national park in the United States. The state has no income tax on wages.` },
  { names: ['maryland'], display: 'Maryland', abbr: 'MD', capital: 'Annapolis', largestCity: 'Baltimore', population: '~6.2 million', area: '~32,000 km^2', admitted: '28 April 1788 (7th state)', nickname: 'Old Line State; Free State', region: 'Mid-Atlantic / Northeast', notes: `Maryland surrounds the Chesapeake Bay, source of its famed blue crab. Baltimore is a historic port; Annapolis hosts the United States Naval Academy. Maryland adjoins Washington, D.C. and contains many federal-government and biomedical-research facilities (NIH, NSA, NASA Goddard, Johns Hopkins).` },
  { names: ['indiana'], display: 'Indiana', abbr: 'IN', capital: 'Indianapolis', largestCity: 'Indianapolis', population: '~6.8 million', area: '~94,000 km^2', admitted: '11 December 1816 (19th state)', nickname: 'The Hoosier State', region: 'Midwest', notes: `Indiana is at the eastern edge of the Corn Belt. Indianapolis hosts the Indianapolis 500, the world\u2019s largest single-day sporting event by attendance. Notre Dame and Purdue are major universities. The state\u2019s manufacturing base remains strong in steel, automobiles and pharmaceuticals (Eli Lilly is headquartered in Indianapolis).` },
  { names: ['missouri'], display: 'Missouri', abbr: 'MO', capital: 'Jefferson City', largestCity: 'Kansas City', population: '~6.2 million', area: '~180,000 km^2', admitted: '10 August 1821 (24th state, the Missouri Compromise)', nickname: 'The Show Me State', region: 'Midwest', notes: `Missouri sits at the confluence of the Missouri and Mississippi rivers, the gateway to the American West historically marked by Saint Louis and the Gateway Arch. Kansas City and Saint Louis are major metro areas. Mark Twain set Tom Sawyer and Huckleberry Finn along the Mississippi in his native Hannibal, Missouri.` },
  { names: ['south carolina'], display: 'South Carolina', abbr: 'SC', capital: 'Columbia', largestCity: 'Charleston', population: '~5.4 million', area: '~82,000 km^2', admitted: '23 May 1788 (8th state)', nickname: 'The Palmetto State', region: 'Southeast', notes: `South Carolina was the first state to secede from the Union in 1860, opening the Civil War with the bombardment of Fort Sumter. Charleston is one of America\u2019s most preserved colonial cities. Hilton Head Island and Myrtle Beach are major tourist destinations. BMW and Boeing both operate large manufacturing plants in the state.` },
  { names: ['oklahoma'], display: 'Oklahoma', abbr: 'OK', capital: 'Oklahoma City', largestCity: 'Oklahoma City', population: '~4.0 million', area: '~181,000 km^2', admitted: '16 November 1907 (46th state)', nickname: 'The Sooner State', region: 'South / Great Plains', notes: `Oklahoma was Indian Territory before statehood and remains home to 39 federally recognised tribal nations. It sits at the heart of Tornado Alley and is a major producer of oil and natural gas. The state name comes from the Choctaw words okla (people) and humma (red).` },
  { names: ['connecticut'], display: 'Connecticut', abbr: 'CT', capital: 'Hartford', largestCity: 'Bridgeport', population: '~3.6 million', area: '~14,000 km^2', admitted: '9 January 1788 (5th state)', nickname: 'The Constitution State; Nutmeg State', region: 'New England', notes: `Connecticut is one of the wealthiest US states by per-capita income, with a strong financial-services sector concentrated in Stamford and Hartford (the historic "Insurance Capital"). Yale University is in New Haven. The Fundamental Orders of Connecticut (1639) are sometimes considered the first written constitution in Western history.` },
  { names: ['utah'], display: 'Utah', abbr: 'UT', capital: 'Salt Lake City', largestCity: 'Salt Lake City', population: '~3.4 million', area: '~220,000 km^2', admitted: '4 January 1896 (45th state)', nickname: 'The Beehive State', region: 'Mountain West', notes: `Utah was settled by Mormon pioneers under Brigham Young in 1847 and remains the heartland of The Church of Jesus Christ of Latter-day Saints. It contains five spectacular national parks (Zion, Bryce Canyon, Arches, Capitol Reef, Canyonlands) and the Great Salt Lake. The Salt Lake City region hosted the 2002 Winter Olympics.` }
];

const CITIES_4: City4[] = [
  { names: ['mexico city'], display: 'Mexico City', country: 'Mexico (capital)', population: '~9.2 million city, ~22 million metro (largest in North America)', founded: 'Aztec Tenochtitlan 1325; refounded by the Spanish 1521', region: 'Central Mexico, Valley of Mexico (~2,240 m elevation)', landmarks: 'Zocalo, Metropolitan Cathedral, Templo Mayor, National Palace, Chapultepec Park, Frida Kahlo Museum', notes: `Mexico City sits on the drained lake bed of the Aztec capital Tenochtitlan, which was one of the largest cities in the world when Hernan Cortes arrived in 1519. The greater metropolitan area is the largest in the Spanish-speaking world and home to the Mexican federal government, major universities (UNAM) and a vast cultural and culinary scene.` },
  { names: ['buenos aires'], display: 'Buenos Aires', country: 'Argentina (capital)', population: '~3.1 million city, ~16 million metro', founded: 'Founded 1536 (failed) and 1580 (permanent) by Spanish settlers', region: 'Eastern Argentina, on the Rio de la Plata estuary', landmarks: 'Plaza de Mayo, Casa Rosada, Teatro Colon, Caminito (La Boca), Recoleta Cemetery (Eva Peron\u2019s grave), Palermo parks', notes: `Buenos Aires is the political, economic and cultural centre of Argentina. Its European architecture (often compared to Paris), tango culture, theatre district and obsession with football make it one of the most distinctive cities in the Americas. The city hosts a major book industry and the most published Spanish-language newspapers in the southern hemisphere.` },
  { names: ['saint petersburg', 'st petersburg', 'st. petersburg', 'leningrad'], display: 'Saint Petersburg', country: 'Russia (former capital)', population: '~5.6 million', founded: '27 May 1703 by Tsar Peter the Great', region: 'North-western Russia, on the Neva River and Gulf of Finland', landmarks: 'Hermitage Museum, Winter Palace, Peter and Paul Fortress, Church of the Saviour on Spilled Blood, Palace Square, Nevsky Prospect', notes: `Saint Petersburg was founded by Peter the Great as Russia\u2019s window on Europe and served as the imperial capital until 1918. It was renamed Petrograd (1914) and Leningrad (1924) before reverting to its original name in 1991. The city centre is a UNESCO World Heritage Site and one of the great urban ensembles of European art and architecture.` },
  { names: ['vienna'], display: 'Vienna', country: 'Austria (capital)', population: '~2.0 million', founded: 'Roman military camp Vindobona 1st century CE; Habsburg capital from 1278', region: 'Eastern Austria, on the Danube', landmarks: 'Schonbrunn Palace, Hofburg, Saint Stephen\u2019s Cathedral, Belvedere, Vienna State Opera, Prater (with the Riesenrad)', notes: `Vienna was the capital of the Habsburg Monarchy and Austro-Hungarian Empire and a global centre of classical music (Mozart, Beethoven, Schubert, Brahms, Mahler) and the arts (Klimt, Schiele). Today it is one of the world\u2019s most liveable cities and a major United Nations seat (alongside New York, Geneva and Nairobi).` },
  { names: ['athens'], display: 'Athens', country: 'Greece (capital)', population: '~640,000 city, ~3.8 million metro', founded: 'Continuously inhabited for ~5,000 years; classical golden age 5th century BCE', region: 'Attica region, central-eastern Greece', landmarks: 'Acropolis with the Parthenon, Erechtheion, Temple of Olympian Zeus, Ancient Agora, Acropolis Museum, Plaka district', notes: `Athens is one of the oldest cities in the world and the cradle of Western philosophy, drama, mathematics and democracy. It hosted the first modern Olympic Games in 1896 and the 2004 Summer Olympics. The Acropolis remains the most enduring symbol of classical antiquity.` },
  { names: ['stockholm'], display: 'Stockholm', country: 'Sweden (capital)', population: '~990,000 city, ~2.4 million metro', founded: 'Founded as a fortified town c. 1252', region: 'Eastern Sweden, on a 14-island archipelago at the mouth of Lake Malaren', landmarks: 'Gamla Stan (Old Town), Royal Palace, Vasa Museum, Stockholm City Hall, ABBA Museum, Skansen open-air museum', notes: `Stockholm is the largest city in Scandinavia, the seat of the Swedish royal family, parliament and government, and the host of the annual Nobel Prize ceremonies (the Nobel Peace Prize is awarded in Oslo). Built across 14 islands, it is sometimes called the Venice of the North.` },
  { names: ['vancouver'], display: 'Vancouver', country: 'Canada (British Columbia)', population: '~660,000 city, ~2.8 million metro', founded: 'Incorporated 1886', region: 'Pacific coast of British Columbia, surrounded by mountains', landmarks: 'Stanley Park, Granville Island, Capilano Suspension Bridge, Grouse Mountain, Canada Place, Gastown', notes: `Vancouver is regularly ranked among the most liveable cities in the world. Its setting between the Pacific Ocean and the Coast Mountains makes it a hub for outdoor recreation. It is one of the most ethnically diverse cities in North America (large Chinese, Indian and Filipino communities) and a major film-production centre nicknamed "Hollywood North".` },
  { names: ['seoul'], display: 'Seoul', country: 'South Korea (capital)', population: '~9.7 million city, ~26 million metro', founded: 'Capital of Joseon Korea since 1394; modern reconstruction post-1953', region: 'North-western South Korea, on the Han River', landmarks: 'Gyeongbokgung Palace, Bukchon Hanok Village, N Seoul Tower, Myeongdong, Gangnam district, Dongdaemun Design Plaza', notes: `Seoul is the political, economic and cultural heart of South Korea, accounting for roughly half the country\u2019s population in its metro area. It is headquarters to Samsung, Hyundai and LG and the global epicentre of K-pop, K-drama and Korean cinema. The Han River bisects the city; Gangnam south of the river is the wealthy commercial district.` },
  { names: ['kuala lumpur', 'kl city'], display: 'Kuala Lumpur', country: 'Malaysia (federal capital)', population: '~1.8 million city, ~8 million metro (Klang Valley)', founded: 'Founded 1857 as a tin-mining settlement', region: 'West coast of Peninsular Malaysia, at the confluence of the Klang and Gombak rivers', landmarks: 'Petronas Twin Towers, KL Tower, Batu Caves, Merdeka Square, Sultan Abdul Samad Building, Bukit Bintang shopping district', notes: `Kuala Lumpur (often abbreviated KL) is the largest city in Malaysia. The Petronas Twin Towers held the title of world\u2019s tallest buildings from 1998 to 2004. The city reflects Malaysia\u2019s multi-ethnic mix of Malay, Chinese, Indian and indigenous cultures, with mosques, temples and churches in close quarters.` },
  { names: ['jerusalem'], display: 'Jerusalem', country: 'Israel (claimed capital) and a city of deep religious significance', population: '~970,000 city, ~1.3 million metro', founded: 'Settled for over 5,000 years; first walled city c. 1800 BCE', region: 'Judean Mountains, between the Mediterranean and the Dead Sea', landmarks: 'Western Wall, Temple Mount and Dome of the Rock, Al-Aqsa Mosque, Church of the Holy Sepulchre, Old City walls, Yad Vashem', notes: `Jerusalem is sacred to the three Abrahamic religions: Judaism (Western Wall, Temple Mount), Christianity (Church of the Holy Sepulchre, the site of the Crucifixion and Resurrection) and Islam (Al-Aqsa, Dome of the Rock). The Old City is divided into Jewish, Muslim, Christian and Armenian quarters and is a UNESCO World Heritage Site. The political status of the city remains internationally disputed.` }
];

const FRAMEWORKS_4: Framework4[] = [
  { names: ['react', 'reactjs', 'react.js'], display: 'React', language: 'JavaScript / TypeScript', released: '29 May 2013 (open-sourced by Facebook)', creator: 'Jordan Walke at Facebook (now Meta)', category: 'Front-end UI library (often described as a framework in practice)', uses: 'Single-page applications, component-based UIs, React Native for mobile, server components in modern Next.js', notes: `React introduced the virtual DOM and the unidirectional data-flow model that came to dominate modern front-end development. JSX (HTML-like syntax in JavaScript) and the component model are now standard idioms. React Hooks (introduced in 16.8, February 2019) replaced most class-based components with composable functional patterns.` },
  { names: ['vue', 'vuejs', 'vue.js'], display: 'Vue.js', language: 'JavaScript / TypeScript', released: 'February 2014', creator: 'Evan You', category: 'Front-end progressive framework', uses: 'Single-page applications, component-based UIs, server-side rendering with Nuxt, full-stack apps via Nuxt 3', notes: `Vue was designed by former Google AngularJS engineer Evan You as a lighter, more approachable alternative. Its single-file components (.vue files combining template, script and style) and the Composition API (Vue 3, 2020) influenced React Hooks. Vue is particularly popular in China and Europe and is known for excellent documentation.` },
  { names: ['angular', 'angularjs'], display: 'Angular', language: 'TypeScript (Angular 2+); JavaScript for the original AngularJS', released: 'AngularJS October 2010; Angular (rewrite) September 2016', creator: 'Misko Hevery and the Google Angular team', category: 'Front-end full framework', uses: 'Large enterprise single-page applications; opinionated full-stack workflow with built-in routing, forms, HTTP, RxJS', notes: `Angular is a full opinionated framework rather than a library. It was rewritten from scratch in TypeScript for version 2 in 2016, breaking with AngularJS. It uses dependency injection, reactive programming via RxJS and an Ahead-of-Time compiler. Heavily used in enterprise contexts.` },
  { names: ['svelte', 'sveltekit'], display: 'Svelte', language: 'JavaScript / TypeScript', released: 'November 2016', creator: 'Rich Harris', category: 'Compile-time front-end framework', uses: 'Component-based UIs that compile away to optimised vanilla JavaScript; SvelteKit for full-stack apps', notes: `Svelte takes a different approach from React/Vue/Angular: instead of a runtime virtual DOM, it compiles components at build time into surgical DOM updates. This often yields smaller bundles and better runtime performance. Rich Harris (formerly at the New York Times, then Vercel) leads the project; SvelteKit is the official meta-framework.` },
  { names: ['next.js', 'nextjs'], display: 'Next.js', language: 'JavaScript / TypeScript (built on React)', released: '25 October 2016', creator: 'Vercel (formerly Zeit), led by Guillermo Rauch', category: 'React meta-framework', uses: 'Server-side rendering, static site generation, server components, API routes, full-stack React applications', notes: `Next.js is the most widely adopted React meta-framework. It pioneered hybrid rendering (SSR + SSG + ISR), the file-system router, and the App Router with React Server Components (Next 13/14/15). It is the default choice for most production React applications and the flagship framework of Vercel\u2019s deployment platform.` },
  { names: ['django'], display: 'Django', language: 'Python', released: '21 July 2005', creator: 'Adrian Holovaty and Simon Willison at the Lawrence Journal-World newspaper', category: 'Back-end web framework (full-stack, batteries-included)', uses: 'Database-driven websites, content management systems, REST APIs (with Django REST Framework), large web applications (Instagram, Disqus, Pinterest)', notes: `Django follows the "batteries-included" philosophy: ORM, admin interface, authentication, forms, templating and security defaults are all built in. It enforces a model-template-view architecture (a flavour of MVC). Django is widely used in scientific publishing, government and content-heavy applications.` },
  { names: ['ruby on rails', 'ruby rails', 'rails framework'], display: 'Ruby on Rails', language: 'Ruby', released: 'December 2005', creator: 'David Heinemeier Hansson (DHH) at 37signals (now Basecamp)', category: 'Back-end web framework (full-stack)', uses: 'Database-driven websites, startups (Shopify, GitHub, Airbnb, Basecamp), APIs', notes: `Rails popularised "convention over configuration" and the Active Record pattern, and made the model-view-controller architecture the default of mainstream web development for a generation. It launched the careers of many startups (GitHub, Shopify, Airbnb, Basecamp) and influenced Django, Laravel and many later frameworks.` },
  { names: ['laravel'], display: 'Laravel', language: 'PHP', released: 'June 2011', creator: 'Taylor Otwell', category: 'Back-end web framework (full-stack)', uses: 'Database-driven websites, REST APIs, content systems, Inertia/Livewire single-page-style apps; large PHP startups and agencies', notes: `Laravel is the dominant modern PHP framework, taking conventions from Ruby on Rails and combining them with PHP\u2019s deep web roots. Eloquent (its ORM), Blade templates, queues and the Artisan CLI are core. Laravel Forge, Vapor and Nova are first-party tools that make production deployment, serverless and admin panels straightforward.` },
  { names: ['nestjs', 'nest.js'], display: 'NestJS', language: 'TypeScript (Node.js)', released: 'May 2017', creator: 'Kamil Mysliwiec', category: 'Back-end web framework (Node.js, TypeScript-first)', uses: 'Enterprise Node.js back-ends, REST and GraphQL APIs, microservices, WebSocket gateways', notes: `NestJS layers an Angular-style architecture (modules, decorators, dependency injection) on top of Express or Fastify. It is the most popular opinionated TypeScript framework on Node and is widely used by teams that want Java/.NET-style structure with the JavaScript runtime.` },
  { names: ['spring framework', 'spring boot'], display: 'Spring (and Spring Boot)', language: 'Java (also Kotlin)', released: 'Spring 1.0 in March 2004; Spring Boot 1.0 in April 2014', creator: 'Rod Johnson (Spring Framework) and the Pivotal/VMware team (Spring Boot)', category: 'Java enterprise back-end framework', uses: 'Enterprise back-end services, microservices, REST APIs, batch jobs; Spring Boot for opinionated rapid setup', notes: `Spring is the dominant enterprise Java framework, providing dependency injection, AOP and a vast ecosystem (Spring MVC, Spring Data, Spring Security, Spring Cloud). Spring Boot reduced the configuration burden by providing convention-driven defaults and embedded servers. It runs much of the world\u2019s back-office and banking infrastructure.` },
  { names: ['express', 'express.js', 'expressjs'], display: 'Express.js', language: 'JavaScript / TypeScript (Node.js)', released: '16 November 2010', creator: 'TJ Holowaychuk', category: 'Minimalist back-end web framework for Node.js', uses: 'REST APIs, middleware-based servers, lightweight web applications, foundation for many higher-level frameworks (NestJS, Sails, Feathers)', notes: `Express is the de-facto standard minimalist web framework for Node.js. Its middleware model (a pipeline of (req, res, next) functions) influenced Koa, NestJS and many subsequent server frameworks across languages. Despite the rise of newer alternatives it remains heavily used in production.` },
  { names: ['fastapi'], display: 'FastAPI', language: 'Python (3.7+)', released: 'December 2018', creator: 'Sebastian Ramirez', category: 'Modern Python web framework for APIs', uses: 'High-performance REST APIs, ML model serving, microservices, automatic OpenAPI / Swagger documentation', notes: `FastAPI built on Python type hints, Starlette and Pydantic to provide one of the highest-performance Python web frameworks (comparable to Node.js and Go in many benchmarks). Automatic OpenAPI documentation, request validation and async-first design have made it the preferred Python framework for new API services and ML model deployment.` }
];

const COMPANIES_4: Company4[] = [
  { names: ['google company', 'alphabet inc'], display: 'Google (Alphabet Inc.)', founded: '4 September 1998 (Google); reorganised under Alphabet 2 October 2015', founders: 'Larry Page and Sergey Brin', headquarters: 'Mountain View, California (Googleplex)', industry: 'Internet search, online advertising, cloud computing, software, hardware, AI', ceo: 'Sundar Pichai (CEO of both Google and Alphabet)', notable: 'Google Search, Android, YouTube, Chrome, Gmail, Google Cloud, Google Maps, Pixel, Waymo, DeepMind', notes: `Google began as a Stanford research project on the PageRank algorithm. It dominates internet search (~90% global market share) and online advertising and is one of the world\u2019s most valuable companies. Alphabet is the parent holding created in 2015 to separate Google from "other bets" like Waymo (autonomous driving) and Verily (life sciences).` },
  { names: ['microsoft'], display: 'Microsoft', founded: '4 April 1975', founders: 'Bill Gates and Paul Allen', headquarters: 'Redmond, Washington', industry: 'Software, cloud computing, hardware, gaming, AI', ceo: 'Satya Nadella', notable: 'Windows, Microsoft 365 (Office), Azure, Xbox, GitHub, LinkedIn, Surface, Visual Studio, Copilot', notes: `Microsoft built the personal-computing era on MS-DOS and Windows and the productivity-software market on Office. Under CEO Satya Nadella (2014\u2013) it pivoted to cloud (Azure), made major acquisitions (LinkedIn 2016, GitHub 2018, Activision Blizzard 2023) and led the corporate AI integration wave with its OpenAI partnership.` },
  { names: ['apple inc', 'apple company'], display: 'Apple Inc.', founded: '1 April 1976', founders: 'Steve Jobs, Steve Wozniak, Ronald Wayne', headquarters: 'Cupertino, California (Apple Park)', industry: 'Consumer electronics, software, services', ceo: 'Tim Cook (since August 2011)', notable: 'iPhone, Mac, iPad, Apple Watch, AirPods, App Store, iCloud, Apple Music, Apple TV+', notes: `Apple is one of the most valuable companies in history, the first to reach a 1, 2 and 3 trillion-dollar market capitalisation. The 2007 launch of the iPhone redefined the smartphone market and the broader consumer-electronics industry. Apple\u2019s tightly integrated hardware-software-services model is the template most rivals chase.` },
  { names: ['amazon company', 'amazon.com'], display: 'Amazon.com', founded: '5 July 1994', founders: 'Jeff Bezos', headquarters: 'Seattle, Washington (HQ1) and Arlington, Virginia (HQ2)', industry: 'E-commerce, cloud computing (AWS), digital streaming, AI, logistics', ceo: 'Andy Jassy (since July 2021)', notable: 'Amazon.com online store, Amazon Web Services (AWS), Prime Video, Kindle, Echo / Alexa, Whole Foods, MGM Studios', notes: `Amazon began selling books online and grew into the dominant e-commerce platform in much of the world. Amazon Web Services (AWS), launched in 2006, is the leading cloud-computing platform globally and a major profit driver. Amazon\u2019s logistics network is one of the largest in the world.` },
  { names: ['meta platforms', 'facebook company', 'meta company'], display: 'Meta Platforms', founded: '4 February 2004 (as Facebook); renamed Meta Platforms 28 October 2021', founders: 'Mark Zuckerberg, Eduardo Saverin, Andrew McCollum, Dustin Moskovitz, Chris Hughes', headquarters: 'Menlo Park, California', industry: 'Social media, advertising, virtual and augmented reality, AI', ceo: 'Mark Zuckerberg', notable: 'Facebook, Instagram, WhatsApp, Messenger, Threads, Quest VR headsets, Reality Labs, Llama AI models', notes: `Meta operates the largest social-media network on Earth (Facebook, Instagram, WhatsApp combined have several billion monthly users). The 2021 rebranding to Meta marked a strategic bet on the metaverse and VR/AR via Reality Labs. The company is also a major releaser of open-weight AI models (Llama family).` },
  { names: ['nvidia'], display: 'Nvidia', founded: '5 April 1993', founders: 'Jensen Huang, Chris Malachowsky, Curtis Priem', headquarters: 'Santa Clara, California', industry: 'Semiconductors, GPU computing, AI hardware and software', ceo: 'Jensen Huang', notable: 'GeForce GPUs, Quadro / RTX professional GPUs, Tegra mobile SoCs, CUDA, A100/H100/B200 datacenter accelerators, DGX systems, Omniverse', notes: `Nvidia invented the modern GPU (GeForce 256, 1999) and pioneered general-purpose GPU computing with CUDA (2007). The 2010s deep-learning revolution turned its datacenter GPUs into the dominant AI accelerators, and the 2022 onward generative-AI boom made Nvidia briefly the world\u2019s most valuable public company.` },
  { names: ['openai'], display: 'OpenAI', founded: '11 December 2015', founders: 'Sam Altman, Elon Musk, Greg Brockman, Ilya Sutskever, Wojciech Zaremba, John Schulman and others', headquarters: 'San Francisco, California', industry: 'Artificial intelligence research and deployment', ceo: 'Sam Altman', notable: 'GPT model family, ChatGPT (launched 30 November 2022), DALL-E, Whisper, Codex, Sora, the OpenAI API, Microsoft strategic partnership', notes: `OpenAI was founded as a non-profit AI lab and later restructured to a capped-profit company. The November 2022 release of ChatGPT, built on GPT-3.5, became the fastest-consumer-software adoption in history and triggered a global wave of generative-AI products. GPT-4 (2023) and successors anchor much of the current commercial AI landscape.` },
  { names: ['tesla company', 'tesla motors', 'tesla inc'], display: 'Tesla, Inc.', founded: '1 July 2003', founders: 'Martin Eberhard and Marc Tarpenning (Elon Musk joined 2004 as chairman / lead investor; later CEO)', headquarters: 'Austin, Texas', industry: 'Electric vehicles, battery energy storage, solar, AI / autonomy', ceo: 'Elon Musk', notable: 'Model S, Model 3, Model X, Model Y, Cybertruck, Semi, Powerwall, Megapack, Supercharger network, Full Self-Driving software', notes: `Tesla is named after Nikola Tesla and largely created the modern mass-market electric-vehicle category with the Model S (2012) and Model 3 (2017). It built the world\u2019s most extensive fast-charging network and significantly drove the global automotive transition to electrification. Energy storage and autonomous-driving software are growing arms.` },
  { names: ['netflix'], display: 'Netflix', founded: '29 August 1997', founders: 'Reed Hastings and Marc Randolph', headquarters: 'Los Gatos, California', industry: 'Subscription streaming, film and television production', ceo: 'Ted Sarandos and Greg Peters (co-CEOs)', notable: 'Netflix streaming service, original films and series (Stranger Things, The Crown, Squid Game), DVD-by-mail (legacy)', notes: `Netflix began as a DVD-by-mail rental service in the United States and pivoted to streaming in 2007, then to original content from 2013. House of Cards (2013) launched its production arm. The service is now available in nearly every country on Earth and triggered the broader "streaming wars" reshaping the global TV and film industries.` },
  { names: ['adobe'], display: 'Adobe Inc.', founded: 'December 1982', founders: 'John Warnock and Charles Geschke', headquarters: 'San Jose, California', industry: 'Creative software, document services, marketing technology', ceo: 'Shantanu Narayen', notable: 'Photoshop, Illustrator, Premiere Pro, After Effects, Lightroom, InDesign, Acrobat / PDF, Creative Cloud, Adobe Express, Firefly generative AI', notes: `Adobe defines the global standard for creative-professional software. PostScript (its first major product) revolutionised digital printing in the 1980s; PDF (introduced 1993) became the world\u2019s standard document format. The 2013 transition to Creative Cloud subscriptions reshaped its business model and the software industry more broadly.` }
];

function makeMatcher4(names: string[]): RegExp {
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const alts = escaped.map((n) => `${n}s?`).join('|');
  return new RegExp(`(?:^|[^A-Za-z0-9_])(?:${alts})(?:$|[^A-Za-z0-9_])`, 'i');
}

function renderCountry4(c: Country4): string {
  return `**${c.display}**\n\n` +
    `- **Capital:** ${c.capital}\n` +
    `- **Language:** ${c.language}\n` +
    `- **Population:** ${c.population}\n` +
    `- **Area:** ${c.area}\n` +
    `- **Currency:** ${c.currency}\n` +
    `- **Continent:** ${c.continent}\n` +
    `- **Founded:** ${c.founded}\n` +
    `- **Government:** ${c.government}\n\n` +
    c.notes;
}

function renderUSState4(s: USState4): string {
  return `**${s.display}**\n\n` +
    `- **Abbreviation:** ${s.abbr}\n` +
    `- **Capital:** ${s.capital}\n` +
    `- **Largest city:** ${s.largestCity}\n` +
    `- **Population:** ${s.population}\n` +
    `- **Area:** ${s.area}\n` +
    `- **Admitted:** ${s.admitted}\n` +
    `- **Nickname:** ${s.nickname}\n` +
    `- **Region:** ${s.region}\n\n` +
    s.notes;
}

function renderCity4(c: City4): string {
  return `**${c.display}**\n\n` +
    `- **Country:** ${c.country}\n` +
    `- **Population:** ${c.population}\n` +
    `- **Founded:** ${c.founded}\n` +
    `- **Region:** ${c.region}\n` +
    `- **Landmarks:** ${c.landmarks}\n\n` +
    c.notes;
}

function renderFramework4(f: Framework4): string {
  return `**${f.display}**\n\n` +
    `- **Language:** ${f.language}\n` +
    `- **Released:** ${f.released}\n` +
    `- **Creator:** ${f.creator}\n` +
    `- **Category:** ${f.category}\n` +
    `- **Common uses:** ${f.uses}\n\n` +
    f.notes;
}

function renderCompany4(c: Company4): string {
  return `**${c.display}**\n\n` +
    `- **Founded:** ${c.founded}\n` +
    `- **Founders:** ${c.founders}\n` +
    `- **Headquarters:** ${c.headquarters}\n` +
    `- **Industry:** ${c.industry}\n` +
    `- **CEO:** ${c.ceo}\n` +
    `- **Notable products:** ${c.notable}\n\n` +
    c.notes;
}

interface CompiledEntry4 {
  re: RegExp;
  render: () => string;
}

const COMPILED_4: CompiledEntry4[] = [];
for (const c of COUNTRIES_4) {
  COMPILED_4.push({ re: makeMatcher4(c.names), render: () => renderCountry4(c) });
}
for (const s of US_STATES_4) {
  COMPILED_4.push({ re: makeMatcher4(s.names), render: () => renderUSState4(s) });
}
for (const c of CITIES_4) {
  COMPILED_4.push({ re: makeMatcher4(c.names), render: () => renderCity4(c) });
}
for (const f of FRAMEWORKS_4) {
  COMPILED_4.push({ re: makeMatcher4(f.names), render: () => renderFramework4(f) });
}
for (const c of COMPANIES_4) {
  COMPILED_4.push({ re: makeMatcher4(c.names), render: () => renderCompany4(c) });
}

export function bulkFactsLookup4Compiled(lower: string): string | null {
  for (const entry of COMPILED_4) {
    if (entry.re.test(lower)) {
      return entry.render();
    }
  }
  return null;
}
