# TEMPLATE DESIGN SYSTEM — Visual Identity & Animation Requirements

> **Purpose:** Ensure all 16 templates (4 stacks × 4 tiers) are visually distinct,  
> over-engineered in UX polish, and never repeat the same layout/animation/style.  
> **Authority:** Subordinate to Master.md. Validated: 2026-03-04  
> **Rule:** Every template must pass the "screenshot test" — if you screenshot all 16,  
> no two should be mistakable for each other.

---

## THE PROBLEM THIS SOLVES

Right now every tier deploys the same basic todo app. Even if the pipeline is fixed and
tier overrides apply correctly, the templates themselves need distinct visual DNA.
A Premium tier that looks like a Basic tier with extra buttons is not a Premium tier.
Each tier must FEEL different the moment it loads.

---

## PART 1: SHARED ANIMATION INFRASTRUCTURE

Every template, regardless of tier, has access to these animation primitives.
They are the building blocks — each template combines them differently.

### 1.1 The Cursor Border Box (from Master.md)

A single accent-colored border element that follows the mouse between interactive
elements. It doesn't follow the mouse continuously — it snaps from element to
element along spatial paths (up, left, down, right).

```
Implementation:
- One absolutely-positioned div with border + border-radius
- On mouseenter of any interactive element:
  1. Get element's getBoundingClientRect()
  2. Animate border box FROM its current position TO new element
  3. Match target element's width, height, border-radius
  4. Use GSAP or framer-motion with spring physics
  5. Duration: 300-400ms, ease: "back.out(1.7)"
- On mouseleave: border box STAYS on last element (doesn't disappear)
- On mouseenter of a new element: animates from old position to new
- The path should feel spatial — not teleporting, but traveling

CSS for the border box:
  border: 2px solid var(--accent-glow);
  box-shadow: 0 0 12px var(--accent-glow-alpha);
  pointer-events: none;
  position: fixed;
  z-index: 9999;
  transition: none; /* handled by JS animation */
```

### 1.2 Always-Alive Ambient Animation

Every route has ONE looping background animation. Never static.
Choose per-template from:

| Type | Implementation | Best For |
|------|---------------|----------|
| **Floating particles** | Canvas with 20-40 soft circles, parallax on mouse | Basic, clean UIs |
| **Gradient mesh breathing** | CSS radial gradients with hue-rotate keyframes | Dark, moody UIs |
| **Noise grain overlay** | SVG feTurbulence filter, animated seed | Textured, editorial |
| **Geometric orbit** | SVG circles/lines rotating at different speeds | Tech, data-heavy |
| **Liquid blob** | SVG with animated d path or CSS border-radius morph | Organic, creative |
| **Aurora wave** | CSS gradient with translateX animation | Premium, atmospheric |
| **Grid pulse** | CSS grid lines that pulse outward from center | Cyberpunk, technical |
| **DNA helix** | Three.js or CSS 3D rotating double-helix | Science, biotech |

### 1.3 Page Transition System

Every navigation between pages/tabs uses a transition. Never an instant swap.

```
Tier 1 (Basic):     Crossfade (opacity 0→1, 200ms)
Tier 2 (Solid):     Slide + fade (translateY 12px→0, opacity, 250ms)
Tier 3 (Battle):    Clip-path reveal (circle from click point expanding)
Tier 4 (Premium):   Liquid morph (shared layout animation + displacement)
```

### 1.4 Scroll-Triggered Animations

Elements animate in as they enter the viewport:

```javascript
// Intersection Observer with staggered children
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('animate-in');
      // Stagger children
      entry.target.querySelectorAll('[data-stagger]').forEach((child, i) => {
        child.style.animationDelay = `${i * 60}ms`;
        child.classList.add('animate-in');
      });
    }
  });
}, { threshold: 0.15 });
```

Animation presets:
```css
.animate-in { animation: revealUp 500ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }

@keyframes revealUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes revealScale {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes revealBlur {
  from { opacity: 0; filter: blur(8px); transform: translateY(8px); }
  to   { opacity: 1; filter: blur(0); transform: translateY(0); }
}
```

### 1.5 Hover & Interaction Effects

Every interactive element must have a hover response. NEVER a bare unstyled button.

```
Buttons:
  - Scale: 1 → 0.97 on mousedown, spring back to 1.02 then 1.0
  - Glow: box-shadow expands 0→8px accent color on hover
  - Ripple: Material-style click ripple (circle expanding from click point)

Cards:
  - Lift: translateY(-2px) + shadow increase on hover
  - Border glow: border-color transitions to accent
  - Tilt: subtle perspective tilt toward mouse (3-5 degrees max)
  - The cursor border box snaps to the card

Inputs:
  - Focus ring: 2px accent border + outer glow
  - Label float: placeholder text floats up as label on focus
  - Shake: horizontal shake animation (6px, 3 cycles, 300ms) on validation error
  - Success: brief green flash on valid submit

Links/Nav:
  - Underline grow: width 0→100% from left on hover
  - Color shift: text color transitions 150ms
  - Icon rotate: small rotation or morph on hover (arrow → rotated arrow)
```

### 1.6 Text Animation Toolkit

```
Rolling letters:   Each character animates in sequence (translateY + opacity)
Typewriter:        Characters appear one by one with blinking cursor
Glitch:            Random offset + color channel split (text-shadow trick)
Counting:          Numbers count up/down to target value
Gradient text:     background-clip: text with animated gradient
Scramble:          Random characters resolve to correct ones (matrix-style)
Split reveal:      Text splits and reveals from center outward
```

### 1.7 Loading & Skeleton System

No spinners. Ever. Skeletons only.

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-skeleton) 25%,
    var(--bg-skeleton-shimmer) 50%,
    var(--bg-skeleton) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 6px;
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Every skeleton must match the exact dimensions of the content it replaces.
No layout shift. CLS = 0.

---

## PART 2: TIER-SPECIFIC VISUAL IDENTITY

Each tier has a distinct visual language. This is non-negotiable.

### TIER 1: BASIC — Clean Craft

**Visual DNA:** Minimal but meticulous. Like a well-designed notebook app.
Think Apple Notes meets Things 3.

```
Color Palette:
  Background:  #0a0a0a (near black)
  Surface:     #141414
  Border:      #262626
  Text:        #e5e5e5
  Accent:      #22c55e (green-500)
  Accent glow: rgba(34, 197, 94, 0.15)

Typography:
  Headings:  "DM Sans", sans-serif — 600 weight
  Body:      "DM Sans", sans-serif — 400 weight
  Mono:      "JetBrains Mono", monospace

Ambient Animation:  Floating particles (soft green dots, very subtle)
Page Transitions:   Crossfade (200ms)
Border Radius:      8px (containers), 6px (inputs), 20px (pills)
Spacing:            4px grid
Shadow:             None (flat design, borders only)
```

**Unique feature:** The board sidebar has a subtle gradient line on the left
edge that pulses slowly (breathes) to indicate the active board.

### TIER 2: SOLID — Structured Authority

**Visual DNA:** More layered. Panels, depth, clear hierarchy.
Think Linear meets Notion.

```
Color Palette:
  Background:  #09090b (zinc-950)
  Surface:     #18181b (zinc-900)
  Elevated:    #27272a (zinc-800)
  Border:      #3f3f46 (zinc-700)
  Text:        #fafafa (zinc-50)
  Accent:      #8b5cf6 (violet-500)
  Secondary:   #06b6d4 (cyan-500)

Typography:
  Headings:  "Instrument Sans", sans-serif — 700 weight
  Body:      "Instrument Sans", sans-serif — 400 weight
  Mono:      "Fira Code", monospace

Ambient Animation:  Geometric orbit (thin SVG circles rotating at different speeds)
Page Transitions:   Slide + fade (250ms)
Border Radius:      12px (containers), 8px (inputs), 24px (pills)
Spacing:            4px grid
Shadow:             Layered (0 1px 2px + 0 4px 8px, very subtle)
```

**Unique features:**
- Auth screen has a large animated geometric pattern behind the form
- The board view has a kanban-style option (toggle between list and kanban)
- Search (Ctrl+K) opens a command palette with blur backdrop

### TIER 3: BATTLE-TESTED — Dashboard Power

**Visual DNA:** Information-dense but not cluttered. Like a Bloomberg terminal
meets Discord. Tabbed navigation, badges, real-time indicators.

```
Color Palette:
  Background:  #0c0a14 (deep purple-black)
  Surface:     #16131f
  Elevated:    #1e1a2a
  Border:      #2d2640
  Text:        #e8e4f0
  Accent:      #a78bfa (violet-400)
  Success:     #4ade80
  Warning:     #fbbf24
  Danger:      #f87171
  Info:        #60a5fa

Typography:
  Headings:  "Plus Jakarta Sans", sans-serif — 700 weight
  Body:      "Plus Jakarta Sans", sans-serif — 400 weight
  Mono:      "Source Code Pro", monospace

Ambient Animation:  Grid pulse (CSS grid lines pulsing outward)
Page Transitions:   Clip-path reveal (circle expanding from click point)
Border Radius:      12px (containers), 8px (inputs), 9999px (badges/pills)
Spacing:            4px grid
Shadow:             Glow shadows (box-shadow with accent color alpha)
```

**Unique features:**
- Tab bar has an animated underline that slides between tabs (not just appears)
- Notification badge has a pulse animation (scale 1→1.2→1, loop)
- Admin dashboard charts animate on mount (bars grow up, lines draw left-to-right)
- Feed items slide in from the right as they arrive in real-time
- User avatars have status rings (green=online, yellow=away, gray=offline)

### TIER 4: PREMIUM — Glass & Light

**Visual DNA:** Premium. Atmospheric. Depth through glass morphism, light rays,
and volumetric effects. Think VS Code meets a luxury car dashboard.

```
Color Palette:
  Background:  #050507 (true dark)
  Surface:     oklch(0.16 0.005 270 / 0.80) (glass)
  Elevated:    oklch(0.19 0.01 270 / 0.85)
  Border:      oklch(0.30 0.02 270 / 0.50)
  Text:        #f0eef5
  Accent:      oklch(0.65 0.20 270) (violet)
  Accent 2:    oklch(0.65 0.18 200) (teal)
  Glow:        oklch(0.65 0.25 270 / 0.25)

Typography:
  Headings:  "Satoshi", sans-serif — 700 weight
  Body:      "Satoshi", sans-serif — 400 weight
  Mono:      "JetBrains Mono", monospace
  Display:   "Cabinet Grotesk", sans-serif — 800 weight (for hero text)

Ambient Animation:  Aurora wave (animated gradient mesh, 20s loop)
Page Transitions:   Liquid morph (shared layout animation + blur)
Border Radius:      16px (containers), 10px (inputs), 9999px (pills)
Spacing:            4px grid
Shadow:             Volumetric (multiple layers with colored blur)

Glass effect:
  background: oklch(0.16 0.005 270 / 0.80);
  backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid oklch(0.30 0.02 270 / 0.50);
  box-shadow: 0 4px 24px oklch(0 0 0 / 0.30),
              inset 0 1px 0 oklch(1 0 0 / 0.05);
```

**Unique features:**
- Setup wizard has a full-screen animated background (three.js particles + aurora)
- Sidebar is glass with blur-through to background aurora
- AI chat messages have a subtle glow that fades as they age
- Panel dividers glow on hover (accent color, 0→1 opacity)
- The activity bar icons have micro-animations on hover (each icon unique)
- Light rays emanate from the VeggaAI logo on first load
- BYOK key input has a "scanning" animation when auto-detecting provider

---

## PART 3: STACK-SPECIFIC VISUAL ACCENTS

While tiers define the major visual identity, each stack gets a subtle accent
that makes it identifiable even at the same tier level.

### PERN — The Reliable Workhorse

```
Stack accent:    Emerald (#10b981)
Icon motif:      Elephant (PostgreSQL) + circuit board pattern
Deploy card bg:  Subtle circuit board SVG pattern at 3% opacity
Console theme:   Green-on-dark terminal aesthetic
```

### MERN — The Flexible Builder

```
Stack accent:    Lime (#84cc16)
Icon motif:      Leaf (MongoDB) + hexagonal grid
Deploy card bg:  Hexagonal mesh pattern at 3% opacity
Console theme:   MongoDB-green terminal aesthetic
```

### Next.js — The Production Framework

```
Stack accent:    White/Silver (#e5e5e5)
Icon motif:      Triangle (Next.js) + vercel-style gradient
Deploy card bg:  Diagonal gradient lines at 3% opacity
Console theme:   Clean monochrome terminal
```

### T3 Stack — The Type-Safe Purist

```
Stack accent:    Blue (#3b82f6)
Icon motif:      Prism/triangle (T3) + TypeScript blue
Deploy card bg:  Prism refraction pattern at 3% opacity
Console theme:   TypeScript-blue terminal aesthetic
```

---

## PART 4: THE DEPLOY EXPERIENCE

The deploy pipeline itself must be visually engaging. Right now it's a list
of steps with checkmarks. It should feel like a launch sequence.

### Progress Bar

```
Not just a bar — a gradient bar with a glow:

.progress-bar {
  height: 4px;
  background: linear-gradient(90deg,
    var(--accent) 0%,
    var(--accent-bright) 50%,
    var(--accent) 100%
  );
  background-size: 200% 100%;
  animation: progressShimmer 2s ease-in-out infinite;
  box-shadow: 0 0 12px var(--accent-glow);
  border-radius: 2px;
  transition: width 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

### Step Icons

Each step has a unique icon that animates when active:

```
Scaffolding:      📦 → spinning cube animation
Installing:       ⬇️ → downloading arrow bouncing
Building:         🔨 → hammer strike animation (rotation)
Docker:           🐳 → whale tail splash (vertical bounce)
Testing:          🧪 → liquid bubbling (scale oscillation)
Dev Server:       ▶️ → play button pulse
Health Check:     💚 → heartbeat pulse (scale 1→1.15→1, 800ms loop)
```

### Console Streaming

The console panel must stream real-time output:

```
- Monospace font (JetBrains Mono)
- Line numbers on the left (dimmed)
- Auto-scroll to bottom (with scroll-lock toggle)
- Color coding:
    Green:   Success messages, "✓ Dependencies installed"
    Yellow:  Warnings, "npm warn..."
    Red:     Errors
    Cyan:    Info, "Starting dev server on port 4100..."
    Dim:     Verbose output (can be toggled)
- Timestamp per line (HH:MM:SS.ms)
- Click to copy any line
- Search within console (Ctrl+F)
```

### Deploy Complete Animation

When all steps are green:

```
1. Progress bar fills to 100% with a flash
2. "Deployment Complete" text types in (typewriter, 40ms/char)
3. Checkmark animates: draw SVG path stroke (300ms)
4. "Ready — loading preview..." bar slides in from bottom
5. Preview iframe fades in with blur→clear transition (400ms)
6. Confetti burst (8-10 accent-colored particles, fade out over 1s)
```

---

## PART 5: THE SCREENSHOT TEST

Before any template is considered done, take these 5 screenshots
and verify they pass:

### Test 1: First Impression (3-second test)
- Show all 4 tiers of one stack side by side
- A stranger should instantly tell which is Basic and which is Premium
- If they look the same → FAIL

### Test 2: Animation Alive
- Record a 5-second screen capture of each template with no interaction
- There must be visible ambient animation (particles, gradients, orbits)
- If the page looks static → FAIL

### Test 3: Hover Polish
- Hover over 5 different interactive elements
- Each must respond visually (border box, glow, scale, color shift)
- If any element has no hover response → FAIL

### Test 4: Transition Smoothness
- Navigate between 3 different views/tabs
- Transitions must be smooth (no instant swaps, no janky flashes)
- Record at 60fps — if frames drop below 30fps during transition → FAIL

### Test 5: Mobile Dignity
- View at 375px width (iPhone SE)
- The layout must be usable and beautiful (not just "not broken")
- If it looks like a shrunk desktop → FAIL

---

## PART 6: ANIMATION RECIPES

Copy-paste-ready implementations for the most impactful effects.

### Recipe: Cursor Border Box (GSAP)

```javascript
// cursor-border-box.js
class CursorBorderBox {
  constructor() {
    this.box = document.createElement('div');
    this.box.className = 'cursor-border-box';
    this.box.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 9999;
      border: 2px solid var(--accent);
      border-radius: 8px;
      box-shadow: 0 0 12px var(--accent-glow);
      opacity: 0;
      transition: opacity 200ms;
    `;
    document.body.appendChild(this.box);
    this.currentTarget = null;
    this.setupListeners();
  }

  setupListeners() {
    const interactiveSelector = 'button, a, input, [data-hover], .card, [role="button"]';

    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest(interactiveSelector);
      if (!target || target === this.currentTarget) return;

      this.currentTarget = target;
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);

      // Animate to new target
      gsap.to(this.box, {
        x: rect.left - 2,
        y: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        borderRadius: style.borderRadius,
        duration: 0.35,
        ease: 'back.out(1.4)',
      });

      this.box.style.opacity = '1';
    });
  }
}
```

### Recipe: Floating Particles (Canvas)

```javascript
// ambient-particles.js
class FloatingParticles {
  constructor(canvas, options = {}) {
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.count = options.count || 30;
    this.color = options.color || '34, 197, 94'; // RGB
    this.maxAlpha = options.maxAlpha || 0.15;
    this.maxSize = options.maxSize || 3;
    this.speed = options.speed || 0.3;

    this.resize(canvas);
    this.init();
    this.animate();
  }

  resize(canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  init() {
    for (let i = 0; i < this.count; i++) {
      this.particles.push({
        x: Math.random() * this.ctx.canvas.width,
        y: Math.random() * this.ctx.canvas.height,
        size: Math.random() * this.maxSize + 0.5,
        speedX: (Math.random() - 0.5) * this.speed,
        speedY: (Math.random() - 0.5) * this.speed,
        alpha: Math.random() * this.maxAlpha,
        alphaDir: Math.random() > 0.5 ? 1 : -1,
      });
    }
  }

  animate() {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    for (const p of this.particles) {
      p.x += p.speedX;
      p.y += p.speedY;
      p.alpha += p.alphaDir * 0.001;

      if (p.alpha >= this.maxAlpha) p.alphaDir = -1;
      if (p.alpha <= 0.02) p.alphaDir = 1;

      // Wrap around edges
      if (p.x < 0) p.x = this.ctx.canvas.width;
      if (p.x > this.ctx.canvas.width) p.x = 0;
      if (p.y < 0) p.y = this.ctx.canvas.height;
      if (p.y > this.ctx.canvas.height) p.y = 0;

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${this.color}, ${p.alpha})`;
      this.ctx.fill();
    }

    requestAnimationFrame(() => this.animate());
  }
}
```

### Recipe: Aurora Wave (CSS)

```css
.aurora-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.aurora-bg::before,
.aurora-bg::after {
  content: '';
  position: absolute;
  width: 150%;
  height: 150%;
  top: -25%;
  left: -25%;
  border-radius: 40%;
  animation: auroraRotate 20s linear infinite;
}

.aurora-bg::before {
  background: radial-gradient(
    ellipse at 30% 50%,
    oklch(0.45 0.15 270 / 0.12) 0%,
    transparent 60%
  );
}

.aurora-bg::after {
  background: radial-gradient(
    ellipse at 70% 50%,
    oklch(0.40 0.12 200 / 0.08) 0%,
    transparent 60%
  );
  animation-duration: 25s;
  animation-direction: reverse;
}

@keyframes auroraRotate {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
```

### Recipe: Glitch Text (CSS)

```css
.glitch-text {
  position: relative;
  font-weight: 700;
}

.glitch-text::before,
.glitch-text::after {
  content: attr(data-text);
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.glitch-text::before {
  color: #ff006a;
  animation: glitch1 2s infinite linear alternate-reverse;
  clip-path: inset(20% 0 60% 0);
}

.glitch-text::after {
  color: #00e5ff;
  animation: glitch2 2s infinite linear alternate-reverse;
  clip-path: inset(60% 0 10% 0);
}

@keyframes glitch1 {
  0%   { transform: translate(0); }
  20%  { transform: translate(-3px, 2px); }
  40%  { transform: translate(3px, -1px); }
  60%  { transform: translate(-2px, 1px); }
  80%  { transform: translate(1px, -2px); }
  100% { transform: translate(0); }
}

@keyframes glitch2 {
  0%   { transform: translate(0); }
  20%  { transform: translate(3px, -2px); }
  40%  { transform: translate(-3px, 1px); }
  60%  { transform: translate(2px, 2px); }
  80%  { transform: translate(-1px, -1px); }
  100% { transform: translate(0); }
}
```

### Recipe: Tab Underline Slider

```javascript
// Animated underline that slides between tabs
function TabSlider({ tabs, activeIndex }) {
  const tabRefs = useRef([]);
  const [underline, setUnderline] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const tab = tabRefs.current[activeIndex];
    if (tab) {
      setUnderline({
        left: tab.offsetLeft,
        width: tab.offsetWidth,
      });
    }
  }, [activeIndex]);

  return (
    <div className="relative flex">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={el => tabRefs.current[i] = el}
          onClick={() => setActive(i)}
          className={activeIndex === i ? 'text-white' : 'text-zinc-400'}
        >
          {tab.icon} {tab.label}
          {tab.badge > 0 && <span className="badge">{tab.badge}</span>}
        </button>
      ))}
      {/* Sliding underline */}
      <div
        className="absolute bottom-0 h-[2px] bg-accent rounded-full
                   transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ left: underline.left, width: underline.width }}
      />
    </div>
  );
}
```

### Recipe: Validation Shake

```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
}

.input-error {
  animation: shake 400ms ease-in-out;
  border-color: var(--danger) !important;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.15);
}
```

### Recipe: Number Counter Animation

```javascript
function AnimatedNumber({ value, duration = 1000 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    const start = display;
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (value - start) * eased));

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }, [value]);

  return <span>{display.toLocaleString()}</span>;
}
```

### Recipe: Card Tilt on Mouse

```javascript
function TiltCard({ children }) {
  const ref = useRef(null);

  const handleMouseMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    ref.current.style.transform =
      `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
  };

  const handleMouseLeave = () => {
    ref.current.style.transform = 'perspective(600px) rotateY(0) rotateX(0)';
    ref.current.style.transition = 'transform 400ms ease-out';
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transition: 'transform 50ms linear', willChange: 'transform' }}
    >
      {children}
    </div>
  );
}
```

---

## PART 7: QUALITY CHECKLIST PER TEMPLATE

Before any template ships, it must pass ALL of these:

### Visual
- [ ] Unique color palette (not shared with any other tier)
- [ ] Unique font pairing (not shared with any other tier)
- [ ] Ambient animation running on every route
- [ ] Cursor border box follows mouse between elements
- [ ] All buttons have hover + active states
- [ ] All inputs have focus ring + error shake + success flash
- [ ] Dark mode looks intentional (not just inverted light)
- [ ] No default browser styles visible anywhere (no blue links, no default buttons)

### Animation
- [ ] Page transitions between all views (no instant swaps)
- [ ] Scroll-triggered reveal on first viewport entry
- [ ] Loading states are skeletons (no spinners except inline button actions)
- [ ] At least one text animation (title reveal, counter, or label transition)
- [ ] At least one micro-interaction per page (not counting hover states)

### Responsive
- [ ] Works beautifully at 375px (iPhone SE)
- [ ] Works at 768px (iPad)
- [ ] Works at 1440px (desktop)
- [ ] Works at 1920px+ (large desktop — content doesn't stretch)
- [ ] Sidebar becomes bottom sheet or drawer on mobile
- [ ] Touch targets ≥ 44px on mobile
- [ ] No horizontal scroll at any viewport

### Performance
- [ ] First Contentful Paint < 1.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Cumulative Layout Shift = 0
- [ ] All animations run at 60fps (no jank during scroll or transition)
- [ ] Bundle size < 100KB first-load JS (per route)

### Code
- [ ] TypeScript strict mode, zero errors
- [ ] No console.log in production
- [ ] No unused imports or dead code
- [ ] Component files < 200 lines (extract if larger)
- [ ] All colors use CSS variables (no hardcoded hex in components)
- [ ] All spacing uses the 4px grid (no arbitrary values)
