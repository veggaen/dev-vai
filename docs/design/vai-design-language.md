# Vai Design Language — "Discipline over decoration"

The binding design constitution for Vai's desktop shell. Agents (human or AI)
touching `apps/desktop` UI MUST read this before styling anything. Vai's own
stylist/council should be held to the same bar when generating app UIs.

The taste anchor is **compact mode**: hairlines, density, quiet surfaces,
precise motion, one accent. Everything else derives from it.

## Why this exists

The failure mode of AI-styled UI is decoration: gradients that drift, glows,
glass, starfields, chips in four colors, five stacked panels each with its own
border. It photographs well for two seconds and exhausts users in ten minutes.
Award-worthy tools (Linear, Raycast, Arc) win with the opposite: typography,
spacing, restraint, and ONE signature element per surface.

## The budgets (hard limits)

1. **Accent budget** — accent color appears at most TWICE per surface:
   the live/primary indicator and the primary action. Everything else is
   neutral. If a third accent appears, one of the first two must go.
2. **Box budget** — at most ONE bordered panel may stack above/below the
   composer or inside a message turn. New surfaces share the existing slot
   (dock line, notice slot, receipt panel) instead of adding a box.
3. **Ambient budget** — ZERO infinite animation loops per mode, except a
   mode's single signature element (compact's scanline). No drifting meshes,
   auroras, starfields, sheens, glows, or breathing rings. Motion is
   transactional: it responds to the user, then stops.
4. **Radius scale** — 4/8/12px only. One radius per component family.
5. **Type scale** — UI chrome 11–13px; body 13.5–14px; mono 10–11px for
   process/receipt voice. Two weights (400/500). Sentence case everywhere.
6. **Chip budget** — status chips render only state that is actionable or
   changing. A chip that always shows the same label is furniture; delete it.

## Voice separation

- **Answer voice** — normal body type. What Vai did/found. Always FIRST.
- **Process voice** — 11px mono, muted, one hairline spine. How it happened.
  Always UNDER the answer, collapsed to one line once settled.
- **Notice voice** — one slim row, inline text actions, one at a time,
  priority-ordered. Never a stack of styled cards.

Result before evidence, always. A wall of process text is not a receipt
(see backlog 2026-07-10: completion-message gate).

## Turn anatomy (builder/agent turns)

```
[answer sentence — what shipped]
[Open app] [View code]
✓ 12 steps · 48s · council 4/5 ship · 3 files +214   ▸   ← one mono line
   └─ expanded: timeline steps, council verdict, sources, self-improvements
```

While streaming: the mono line is live (pulsing dot, current step, n/total,
elapsed) with the timeline expanded beneath it. On settle it collapses to the
receipt. ONE process surface per turn — never TurnProcessSection + ThinkingPanel
stacked.

## Layout modes — three rooms, one DNA

Each mode is a ROOM with a purpose and exactly one signature element.
`--mode-dur/--mode-ease/--row-radius/--menu-radius` carry the personality;
components opt in via `.vai-side-row`, `.vai-context-menu`, `.vai-side-search`,
`.vai-new-chat-btn`.

| Mode | Room | Purpose | Signature | Grammar |
|---|---|---|---|---|
| `compact` | Instrument | dense daily work | the scanline | blueprint grid, hairlines, 130ms, notch accents |
| `open` | Atelier | reading, thinking | the margin rule | paper-tint canvas, flush hairline panels, zero transforms, 200ms |
| `odyssey` | Stage | focus, demos | the meridian | near-black room, chrome as silhouettes (60% → 100% on hover), lit content surface, 240ms |

Forbidden in all modes: backdrop-blur glass outside compact menus, hover
lift-shadows, glow rings, gradient text, animated backgrounds.

## Adaptive grammar — the shell answers the screen

The content column is ALWAYS centered and symmetrical; screens change how
much room the room takes (`styles/adaptive.css`):

- **Ultrawide (≥ ~21:10, ≥1720px)** — letterbox: the workspace caps at
  112rem and centers; the mode's canvas owns the wings. Never stretch
  panels to fill a 32:9 monitor.
- **Portrait / tall** (rotated side monitors) — width is scarce, height
  abundant: chat column goes full usable width, chrome tightens vertically.
- **Narrow (≤900px) / touch (≤640px)** — paddings compress, touch targets
  ≥40px, decorative canvas (blueprint grid) drops. Rails should collapse to
  drawers at component level.

Test any new surface at: 32:9, 16:9, 3:4 (portrait), and 390px phone width.
Media queries key on BOTH width and aspect-ratio/orientation — a 1440×2560
portrait monitor is not a phone.

## Definition of PASS for UI work

1. Screenshot the surface in all three modes, light and dark.
2. Count accent occurrences (≤2), stacked boxes (≤1), infinite loops
   (≤ signature).
3. The idle composer shows nothing but the input, toolbar, and (if active)
   the one dock line.
4. Every removed feature is either relocated (say where) or deliberately
   killed (say why). Silent drops are bugs.

## File map

- `apps/desktop/src/styles/layout-modes.css` — mode personalities
- `apps/desktop/src/components/chat/ComposerDock.tsx` — the one status line
- `apps/desktop/src/components/chat/ComposerNotice.tsx` — the one notice slot
- `apps/desktop/src/styles/index.css` — tokens (`--chat-*`, `--panel-*`,
  `--accent-*`, `--phase-*`, `--tone-*`)
