#!/usr/bin/env node
/**
 * Teach Vai about Phase 0 sandbox overlay system and deployment pipeline.
 */

const entries = [
  {
    pattern: 'vai cursor sandbox overlay phase 0',
    response: [
      'The Vai Agent Overlay (Phase 0) is a visual demonstration system that shows Vai interacting with sandboxed websites.',
      'It consists of 4 components:',
      '(1) VaiCursor - an animated cursor with eased cubic movement, hover glow, click ripple, and typing indicator.',
      '(2) VirtualKeyboard - a QWERTY overlay that lights up keys as Vai types.',
      '(3) RadialMenu - a 6-category tool ring (Navigate, Validate, Edit, Screenshot, SubVai, Tools) that Vai opens to pick actions.',
      '(4) ActionLog - a collapsible feed that logs every action in real time.',
      '(5) DemoSequence - a declarative runner that executes choreographed sequences of actions.',
      'All exposed via window.__vai_cursor (16 methods) and window.__vai_demo (run/stop/isRunning).',
    ].join(' '),
  },
  {
    pattern: 'vai cursor api methods',
    response: [
      'window.__vai_cursor API (16 methods):',
      'moveTo(x,y) - eased cursor move.',
      'click(x,y) - click with ripple effect.',
      'hover(x,y) - hover with glow ring.',
      'focus(x,y,label?) - move + hover with optional label tooltip.',
      'type(x,y,text) - type with virtual keyboard animation (80ms per key).',
      'scroll(deltaY) - scroll preview up/down.',
      'navigateTo(url) - navigate iframe to URL.',
      'screenshot() - capture current viewport state.',
      'hide() - hide cursor and keyboard overlays.',
      'openRadialMenu(x,y) - open tool menu at position.',
      'closeRadialMenu() - close the radial menu.',
      'selectRadialItem(id) - select a tool (navigate/validate/edit/screenshot/subvai/tools).',
      'log(type,message,detail?) - push custom action to the action log.',
      'assertVisible(selector) - validation assertion for element visibility.',
      'assertText(selector,expected) - text content assertion.',
      'getState() - returns {cursor, kbVisible, radialOpen, actionCount, screenshotCount}.',
    ].join(' '),
  },
  {
    pattern: 'demo sequence actions steps',
    response: [
      'DemoSequence is a declarative runner for Vai choreographed demos.',
      'Each step has a type and optional delay (ms). Supported action types:',
      'move (x,y coords), click (x,y), hover (x,y), focus (x,y,label),',
      'type (x,y,text), screenshot, radial (x,y,selectId), navigate (url),',
      'scroll (deltaY), assert (kind:visible|text, selector, expected?),',
      'log (message,detail?), wait (ms), hide.',
      'Coordinates are relative (0-1) and converted to absolute at runtime based on container size.',
      'The DEFAULT_DEMO demonstrates all overlays: nav hover, clicking, screenshots, radial menu, form typing, validation, scrolling.',
      'Run via window.__vai_demo.run() or the play button in PreviewPanel toolbar.',
    ].join(' '),
  },
  {
    pattern: 'radial menu tools categories',
    response: [
      'The RadialMenu has 6 tool categories arranged in a ring:',
      '(1) Navigate - browse, click links, explore the page.',
      '(2) Validate - run assertions, check visibility, verify text content.',
      '(3) Edit - type into fields, modify content, interact with forms.',
      '(4) Screenshot - capture the current viewport state.',
      '(5) SubVai - spawn a sub-agent for specialized tasks.',
      '(6) Tools - access developer tools, console, network inspection.',
      'Each category has an icon from lucide-react and a color.',
      'Opened via openRadialMenu(x,y), item selected via selectRadialItem(id).',
      'Auto-closes after 500ms selection animation.',
    ].join(' '),
  },
  {
    pattern: 'sandbox stack deployment tiers',
    response: [
      'VeggaAI sandbox has 4 stacks x 4 tiers = 16 deployment combinations.',
      'Stacks: PERN (PostgreSQL+Express+React+Node), MERN (MongoDB+Express+React+Node),',
      'Next.js (full-stack React), T3 (tRPC+Prisma+NextAuth+Tailwind).',
      'Tiers: Basic (starter - minimal deps, SQLite/in-memory),',
      'Solid (recommended - Prisma ORM, Zod validation, proper error handling),',
      'Battle-tested (production - Docker, health checks, rate limiting, structured logging),',
      'Vai (premium - all of battle-tested + VeggaAI integration, AI-powered features).',
      'Deploy via POST /api/sandbox/deploy with {stackId, tierId} - streams NDJSON progress events.',
      'All 16 combinations verified passing: scaffold, install, build, start, verify.',
    ].join(' '),
  },
  {
    pattern: 'sandbox deploy pipeline steps',
    response: [
      'Sandbox deploy pipeline (deploy.ts):',
      '(1) scaffold - create directory structure, write all template files.',
      '(2) install - run npm install with --legacy-peer-deps.',
      '(3) build - run npm run build (skipped for dev-only stacks).',
      '(4) docker - build Docker image if Dockerfile exists and Docker daemon is running (gracefully skipped if not).',
      '(5) test - run npm test if test script exists.',
      '(6) start - launch dev server (npm run dev).',
      '(7) verify - check health endpoint responds.',
      'Each step streams progress via NDJSON.',
      'The deploy function returns a SandboxProject with {id, name, port, previewUrl, status}.',
      'Docker availability checked via "docker info" (verifies daemon, not just CLI).',
    ].join(' '),
  },
  {
    pattern: 'virtual keyboard typing animation',
    response: [
      'VirtualKeyboard is a QWERTY overlay that appears when Vai types.',
      'It shows a realistic keyboard with rows: number row, QWERTY, ASDF, ZXCV, and a spacebar.',
      'When type(x,y,text) is called, the keyboard appears and each key lights up in sequence at 80ms intervals.',
      'The active key gets a highlighted color (emerald glow).',
      'After the last character, the keyboard auto-hides and the cursor typing indicator turns off.',
      'Smart positioning: the keyboard renders at a fixed position near the bottom of the preview container,',
      'avoiding overlap with the typing location. Built with framer-motion for smooth entrance/exit animations.',
    ].join(' '),
  },
  {
    pattern: 'vai cursor movement animation',
    response: [
      'VaiCursor uses eased cubic movement for smooth, natural cursor motion.',
      'The cursor has 4 visual states: default (arrow pointer), hovering (glow ring around cursor),',
      'clicking (ripple effect expanding outward), and typing (pulsing dot indicator).',
      'A motion trail follows the cursor using framer-motion spring physics.',
      'The cursor renders as an SVG arrow rotated to match movement direction.',
      'All state managed via React useState with the shape:',
      '{x, y, visible, clicking, hovering, typing, label}.',
      'Labels appear as tooltips when focus() is called with a label parameter.',
    ].join(' '),
  },
];

async function teach() {
  const res = await fetch('http://localhost:3006/api/teach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  const data = await res.json();
  console.log('Taught:', JSON.stringify(data, null, 2));
}

teach().catch(console.error);
