#!/usr/bin/env node
/**
 * Generate 48 themed framework test prompts and send to Vai
 * 
 * Structure: 4 stacks × 4 levels × 3 versions = 48 unique themed prompts
 * Each prompt asks Vai to build a website/app in a specific theme using
 * a specific stack at a specific complexity level.
 *
 * Usage: node scripts/test-mega-48-themes.mjs
 */
import { WebSocket } from 'ws';

const API = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';
const TIMEOUT = 30_000;

/* ═══════════════ Stacks & Tiers ═══════════════ */

const STACKS = ['PERN', 'MERN', 'Next.js', 'T3'];
const TIERS = ['Basic', 'Solid', 'Battle-Tested', 'Vai'];

/* ═══════════════ 48 Unique Themes ═══════════════ */

const THEMES = [
  // ── PERN Basic (3) ──
  { theme: 'Star Wars Lore', desc: 'make a website Star Wars themed with good info on the lore and story in Star Wars, covering the original trilogy, prequels, and expanded universe' },
  { theme: 'Retro Arcade', desc: 'build a retro arcade game catalog site with pixel art styling, high score tables, and game info pages for classic 80s games' },
  { theme: 'Coffee Brewing Guide', desc: 'create a coffee brewing guide website with bean profiles, brewing methods (pour-over, French press, espresso), and recipe calculators' },

  // ── PERN Solid (3) ──
  { theme: 'Space Exploration', desc: 'build a NASA-inspired space exploration dashboard showing real-time ISS data, mission timelines, and planet info cards with orbital animations' },
  { theme: 'Medieval Fantasy RPG', desc: 'create an RPG character sheet manager with stats, inventory, spell lists, and party management for a D&D-style fantasy game' },
  { theme: 'Urban Gardening', desc: 'build an urban gardening planner with plant databases, watering schedules, companion planting charts, and seasonal growing guides' },

  // ── PERN Battle-Tested (3) ──
  { theme: 'Crypto Portfolio', desc: 'build a cryptocurrency portfolio tracker with live price feeds, chart visualizations, profit/loss tracking, and portfolio rebalancing alerts' },
  { theme: 'Film Noir Detective', desc: 'create a film noir themed mystery game website with a dark moody aesthetic, interactive case files, evidence boards, and suspect profiles' },
  { theme: 'Japanese Ramen Guide', desc: 'build a comprehensive ramen guide website with regional styles (Tonkotsu, Shoyu, Miso), restaurant maps, and noodle-making tutorials' },

  // ── PERN Vai (3) ──
  { theme: 'Norwegian Fjords Tourism', desc: 'create a Norwegian fjord tourism site with interactive maps, hiking trail guides, ferry schedules, and Northern Lights forecasts' },
  { theme: 'Synthwave Music Hub', desc: 'build a synthwave/retrowave music discovery platform with neon aesthetics, artist profiles, playlist curation, and an embedded audio player' },
  { theme: 'Ancient Egyptian Museum', desc: 'create a virtual Egyptian museum with 3D artifact viewers, pharaoh timelines, hieroglyph translator, and tomb exploration guides' },

  // ── MERN Basic (3) ──
  { theme: 'Pokemon Pokedex', desc: 'build a Pokedex web app with type matchup charts, evolution trees, move lists, and a party builder that calculates team coverage' },
  { theme: 'Vintage Vinyl Records', desc: 'create a vintage vinyl record shop with album artwork galleries, genre filtering, wishlist tracking, and turntable setup guides' },
  { theme: 'Yoga & Mindfulness', desc: 'build a yoga practice planner with pose libraries, guided meditation timers, breathing exercises, and daily mindfulness journals' },

  // ── MERN Solid (3) ──
  { theme: 'Formula 1 Racing', desc: 'create an F1 racing dashboard with live race tracking, driver standings, circuit maps, lap time comparisons, and historical season data' },
  { theme: 'Haunted House Explorer', desc: 'build a haunted locations directory with spooky styling, ghost story archives, user-submitted experiences, and an interactive scare meter' },
  { theme: 'Artisan Cheese Guide', desc: 'create an artisan cheese encyclopedia with pairing recommendations, aging charts, tasting notes, and cheesemaking tutorials' },

  // ── MERN Battle-Tested (3) ──
  { theme: 'Cyberpunk City', desc: 'build a cyberpunk-themed city management sim dashboard with neon UI, district management, resource tracking, and faction reputation systems' },
  { theme: 'Wildlife Safari', desc: 'create a wildlife safari booking and tracking platform with animal spotting maps, species databases, photo galleries, and conservation stats' },
  { theme: 'Craft Beer Brewery', desc: 'build a craft brewery management system with recipe builders, fermentation tracking, taproom menus, and beer rating aggregation' },

  // ── MERN Vai (3) ──
  { theme: 'Viking Age History', desc: 'create a Viking Age historical site with interactive raid maps, Norse mythology encyclopedia, saga translations, and rune alphabet tools' },
  { theme: 'Bonsai Cultivation', desc: 'build a bonsai tree cultivation guide with species databases, pruning calendars, styling techniques, and time-lapse growth journals' },
  { theme: 'Underwater Ocean World', desc: 'create an underwater ocean exploration site with marine species catalog, depth zone info, coral reef maps, and diving spot guides' },

  // ── Next.js Basic (3) ──
  { theme: 'Astronomy Star Charts', desc: 'build an astronomy portal with interactive star charts, constellation guides, planet visibility calendars, and telescope recommendations' },
  { theme: 'Retro VHS Horror', desc: 'create a retro VHS horror movie catalog with tracking lines visual effects, movie reviews, director spotlights, and a random horror picker' },
  { theme: 'Sourdough Baking', desc: 'build a sourdough baking community with starter maintenance guides, recipe sharing, fermentation timers, and crumb-shot photo galleries' },

  // ── Next.js Solid (3) ──
  { theme: 'Steampunk Inventor', desc: 'create a steampunk-themed inventor workshop site with gear-based UI, project blueprints, parts catalogs, and mechanical animation demos' },
  { theme: 'Tropical Cocktail Bar', desc: 'build a tropical cocktail recipe app with ingredient databases, flavor profiles, bartender tips, and a cocktail randomizer wheel' },
  { theme: 'Antarctic Research', desc: 'create an Antarctic research station dashboard with weather monitoring, wildlife tracking, expedition logs, and ice core data visualizations' },

  // ── Next.js Battle-Tested (3) ──
  { theme: 'Martial Arts Dojo', desc: 'build a martial arts dojo management platform with belt progression tracking, technique libraries, sparring schedules, and tournament brackets' },
  { theme: 'Neon Tokyo Nightlife', desc: 'create a Tokyo nightlife guide with glowing neon UI, district maps, restaurant/bar listings, event calendars, and transit route planners' },
  { theme: 'Vintage Aviation', desc: 'build a vintage aviation museum website with aircraft specs, pilot biographies, flight path visualizations, and warbird restoration projects' },

  // ── Next.js Vai (3) ──
  { theme: 'Aurora Borealis Tracker', desc: 'create a Northern Lights tracker with real-time Kp index monitoring, best viewing locations, photography tips, and alert notifications' },
  { theme: 'Samurai Bushido', desc: 'build a Samurai history and Bushido philosophy site with clan genealogies, sword catalogs, battle maps, and calligraphy practice tools' },
  { theme: 'Deep Sea Mining', desc: 'create a deep sea mining operations dashboard with subsea ROV monitoring, mineral deposit maps, pressure gauges, and extraction logistics' },

  // ── T3 Basic (3) ──
  { theme: 'Pixel Art Studio', desc: 'build a pixel art creation studio with a canvas editor, color palette manager, animation timeline, and community gallery for sharing sprites' },
  { theme: 'Herbalism & Potions', desc: 'create a fantasy herbalism guide with potion recipes, ingredient databases, effect calculators, and a magical garden planner' },
  { theme: 'Skateboard Culture', desc: 'build a skateboarding culture site with trick tutorials, skatepark maps, deck customizer, and competition results tracking' },

  // ── T3 Solid (3) ──
  { theme: 'Vampire Chronicles', desc: 'create a vampire-themed social network with blood-red dark mode, coven management, night-only chat rooms, and immortal character profiles' },
  { theme: 'Volcanic Geology', desc: 'build a volcanology dashboard with eruption monitoring, tectonic plate maps, historical eruption timelines, and evacuation zone planners' },
  { theme: 'Scandinavian Design', desc: 'create a Scandinavian furniture design showcase with minimalist aesthetics, 3D room planners, material guides, and designer biographies' },

  // ── T3 Battle-Tested (3) ──
  { theme: 'Pirate Ship Adventures', desc: 'build a pirate-themed adventure game hub with treasure maps, ship customization, crew management, and sea battle strategy guides' },
  { theme: 'Electric Vehicle Hub', desc: 'create an EV comparison platform with range calculators, charging station maps, battery health monitors, and road trip planners' },
  { theme: 'Zen Rock Garden', desc: 'build a Zen garden designer with drag-and-drop rock/sand placement, meditation timers, Japanese garden history, and ambient sound players' },

  // ── T3 Vai (3) ──
  { theme: 'AI Art Gallery', desc: 'create an AI-generated art gallery with prompt engineering guides, model comparisons, style transfer demos, and community prompt sharing' },
  { theme: 'Norse Mythology', desc: 'build a Norse mythology compendium with the World Tree visualization, god/creature profiles, saga excerpts, and rune casting divination tool' },
  { theme: 'Quantum Computing', desc: 'create a quantum computing learning platform with qubit visualizations, gate circuit builders, algorithm tutorials, and quantum state simulators' },
];

/* ═══════════════ Build 48 Prompts ═══════════════ */

function buildPrompts() {
  const prompts = [];
  let themeIdx = 0;

  for (const stack of STACKS) {
    for (const tier of TIERS) {
      for (let v = 0; v < 3; v++) {
        const t = THEMES[themeIdx];
        const tierLabel = tier === 'Vai' ? 'Vai-tier premium' : tier.toLowerCase();
        const prompt =
          `Build me a ${tierLabel} ${stack} stack web application: ${t.desc}. ` +
          `Use the ${stack} stack at the ${tier} level. ` +
          `Theme: "${t.theme}". ` +
          `Include responsive design, proper routing, and good UI/UX. ` +
          `Show me the key files and explain the architecture.`;
        prompts.push({
          id: `${stack.toLowerCase().replace(/\./g, '')}-${tier.toLowerCase().replace(/\s+/g, '-')}-v${v + 1}`,
          stack,
          tier,
          version: v + 1,
          theme: t.theme,
          prompt,
        });
        themeIdx++;
      }
    }
  }
  return prompts;
}

/* ═══════════════ Chat with Vai ═══════════════ */

async function chatWithVai(conversationId, message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content: message }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) {
        response += msg.textDelta;
      } else if (msg.type === 'done') {
        gotDone = true;
        ws.close();
      } else if (msg.type === 'error') {
        ws.close();
        reject(new Error(msg.error));
      }
    });

    ws.on('close', () => resolve(response || '[no response]'));
    ws.on('error', (err) => reject(err));
    setTimeout(() => { if (!gotDone) { ws.close(); resolve(response || '[timeout]'); } }, TIMEOUT);
  });
}

/* ═══════════════ Main ═══════════════ */

async function main() {
  const prompts = buildPrompts();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   48 THEMED FRAMEWORK TEST — 4 Stacks × 4 Tiers × 3   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nTotal prompts: ${prompts.length}\n`);

  // Print prompt overview
  console.log('=== PROMPT OVERVIEW ===\n');
  for (const p of prompts) {
    console.log(`  ${p.id.padEnd(30)} [${p.stack}/${p.tier}]  Theme: ${p.theme}`);
  }

  // Create a single conversation for all
  const convRes = await fetch(`${API}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '48 Themed Framework Mega-Test', modelId: 'vai:v0' }),
  });
  const conv = await convRes.json();
  console.log(`\nConversation: ${conv.id}\n`);

  const results = [];
  let passed = 0;

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${i + 1}/${prompts.length}] ${p.id}`);
    console.log(`  Stack: ${p.stack}  Tier: ${p.tier}  Theme: ${p.theme}`);
    console.log(`  Prompt: ${p.prompt.substring(0, 120)}...`);

    try {
      const response = await chatWithVai(conv.id, p.prompt);
      const words = response.split(/\s+/).length;
      const hasCode = /```/.test(response);
      const hasFiles = /\.(tsx?|jsx?|css|html|json|sql|prisma)/.test(response);
      const mentionsStack = new RegExp(p.stack.replace('.', '\\.'), 'i').test(response);
      const mentionsTheme = new RegExp(p.theme.split(/\s+/)[0], 'i').test(response);

      const score = (
        (words >= 50 ? 25 : 0) +
        (hasCode ? 25 : 0) +
        (hasFiles ? 20 : 0) +
        (mentionsStack ? 15 : 0) +
        (mentionsTheme ? 15 : 0)
      );

      const pass = score >= 50;
      if (pass) passed++;

      results.push({
        id: p.id,
        stack: p.stack,
        tier: p.tier,
        theme: p.theme,
        score,
        passed: pass,
        words,
        hasCode,
        hasFiles,
        mentionsStack,
        mentionsTheme,
        responsePreview: response.substring(0, 300),
      });

      console.log(`  → ${pass ? '✅ PASS' : '❌ FAIL'} (score: ${score}/100, ${words} words, code: ${hasCode}, files: ${hasFiles})`);
    } catch (err) {
      console.log(`  → ❌ ERROR: ${err.message}`);
      results.push({
        id: p.id,
        stack: p.stack,
        tier: p.tier,
        theme: p.theme,
        score: 0,
        passed: false,
        error: err.message,
      });
    }
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`\n48 THEMED FRAMEWORK TEST — RESULTS\n`);
  console.log(`Total: ${results.length}  Passed: ${passed}  Failed: ${results.length - passed}`);
  console.log(`Pass rate: ${((passed / results.length) * 100).toFixed(1)}%\n`);

  // Per-stack breakdown
  for (const stack of STACKS) {
    const stackResults = results.filter(r => r.stack === stack);
    const stackPassed = stackResults.filter(r => r.passed).length;
    console.log(`  ${stack.padEnd(10)} ${stackPassed}/${stackResults.length} passed`);
    for (const tier of TIERS) {
      const tierResults = stackResults.filter(r => r.tier === tier);
      const tierPassed = tierResults.filter(r => r.passed).length;
      console.log(`    ${tier.padEnd(15)} ${tierPassed}/${tierResults.length}`);
    }
  }

  // Failures
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`\n── Failures ──`);
    for (const f of failures) {
      console.log(`  ${f.id}: score=${f.score} ${f.error ? `error: ${f.error}` : ''}`);
    }
  }

  console.log(`\nDone.`);
}

main().catch(console.error);
