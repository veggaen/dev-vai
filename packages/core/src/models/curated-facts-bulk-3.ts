/**
 * Bulk curated facts — Round 25 extensions.
 *
 * Companion module to curated-facts-bulk.ts and curated-facts-bulk-2.ts.
 * Adds new topic classes and broader coverage for existing ones.
 *
 * Called from bulkFactsLookup2Compiled when it falls through, so all the
 * gating in the main file applies uniformly.
 */

interface HistFigure3 {
  names: string[];
  display: string;
  born: string;
  died: string;
  nationality: string;
  field: string;
  knownFor: string;
  works: string;
  legacy: string;
  notes: string;
}

interface Religion3 {
  names: string[];
  display: string;
  founded: string;
  founder: string;
  adherents: string;
  scripture: string;
  beliefs: string;
  branches: string;
  practices: string;
  notes: string;
}

interface Country3 {
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

interface USState3 {
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

interface City3 {
  names: string[];
  display: string;
  country: string;
  population: string;
  founded: string;
  region: string;
  landmarks: string;
  notes: string;
}

interface Sport3 {
  names: string[];
  display: string;
  origin: string;
  governingBody: string;
  players: string;
  field: string;
  format: string;
  majorEvents: string;
  notes: string;
}

interface Instrument3 {
  names: string[];
  display: string;
  family: string;
  origin: string;
  range: string;
  notable: string;
  notes: string;
}

const HIST_FIGURES_3: HistFigure3[] = [
  { names: ['albert einstein', 'einstein'], display: 'Albert Einstein', born: '14 March 1879, Ulm, German Empire', died: '18 April 1955, Princeton, New Jersey (age 76)', nationality: 'German-born; later Swiss and American citizen', field: 'Theoretical physics', knownFor: 'Special and general relativity, the photoelectric effect, mass-energy equivalence E=mc^2', works: 'Annus mirabilis papers (1905), General Theory of Relativity (1915), the Einstein-Podolsky-Rosen paradox (1935)', legacy: 'Considered one of the greatest physicists of all time; awarded the 1921 Nobel Prize in Physics for the photoelectric effect', notes: `Einstein revolutionised modern physics. His 1905 papers on special relativity, Brownian motion, the photoelectric effect and mass-energy equivalence transformed our understanding of space, time, light and matter. The 1915 general theory of relativity recast gravity as the curvature of spacetime and predicted phenomena later confirmed (gravitational lensing, gravitational waves, black holes). Beyond physics he was an outspoken pacifist, a defender of civil rights, and the most recognisable scientist of the twentieth century.` },
  { names: ['isaac newton', 'newton'], display: 'Isaac Newton', born: '4 January 1643 (NS), Woolsthorpe, Lincolnshire, England', died: '31 March 1727, London (age 84)', nationality: 'English', field: 'Mathematics, physics, astronomy, alchemy, theology', knownFor: 'Laws of motion, universal gravitation, calculus, the reflecting telescope, optics', works: 'Philosophiae Naturalis Principia Mathematica (1687), Opticks (1704)', legacy: 'Founder of classical mechanics; Lucasian Professor of Mathematics at Cambridge; Master of the Royal Mint', notes: `Newton synthesised the laws of motion and universal gravitation in the Principia, providing the mathematical framework that explained terrestrial mechanics and planetary motion in a single theory. He co-invented calculus (independently of Leibniz), built the first practical reflecting telescope, and decomposed white light into the visible spectrum. His influence on science, mathematics and engineering is matched by virtually no other individual.` },
  { names: ['charles darwin', 'darwin'], display: 'Charles Darwin', born: '12 February 1809, Shrewsbury, England', died: '19 April 1882, Down House, Kent (age 73)', nationality: 'English', field: 'Naturalist, geologist, biologist', knownFor: 'Theory of evolution by natural selection', works: 'On the Origin of Species (1859), The Descent of Man (1871), The Voyage of the Beagle (1839)', legacy: 'Founder of evolutionary biology; buried in Westminster Abbey beside Newton', notes: `Darwin\u2019s 1859 Origin of Species established that all life shares common ancestry and that natural selection is the principal mechanism of evolution. The five-year voyage on HMS Beagle (1831\u20131836), particularly observations of finches and tortoises in the Galapagos, supplied much of the evidence. His framework remains the unifying theory of modern biology.` },
  { names: ['nikola tesla', 'tesla inventor'], display: 'Nikola Tesla', born: '10 July 1856, Smiljan, Austrian Empire (modern Croatia)', died: '7 January 1943, New York City (age 86)', nationality: 'Serbian-American', field: 'Electrical and mechanical engineering, physics', knownFor: 'Alternating-current (AC) electrical system, induction motor, Tesla coil, wireless power experiments', works: 'Over 300 patents in 26 countries', legacy: 'The SI unit of magnetic flux density (the tesla) is named after him', notes: `Tesla designed the polyphase AC system that won the late-19th-century War of Currents against Edison\u2019s DC, and his induction motor remains the workhorse of modern industry. His later work on wireless power and high-frequency transmission was visionary if commercially unsuccessful. He died in poverty in a New York hotel; his reputation was substantially rehabilitated in the late twentieth century.` },
  { names: ['thomas edison', 'edison'], display: 'Thomas Edison', born: '11 February 1847, Milan, Ohio', died: '18 October 1931, West Orange, New Jersey (age 84)', nationality: 'American', field: 'Invention, business', knownFor: 'Phonograph, practical incandescent light bulb, motion-picture camera, electrical power distribution', works: '1,093 US patents', legacy: 'Founded General Electric and the world\u2019s first industrial research lab at Menlo Park', notes: `Edison combined relentless empirical experimentation with a structured industrial-research model. The Menlo Park laboratory pioneered teamwork-based invention and gave the world the phonograph (1877), a commercially viable incandescent lamp (1879) and the first central electric power station (Pearl Street, 1882). His business empire grew into General Electric, one of the foundational American corporations.` },
  { names: ['leonardo da vinci', 'da vinci', 'leonardo'], display: 'Leonardo da Vinci', born: '15 April 1452, Vinci, Republic of Florence', died: '2 May 1519, Amboise, France (age 67)', nationality: 'Italian (Florentine)', field: 'Painting, sculpture, architecture, engineering, anatomy, botany, music', knownFor: 'The Mona Lisa, The Last Supper, the Vitruvian Man; thousands of pages of notebooks', works: 'Mona Lisa (~1503\u20131519), The Last Supper (~1495\u20131498), Vitruvian Man (~1490)', legacy: 'Archetype of the Renaissance polymath', notes: `Leonardo combined extraordinary artistic talent with scientific observation. His notebooks span anatomy, hydraulics, flight, geology and optics centuries before formal disciplines existed. The Mona Lisa\u2019s atmospheric sfumato and the Last Supper\u2019s narrative composition redefined what painting could express. He served the Medici, the Sforza, the French king, and worked into his final days.` },
  { names: ['william shakespeare', 'shakespeare'], display: 'William Shakespeare', born: 'Baptised 26 April 1564, Stratford-upon-Avon, England', died: '23 April 1616, Stratford-upon-Avon (age 52)', nationality: 'English', field: 'Playwright, poet, actor', knownFor: '39 plays, 154 sonnets, two long narrative poems', works: 'Hamlet, Macbeth, King Lear, Romeo and Juliet, Othello, A Midsummer Night\u2019s Dream, the Sonnets', legacy: 'Widely regarded as the greatest writer in the English language', notes: `Shakespeare\u2019s plays span tragedy, comedy and history. He was a part-owner of the Lord Chamberlain\u2019s Men (later the King\u2019s Men) and the Globe Theatre. His coined or popularised phrases (heart of gold, wild-goose chase, break the ice, in a pickle, all that glitters) saturate modern English. Continuous performance and translation make his canon arguably the most widely read body of work in any language.` },
  { names: ['abraham lincoln', 'lincoln president'], display: 'Abraham Lincoln', born: '12 February 1809, Hodgenville, Kentucky', died: '15 April 1865, Washington DC (age 56)', nationality: 'American', field: 'Law, politics', knownFor: '16th President of the United States; preserved the Union; abolished slavery', works: 'Gettysburg Address (1863), Emancipation Proclamation (1863), Second Inaugural Address (1865)', legacy: 'Routinely ranked among the greatest US Presidents', notes: `Lincoln led the United States through the Civil War (1861\u20131865), preserving the Union and ending chattel slavery via the Thirteenth Amendment (passed January 1865). The Gettysburg Address re-founded the nation on a creed of equality. He was assassinated by John Wilkes Booth at Ford\u2019s Theatre five days after Lee\u2019s surrender at Appomattox.` },
  { names: ['mahatma gandhi', 'gandhi'], display: 'Mahatma Gandhi', born: '2 October 1869, Porbandar, India', died: '30 January 1948, New Delhi (age 78)', nationality: 'Indian', field: 'Lawyer, anti-colonial activist, political ethicist', knownFor: 'Leadership of Indian independence; nonviolent resistance (satyagraha)', works: 'The Story of My Experiments with Truth (1927), Hind Swaraj (1909)', legacy: 'Father of the Indian nation; inspiration for civil-rights movements worldwide', notes: `Gandhi developed satyagraha (truth-force) into a disciplined method of nonviolent civil disobedience. The Salt March of 1930, the Quit India movement of 1942 and continuous campaigning helped force British withdrawal in 1947. Assassinated in Delhi by a Hindu nationalist, his methods shaped Martin Luther King Jr., Nelson Mandela and many later movements.` },
  { names: ['martin luther king jr', 'mlk', 'martin luther king'], display: 'Martin Luther King Jr.', born: '15 January 1929, Atlanta, Georgia', died: '4 April 1968, Memphis, Tennessee (age 39)', nationality: 'American', field: 'Baptist minister, civil-rights activist', knownFor: 'Leader of the American civil-rights movement; nonviolent campaigning against segregation', works: '"I Have a Dream" speech (1963), Letter from Birmingham Jail (1963), Stride Toward Freedom (1958)', legacy: 'Awarded the 1964 Nobel Peace Prize; federal holiday on the third Monday of January', notes: `King led the Montgomery Bus Boycott (1955\u20131956), co-founded the Southern Christian Leadership Conference, and helped secure the Civil Rights Act of 1964 and the Voting Rights Act of 1965. His Letter from Birmingham Jail is a foundational text of nonviolent ethics. He was assassinated by James Earl Ray in Memphis while supporting striking sanitation workers.` },
  { names: ['marie curie', 'curie'], display: 'Marie Curie', born: '7 November 1867, Warsaw, Russian-controlled Poland', died: '4 July 1934, Sancellemoz, France (age 66)', nationality: 'Polish-French', field: 'Physics, chemistry', knownFor: 'Pioneering research on radioactivity; discovery of polonium and radium', works: '1903 Nobel Prize in Physics (with Pierre Curie and Henri Becquerel), 1911 Nobel Prize in Chemistry', legacy: 'First woman to win a Nobel Prize and the only person to win Nobel Prizes in two different sciences', notes: `Curie coined the term radioactivity, isolated two new elements (polonium and radium), and developed mobile X-ray units that served on the front lines of the First World War. She died of aplastic anaemia caused by long exposure to ionising radiation. Her notebooks are still radioactive and stored in lead-lined boxes.` },
  { names: ['galileo galilei', 'galileo'], display: 'Galileo Galilei', born: '15 February 1564, Pisa, Duchy of Florence', died: '8 January 1642, Arcetri, Tuscany (age 77)', nationality: 'Italian', field: 'Astronomy, physics, engineering', knownFor: 'Telescopic astronomy; the moons of Jupiter; defence of heliocentrism', works: 'Sidereus Nuncius (1610), Dialogue Concerning the Two Chief World Systems (1632), Discourses on Two New Sciences (1638)', legacy: 'Often called the father of observational astronomy and modern science', notes: `Galileo\u2019s telescopic observations of Jupiter\u2019s four largest moons, the phases of Venus and the rugged surface of the Moon dismantled the geocentric world picture. His 1633 trial by the Roman Inquisition for heresy ended in lifelong house arrest, but his work on inertia, free fall and the kinematics of projectiles laid the groundwork for Newton.` }
];

const RELIGIONS_3: Religion3[] = [
  { names: ['christianity'], display: 'Christianity', founded: '1st century CE in Roman Judea', founder: 'Jesus of Nazareth and his apostles', adherents: '~2.4 billion (the largest religion globally)', scripture: 'The Bible (Old Testament shared with Judaism; New Testament unique to Christianity)', beliefs: 'Monotheism; Jesus as the Son of God and Messiah; salvation through grace and faith; the Trinity (Father, Son, Holy Spirit) in mainstream branches', branches: 'Catholic (~1.3 billion), Protestant (~900 million across many denominations), Eastern Orthodox (~220 million), Oriental Orthodox', practices: 'Baptism, the Eucharist, prayer, congregational worship on Sunday, the liturgical calendar (Christmas, Easter)', notes: `Christianity grew from a Jewish movement in 1st-century Palestine to the official religion of the Roman Empire by the 4th century. The Great Schism of 1054 split Catholic from Orthodox; the 16th-century Reformation split Protestant from Catholic. It is the dominant religion of Europe, the Americas, sub-Saharan Africa and the Philippines.` },
  { names: ['islam'], display: 'Islam', founded: '7th century CE in the Arabian Peninsula', founder: 'The Prophet Muhammad (570\u2013632 CE)', adherents: '~1.9 billion (the second-largest religion)', scripture: 'The Qur\u2019an (regarded as the literal word of God revealed to Muhammad); the Hadith (sayings and actions of the Prophet)', beliefs: 'Strict monotheism (tawhid); the Five Pillars (shahada, salat, zakat, sawm, hajj); the Day of Judgement; prophets from Adam through Jesus to Muhammad', branches: 'Sunni (~85\u201390%), Shia (~10\u201315%, mainly in Iran, Iraq, Bahrain), Ibadi, Sufi traditions', practices: 'Five daily prayers facing Mecca, Ramadan fasting, pilgrimage to Mecca (hajj), abstention from pork and alcohol', notes: `Islam spread from Mecca and Medina to North Africa, Spain, Persia and Central Asia within a century of Muhammad\u2019s death, and later to South-East Asia and sub-Saharan Africa. It is the dominant religion across the Middle East, North Africa, Central Asia and South-East Asia, with Indonesia the most populous Muslim country.` },
  { names: ['hinduism'], display: 'Hinduism', founded: 'No single founding date; origins in Vedic religion (~1500\u2013500 BCE)', founder: 'No single founder; an evolved family of traditions', adherents: '~1.2 billion (the third-largest religion)', scripture: 'The Vedas, Upanishads, Bhagavad Gita, Ramayana, Mahabharata, Puranas', beliefs: 'Dharma (right conduct), karma, samsara (rebirth), moksha (liberation); a vast pantheon often understood as expressions of one ultimate reality (Brahman)', branches: 'Vaishnavism (devotion to Vishnu), Shaivism (Shiva), Shaktism (the Goddess), Smartism', practices: 'Daily puja, temple worship, festivals (Diwali, Holi, Navaratri), pilgrimage (Varanasi, Tirupati), yoga and meditation', notes: `Hinduism is the dominant religion of India and Nepal and the world\u2019s oldest major living religious tradition. It encompasses an extraordinary diversity of beliefs and practices, from monism and polytheism to monotheism and atheism, unified more by shared scripture and culture than by centralised doctrine.` },
  { names: ['buddhism'], display: 'Buddhism', founded: 'c. 5th century BCE in northern India', founder: 'Siddhartha Gautama (the Buddha, c. 563\u2013483 BCE)', adherents: '~520 million', scripture: 'The Pali Canon (Tripitaka) for Theravada; many Mahayana sutras; Vajrayana tantras', beliefs: 'The Four Noble Truths, the Eightfold Path, anatta (non-self), anicca (impermanence), karma and rebirth, nirvana', branches: 'Theravada (Sri Lanka, Thailand, Myanmar), Mahayana (China, Japan, Korea, Vietnam), Vajrayana (Tibet, Mongolia, Bhutan)', practices: 'Meditation, ethical precepts, monasticism, chanting, pilgrimage to Bodh Gaya and Lumbini', notes: `Buddhism teaches a path out of suffering through ethical conduct, mental discipline and wisdom. It became the state religion of much of Asia between the 3rd century BCE (Ashoka) and the medieval period, and now influences global meditation and mindfulness practice far beyond traditionally Buddhist countries.` },
  { names: ['judaism'], display: 'Judaism', founded: 'Traditionally with Abraham (c. 2000 BCE) and the giving of the Torah at Sinai', founder: 'Abraham as patriarch; Moses as lawgiver', adherents: '~15 million worldwide (largest communities in Israel and the United States)', scripture: 'The Hebrew Bible (Tanakh: Torah, Nevi\u2019im, Ketuvim); the Talmud (Mishnah and Gemara)', beliefs: 'Strict monotheism; covenant between God and the Jewish people; observance of mitzvot (commandments); the coming of the Messiah', branches: 'Orthodox, Conservative, Reform, Reconstructionist, Hasidic', practices: 'Shabbat observance from Friday sundown, kosher dietary laws, festivals (Passover, Rosh Hashanah, Yom Kippur, Hanukkah, Sukkot), prayer in Hebrew', notes: `Judaism is the oldest continuously practiced monotheistic religion and the parent tradition of Christianity and Islam. The State of Israel was re-established in 1948 as a Jewish national homeland. Diaspora communities have shaped European, American and Middle Eastern history for two millennia.` },
  { names: ['sikhism'], display: 'Sikhism', founded: '15th century CE in Punjab, South Asia', founder: 'Guru Nanak (1469\u20131539); succeeded by nine further Gurus', adherents: '~30 million (mainly in India, especially Punjab)', scripture: 'Guru Granth Sahib (compiled by the fifth Guru and finalised by the tenth); regarded as the eternal Guru', beliefs: 'One formless God (Ik Onkar); equality of all humans; honest work, sharing, devotion; rejection of caste and ritualism', branches: 'No formal denominations; Khalsa initiated Sikhs follow the Five Ks (kesh, kara, kanga, kachera, kirpan)', practices: 'Daily prayer, communal worship at the gurdwara, langar (free community kitchen), service (seva)', notes: `Sikhism emerged in 15th-century Punjab as a distinct path emphasising devotion, social equality and honest livelihood. The Golden Temple (Harmandir Sahib) at Amritsar is its holiest shrine. Sikhs have a strong global diaspora in the United Kingdom, Canada, the United States and Australia.` },
  { names: ['taoism', 'daoism'], display: 'Taoism', founded: 'c. 6th century BCE in China', founder: 'Traditionally attributed to Laozi; refined by Zhuangzi', adherents: 'Tens of millions in China and the Chinese diaspora; cultural influence reaches hundreds of millions', scripture: 'Tao Te Ching (Daodejing) by Laozi; Zhuangzi; the Daozang (Taoist canon)', beliefs: 'The Tao (the Way) as the underlying principle of the universe; wu wei (effortless action); harmony with nature; balance of yin and yang', branches: 'Philosophical Taoism (daojia), religious Taoism (daojiao); Quanzhen and Zhengyi schools', practices: 'Meditation, qigong, internal alchemy, ritual, divination, herbal medicine, pilgrimage to sacred mountains', notes: `Taoism deeply shaped Chinese medicine, martial arts, calligraphy, painting and statecraft. The interplay of Confucianism, Taoism and Buddhism (the Three Teachings) defined Chinese intellectual life for two millennia.` },
  { names: ['shinto', 'shintoism'], display: 'Shinto', founded: 'Prehistoric Japan; codified gradually from the 8th century CE', founder: 'No single founder; an indigenous folk tradition', adherents: '~100 million Japanese practitioners (often combined with Buddhism)', scripture: 'Kojiki (712 CE) and Nihon Shoki (720 CE) record the foundational myths', beliefs: 'Veneration of kami (spirits) inhabiting natural features, ancestors and revered figures; ritual purity; harmony with nature', branches: 'Shrine Shinto, Imperial Household Shinto, Sect Shinto, Folk Shinto', practices: 'Visits to shrines (jinja), purification (misogi, harae), seasonal festivals (matsuri), torii gates marking sacred space', notes: `Shinto is the indigenous religion of Japan and the source of much of its aesthetic and ritual life. It coexists pragmatically with Buddhism: most Japanese are married in Shinto rites and buried in Buddhist ones. The Ise Grand Shrine, dedicated to the sun goddess Amaterasu, is its most sacred site.` }
];

const COUNTRIES_3: Country3[] = [
  { names: ['south africa'], display: 'South Africa', capital: 'Three capitals: Pretoria (executive), Cape Town (legislative), Bloemfontein (judicial)', language: '11 official languages including Zulu, Xhosa, Afrikaans, English, Sotho', population: '~62 million', area: '~1,221,000 km^2', currency: 'South African rand (ZAR)', continent: 'Africa (southern tip)', founded: 'Union of South Africa formed 1910; Republic 1961; democratic transition 1994', government: 'Parliamentary republic', notes: `South Africa is the most industrialised economy in sub-Saharan Africa. Apartheid (1948\u20131994) was dismantled under negotiation between F.W. de Klerk and Nelson Mandela; Mandela became the first president elected in fully democratic elections in 1994. The country is uniquely diverse linguistically, culturally and ecologically (the Cape Floristic Region is one of the world\u2019s biodiversity hotspots).` },
  { names: ['saudi arabia'], display: 'Saudi Arabia', capital: 'Riyadh', language: 'Arabic', population: '~36 million', area: '~2,150,000 km^2', currency: 'Saudi riyal (SAR)', continent: 'Asia (Arabian Peninsula)', founded: 'Modern kingdom unified 1932 by Ibn Saud', government: 'Absolute monarchy (House of Saud) with consultative Shura Council', notes: `Saudi Arabia is the birthplace of Islam and host to the holiest sites in Mecca and Medina, drawing millions of pilgrims for the annual hajj. It holds the world\u2019s second-largest proven oil reserves and is a founding member of OPEC. The Vision 2030 programme aims to diversify the economy beyond oil.` },
  { names: ['nigeria'], display: 'Nigeria', capital: 'Abuja (purpose-built capital since 1991; replaced Lagos)', language: 'English (official); Hausa, Yoruba, Igbo and ~500 other languages', population: '~225 million (most populous country in Africa)', area: '~924,000 km^2', currency: 'Nigerian naira (NGN)', continent: 'Africa (West Africa)', founded: 'Independence from the United Kingdom 1 October 1960; Federal Republic 1963', government: 'Federal presidential republic of 36 states', notes: `Nigeria is Africa\u2019s most populous country and one of its largest economies, dominated historically by oil (Niger Delta) and increasingly by services, agriculture and a thriving film industry (Nollywood, the world\u2019s second-largest by output). It is projected to become the world\u2019s third most populous country by 2050.` },
  { names: ['vietnam'], display: 'Vietnam', capital: 'Hanoi', language: 'Vietnamese', population: '~100 million', area: '~331,000 km^2', currency: 'Vietnamese dong (VND)', continent: 'Asia (South-East Asia)', founded: 'Reunified 1975 after the Vietnam War; Socialist Republic 1976', government: 'One-party socialist republic (Communist Party of Vietnam)', notes: `Vietnam is one of the fastest-growing economies in South-East Asia, transformed by the Doi Moi reforms of 1986. It is the world\u2019s second-largest exporter of coffee and rice. Ho Chi Minh City (formerly Saigon) is the largest city and economic centre; Hanoi remains the political capital.` },
  { names: ['thailand'], display: 'Thailand', capital: 'Bangkok', language: 'Thai', population: '~70 million', area: '~513,000 km^2', currency: 'Thai baht (THB)', continent: 'Asia (South-East Asia)', founded: 'Kingdom of Sukhothai 1238; never colonised by a European power', government: 'Constitutional monarchy', notes: `Thailand is the only South-East Asian country never colonised, a result of skilful diplomacy between the British and French empires. It is a major regional manufacturing hub, the world\u2019s largest exporter of natural rubber, and one of the most visited tourist destinations on the planet. Theravada Buddhism is woven into daily life.` },
  { names: ['indonesia'], display: 'Indonesia', capital: 'Jakarta (transitioning to Nusantara on Borneo)', language: 'Indonesian (Bahasa Indonesia); 700+ regional languages', population: '~280 million (4th most populous country)', area: '~1,905,000 km^2', currency: 'Indonesian rupiah (IDR)', continent: 'Asia (South-East Asia, Maritime)', founded: 'Independence proclaimed 17 August 1945; recognised 1949', government: 'Presidential constitutional republic', notes: `Indonesia is the world\u2019s largest archipelagic state with over 17,000 islands, the largest Muslim-majority country, and a member of the G20. It sits along the Pacific Ring of Fire and contains some of the world\u2019s most biodiverse rainforests on Borneo, Sumatra and Papua.` },
  { names: ['philippines'], display: 'Philippines', capital: 'Manila', language: 'Filipino and English (official); ~180 regional languages', population: '~115 million', area: '~300,000 km^2', currency: 'Philippine peso (PHP)', continent: 'Asia (South-East Asia, Maritime)', founded: 'Independence from Spain 1898 (declared); from the United States 4 July 1946', government: 'Presidential constitutional republic', notes: `The Philippines comprises 7,641 islands and is the only majority-Christian (largely Catholic) nation in Asia, a legacy of three centuries of Spanish colonial rule. It is a global hub for business-process outsourcing and a major source of overseas workers and remittances.` },
  { names: ['new zealand'], display: 'New Zealand', capital: 'Wellington', language: 'English, M\u0101ori, NZ Sign Language (all official)', population: '~5.3 million', area: '~268,000 km^2', currency: 'New Zealand dollar (NZD)', continent: 'Oceania', founded: 'Treaty of Waitangi 1840; Dominion 1907; full sovereignty acts mid-20th century', government: 'Parliamentary constitutional monarchy (Charles III as head of state)', notes: `New Zealand is famed for its dramatic landscape (used in the Lord of the Rings films), pioneering social legislation (first self-governing country to grant women the vote, 1893), and a strong indigenous M\u0101ori cultural revival. It lies in the Pacific between the Australian and Pacific tectonic plates, giving it active volcanism and earthquakes.` },
  { names: ['iran'], display: 'Iran', capital: 'Tehran', language: 'Persian (Farsi)', population: '~88 million', area: '~1,648,000 km^2', currency: 'Iranian rial (IRR)', continent: 'Asia (Western Asia)', founded: 'Achaemenid Empire 550 BCE; modern Islamic Republic established 1979', government: 'Islamic theocratic republic (Supreme Leader plus elected president)', notes: `Iran (historically Persia) is the heir to one of the world\u2019s oldest continuous civilisations and held the largest empire of antiquity under Cyrus the Great. The 1979 Revolution overthrew the Pahlavi monarchy and installed a Shia Islamic republic. Persian is also the language of much of Afghanistan and Tajikistan.` },
  { names: ['singapore'], display: 'Singapore', capital: 'Singapore (city-state)', language: 'English, Mandarin, Malay, Tamil (all official)', population: '~5.9 million', area: '~734 km^2', currency: 'Singapore dollar (SGD)', continent: 'Asia (South-East Asia)', founded: 'Independence from Malaysia 9 August 1965', government: 'Parliamentary republic', notes: `Singapore is one of the most densely populated countries on Earth and one of the wealthiest by GDP per capita. From a British trading post founded in 1819 by Stamford Raffles, it transformed under Lee Kuan Yew into a global finance, shipping and technology hub. Changi Airport is consistently ranked among the world\u2019s best.` }
];

const US_STATES_3: USState3[] = [
  { names: ['georgia state', 'georgia us'], display: 'Georgia (US state)', abbr: 'GA', capital: 'Atlanta', largestCity: 'Atlanta', population: '~11 million', area: '~154,000 km^2', admitted: '2 January 1788 (4th state)', nickname: 'The Peach State; The Empire State of the South', region: 'Southeast', notes: `Georgia is one of the original Thirteen Colonies, named after King George II. Atlanta is a major financial, transportation and media centre (CNN, Coca-Cola headquarters, Hartsfield-Jackson - the world\u2019s busiest airport). Civil-rights leader Martin Luther King Jr. was born in Atlanta. The state\u2019s coast and Appalachian mountains book-end its geography.` },
  { names: ['virginia'], display: 'Virginia', abbr: 'VA', capital: 'Richmond', largestCity: 'Virginia Beach', population: '~8.7 million', area: '~110,000 km^2', admitted: '25 June 1788 (10th state)', nickname: 'Old Dominion; Mother of Presidents', region: 'Southeast / Mid-Atlantic', notes: `Virginia hosted the first permanent English settlement in the Americas at Jamestown (1607). Eight US presidents were born here, including Washington, Jefferson and Madison. Northern Virginia is a major federal-government and technology cluster (the Pentagon, the CIA, much of the early internet backbone).` },
  { names: ['massachusetts'], display: 'Massachusetts', abbr: 'MA', capital: 'Boston', largestCity: 'Boston', population: '~7.0 million', area: '~27,000 km^2', admitted: '6 February 1788 (6th state)', nickname: 'The Bay State', region: 'New England', notes: `Massachusetts is the cultural and academic heart of New England, home to Harvard (1636) and MIT, and the site of the Pilgrim landing at Plymouth (1620) and the opening battles of the American Revolution at Lexington and Concord (1775). Boston, Cambridge and Worcester anchor a dense innovation economy.` },
  { names: ['michigan'], display: 'Michigan', abbr: 'MI', capital: 'Lansing', largestCity: 'Detroit', population: '~10 million', area: '~250,000 km^2', admitted: '26 January 1837 (26th state)', nickname: 'The Great Lakes State; The Wolverine State', region: 'Midwest', notes: `Michigan borders four of the five Great Lakes and consists of two large peninsulas. Detroit was the cradle of the American automobile industry under Ford, GM and Chrysler. The state has reinvented itself with strong life-sciences, advanced manufacturing and clean-energy clusters around Ann Arbor and Grand Rapids.` },
  { names: ['colorado'], display: 'Colorado', abbr: 'CO', capital: 'Denver', largestCity: 'Denver', population: '~5.9 million', area: '~270,000 km^2', admitted: '1 August 1876 (38th state, the Centennial State)', nickname: 'The Centennial State', region: 'Mountain West', notes: `Colorado contains 53 mountain peaks above 14,000 feet (the Fourteeners). The Rocky Mountains run north-south through the state. The Denver-Boulder corridor is a major aerospace, defence and outdoor-industry hub. Colorado was the first US state to legalise recreational cannabis (2012).` },
  { names: ['arizona'], display: 'Arizona', abbr: 'AZ', capital: 'Phoenix', largestCity: 'Phoenix', population: '~7.5 million', area: '~295,000 km^2', admitted: '14 February 1912 (48th state)', nickname: 'The Grand Canyon State', region: 'Southwest', notes: `Arizona contains the Grand Canyon, one of the world\u2019s most spectacular natural landscapes, plus the Sonoran Desert\u2019s saguaro forests. Phoenix is one of the fastest-growing US metro areas. The state\u2019s 22 federally recognised Native American tribes hold the largest tribal land area in the country (Navajo Nation).` },
  { names: ['oregon'], display: 'Oregon', abbr: 'OR', capital: 'Salem', largestCity: 'Portland', population: '~4.2 million', area: '~255,000 km^2', admitted: '14 February 1859 (33rd state)', nickname: 'The Beaver State', region: 'Pacific Northwest', notes: `Oregon spans Pacific coastline, the Cascade volcanoes, the Willamette Valley wine country and the high desert east of the mountains. Portland is known for craft brewing, food culture and progressive politics. Oregon was the first US state to legalise physician-assisted dying (Death with Dignity Act, 1997).` },
  { names: ['nevada'], display: 'Nevada', abbr: 'NV', capital: 'Carson City', largestCity: 'Las Vegas', population: '~3.2 million', area: '~286,000 km^2', admitted: '31 October 1864 (36th state, the Battle Born State)', nickname: 'The Silver State; Battle Born', region: 'Mountain West / Southwest', notes: `Nevada is the driest state in the United States, dominated by the Great Basin desert. Las Vegas is a global gaming, entertainment and convention destination; Reno and Sparks form a second major metro. Nellis Air Force Base, Area 51 and the Nevada Test Site reflect the state\u2019s outsized role in US defence and aerospace history.` },
  { names: ['minnesota'], display: 'Minnesota', abbr: 'MN', capital: 'Saint Paul', largestCity: 'Minneapolis', population: '~5.7 million', area: '~225,000 km^2', admitted: '11 May 1858 (32nd state)', nickname: 'Land of 10,000 Lakes; The North Star State', region: 'Upper Midwest', notes: `Minnesota actually has more than 11,000 lakes. The Twin Cities (Minneapolis-Saint Paul) host headquarters for Target, 3M, US Bancorp and the Mayo Clinic (in Rochester). The state\u2019s heritage is heavily Scandinavian and German, with strong ties to Norway, Sweden and Finland.` },
  { names: ['wisconsin'], display: 'Wisconsin', abbr: 'WI', capital: 'Madison', largestCity: 'Milwaukee', population: '~5.9 million', area: '~169,000 km^2', admitted: '29 May 1848 (30th state)', nickname: 'America\u2019s Dairyland; The Badger State', region: 'Upper Midwest', notes: `Wisconsin is famous for cheese, beer (Milwaukee\u2019s German brewing heritage) and the Green Bay Packers, the only community-owned franchise in the major US sports leagues. The University of Wisconsin\u2013Madison is one of the leading public research universities in the country.` }
];

const CITIES_3: City3[] = [
  { names: ['madrid'], display: 'Madrid', country: 'Spain (capital)', population: '~3.3 million city, ~6.7 million metro', founded: 'Settled by Moors as Mayrit in the 9th century; capital of Spain since 1561', region: 'Central Spain (Community of Madrid)', landmarks: 'Royal Palace, Prado Museum, Plaza Mayor, Puerta del Sol, Retiro Park, Santiago Bernabeu Stadium', notes: `Madrid is the political, economic and cultural capital of Spain and the third-largest city in the European Union. It hosts the Spanish royal family, the national government and the headquarters of leading Spanish companies. The city is famed for the Golden Triangle of Art (Prado, Reina Sofia, Thyssen-Bornemisza) and a vibrant nightlife.` },
  { names: ['moscow'], display: 'Moscow', country: 'Russia (capital)', population: '~13 million city, ~21 million metro (largest in Europe)', founded: 'First mentioned 1147; capital of Russia since 1389 (with Saint Petersburg interlude 1712\u20131918)', region: 'Western Russia (along the Moskva River)', landmarks: 'Red Square, Saint Basil\u2019s Cathedral, the Kremlin, Bolshoi Theatre, GUM department store, Moscow Metro', notes: `Moscow is the largest city in Europe by population and the political, economic and cultural centre of Russia. The Kremlin is the seat of the Russian presidency. The city\u2019s Metro is renowned for its ornate Stalin-era stations. Moscow hosted the 1980 Summer Olympics and the 2018 FIFA World Cup final.` },
  { names: ['cairo'], display: 'Cairo', country: 'Egypt (capital)', population: '~10 million city, ~22 million metro (largest in Africa and the Arab world)', founded: '969 CE by the Fatimid dynasty; predecessor settlements (Memphis, Fustat) much older', region: 'Northern Egypt, on the Nile delta', landmarks: 'Pyramids of Giza and the Sphinx (nearby), Egyptian Museum, Khan el-Khalili bazaar, Citadel of Saladin, Tahrir Square', notes: `Cairo is the largest metropolitan area in Africa and the historic capital of the Arab world. Greater Cairo encompasses Giza, home to the only surviving Wonder of the Ancient World - the Great Pyramid. The city is the centre of Arab cinema, publishing and Sunni Islamic scholarship (Al-Azhar University, founded 970 CE).` },
  { names: ['toronto'], display: 'Toronto', country: 'Canada (capital of Ontario)', population: '~2.9 million city, ~6.4 million metro (largest in Canada)', founded: 'Founded as York 1793; renamed Toronto 1834', region: 'Southern Ontario, on Lake Ontario', landmarks: 'CN Tower, Royal Ontario Museum, Rogers Centre, Distillery District, Casa Loma', notes: `Toronto is Canada\u2019s largest city, financial centre and a top global destination by share of foreign-born residents (~half). It is the seat of Canadian banking and the headquarters of the Toronto Stock Exchange. The CN Tower (553 m) was the world\u2019s tallest free-standing structure from 1975 until 2007.` },
  { names: ['los angeles'], display: 'Los Angeles', country: 'United States (California)', population: '~3.9 million city, ~13 million metro (2nd largest US metro)', founded: 'Spanish pueblo founded 4 September 1781', region: 'Southern California, Pacific coast', landmarks: 'Hollywood Sign, Walk of Fame, Griffith Observatory, Getty Center, Disneyland (Anaheim), Santa Monica Pier', notes: `Los Angeles is the centre of the global film and television industry (Hollywood), a major aerospace and tech hub, and one of the most ethnically diverse cities in the world. The Greater Los Angeles area sprawls across five counties and the Port of Los Angeles is the busiest container port in the Western Hemisphere.` },
  { names: ['chicago'], display: 'Chicago', country: 'United States (Illinois)', population: '~2.7 million city, ~9.4 million metro (3rd largest US metro)', founded: 'Incorporated 1837; rebuilt after the Great Chicago Fire of 1871', region: 'Midwest, on the southwest shore of Lake Michigan', landmarks: 'Willis (Sears) Tower, Cloud Gate (the Bean) at Millennium Park, Navy Pier, Art Institute of Chicago, Wrigley Field', notes: `Chicago is the largest city in the American Midwest and the birthplace of the modern skyscraper (Home Insurance Building, 1885). It is a major financial, transportation and cultural centre and the home of Chicago-style deep-dish pizza, the blues, and architecture by Louis Sullivan, Frank Lloyd Wright and Mies van der Rohe.` },
  { names: ['hong kong'], display: 'Hong Kong', country: 'Special Administrative Region of China', population: '~7.5 million', founded: 'British colony 1842; returned to China 1 July 1997 under "one country, two systems"', region: 'Southern China, on the Pearl River Delta', landmarks: 'Victoria Peak, Star Ferry, Tian Tan Buddha, Symphony of Lights, Lan Kwai Fong nightlife district', notes: `Hong Kong is one of the world\u2019s densest cities and a major international financial centre. Its dramatic skyline, mountainous terrain and deep natural harbour are iconic. The Basic Law allowed a high degree of autonomy under "one country, two systems"; political integration with the mainland accelerated after 2020.` },
  { names: ['bangkok'], display: 'Bangkok', country: 'Thailand (capital)', population: '~10 million metro', founded: '1782 by King Rama I as the capital of the Chakri dynasty', region: 'Central Thailand, on the Chao Phraya River', landmarks: 'Grand Palace, Wat Pho, Wat Arun, Chatuchak Weekend Market, Khao San Road, Skytrain (BTS)', notes: `Bangkok is one of the most visited tourist cities in the world and the political, commercial and cultural heart of Thailand. The full ceremonial Thai name (Krung Thep Maha Nakhon...) is among the longest place names in the world. Street food is a defining feature, recognised by Michelin guides.` },
  { names: ['istanbul'], display: 'Istanbul', country: 'Turkey (largest city; political capital is Ankara)', population: '~16 million (largest city in Europe by population within urban limits)', founded: 'Founded as Byzantium 7th century BCE; refounded as Constantinople 330 CE; renamed Istanbul 1930', region: 'Spans Europe and Asia across the Bosphorus Strait', landmarks: 'Hagia Sophia, Blue Mosque, Topkapi Palace, Grand Bazaar, Galata Tower, Bosphorus Bridge', notes: `Istanbul is the only major city in the world straddling two continents. It served as capital of the Roman, Byzantine and Ottoman empires for over 1,500 years. The Hagia Sophia\u2019s 1,500-year history (basilica, mosque, museum, mosque again) reflects the city\u2019s layered religious and political past.` },
  { names: ['rio de janeiro', 'rio'], display: 'Rio de Janeiro', country: 'Brazil', population: '~6.7 million city, ~13 million metro', founded: '1565 by the Portuguese', region: 'Southeastern Brazil, on the Atlantic coast', landmarks: 'Christ the Redeemer, Sugarloaf Mountain, Copacabana and Ipanema beaches, Maracana Stadium, Carnival', notes: `Rio is famed for its dramatic setting between mountains and the sea, the world\u2019s largest carnival, and a beach-and-football culture that has projected Brazilian style globally. It served as the capital of Portugal\u2019s overseas empire (1808\u20131821) and of Brazil itself until 1960. Hosted the 2016 Summer Olympics and the 2014 FIFA World Cup final.` }
];

const SPORTS_3: Sport3[] = [
  { names: ['soccer', 'association football', 'football soccer'], display: 'Association football (soccer)', origin: 'Modern rules codified by the Football Association in England, 1863', governingBody: 'FIFA (Federation Internationale de Football Association), founded 1904', players: '11 per side on the pitch', field: 'Rectangular pitch ~100\u2013110 m by 64\u201375 m, grass or approved artificial turf', format: 'Two 45-minute halves; no time-outs; substitutions limited; goals decide outcome with possible extra time and penalty shoot-outs', majorEvents: 'FIFA World Cup (every 4 years), UEFA European Championship, UEFA Champions League, English Premier League, Spanish La Liga, Copa Libertadores', notes: `Association football is the most popular and watched sport on Earth, with an estimated 4 billion fans. The 2022 FIFA World Cup final between Argentina and France drew over 1.5 billion viewers. Pele, Diego Maradona, Lionel Messi and Cristiano Ronaldo are commonly cited as the greatest players of all time.` },
  { names: ['basketball'], display: 'Basketball', origin: 'Invented in 1891 by James Naismith in Springfield, Massachusetts, USA', governingBody: 'FIBA (International Basketball Federation), founded 1932', players: '5 per side on the court', field: 'Rectangular court 28 m by 15 m (NBA: 94 by 50 feet)', format: 'Four 10-minute or 12-minute (NBA) quarters; baskets worth 1, 2 or 3 points; shot clock', majorEvents: 'NBA Finals, FIBA Basketball World Cup, Olympic Basketball, EuroLeague, NCAA March Madness', notes: `Basketball grew from a YMCA gym game using a peach basket into one of the world\u2019s most popular sports. The NBA is the premier professional league. Michael Jordan, LeBron James and Kareem Abdul-Jabbar are among the most celebrated players. Three-point shooting has reshaped the modern game.` },
  { names: ['american football'], display: 'American football', origin: 'Evolved from rugby and association football in the late 19th century in the United States', governingBody: 'NFL (National Football League) at professional level; NCAA at college level; IFAF internationally', players: '11 per side on the field', field: '120 yards by 53 1/3 yards including end zones (~109 m by 49 m)', format: 'Four 15-minute quarters; downs system (4 downs to advance 10 yards); touchdowns 6 points, field goals 3, safeties 2', majorEvents: 'Super Bowl, NFL season and playoffs, College Football Playoff, the Rose Bowl, the Heisman Trophy', notes: `American football is the most-watched sport in the United States. The Super Bowl is consistently the most-watched US television broadcast of the year and a global advertising event. Tom Brady (seven Super Bowl titles) and Jerry Rice are among the most decorated players.` },
  { names: ['baseball'], display: 'Baseball', origin: 'Evolved from English bat-and-ball games (rounders, cricket); modern rules formalised in 1840s\u20131850s United States', governingBody: 'WBSC (World Baseball Softball Confederation); MLB at top professional level', players: '9 per side at any time', field: 'Diamond-shaped infield with 90-foot bases; outfield extends 300\u2013420 feet from home plate', format: 'Nine innings; each team bats and fields each inning; three outs per half-inning; team with most runs wins (extra innings if tied)', majorEvents: 'World Series (MLB championship), World Baseball Classic, Olympic Baseball (intermittent), Nippon Professional Baseball Series, KBO Korean Series', notes: `Baseball is deeply embedded in American culture (the National Pastime) and is the most popular team sport in Japan, South Korea and several Latin American countries. Babe Ruth, Hank Aaron, Willie Mays and Shohei Ohtani are among the great players.` },
  { names: ['tennis'], display: 'Tennis', origin: 'Modern lawn tennis codified by Major Walter Wingfield in England, 1873; descended from medieval real tennis', governingBody: 'ITF (International Tennis Federation); ATP (men\u2019s tour) and WTA (women\u2019s tour) at professional level', players: '1 per side (singles) or 2 per side (doubles)', field: 'Rectangular court 23.77 m by 8.23 m (singles), grass, clay, hard or carpet', format: 'Best of 3 or 5 sets; sets won at 6 games (with 2-game margin) or via tie-break', majorEvents: 'Grand Slams: Australian Open, French Open (Roland-Garros), Wimbledon, US Open; ATP and WTA Finals; Davis Cup; Billie Jean King Cup', notes: `Tennis is one of the most international individual sports. The Open Era began in 1968 when professionals were first admitted to the Grand Slams. Roger Federer, Rafael Nadal, Novak Djokovic, Serena Williams, Steffi Graf and Martina Navratilova are commonly cited among the greatest of all time.` },
  { names: ['golf'], display: 'Golf', origin: 'Originated in 15th-century Scotland; rules formalised at the Royal and Ancient Golf Club of St Andrews', governingBody: 'R&A (worldwide outside the United States and Mexico) and USGA (United States and Mexico)', players: 'Individual stroke or match play; team formats include Ryder Cup, Presidents Cup', field: 'Course of 9 or 18 holes, typically 5,000\u20137,500 yards, with tees, fairways, hazards and greens', format: 'Aim to put the ball in each hole in the fewest strokes; lowest total score wins (stroke play)', majorEvents: 'The Masters (Augusta), PGA Championship, US Open, The Open Championship; Ryder Cup; Presidents Cup; Solheim Cup', notes: `Golf is one of only a few sports played on the Moon (Alan Shepard, Apollo 14, 1971). Tiger Woods, Jack Nicklaus and Annika Sorenstam are among the most decorated players. The St Andrews Old Course is regarded as the home of golf.` },
  { names: ['cricket'], display: 'Cricket', origin: 'Documented in 16th-century England; Marylebone Cricket Club (MCC) codified the laws in 1788', governingBody: 'ICC (International Cricket Council)', players: '11 per side', field: 'Oval field with a central rectangular pitch 22 yards (~20.12 m) long', format: 'Test matches (up to 5 days), One-Day Internationals (50 overs per side), T20 Internationals (20 overs)', majorEvents: 'ICC Cricket World Cup (ODI), ICC T20 World Cup, World Test Championship, Indian Premier League (IPL), The Ashes (England vs Australia)', notes: `Cricket is the second most popular sport globally after football and the dominant sport of the Indian subcontinent, England, Australia, the Caribbean and Southern Africa. The IPL is one of the most lucrative sporting leagues in the world. Sir Donald Bradman, Sachin Tendulkar and Sir Vivian Richards are among the legends.` },
  { names: ['ice hockey'], display: 'Ice hockey', origin: 'Modern game codified in Montreal, Canada in the 1870s', governingBody: 'IIHF (International Ice Hockey Federation); NHL at top professional level in North America', players: '6 per side on the ice (including the goaltender)', field: 'Ice rink ~60 m by 30 m (international) or 200 by 85 feet (NHL)', format: 'Three 20-minute periods; overtime and shoot-outs in regular season; longer playoff overtimes', majorEvents: 'Stanley Cup (NHL), IIHF World Championship, Olympic ice hockey, KHL Gagarin Cup', notes: `Ice hockey is the most popular sport in Canada and one of the four major North American professional sports. The Stanley Cup, first awarded in 1893, is the oldest professional team trophy in North America. Wayne Gretzky is widely regarded as the greatest player ever.` }
];

const INSTRUMENTS_3: Instrument3[] = [
  { names: ['piano'], display: 'Piano', family: 'Keyboard / chordophone (struck-string)', origin: 'Invented around 1700 by Bartolomeo Cristofori in Florence, Italy (originally pianoforte)', range: 'Standard 88 keys spanning 7 octaves and a minor third (A0\u2013C8)', notable: 'Frederic Chopin, Franz Liszt, Sergei Rachmaninoff, Vladimir Horowitz, Glenn Gould, Bill Evans, Thelonious Monk, Herbie Hancock', notes: `The piano combines a keyboard mechanism with hammers that strike steel strings, allowing dynamic shading from soft (piano) to loud (forte) - the source of its name pianoforte. It became the dominant Western instrument of the 19th century, central to classical, jazz, blues and popular music. Modern variants include the upright, the grand and a wide range of digital pianos.` },
  { names: ['guitar'], display: 'Guitar', family: 'Plucked / strummed chordophone', origin: 'Modern classical guitar refined in 19th-century Spain by Antonio de Torres; electric guitar invented in the 1930s (George Beauchamp, Adolph Rickenbacker)', range: 'Standard six-string tuned EADGBE; range about 3 1/2 octaves from low E (E2)', notable: 'Andres Segovia, Jimi Hendrix, Eric Clapton, Jimmy Page, Eddie Van Halen, B.B. King, Django Reinhardt', notes: `The guitar is one of the most popular instruments in the world, available in classical (nylon-string), steel-string acoustic and electric forms. The electric guitar transformed popular music after the 1950s, defining rock, blues and pop. Twelve-string, bass and seven/eight-string variants extend the family.` },
  { names: ['violin'], display: 'Violin', family: 'Bowed string / chordophone', origin: 'Took its modern form in 16th-century Italy; Cremonese makers Stradivari, Guarneri and Amati produced the most prized examples in the 17th\u201318th centuries', range: 'Tuned in fifths G3, D4, A4, E5; practical range about 4 octaves', notable: 'Niccolo Paganini, Jascha Heifetz, Itzhak Perlman, Anne-Sophie Mutter, Hilary Hahn, Stephane Grappelli', notes: `The violin is the smallest and highest-pitched member of the standard string quartet (with viola, cello, double bass). It is central to Western classical music, Irish and Scottish folk, bluegrass, jazz and many world traditions. A surviving Stradivarius can sell for tens of millions of dollars.` },
  { names: ['drums', 'drum kit'], display: 'Drum kit', family: 'Percussion', origin: 'Modern kit assembled in early-20th-century United States from military and orchestral percussion', range: 'Untuned (in most popular use); pitch varies by drum size and tuning', notable: 'Buddy Rich, Gene Krupa, John Bonham, Neil Peart, Stewart Copeland, Tony Williams, Questlove', notes: `The drum kit typically combines a bass drum (kick), snare, toms, hi-hat, ride cymbal and crash cymbals played by a single drummer. It is the rhythmic foundation of jazz, rock, pop, funk and most modern popular music. Electronic kits and hybrid setups now extend its sonic vocabulary.` },
  { names: ['saxophone'], display: 'Saxophone', family: 'Single-reed woodwind (typically made of brass)', origin: 'Invented around 1840 by Adolphe Sax in Belgium and patented in 1846 in Paris', range: 'Family includes soprano, alto, tenor, baritone; combined family covers more than 5 octaves', notable: 'Charlie Parker, John Coltrane, Sonny Rollins, Stan Getz, Wayne Shorter, Kenny G', notes: `The saxophone is the most prominent woodwind in jazz and a major voice in classical, military-band and popular music. Despite its brass body it is technically a woodwind because it uses a single reed. The alto and tenor saxophones are the most commonly played.` },
  { names: ['flute'], display: 'Flute', family: 'Woodwind (aerophone, edge-blown)', origin: 'Among the oldest known instruments; bone flutes ~40,000 years old; modern Western concert flute developed by Theobald Boehm in the 1830s\u20131840s', range: 'Concert flute spans about 3 octaves from middle C (C4) upward', notable: 'James Galway, Jean-Pierre Rampal, Emmanuel Pahud, Hubert Laws, Ian Anderson', notes: `The flute is one of the oldest instruments in human culture, with examples found across nearly every continent. The Boehm system gave the modern Western concert flute its characteristic key mechanism and intonation. Variants include the piccolo, alto and bass flutes.` },
  { names: ['cello', 'violoncello'], display: 'Cello', family: 'Bowed string / chordophone', origin: 'Developed in Italy in the 16th century alongside the violin family', range: 'Tuned in fifths C2, G2, D3, A3; practical range about 4 octaves', notable: 'Pablo Casals, Mstislav Rostropovich, Jacqueline du Pre, Yo-Yo Ma, Steven Isserlis', notes: `The cello (formally violoncello) is the second-largest member of the standard string family and provides the bass line of the string quartet. Its lyrical, vocal-like tone made it a favourite of composers from Bach (the Six Suites) and Beethoven through Dvorak (the Cello Concerto in B minor) and Elgar.` },
  { names: ['trumpet'], display: 'Trumpet', family: 'Brass (lip-reed aerophone)', origin: 'Ancient origins (military signalling); modern valved trumpet developed in the early 19th century', range: 'B-flat trumpet effective range from F-sharp 3 to D6 or higher', notable: 'Louis Armstrong, Miles Davis, Dizzy Gillespie, Wynton Marsalis, Maurice Andre, Chet Baker', notes: `The trumpet is the highest-pitched standard brass instrument and a leading solo voice in jazz, classical and big-band music. Modern trumpets typically have three piston valves; the C trumpet is common in orchestral playing while the B-flat trumpet dominates jazz and bands.` }
];

function topicWord3(name: string): string {
  return name;
}

function makeMatcher3(names: string[]): RegExp {
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const alts = escaped.map((n) => `${n}s?`).join('|');
  return new RegExp(`(?:^|[^A-Za-z0-9_])(?:${alts})(?:$|[^A-Za-z0-9_])`, 'i');
}

function renderHistFigure3(p: HistFigure3): string {
  return `**${p.display}**\n\n` +
    `- **Born:** ${p.born}\n` +
    `- **Died:** ${p.died}\n` +
    `- **Nationality:** ${p.nationality}\n` +
    `- **Field:** ${p.field}\n` +
    `- **Known for:** ${p.knownFor}\n` +
    `- **Major works:** ${p.works}\n` +
    `- **Legacy:** ${p.legacy}\n\n` +
    p.notes;
}

function renderReligion3(r: Religion3): string {
  return `**${r.display}**\n\n` +
    `- **Founded:** ${r.founded}\n` +
    `- **Founder:** ${r.founder}\n` +
    `- **Adherents:** ${r.adherents}\n` +
    `- **Scripture:** ${r.scripture}\n` +
    `- **Core beliefs:** ${r.beliefs}\n` +
    `- **Major branches:** ${r.branches}\n` +
    `- **Practices:** ${r.practices}\n\n` +
    r.notes;
}

function renderCountry3(c: Country3): string {
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

function renderUSState3(s: USState3): string {
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

function renderCity3(c: City3): string {
  return `**${c.display}**\n\n` +
    `- **Country:** ${c.country}\n` +
    `- **Population:** ${c.population}\n` +
    `- **Founded:** ${c.founded}\n` +
    `- **Region:** ${c.region}\n` +
    `- **Landmarks:** ${c.landmarks}\n\n` +
    c.notes;
}

function renderSport3(s: Sport3): string {
  return `**${s.display}**\n\n` +
    `- **Origin:** ${s.origin}\n` +
    `- **Governing body:** ${s.governingBody}\n` +
    `- **Players:** ${s.players}\n` +
    `- **Field:** ${s.field}\n` +
    `- **Format:** ${s.format}\n` +
    `- **Major events:** ${s.majorEvents}\n\n` +
    s.notes;
}

function renderInstrument3(i: Instrument3): string {
  return `**${i.display}**\n\n` +
    `- **Family:** ${i.family}\n` +
    `- **Origin:** ${i.origin}\n` +
    `- **Range:** ${i.range}\n` +
    `- **Notable players:** ${i.notable}\n\n` +
    i.notes;
}

interface CompiledEntry3 {
  re: RegExp;
  render: () => string;
}

const COMPILED_3: CompiledEntry3[] = [];
for (const p of HIST_FIGURES_3) {
  COMPILED_3.push({ re: makeMatcher3(p.names), render: () => renderHistFigure3(p) });
}
for (const r of RELIGIONS_3) {
  COMPILED_3.push({ re: makeMatcher3(r.names), render: () => renderReligion3(r) });
}
for (const c of COUNTRIES_3) {
  COMPILED_3.push({ re: makeMatcher3(c.names), render: () => renderCountry3(c) });
}
for (const s of US_STATES_3) {
  COMPILED_3.push({ re: makeMatcher3(s.names), render: () => renderUSState3(s) });
}
for (const c of CITIES_3) {
  COMPILED_3.push({ re: makeMatcher3(c.names), render: () => renderCity3(c) });
}
for (const s of SPORTS_3) {
  COMPILED_3.push({ re: makeMatcher3(s.names), render: () => renderSport3(s) });
}
for (const i of INSTRUMENTS_3) {
  COMPILED_3.push({ re: makeMatcher3(i.names), render: () => renderInstrument3(i) });
}

export function bulkFactsLookup3Compiled(lower: string): string | null {
  for (const entry of COMPILED_3) {
    if (entry.re.test(lower)) {
      return entry.render();
    }
  }
  return null;
}
