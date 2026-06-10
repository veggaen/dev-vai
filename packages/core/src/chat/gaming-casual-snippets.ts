/**
 * Short grounded answers for common gaming / casual chat prompts that
 * otherwise fall through to the generic capabilities fallback.
 */

function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tryGamingCasualSnippet(lower: string): string | null {
  const text = normalizeForMatch(lower);
  if (/\bdota\s*2?\b/i.test(text) && /\bmmr\b/i.test(text)) {
    return [
      '**Dota 2 MMR** (matchmaking rating) is the number Valve uses to place you in ranked games and move you between medals.',
      '',
      'Worth caring about if you play ranked and want fairer matches; less important if you only play unranked or Turbo. Climbing is slow — expect hundreds of games for big shifts — so treat it as a long-term skill tracker, not a daily score.',
      '',
      'Practical tips: play a small hero pool, review deaths (not KDA alone), and queue when you are focused. Duo queue only helps if roles complement each other.',
    ].join('\n');
  }

  if (/\belden\s*ring\b/i.test(text) && /\bmalenia\b/i.test(text)) {
    return [
      '**Malenia, Blade of Miquella** is Elden Ring\'s hardest optional boss for most players — high damage, fast dashes, and **Waterfowl Dance** (the multi-hit rot burst).',
      '',
      'General tips:',
      '- Use **Bloodhound Step** or a greatshield for Waterfowl; roll into her, not away on many attacks.',
      '- Stack **frost** (Hoarfrost Stomp, Frost Arrows) or **bleed**; rot resistance helps but does not trivialize her.',
      '- Summon **Mimic Tear** or **Black Knife Tiche** if you want breathing room — still learn her first phase solo.',
      '- Phase 2: stay aggressive after she heals; healing only when she is airborne or recovering.',
    ].join('\n');
  }

  if (/\budyr\b/i.test(text) && /\b(?:league|lol)\b/i.test(text)) {
    return [
      '**Udyr** is a flexible **League of Legends** jungler/top who swaps between four stances (Tiger, Turtle, Bear, Phoenix) instead of casting traditional abilities.',
      '',
      'He can be tanky, split-pushy, or damage-heavy depending on build. Strong early skirmishes, falls off if behind. In modern patches check whether **Awakened** forms are enabled on your patch — that changes his burst pattern.',
    ].join('\n');
  }

  if (/\bcs2?\b|\bcounter-?strike\b/i.test(text) && /\bak[-\s]?47\b/i.test(text) && /\b(?:skin|price|market)\b/i.test(text)) {
    return [
      '**CS2 AK-47 skin prices** change daily on the Steam Community Market and third-party sites — I cannot give a live price without checking sources.',
      '',
      'What moves price: float/wear, pattern (Case Hardened blue gem, etc.), stickers, and liquidity. Budget entry skins are often a few dollars; high-tier finishes can be hundreds or more.',
      '',
      'If you want a current number, say your region/currency and whether you mean Steam Market or Buff163 — I should look that up rather than guess.',
    ].join('\n');
  }

  if (/\bvalorant\b/i.test(text) && /\brank\b/i.test(text)) {
    return [
      '**Valorant ranked** uses a tier ladder (Iron → Radiant) based on **RR** (rank rating) won/lost per match, with hidden **MMR** driving match quality.',
      '',
      'Climbing is mostly consistency: crosshair placement, utility timing, and comms beat raw flicking alone. Play 3–5 ranked games when focused rather than marathon queuing tilted.',
    ].join('\n');
  }

  if (/\bminecraft\b/i.test(text) && /\bvillager\b/i.test(text)) {
    return [
      '**Minecraft villager trading** unlocks better deals by leveling professions (librarian, armorer, etc.).',
      '',
      'Basics: trap a villager safely, give them a job site block, trade until they level, refresh by breaking/replacing the workstation if needed. Zombie-cure discount stacking is the classic economy trick on Java.',
    ].join('\n');
  }

  if (/\bgenshin\b/i.test(text) && /\bpity\b/i.test(text)) {
    return [
      '**Genshin pity** guarantees a 5★ on the character banner at **90 pulls** (soft pity ramps from ~74). Weapon banner pity works differently (check current patch notes).',
      '',
      'Event character banners have separate pity counters from the standard banner. Lost 50/50 sends you to guaranteed next 5★ on that banner type.',
    ].join('\n');
  }

  if (/\bfortnite\b/i.test(text) && /\bzero\s*build\b/i.test(text)) {
    return [
      '**Fortnite Zero Build** removes building — gunplay, positioning, and mobility items matter more.',
      '',
      'Play for cover peaks, third-party timing, and loadout synergy (smoke, mobility, heals). Ranked Zero Build has its own MMR-style progression separate from build modes.',
    ].join('\n');
  }

  if (/\blearning\s+guitar\b/i.test(text) || (/\bguitar\b/i.test(text) && /\badult\b/i.test(text))) {
    return [
      'Learning guitar as an adult is very doable — motor skills take longer than kids but discipline and clear goals help.',
      '',
      'Start with 15–20 minutes daily: open chords (G, C, D, Em), one strumming pattern, and a simple song you like. Use a clip-on tuner; sore fingertips are normal for a few weeks.',
      '',
      'If you want structure, pick one course or teacher instead of random YouTube tabs; record yourself weekly to hear timing issues early.',
    ].join('\n');
  }

  if (/\bremote\s+work\b/i.test(text) && /\bburnout\b/i.test(text)) {
    return [
      '**Remote work burnout** usually mixes isolation, blurred boundaries, and always-on chat.',
      '',
      'What helps: fixed start/stop rituals, camera-off walks between meetings, async-first docs, and saying no to "quick sync" that could be a message. If motivation is flat for weeks, treat it as health — not a discipline failure.',
    ].join('\n');
  }

  if (/\b(?:weekend|rainy\s+day)\b/i.test(text) && /\b(?:plan|rain|indoor)\b/i.test(text)) {
    return [
      'Rainy weekend ideas: museum or café crawl, cook something new, board games, a long walk with waterproof gear, or a movie marathon at home.',
      '',
      'Pick one anchor (rest, social, or productivity) so the day does not feel like wasted scrolling.',
    ].join('\n');
  }

  if (/\bcoffee\b/i.test(text) && /\b(?:home|brew|grind)\b/i.test(text)) {
    return [
      'Good home coffee: fresh beans (2–4 weeks off roast), burr grinder, scale, and water just off boil (~90–96°C).',
      '',
      'Pour-over (V60/Chemex) highlights clarity; AeroPress is forgiving; espresso needs more gear and practice. Start with 1:16 coffee-to-water and adjust taste from there.',
    ].join('\n');
  }

  if (/\btesla\b/i.test(text) && /\b(?:model\s*3|battery|range)\b/i.test(text)) {
    return [
      '**Tesla Model 3** EPA-rated range varies by trim and year (roughly mid-200s to ~360 miles / ~400–580 km depending on variant).',
      '',
      'Real-world range drops with cold weather, speed, and hills. For a current trim-specific number I should check live specs rather than guess.',
    ].join('\n');
  }

  if (/\bpython\b/i.test(text) && /\bjavascript\b/i.test(text) && /\b(?:beginner|vs|versus|compare)\b/i.test(text)) {
    return [
      '**Python vs JavaScript for beginners:** Python is usually easier for first programming concepts (clean syntax, great for scripts, data, automation). JavaScript is essential if you care about web pages and browsers immediately.',
      '',
      'Pick Python for general CS learning; pick JavaScript if your goal is websites or full-stack web this month. Many people learn both — Python first, then JS for the frontend.',
    ].join('\n');
  }

  if (/\b(?:night\s+shift|work\s+nights)\b/i.test(text) && /\bsleep\b/i.test(text)) {
    return [
      'Night-shift sleep: keep a fixed “night bedtime” even on days off, blackout curtains, avoid caffeine 6+ hours before sleep, and get morning light on wake (or a light box) to anchor rhythm.',
      '',
      'Meals and exercise timing matter — many people do better with a small carb snack before day-sleep than a heavy meal right after work.',
    ].join('\n');
  }

  if (/\b(?:moving|move)\b/i.test(text) && /\b(?:city|alone|new\s+place)\b/i.test(text)) {
    return [
      'Moving to a new city alone: give yourself a short routine in week one (grocery, walk, one social touchpoint). Join one recurring activity — climbing gym, language meetup, volunteer shift — repetition beats one-off events.',
      '',
      'Homesickness is normal for a few months; it is not a signal you made the wrong choice unless safety or basics are broken.',
    ].join('\n');
  }

  if (/\bcollege\b/i.test(text) && /\b(?:worth|2026|degree)\b/i.test(text)) {
    return [
      'Whether college is “worth it” in 2026 depends on field and debt: high-ROI paths (engineering, nursing, CS with internships) still benefit; vague degrees with heavy loans hurt more than a decade ago.',
      '',
      'Alternatives — trades, apprenticeships, targeted certs — can beat a generic four-year route if you already know the job you want.',
    ].join('\n');
  }

  if (/\b(?:electric|ev)\b/i.test(text) && /\b(?:hybrid|commute)\b/i.test(text)) {
    return [
      'For a daily commute: hybrids are low-friction if charging is awkward; EVs win on fuel/maintenance when you have reliable home or workplace charging.',
      '',
      'Compare total cost (purchase, electricity, insurance, tires) and your typical daily miles — short commutes favor EV; long rural drives often favor hybrid.',
    ].join('\n');
  }

  if (/\bdocker\b/i.test(text) && /\bpodman\b/i.test(text)) {
    return [
      '**Docker vs Podman** for local dev: both run OCI containers. Docker Desktop is familiar; Podman is daemonless/rootless-friendly and CLI-compatible for many workflows.',
      '',
      'Use Docker if your team standardizes on Docker Compose files as-is; try Podman if you want rootless containers or to avoid the Docker daemon on Linux.',
    ].join('\n');
  }

  if (/\bredis\b/i.test(text) && /\bpostgres\b/i.test(text)) {
    return [
      '**Redis vs Postgres** is not either/or: Postgres is your system of record; Redis is an in-memory layer for cache, queues, rate limits, and ephemeral session state.',
      '',
      'Use Redis when stale reads are acceptable and speed matters; keep authoritative data in Postgres with clear TTL/invalidation rules.',
    ].join('\n');
  }

  if (/\brescue\s+dog\b/i.test(text) || (/\badopt(?:ing)?\b/i.test(text) && /\bdog\b/i.test(text))) {
    return [
      'Adopting a **rescue dog** is rewarding but needs patience: many need decompression time (3–3–3 rule: days, weeks, months).',
      '',
      'Ask the shelter about bite history, triggers, vet needs, and foster notes. Start with a quiet routine, crate training, and positive reinforcement; a trainer early beats fixing habits late.',
    ].join('\n');
  }

  return null;
}
