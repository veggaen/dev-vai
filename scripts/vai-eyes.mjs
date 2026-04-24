#!/usr/bin/env node
/**
 * VaiEyes — Visual Navigation Module
 *
 * Gives Vai the ability to SEE the screen through screenshots,
 * FIND elements by scanning the DOM for bounding boxes,
 * and NAVIGATE using only real mouse/keyboard — no JS shortcuts.
 *
 * Two modes:
 *   SIGHTED: Uses window.__vai_gym, window.__vai_cursor (current behavior)
 *   BLIND:   Uses ONLY page.mouse, page.keyboard + screenshots for verification
 *
 * The BLIND mode is the training mode. Vai must learn to:
 *   1. Take a screenshot to see the current state
 *   2. Scan the DOM for element positions (simulating visual recognition)
 *   3. Move the REAL mouse to the element
 *   4. Click/type using REAL browser events
 *   5. Take another screenshot to verify the action worked
 *
 * Usage:
 *   import { VaiEyes } from './vai-eyes.mjs';
 *   const eyes = new VaiEyes(page, { blind: true, screenshotDir: '...' });
 *   await eyes.see();                    // Take screenshot
 *   await eyes.findElement('Submit');     // Find button by text
 *   await eyes.moveTo(x, y);             // Move real mouse
 *   await eyes.click(x, y);              // Real click
 *   await eyes.typeText('hello');         // Real keyboard input
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class VaiEyes {
  /** @type {import('puppeteer').Page} */
  #page;
  #blind;
  #screenshotDir;
  #shotCount = 0;
  #actionLog = [];
  #lastScreenshot = null;
  #elementCache = null;   // cached element scan
  #moveSpeed = 8;         // pixels per step for smooth mouse movement
  #verbose;
  #recording = null;      // active screencast recorder

  /**
   * @param {import('puppeteer').Page} page
   * @param {{ blind?: boolean, screenshotDir?: string, verbose?: boolean }} opts
   */
  constructor(page, opts = {}) {
    this.#page = page;
    this.#blind = opts.blind ?? true; // Default to blind (training mode)
    this.#screenshotDir = opts.screenshotDir || './screenshots/vai-gym/visual-training';
    this.#verbose = opts.verbose ?? true;
  }

  get blind() { return this.#blind; }
  set blind(v) { this.#blind = v; }
  get actionLog() { return [...this.#actionLog]; }
  get lastScreenshot() { return this.#lastScreenshot; }

  // ═══════════════════════════════════════════════════════════
  // SEEING — Screenshots + Element Discovery
  // ═══════════════════════════════════════════════════════════

  /** Take a screenshot — Vai "looks" at the screen */
  async see(label = 'look') {
    await mkdir(this.#screenshotDir, { recursive: true });
    this.#shotCount++;
    const name = `${String(this.#shotCount).padStart(3, '0')}-${label}.png`;
    const path = join(this.#screenshotDir, name);
    await this.#page.screenshot({ path, fullPage: false });
    this.#lastScreenshot = path;
    this.#log('see', `Screenshot: ${name}`);
    return { path, number: this.#shotCount };
  }

  /** Scan the screen — find ALL visible elements with bounding boxes
   *  This simulates "visual recognition" — Vai looks at the page and
   *  identifies every interactive element and its position */
  async scan() {
    const elements = await this.#page.evaluate(() => {
      const results = [];
      const addEl = (el, type) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        if (rect.right < 0 || rect.left > window.innerWidth) return;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return;

        // ── Visual appearance ──
        const bgColor = style.backgroundColor;
        const borderColor = style.borderColor;
        const color = style.color;
        const fontSize = parseFloat(style.fontSize);
        const borderRadius = parseFloat(style.borderRadius);
        const hasVisibleBorder = style.borderWidth !== '0px' && borderColor !== 'transparent';
        const opacity = parseFloat(style.opacity);

        // ── Affordance detection — WHAT does this element DO? ──
        const tag = el.tagName.toLowerCase();
        let affordance = 'unknown';
        let subType = '';
        if (tag === 'button') { affordance = 'clickable'; subType = 'button'; }
        else if (tag === 'a') { affordance = 'clickable'; subType = 'link'; }
        else if (tag === 'select') {
          affordance = 'openable';
          subType = 'dropdown';
          // Capture dropdown options
          const opts = [...el.options].map(o => ({
            value: o.value,
            text: o.textContent?.trim() || '',
            selected: o.selected,
          }));
          results.push({
            type, affordance, subType, tag,
            text: (el.textContent || '').trim().substring(0, 100),
            placeholder: el.placeholder || '',
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            w: Math.round(rect.width), h: Math.round(rect.height),
            left: Math.round(rect.left), top: Math.round(rect.top),
            dataPanel: el.dataset?.panel || '',
            dataVaiGym: Object.keys(el.dataset || {}).filter(k => k.startsWith('vaiGym')),
            id: el.id || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            title: el.title || '',
            disabled: el.disabled || false,
            focused: document.activeElement === el,
            // Dropdown-specific
            options: opts,
            selectedValue: el.value,
            selectedText: el.options?.[el.selectedIndex]?.text || '',
            // Visual hints
            visual: { bgColor, borderColor, color, fontSize, borderRadius, hasVisibleBorder, opacity },
          });
          return; // Already pushed
        }
        else if (tag === 'textarea') { affordance = 'typeable'; subType = 'textarea'; }
        else if (tag === 'input') {
          affordance = 'typeable';
          subType = el.type || 'text';
          if (['checkbox', 'radio'].includes(el.type)) affordance = 'toggleable';
          if (['range'].includes(el.type)) affordance = 'slideable';
        }
        else if (el.getAttribute('role') === 'tab') { affordance = 'switchable'; subType = 'tab'; }
        else if (el.getAttribute('role') === 'button') { affordance = 'clickable'; subType = 'role-button'; }
        else if (el.tabIndex >= 0) { affordance = 'focusable'; subType = 'focusable'; }

        results.push({
          type, affordance, subType, tag,
          text: (el.textContent || '').trim().substring(0, 100),
          placeholder: el.placeholder || '',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          // Data attributes for identification
          dataPanel: el.dataset?.panel || '',
          dataVaiGym: Object.keys(el.dataset || {}).filter(k => k.startsWith('vaiGym')),
          id: el.id || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          title: el.title || '',
          disabled: el.disabled || false,
          focused: document.activeElement === el,
          // Visual hints
          visual: { bgColor, borderColor, color, fontSize, borderRadius, hasVisibleBorder, opacity },
        });
      };

      // Scan buttons
      document.querySelectorAll('button').forEach(el => addEl(el, 'button'));
      // Scan inputs and textareas
      document.querySelectorAll('input, textarea, select').forEach(el => addEl(el, 'input'));
      // Scan links
      document.querySelectorAll('a[href]').forEach(el => addEl(el, 'link'));
      // Scan clickable divs (with role or onClick)
      document.querySelectorAll('[role="button"], [role="tab"], [tabindex]').forEach(el => {
        if (el.tagName !== 'BUTTON' && el.tagName !== 'A') addEl(el, 'interactive');
      });

      // ── Scan custom VaiDropdown components ──
      // Each VaiDropdown has [data-vai-dropdown-trigger] and when open,
      // [data-vai-dropdown-panel] with [data-vai-dropdown-option] children.
      document.querySelectorAll('[data-vai-dropdown-trigger]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return;

        const ddName = el.getAttribute('data-vai-dropdown-trigger') || '';
        const currentText = el.getAttribute('data-vai-dropdown-text') || el.textContent?.trim() || '';
        const currentValue = el.getAttribute('data-vai-dropdown-value') || '';

        // Check if the dropdown panel is open — read options from DOM
        const container = el.closest('[data-vai-dropdown]');
        const panel = container?.querySelector('[data-vai-dropdown-panel]');
        const opts = [];
        if (panel) {
          panel.querySelectorAll('[data-vai-dropdown-option]').forEach(optEl => {
            const optRect = optEl.getBoundingClientRect();
            opts.push({
              value: optEl.getAttribute('data-vai-dropdown-option') || '',
              text: optEl.getAttribute('data-vai-dropdown-option-text') || optEl.textContent?.trim() || '',
              selected: optEl.getAttribute('data-vai-dropdown-option') === currentValue,
              x: Math.round(optRect.left + optRect.width / 2),
              y: Math.round(optRect.top + optRect.height / 2),
              w: Math.round(optRect.width),
              h: Math.round(optRect.height),
            });
          });
        } else {
          // Panel not open — try to read options from trigger's data
          // (We'll need to open it to see the real options)
        }

        results.push({
          type: 'input', affordance: 'openable', subType: 'dropdown', tag: 'button',
          text: currentText.substring(0, 100),
          placeholder: '',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width), h: Math.round(rect.height),
          left: Math.round(rect.left), top: Math.round(rect.top),
          dataPanel: '',
          dataVaiGym: [ddName ? `vaiDropdown-${ddName}` : 'vaiDropdown'],
          id: el.id || '',
          ariaLabel: el.getAttribute('aria-label') || ddName || '',
          title: el.title || '',
          disabled: el.disabled || false,
          focused: document.activeElement === el,
          options: opts,
          selectedValue: currentValue,
          selectedText: currentText,
          isCustomDropdown: true,
          dropdownOpen: !!panel,
          visual: {
            bgColor: style.backgroundColor,
            borderColor: style.borderColor,
            color: style.color,
            fontSize: parseFloat(style.fontSize),
            borderRadius: parseFloat(style.borderRadius),
            hasVisibleBorder: true,
            opacity: parseFloat(style.opacity),
          },
        });
      });

      return results;
    });

    this.#elementCache = elements;
    this.#log('scan', `Found ${elements.length} elements`);
    return elements;
  }

  /** Find a specific element by matching text, placeholder, data attributes, etc.
   *  Returns the best match with coordinates, or null */
  async findElement(query, opts = {}) {
    const elements = this.#elementCache || await this.scan();
    const q = query.toLowerCase();
    const typeFilter = opts.type || null;

    // Score each element
    const scored = elements
      .filter(el => !typeFilter || el.type === typeFilter)
      .filter(el => !el.disabled || opts.includeDisabled)
      .map(el => {
        let score = 0;
        const text = el.text.toLowerCase();
        const placeholder = el.placeholder.toLowerCase();
        const dataPanel = el.dataPanel.toLowerCase();
        const ariaLabel = el.ariaLabel.toLowerCase();
        const title = el.title.toLowerCase();
        const id = el.id.toLowerCase();

        // Exact text match = highest score
        if (text === q) score += 100;
        else if (text.includes(q)) score += 60;
        // Word boundary match (handles multi-word queries like "scenario bank")
        const qWords = q.split(/\s+/);
        if (qWords.length > 1 && qWords.every(w => text.includes(w))) score += 55;
        // Placeholder match
        if (placeholder.includes(q)) score += 50;
        // Data attribute match
        if (dataPanel === q) score += 90;
        if (el.dataVaiGym.some(d => d.toLowerCase().includes(q))) score += 85;
        // Also check if any data-vai-gym attribute words overlap
        if (el.dataVaiGym.length > 0) {
          const dvg = el.dataVaiGym.join(' ').toLowerCase();
          if (dvg.includes(q)) score += 80;
        }
        // Aria/title match
        if (ariaLabel.includes(q)) score += 70;
        if (title.includes(q)) score += 65;
        // ID match
        if (id.includes(q)) score += 80;

        return { ...el, score };
      })
      .filter(el => el.score > 0)
      .sort((a, b) => b.score - a.score);

    const match = scored[0] || null;
    if (match) {
      this.#log('find', `Found "${query}" → ${match.type} at (${match.x}, ${match.y}) [${match.text.substring(0, 40)}]`);
    } else {
      this.#log('find', `"${query}" NOT FOUND`);
    }
    return match;
  }

  /** Find the textarea (Vai's response area) */
  async findTextarea() {
    const elements = this.#elementCache || await this.scan();
    const textarea = elements.find(el =>
      el.tag === 'textarea' ||
      el.dataVaiGym.some(d => d.includes('Textarea') || d.includes('textarea'))
    );
    if (textarea) {
      this.#log('find', `Textarea at (${textarea.x}, ${textarea.y}) ${textarea.w}×${textarea.h}`);
    } else {
      this.#log('find', 'Textarea NOT FOUND');
    }
    return textarea;
  }

  /** Find submit button */
  async findSubmitButton() {
    return this.findElement('submit', { type: 'button' }) ||
           this.findElement('send', { type: 'button' }) ||
           this.findElement('grading', { type: 'button' });
  }

  // ═══════════════════════════════════════════════════════════
  // LOOKING — Scene Understanding (Visual Cognition)
  // ═══════════════════════════════════════════════════════════
  //
  // scan()  → raw element list (metadata)
  // look()  → structured scene: WHAT is here, what can I DO, what should I notice?
  //
  // A human looks at a screen and immediately understands:
  //   "There's a dropdown with options, a button I can click,
  //    a text area where I can type, and tabs I can switch."
  //
  // Vai needs to build that same understanding.

  /** Look at the screen — build a structured understanding of what's visible
   *  Returns a "scene" object that describes the page like a human would */
  async look() {
    const elements = await this.scan();
    await this.see('look');

    // Classify everything by what it DOES (affordance), not what it IS (tag)
    const scene = {
      dropdowns: [],    // Things I can OPEN to see options
      buttons: [],      // Things I can CLICK to trigger actions
      textInputs: [],   // Things I can TYPE into
      tabs: [],         // Things I can SWITCH between
      toggles: [],      // Things I can turn ON/OFF
      readOnly: [],     // Things that are just showing information
      layout: { width: 0, height: 0, sections: [] },
    };

    for (const el of elements) {
      // Dropdowns — have options inside, afford "opening"
      if (el.subType === 'dropdown' || el.tag === 'select') {
        scene.dropdowns.push({
          label: el.text || el.ariaLabel || el.placeholder || '(unlabeled)',
          position: { x: el.x, y: el.y, w: el.w, h: el.h },
          options: el.options || [],
          currentValue: el.selectedText || el.selectedValue || '',
          element: el,
        });
      }
      // Buttons — primary actions, secondary actions
      else if (el.affordance === 'clickable' && el.subType === 'button') {
        const isPrimary = el.visual?.bgColor?.includes('99, 102, 241') || // indigo-600
                          el.visual?.bgColor?.includes('79, 70, 229');    // indigo-700
        scene.buttons.push({
          label: el.text || el.ariaLabel || '(icon button)',
          position: { x: el.x, y: el.y, w: el.w, h: el.h },
          isPrimary,
          disabled: el.disabled,
          element: el,
        });
      }
      // Text inputs — textareas and text fields
      else if (el.affordance === 'typeable') {
        scene.textInputs.push({
          label: el.placeholder || el.ariaLabel || '(text input)',
          position: { x: el.x, y: el.y, w: el.w, h: el.h },
          isTextarea: el.tag === 'textarea',
          element: el,
        });
      }
      // Tabs — switchable navigation items
      else if (el.affordance === 'switchable' || el.subType === 'tab') {
        scene.tabs.push({
          label: el.text || el.ariaLabel || '(tab)',
          position: { x: el.x, y: el.y },
          element: el,
        });
      }
      // Toggles
      else if (el.affordance === 'toggleable') {
        scene.toggles.push({ label: el.text || el.ariaLabel, element: el });
      }
    }

    // Layout — get viewport size and identify major sections
    // Look for visual patterns: bordered containers with title text = "cards"
    scene.layout = await this.#page.evaluate(() => {
      const sections = [];
      // Strategy 1: Find containers that look like cards (bordered, padded, with a heading)
      document.querySelectorAll('div').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 60) return;
        if (rect.top < 0 || rect.top > window.innerHeight) return;
        const style = getComputedStyle(el);
        const hasBorder = style.borderWidth !== '0px' && style.borderStyle !== 'none';
        const hasRounding = parseFloat(style.borderRadius) > 4;
        const hasPadding = parseFloat(style.padding) > 8 || parseFloat(style.paddingLeft) > 8;
        // A "card" is a bordered, rounded container with padding
        if (hasBorder && hasRounding && hasPadding) {
          // Find the title — first bold/uppercase text child
          let title = '';
          const firstChild = el.children[0];
          if (firstChild) {
            const childStyle = getComputedStyle(firstChild);
            if (childStyle.fontWeight >= 600 || childStyle.textTransform === 'uppercase') {
              title = firstChild.textContent?.trim()?.substring(0, 60) || '';
            }
          }
          if (!title) {
            // Try h1-h4
            const heading = el.querySelector('h1, h2, h3, h4');
            if (heading) title = heading.textContent?.trim()?.substring(0, 60) || '';
          }
          sections.push({
            title: title || '(untitled card)',
            x: Math.round(rect.left), y: Math.round(rect.top),
            w: Math.round(rect.width), h: Math.round(rect.height),
          });
        }
      });
      // Strategy 2: Also look for explicit semantic elements
      document.querySelectorAll('section, [role="region"], nav').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 30) return;
        const heading = el.querySelector('h1, h2, h3, h4, [class*="title"]');
        sections.push({
          title: heading?.textContent?.trim()?.substring(0, 60) || el.getAttribute('aria-label') || '(section)',
          x: Math.round(rect.left), y: Math.round(rect.top),
          w: Math.round(rect.width), h: Math.round(rect.height),
        });
      });
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        sections,
      };
    });

    // Narrate — Vai describes what it sees, like a human would
    const narration = this.#narrateScene(scene);
    this.#log('look', narration);

    return scene;
  }

  /** Internal: generate human-readable narration of the scene */
  #narrateScene(scene) {
    const parts = [];
    if (scene.dropdowns.length > 0) {
      parts.push(`${scene.dropdowns.length} dropdown${scene.dropdowns.length > 1 ? 's' : ''}: ${
        scene.dropdowns.map(d => `"${d.currentValue || d.label}"`).join(', ')
      }`);
    }
    if (scene.buttons.length > 0) {
      const primary = scene.buttons.filter(b => b.isPrimary);
      const secondary = scene.buttons.filter(b => !b.isPrimary);
      if (primary.length) parts.push(`${primary.length} primary button${primary.length > 1 ? 's' : ''}: ${primary.map(b => `"${b.label.substring(0, 30)}"`).join(', ')}`);
      if (secondary.length) parts.push(`${secondary.length} secondary button${secondary.length > 1 ? 's' : ''}`);
    }
    if (scene.textInputs.length > 0) {
      parts.push(`${scene.textInputs.length} text input${scene.textInputs.length > 1 ? 's' : ''}: ${
        scene.textInputs.map(t => t.isTextarea ? 'textarea' : `"${t.label.substring(0, 25)}"`).join(', ')
      }`);
    }
    if (scene.tabs.length > 0) {
      parts.push(`${scene.tabs.length} tab${scene.tabs.length > 1 ? 's' : ''}: ${scene.tabs.map(t => `"${t.label}"`).join(', ')}`);
    }
    if (scene.layout.sections.length > 0) {
      parts.push(`${scene.layout.sections.length} section${scene.layout.sections.length > 1 ? 's' : ''}`);
    }
    return `I see: ${parts.join(' · ')}`;
  }

  // ═══════════════════════════════════════════════════════════
  // DROPDOWN INTERACTION — Open, read, select
  // ═══════════════════════════════════════════════════════════

  /** Find all dropdowns currently visible */
  async findDropdowns() {
    const elements = this.#elementCache || await this.scan();
    return elements.filter(el => el.subType === 'dropdown' || el.tag === 'select');
  }

  /** Open a dropdown, read its options, and optionally select one.
   *  Now works with CUSTOM VaiDropdown components using MOUSE HOVER.
   *  Vai moves mouse to each option, sees the hover effect, then clicks.
   *  @param {string} query — search text to find the dropdown
   *  @param {string|number} [selectOption] — option text or index to select
   *  @returns {{ found, options, selected }} */
  async openDropdown(query, selectOption) {
    await this.scan();
    const dropdowns = await this.findDropdowns();
    const q = query.toLowerCase();

    // Find matching dropdown
    const match = dropdowns.find(d => {
      const text = (d.text || '').toLowerCase();
      const label = (d.selectedText || '').toLowerCase();
      const dvaig = (d.dataVaiGym || []).join(' ').toLowerCase();
      return text.includes(q) || label.includes(q) || dvaig.includes(q) ||
             (d.options || []).some(o => o.text.toLowerCase().includes(q));
    });

    if (!match) {
      this.#log('find', `Dropdown "${query}" NOT FOUND (${dropdowns.length} dropdowns visible)`);
      return { found: false, options: [], selected: null };
    }

    // Move cursor to dropdown trigger and show hover
    await this.hover(match.x, match.y);
    await this.see(`dropdown-${q.replace(/\s+/g, '-')}-hover`);

    // Click the dropdown trigger to open it
    await this.click(match.x, match.y);
    await this.#sleep(350);

    // ── CUSTOM VaiDropdown: options are now DOM elements we can hover! ──
    // Re-scan to pick up the newly-rendered option panel
    this.#elementCache = null;
    // Get the dropdown ID for scoping option search
    const ddId = (match.dataVaiGym || []).find(s => s.startsWith('vaiDropdown-'))?.replace('vaiDropdown-', '') || '';

    const panelOptions = await this.#page.evaluate((scopeId) => {
      const opts = [];
      // Scope to the specific dropdown's panel, or fall back to all options
      let selector = '[data-vai-dropdown-option]';
      if (scopeId) {
        const panel = document.querySelector(`[data-vai-dropdown-panel="${scopeId}"]`);
        if (panel) {
          panel.querySelectorAll('[data-vai-dropdown-option]').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            opts.push({
              value: el.getAttribute('data-vai-dropdown-option') || '',
              text: el.getAttribute('data-vai-dropdown-option-text') || el.textContent?.trim() || '',
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
            });
          });
          return opts;
        }
      }
      // Fallback: get all visible dropdown options
      document.querySelectorAll(selector).forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        opts.push({
          value: el.getAttribute('data-vai-dropdown-option') || '',
          text: el.getAttribute('data-vai-dropdown-option-text') || el.textContent?.trim() || '',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      });
      return opts;
    }, ddId);

    // If we got DOM options (custom dropdown), use mouse hover + click
    if (panelOptions.length > 0) {
      await this.see(`dropdown-${q.replace(/\s+/g, '-')}-open`);
      this.#log('look', `Dropdown "${match.selectedText || match.text}" opened — ${panelOptions.length} options visible in DOM`);
      for (const opt of panelOptions.slice(0, 8)) {
        this.#log('look', `  ▸ "${opt.text}" at (${opt.x}, ${opt.y})`);
      }

      let selected = null;
      if (selectOption !== undefined) {
        // Find target option
        if (typeof selectOption === 'number') {
          selected = panelOptions[selectOption] || null;
        } else {
          const sq = String(selectOption).toLowerCase();
          selected = panelOptions.find(o =>
            o.text.toLowerCase().includes(sq) ||
            o.value.toLowerCase().includes(sq) ||
            o.value.toLowerCase() === sq
          ) || null;
        }

        if (selected) {
          // ═══ MOUSE HOVER THROUGH OPTIONS ═══
          // Vai moves the mouse through each option, pausing to see hover effects,
          // then clicks the target. This is how a human uses a dropdown.
          const targetIdx = panelOptions.findIndex(o => o.value === selected.value);
          this.#log('look', `Target: "${selected.text}" (idx ${targetIdx})`);

          for (let i = 0; i <= Math.min(targetIdx, panelOptions.length - 1); i++) {
            const opt = panelOptions[i];

            // Scroll this option into view within the dropdown panel &
            // re-read its LIVE bounding rect (it may have shifted from scrolling)
            const liveRect = await this.#page.evaluate((val) => {
              const el = document.querySelector(`[data-vai-dropdown-option="${val}"]`);
              if (!el) return null;
              el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }, opt.value);
            const cx = liveRect?.x ?? opt.x;
            const cy = liveRect?.y ?? opt.y;

            // Move mouse to this option — triggers CSS hover effect
            await this.moveTo(cx, cy);
            // Show visual hover on overlay too
            await this.#page.evaluate((hx, hy) => {
              try { window.__vai_cursor?.hover?.(hx, hy); } catch {}
            }, cx, cy);
            this.#log('look', `  🖱️ Hovering option ${i}: "${opt.text}"`);
            await this.#sleep(150); // Pause to see the hover effect

            // Screenshot key moments (first, target, every 3rd)
            if (i === 0 || i === targetIdx || i % 3 === 0) {
              await this.see(`dropdown-${q.replace(/\s+/g, '-')}-hover-opt${i}`);
            }
          }

          // Click the target option — re-read LIVE coordinates in case panel scrolled
          const liveTarget = await this.#page.evaluate((val) => {
            const el = document.querySelector(`[data-vai-dropdown-option="${val}"]`);
            if (!el) return null;
            el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          }, selected.value);
          const clickX = liveTarget?.x ?? selected.x;
          const clickY = liveTarget?.y ?? selected.y;
          await this.click(clickX, clickY);
          await this.#sleep(300);
          this.#log('click', `Selected "${selected.text}" from dropdown via MOUSE CLICK`);
          await this.see(`dropdown-${q.replace(/\s+/g, '-')}-selected`);
        } else {
          this.#log('find', `Option "${selectOption}" NOT FOUND in dropdown options`);
          // Close dropdown by clicking elsewhere
          await this.click(10, 10);
          await this.#sleep(200);
        }
      }

      return {
        found: true,
        options: panelOptions.map(o => ({ value: o.value, text: o.text, selected: false })),
        selected: selected ? { value: selected.value, text: selected.text } : null,
      };
    }

    // ── FALLBACK: native <select> (arrow key navigation) ──
    // Keep old behavior for any native selects still in the app
    const options = match.options || [];
    await this.see(`dropdown-${q.replace(/\s+/g, '-')}-open`);
    this.#log('look', `Dropdown "${match.selectedText || match.text}" has ${options.length} native options: ${
      options.slice(0, 5).map(o => `"${o.text}"`).join(', ')}${options.length > 5 ? '...' : ''}`);

    let selected = null;
    if (selectOption !== undefined) {
      if (typeof selectOption === 'number') {
        selected = options[selectOption] || null;
      } else {
        const sq = String(selectOption).toLowerCase();
        selected = options.find(o =>
          o.text.toLowerCase().includes(sq) ||
          o.value?.toLowerCase().includes(sq) ||
          o.value?.toLowerCase() === sq
        ) || null;
      }

      if (selected) {
        await this.click(match.x, match.y);
        await this.#sleep(200);
        const targetIdx = options.findIndex(o => o.value === selected.value);
        const currentIdx = await this.#page.evaluate((x, y) => {
          const el = document.elementFromPoint(x, y);
          const select = el?.closest('select') || el;
          return select?.selectedIndex ?? 0;
        }, match.x, match.y);
        const direction = targetIdx >= currentIdx ? 'ArrowDown' : 'ArrowUp';
        const stepsNeeded = Math.abs(targetIdx - currentIdx);
        for (let step = 0; step < stepsNeeded; step++) {
          await this.#page.keyboard.press(direction);
          await this.#sleep(120);
        }
        await this.#page.keyboard.press('Enter');
        await this.#sleep(200);
        this.#log('click', `Selected "${selected.text}" from native dropdown (${stepsNeeded} arrow steps)`);
        await this.see(`dropdown-${q.replace(/\s+/g, '-')}-selected`);
      } else {
        this.#log('find', `Option "${selectOption}" NOT FOUND in dropdown`);
      }
    }

    return { found: true, options, selected };
  }

  /** Explore a dropdown — open it, read all options, take screenshots, close it */
  async exploreDropdown(query) {
    const result = await this.openDropdown(query);
    if (result.found) {
      // Click elsewhere to close the dropdown
      await this.click(10, 10);
      await this.#sleep(200);
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // HOVER — Show Vai investigating an element visually
  // ═══════════════════════════════════════════════════════════

  /** Hover over an element — shows the hover glow ring */
  async hover(x, y) {
    await this.moveTo(x, y);
    await this.#page.evaluate((cx, cy) => {
      try { window.__vai_cursor?.hover?.(cx, cy); } catch {}
    }, x, y);
    this.#log('move', `Hover @ (${Math.round(x)}, ${Math.round(y)})`);
    await this.#sleep(400); // Hold hover so it's visible
  }

  /** Hover over an element found by text — shows Vai examining it */
  async hoverElement(query) {
    const el = await this.findElement(query);
    if (!el) {
      this.#log('find', `Cannot hover "${query}" — not found`);
      return null;
    }
    await this.hover(el.x, el.y);
    return el;
  }

  // ═══════════════════════════════════════════════════════════
  // MOVING — Real mouse movement with smooth interpolation
  // ═══════════════════════════════════════════════════════════

  /** Move mouse smoothly to coordinates — Vai learns spatial awareness */
  async moveTo(x, y) {
    if (this.#blind) {
      // BLIND MODE: real mouse + visual cursor overlay synced together
      // VaiCursor.tsx has its OWN eased animation (cubic lerp, 200-600ms).
      // So we tell the visual cursor the target and let IT animate smoothly,
      // while we move the real mouse in quick steps for accurate targeting.

      // 1. Read current position BEFORE telling the visual cursor to move
      const current = await this.#page.evaluate(() => {
        try {
          const state = window.__vai_cursor?.getState?.();
          return { x: state?.cursor?.x || 0, y: state?.cursor?.y || 0 };
        } catch { return { x: 0, y: 0 }; }
      });
      const dx = x - current.x;
      const dy = y - current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 2. Tell the visual cursor where we're going (it animates internally)
      await this.#page.evaluate((cx, cy) => {
        try { window.__vai_cursor?.moveTo?.(cx, cy); } catch {}
      }, x, y);

      // 3. Move real mouse in steps that MATCH the visual cursor duration
      //    VaiCursor.tsx uses: duration = Math.min(600, Math.max(200, distance * 1.5))
      //    We spread our mouse steps across that same duration so they arrive together.
      const visualDuration = Math.min(600, Math.max(200, dist * 1.5));
      const steps = Math.max(5, Math.min(20, Math.floor(dist / 30)));
      const stepDelay = Math.max(8, Math.floor(visualDuration / steps));

      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // Match VaiCursor's easedCubic: ease-in-out cubic
        const ease = t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2;
        await this.#page.mouse.move(
          Math.round(current.x + dx * ease),
          Math.round(current.y + dy * ease),
        );
        // Pace mouse steps to match visual cursor animation
        if (i < steps) await this.#sleep(stepDelay);
      }
      // Final precise position
      await this.#page.mouse.move(x, y);

      // 4. Wait for the visual cursor animation to fully complete
      //    Add a small buffer (80ms) for rAF timing jitter
      const remaining = Math.max(0, visualDuration - (steps * stepDelay)) + 80;
      if (remaining > 0) await this.#sleep(remaining);

      // 5. Verify visual cursor arrived (retry if still animating)
      const arrived = await this.#page.evaluate((tx, ty) => {
        try {
          const state = window.__vai_cursor?.getState?.();
          const cx = state?.cursor?.x || 0;
          const cy = state?.cursor?.y || 0;
          return Math.hypot(tx - cx, ty - cy) < 8;
        } catch { return true; } // assume arrived on error
      }, x, y);
      if (!arrived) {
        // Visual cursor still catching up — wait a bit more
        await this.#sleep(120);
      }
    } else {
      // SIGHTED MODE: use the cursor helper (also moves real mouse for clicks)
      await this.#page.evaluate((x, y) => {
        try { window.__vai_cursor?.moveTo?.(x, y); } catch {}
      }, x, y);
    }
    this.#log('move', `→ (${Math.round(x)}, ${Math.round(y)})`);
    await this.#sleep(30);
  }

  /** Move to an element found by text/query */
  async moveToElement(query) {
    const el = await this.findElement(query);
    if (!el) return null;
    await this.moveTo(el.x, el.y);
    return el;
  }

  // ═══════════════════════════════════════════════════════════
  // CLICKING — Real mouse clicks
  // ═══════════════════════════════════════════════════════════

  /** Click at coordinates — RULE: cursor must be hovering before click */
  async click(x, y) {
    // Move cursor to target — Vai can't click unless mouse is over the element
    await this.moveTo(x, y);

    // Verify cursor actually arrived (within 8px of target)
    if (this.#blind) {
      const delta = await this.#page.evaluate((tx, ty) => {
        try {
          const s = window.__vai_cursor?.getState?.();
          return Math.hypot(tx - (s?.cursor?.x || 0), ty - (s?.cursor?.y || 0));
        } catch { return 0; }
      }, x, y);
      if (delta > 8) {
        this.#log('click', `⚠ Cursor not at target (${Math.round(delta)}px off) — waiting...`);
        await this.#sleep(150);
      }
    }

    // Trigger visual click animation on overlay
    await this.#page.evaluate((cx, cy) => {
      try { window.__vai_cursor?.click?.(cx, cy); } catch {}
    }, x, y);
    // Also fire real mouse click (actual DOM interaction)
    await this.#page.mouse.click(x, y);
    this.#log('click', `@ (${Math.round(x)}, ${Math.round(y)})`);
    this.#elementCache = null; // Invalidate — page state changed
    await this.#sleep(200);
  }

  /** Click an element found by text/query */
  async clickElement(query) {
    const el = await this.findElement(query);
    if (!el) {
      this.#log('click', `MISS — "${query}" not found`);
      return false;
    }
    await this.click(el.x, el.y);
    return true;
  }

  /** Click a panel in the activity rail */
  async clickPanel(panelId) {
    // Scan fresh — panels might have changed state
    await this.scan();
    const el = await this.findElement(panelId);
    if (!el) {
      this.#log('click', `Panel "${panelId}" not found`);
      return false;
    }
    await this.click(el.x, el.y);
    await this.#sleep(300); // Wait for panel transition
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // TYPING — Real keyboard input
  // ═══════════════════════════════════════════════════════════

  /** Type text using real keyboard
   *  In blind mode: click textarea, clear it, type char by char
   *  In sighted mode: use store.setResponse() shortcut */
  async typeText(text, opts = {}) {
    const speed = opts.speed || 15; // ms per char (default fast for training)
    const maxChars = opts.maxChars || 800;
    const truncated = text.substring(0, maxChars);

    if (this.#blind) {
      // BLIND MODE: find textarea, click it, clear it, type for real
      const textarea = await this.findTextarea();
      if (!textarea) {
        this.#log('type', 'FAILED — no textarea found');
        return false;
      }

      // Move to textarea and click to focus
      await this.click(textarea.x, textarea.y);
      await this.#sleep(100);

      // Clear existing content
      await this.#page.keyboard.down('Control');
      await this.#page.keyboard.press('a');
      await this.#page.keyboard.up('Control');
      await this.#sleep(50);

      // Show virtual keyboard overlay before typing starts
      await this.#page.evaluate((cx, cy) => {
        try {
          window.__vai_cursor_store?.setState?.({
            cursor: { ...window.__vai_cursor_store.getState().cursor, x: cx, y: cy, visible: true, typing: true },
            kbVisible: true,
          });
        } catch {}
      }, textarea.x, textarea.y);

      // Type character by character with real keyboard events
      // AND sync each key press to the visual keyboard overlay
      for (const char of truncated) {
        // Highlight the key on the virtual keyboard
        await this.#page.evaluate((k) => {
          try { window.__vai_cursor_store?.setState?.({ kbActiveKey: k }); } catch {}
        }, char);
        // Fire the real keyboard event (React onChange picks this up)
        await this.#page.keyboard.type(char, { delay: speed });
      }

      // Hide virtual keyboard after typing
      await this.#page.evaluate(() => {
        try {
          window.__vai_cursor_store?.setState?.({
            kbActiveKey: null,
            kbVisible: false,
            cursor: { ...window.__vai_cursor_store.getState().cursor, typing: false },
          });
        } catch {}
      });

      // Verify what was typed
      const actual = await this.#page.evaluate(() => {
        const ta = document.querySelector('[data-vai-gym-textarea]');
        return ta?.value || '';
      });

      const match = actual.length > 0;
      this.#log('type', `${truncated.length} chars typed, ${actual.length} received (${match ? '✓' : '✗'})`);
      return match;
    } else {
      // SIGHTED MODE: use store shortcut
      await this.#page.evaluate((t) => {
        try { window.__vai_gym?.setResponse?.(t); } catch {}
      }, truncated);
      this.#log('type', `${truncated.length} chars via store`);
      return true;
    }
  }

  /** Press a specific key — shows on LiteKeyboard overlay */
  async pressKey(key) {
    // Show visual arrow key indicator for arrow keys
    const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key);
    if (isArrow) {
      await this.#page.evaluate((k) => {
        try { window.__vai_cursor?.arrowKey?.(k); } catch {}
      }, key);
    }
    // Show key on LiteKeyboard for ALL key presses
    await this.#page.evaluate((k) => {
      try { window.__vai_cursor?.pressKeys?.([k]); } catch {}
    }, key);
    await this.#page.keyboard.press(key);
    this.#log('key', key);
    await this.#sleep(isArrow ? 120 : 80); // Longer pause for arrows; 80ms for other keys so overlay is visible
  }

  /** Press key combination — shows all keys on LiteKeyboard with combo text */
  async pressCombo(...keys) {
    // Build human-readable combo text
    const comboText = keys.map(k => {
      if (k === 'Control') return 'Ctrl';
      if (k === 'Meta') return '⊞';
      if (k.startsWith('Arrow')) return k.replace('Arrow', '');
      return k.charAt(0).toUpperCase() + k.slice(1);
    }).join('+');

    // Show all keys on LiteKeyboard BEFORE pressing
    await this.#page.evaluate((ks, ct) => {
      try { window.__vai_cursor?.pressKeys?.(ks, ct); } catch {}
    }, keys, comboText);

    // Brief pause so the keyboard is visible before action
    await this.#sleep(150);

    for (const key of keys.slice(0, -1)) {
      await this.#page.keyboard.down(key);
    }
    await this.#page.keyboard.press(keys[keys.length - 1]);
    for (const key of keys.slice(0, -1).reverse()) {
      await this.#page.keyboard.up(key);
    }
    this.#log('key', `⌨ ${comboText}`);
    await this.#sleep(200); // Longer pause so combo display stays visible

    // Release keyboard visual
    await this.#page.evaluate(() => {
      try { window.__vai_cursor?.releaseKeys?.(); } catch {}
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SCROLLING — Real mouse wheel
  // ═══════════════════════════════════════════════════════════

  /** Scroll by delta — shows scroll indicator at current cursor position */
  async scroll(deltaY = 300) {
    // Show scroll indicator at mouse position
    const cursorState = await this.#page.evaluate(() => {
      try { return window.__vai_cursor?.getState?.(); } catch { return null; }
    });
    const sx = cursorState?.cursor?.x ?? 400;
    const sy = cursorState?.cursor?.y ?? 400;
    await this.#page.evaluate((dy, x, y) => {
      try { window.__vai_cursor?.showScroll?.(dy, x, y); } catch {}
    }, deltaY, sx, sy);

    if (this.#blind) {
      await this.#page.mouse.wheel({ deltaY });
    } else {
      await this.#page.evaluate((dy) => {
        try { window.__vai_cursor?.scroll?.(dy); } catch {}
      }, deltaY);
    }
    this.#log('scroll', `Δy=${deltaY} at (${Math.round(sx)}, ${Math.round(sy)})`);
    this.#elementCache = null; // Positions changed
    await this.#sleep(200); // Longer pause so scroll indicator is visible
  }

  // ═══════════════════════════════════════════════════════════
  // VERIFICATION — Screenshot + DOM state check
  // ═══════════════════════════════════════════════════════════

  /** Verify that an action succeeded by checking DOM state */
  async verify(check) {
    const result = await this.#page.evaluate(check);
    this.#log('verify', result ? '✓ PASS' : '✗ FAIL');
    return result;
  }

  /** Verify current panel is the expected one */
  async verifyPanel(expectedPanel) {
    const result = await this.#page.evaluate((expected) => {
      try {
        // Check if the panel button has active styling
        const btn = document.querySelector(`[data-panel="${expected}"]`);
        if (!btn) return false;
        return btn.classList.contains('bg-zinc-800') || btn.classList.contains('text-zinc-100');
      } catch { return false; }
    }, expectedPanel);
    this.#log('verify', `Panel "${expectedPanel}": ${result ? '✓' : '✗'}`);
    return result;
  }

  /** Verify text appears on screen */
  async verifyText(text) {
    const found = await this.#page.evaluate((t) => {
      return document.body.innerText.includes(t);
    }, text);
    this.#log('verify', `Text "${text.substring(0, 40)}": ${found ? '✓' : '✗'}`);
    return found;
  }

  /** Take a "before + after" screenshot pair around an action */
  async withVerification(label, action) {
    await this.see(`${label}-before`);
    const result = await action();
    await this.see(`${label}-after`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // RADIAL MENU — Open, browse, select tools
  // ═══════════════════════════════════════════════════════════

  /** Open the radial menu at a given position (or center screen)
   *  The radial menu has 6 categories accessible via keyboard shortcuts 1-6:
   *    1=Navigate, 2=Validate, 3=Edit, 4=Screenshot, 5=SubVai, 6=Tools
   *  Each category has 3-6 sub-tools. */
  async openRadialMenu(x, y) {
    if (!x || !y) {
      // Default to center of viewport
      const vp = await this.#page.evaluate(() => ({
        w: window.innerWidth, h: window.innerHeight,
      }));
      x = Math.round(vp.w / 2);
      y = Math.round(vp.h / 2);
    }
    await this.moveTo(x, y);
    // The radial menu opens via the cursor store's global API
    await this.#page.evaluate((cx, cy) => {
      try { window.__vai_cursor?.openRadialMenu?.(cx, cy); } catch {}
    }, x, y);
    this.#log('click', `Radial menu opened @ (${x}, ${y})`);
    await this.#sleep(400); // Wait for open animation
    await this.see('radial-menu-open');
    return true;
  }

  /** Close the radial menu */
  async closeRadialMenu() {
    await this.#page.evaluate(() => {
      try { window.__vai_cursor?.closeRadialMenu?.(); } catch {}
    });
    this.#log('click', 'Radial menu closed');
    await this.#sleep(200);
  }

  /** Select a tool from the radial menu by category + tool ID
   *  @param {number} categoryKey — keyboard key 1-6
   *  @param {string} toolId — sub-tool ID (e.g. 'scroll', 'focus', 'click')
   *  @returns {boolean} whether selection was made */
  async selectRadialTool(categoryKey, toolId) {
    // Categories by keyboard shortcut:
    // 1=Navigate (scroll, focus, find, tab)
    // 2=Validate (a11y, visual-diff, schema, lighthouse)
    // 3=Edit (click, type, form)
    // 4=Screenshot (capture, compare, record)
    // 5=SubVai (test, review, deps, security)
    // 6=Tools (deploy, console, files, perf, debug, settings)

    // Press the category key to select the category ring
    await this.pressKey(String(categoryKey));
    await this.#sleep(300);
    await this.see(`radial-cat-${categoryKey}`);

    // Now select the sub-tool by its ID
    if (toolId) {
      const selected = await this.#page.evaluate((id) => {
        try {
          window.__vai_cursor?.selectRadialItem?.(id);
          return true;
        } catch { return false; }
      }, toolId);
      this.#log('click', `Radial tool: category ${categoryKey} → "${toolId}" (${selected ? '✓' : '✗'})`);
      await this.#sleep(300);
      await this.see(`radial-tool-${toolId}`);
      return selected;
    }
    return true;
  }

  /** Browse all radial menu categories — open menu, cycle through each ring
   *  Returns a map of category → tools visible */
  async exploreRadialMenu() {
    await this.openRadialMenu();
    const categories = [
      { key: 1, name: 'Navigate', tools: ['scroll', 'focus', 'find', 'tab'] },
      { key: 2, name: 'Validate', tools: ['a11y', 'visual-diff', 'schema', 'lighthouse'] },
      { key: 3, name: 'Edit', tools: ['click', 'type', 'form'] },
      { key: 4, name: 'Screenshot', tools: ['capture', 'compare', 'record'] },
      { key: 5, name: 'SubVai', tools: ['test', 'review', 'deps', 'security'] },
      { key: 6, name: 'Tools', tools: ['deploy', 'console', 'files', 'perf', 'debug', 'settings'] },
    ];
    const explored = {};
    for (const cat of categories) {
      await this.pressKey(String(cat.key));
      await this.#sleep(350);
      this.#log('look', `Radial ${cat.key}: ${cat.name} — [${cat.tools.join(', ')}]`);
      explored[cat.name] = cat.tools;
      await this.see(`radial-explore-${cat.name.toLowerCase()}`);
    }
    // Close with Escape
    await this.pressKey('Escape');
    await this.#sleep(200);
    this.#log('click', 'Radial menu explored and closed');
    return explored;
  }

  // ═══════════════════════════════════════════════════════════
  // SCROLL DISCOVERY — Find elements by scrolling
  // ═══════════════════════════════════════════════════════════

  /** Scroll down to find an element matching the query
   *  Scans after each scroll. Returns the element if found, null if not.
   *  @param {string} query — text to search for
   *  @param {{ maxScrolls?: number, direction?: 'down'|'up', delta?: number }} opts */
  async scrollToFind(query, opts = {}) {
    const maxScrolls = opts.maxScrolls || 8;
    const direction = opts.direction || 'down';
    const delta = opts.delta || 400;
    const dy = direction === 'down' ? delta : -delta;

    for (let i = 0; i < maxScrolls; i++) {
      // Scan current viewport
      this.#elementCache = null;
      const el = await this.findElement(query);
      if (el) {
        this.#log('scroll', `Found "${query}" after ${i} scroll${i !== 1 ? 's' : ''}`);
        return el;
      }
      // Scroll
      await this.scroll(dy);
      await this.#sleep(300);
    }
    this.#log('scroll', `"${query}" not found after ${maxScrolls} scrolls`);
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // REVIEW READING — Parse the ReviewView after grading
  // ═══════════════════════════════════════════════════════════

  /** Read the ReviewView after submitting a response
   *  Returns score, feedback, strengths, improvements, antiPatterns */
  async readReview() {
    const review = await this.#page.evaluate(() => {
      // Try reading from the gym store first
      try {
        const state = window.__vai_gym?.getStore?.();
        if (state?.lastGrade) {
          return {
            score: state.lastGrade.overall ?? state.lastGrade.score ?? -1,
            breakdown: state.lastGrade.breakdown || {},
            feedback: state.lastGrade.feedback || '',
            strengths: state.lastGrade.strengths || [],
            improvements: state.lastGrade.improvements || [],
            antiPatterns: state.lastGrade.antiPatterns || [],
            hiddenNeed: state.lastGrade.hiddenNeed || '',
            fromStore: true,
          };
        }
      } catch {}

      // Fallback: read from the DOM
      const body = document.body.innerText;
      const scoreMatch = body.match(/(\d{1,3})\s*\/\s*100/) || body.match(/Score[:\s]*(\d{1,3})/i);
      return {
        score: scoreMatch ? parseInt(scoreMatch[1]) : -1,
        breakdown: {},
        feedback: body.substring(0, 500),
        strengths: [],
        improvements: [],
        antiPatterns: [],
        hiddenNeed: '',
        fromStore: false,
      };
    });
    this.#log('read', `Review — Score: ${review.score}, Strengths: ${review.strengths.length}, Improvements: ${review.improvements.length}`);
    return review;
  }

  // ═══════════════════════════════════════════════════════════
  // UI COMPREHENSION — Read text, discover layout, find scrollable areas
  // ═══════════════════════════════════════════════════════════

  /** Read ALL visible text on the page, organized by section/area.
   *  Returns structured text blocks with position, category, and content.
   *  Vai uses this to "understand" what's on screen without screenshots. */
  async readAllText() {
    const data = await this.#page.evaluate(() => {
      const blocks = [];
      const seen = new Set();

      // ── Section headers — detect by tag OR by computed visual style ──
      // Strategy: find h1-h6 tags, plus any element with bold/semibold font
      // and fontSize >= 13px that looks like a heading (not too long)
      const headingCandidates = new Set();
      
      // Standard h-tags
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => headingCandidates.add(el));
      
      // Class-based candidates
      document.querySelectorAll('[class*="title"], [class*="Title"], [class*="heading"], [class*="Heading"]').forEach(el => headingCandidates.add(el));
      
      // Font-weight based: scan visible elements with bold/semibold + decent size
      document.querySelectorAll('div, span, p, label').forEach(el => {
        const style = getComputedStyle(el);
        const fontWeight = parseInt(style.fontWeight) || 400;
        const fontSize = parseFloat(style.fontSize) || 0;
        // Bold (>=600) and sized like a heading (>=13px) and short text (likely a label/title)
        if (fontWeight >= 600 && fontSize >= 13) {
          const text = el.textContent?.trim();
          if (text && text.length >= 3 && text.length <= 80) {
            // Check it's not deeply nested inside another heading candidate
            headingCandidates.add(el);
          }
        }
      });

      headingCandidates.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const text = el.textContent?.trim();
        if (!text || text.length < 2 || seen.has(text)) return;
        // Skip if this text is entirely contained in a parent we already captured
        const parentText = el.parentElement?.textContent?.trim();
        if (parentText && seen.has(parentText)) return;
        seen.add(text);
        const style = getComputedStyle(el);
        blocks.push({
          category: 'heading',
          text: text.substring(0, 200),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          fontSize: parseFloat(style.fontSize),
          fontWeight: parseInt(style.fontWeight) || 400,
          tag: el.tagName.toLowerCase(),
        });
      });

      // ── Card/panel content — semantic containers ──
      document.querySelectorAll('[class*="Card"], [class*="card"], [class*="panel"], [class*="Panel"], [class*="section"], section, article').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const text = el.textContent?.trim();
        if (!text || text.length < 10 || seen.has(text.substring(0, 50))) return;
        seen.add(text.substring(0, 50));

        // Extract child text nodes for structure
        const childTexts = [];
        el.querySelectorAll('p, span, div, li, label').forEach(child => {
          const ct = child.textContent?.trim();
          if (ct && ct.length > 2 && ct.length < 300 && !childTexts.includes(ct)) {
            childTexts.push(ct);
          }
        });

        blocks.push({
          category: 'content-block',
          text: text.substring(0, 500),
          childTexts: childTexts.slice(0, 20),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          scrollable: el.scrollHeight > el.clientHeight,
          scrollWidth: el.scrollWidth > el.clientWidth,
        });
      });

      // ── Buttons & interactive elements — read their labels ──
      const buttons = [];
      document.querySelectorAll('button, a[href], [role="button"], [role="tab"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const text = el.textContent?.trim();
        if (!text || text.length < 1) return;
        buttons.push({
          text: text.substring(0, 80),
          type: el.tagName.toLowerCase(),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          disabled: el.disabled || false,
        });
      });

      // ── Dropdowns — read their current values ──
      const dropdowns = [];
      document.querySelectorAll('[data-vai-dropdown-trigger]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;
        dropdowns.push({
          name: el.getAttribute('data-vai-dropdown-trigger') || '',
          currentValue: el.getAttribute('data-vai-dropdown-text') || el.textContent?.trim() || '',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        });
      });

      // ── Plain text paragraphs/descriptions ──
      const descriptions = [];
      document.querySelectorAll('p, [class*="desc"], [class*="Desc"], [class*="subtitle"], [class*="info"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const text = el.textContent?.trim();
        if (!text || text.length < 5 || seen.has(text)) return;
        seen.add(text);
        descriptions.push({
          text: text.substring(0, 300),
          y: Math.round(rect.top),
        });
      });

      return { blocks, buttons, dropdowns, descriptions };
    });

    // Log what Vai "read"
    this.#log('read', `── UI Text Comprehension ──`);
    this.#log('read', `  ${data.blocks.length} content blocks, ${data.buttons.length} buttons, ${data.dropdowns.length} dropdowns`);
    for (const b of data.blocks.filter(b => b.category === 'heading')) {
      this.#log('read', `  📌 "${b.text}" at y=${b.y}`);
    }
    for (const d of data.dropdowns) {
      this.#log('read', `  🔽 Dropdown "${d.name}" = "${d.currentValue}"`);
    }
    for (const btn of data.buttons.slice(0, 10)) {
      this.#log('read', `  🔘 Button: "${btn.text}" at (${btn.x}, ${btn.y})${btn.disabled ? ' [disabled]' : ''}`);
    }
    return data;
  }

  /** Discover all scrollable areas on the page.
   *  Returns containers where scrollHeight > clientHeight or scrollWidth > clientWidth.
   *  For each area, reports position, scroll range, and visible content summary. */
  async findScrollableAreas() {
    const areas = await this.#page.evaluate(() => {
      const results = [];
      // Check all elements for potential scrollability
      document.querySelectorAll('*').forEach(el => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;

        const rect = el.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) return; // Skip tiny elements
        if (rect.bottom < 0 || rect.top > window.innerHeight) return; // Off screen

        // Skip the document body/html (we know those scroll)
        if (el === document.body || el === document.documentElement) return;

        const canScrollY = el.scrollHeight > el.clientHeight + 2;
        const canScrollX = el.scrollWidth > el.clientWidth + 2;
        if (!canScrollY && !canScrollX) return;

        // Check that the element actually ALLOWS scrolling:
        // overflow/overflow-y/overflow-x must be auto, scroll, or overlay
        // If ALL THREE are 'hidden', then it clips content and cannot scroll
        const ov = style.overflow;
        const ovY = style.overflowY;
        const ovX = style.overflowX;
        const scrollable = ['auto', 'scroll', 'overlay'];
        const canActuallyScrollY = canScrollY && (scrollable.includes(ovY) || scrollable.includes(ov));
        const canActuallyScrollX = canScrollX && (scrollable.includes(ovX) || scrollable.includes(ov));
        
        // Also check: if the element has scrollTop > 0 or is already scrolled, it's scrollable
        const hasScrolledAlready = el.scrollTop > 0 || el.scrollLeft > 0;

        if (!canActuallyScrollY && !canActuallyScrollX && !hasScrolledAlready) return;

        // Get a label for this container
        const label = el.getAttribute('aria-label') ||
                      el.getAttribute('data-vai-dropdown-panel') ||
                      el.id ||
                      el.className?.split?.(' ').find(c => c.length > 3 && c.length < 30) ||
                      el.tagName.toLowerCase();

        results.push({
          label,
          tag: el.tagName.toLowerCase(),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          scrollY: canActuallyScrollY || hasScrolledAlready,
          scrollX: canActuallyScrollX,
          scrollTop: Math.round(el.scrollTop),
          scrollHeight: Math.round(el.scrollHeight),
          clientHeight: Math.round(el.clientHeight),
          hiddenPx: canScrollY ? Math.round(el.scrollHeight - el.clientHeight) : 0,
          childCount: el.children.length,
          overflow: `${ov}/${ovY}/${ovX}`,
          textPreview: el.textContent?.trim().substring(0, 100) || '',
        });
      });

      // Sort by area (largest first) and deduplicate overlapping regions
      results.sort((a, b) => (b.w * b.h) - (a.w * a.h));
      return results.slice(0, 15); // Top 15 scrollable regions
    });

    this.#log('scroll', `── Scrollable Areas ──`);
    this.#log('scroll', `  Found ${areas.length} scrollable regions`);
    for (const a of areas) {
      this.#log('scroll', `  📜 "${a.label}" (${a.w}×${a.h}) ${a.scrollY ? `↕${a.hiddenPx}px hidden` : ''} ${a.scrollX ? '↔scrollX' : ''} — ${a.childCount} children`);
    }
    return areas;
  }

  /** Scroll a specific element (not the page) by targeting its coordinates.
   *  Useful for scrolling dropdown panels, side panels, etc.
   *  @param {number} x — x coordinate inside the scrollable area
   *  @param {number} y — y coordinate inside the scrollable area
   *  @param {number} deltaY — pixels to scroll (positive = down) */
  async scrollAt(x, y, deltaY) {
    // Show scroll indicator at target position
    await this.#page.evaluate((dy, sx, sy) => {
      try { window.__vai_cursor?.showScroll?.(dy, sx, sy); } catch {}
    }, deltaY, x, y);

    await this.#page.mouse.move(x, y);
    await this.#page.mouse.wheel({ deltaY });
    this.#log('scroll', `Scroll at (${x}, ${y}) by ${deltaY}px`);
    await this.#sleep(300); // Longer pause so indicator is visible
    this.#elementCache = null;
  }

  /** Ask a self-directed question about the UI.
   *  Vai formulates a question, attempts to answer it by reading the screen,
   *  and evaluates whether the answer is correct.
   *  @param {string} question — the question to investigate
   *  @returns {{ question, answer, evidence, confident }} */
  async investigateQuestion(question) {
    this.#log('think', `❓ ${question}`);
    await this.see(`investigate-${question.replace(/[^a-z0-9]/gi, '-').substring(0, 30)}`);

    // Scan the screen for evidence
    const elements = await this.scan();
    const textData = await this.readAllText();

    // Build evidence from what we see
    const evidence = {
      visibleButtons: textData.buttons.map(b => b.text),
      headings: textData.blocks.filter(b => b.category === 'heading').map(b => b.text),
      dropdownValues: textData.dropdowns.map(d => `${d.name}=${d.currentValue}`),
      contentBlocks: textData.blocks.filter(b => b.category === 'content-block').length,
      descriptions: textData.descriptions.map(d => d.text),
      elementCount: elements.length,
    };

    this.#log('think', `  📊 Evidence: ${evidence.visibleButtons.length} buttons, ${evidence.headings.length} headings, ${evidence.contentBlocks} blocks`);
    return { question, evidence, elements, textData };
  }

  // ═══════════════════════════════════════════════════════════
  // VERIFICATION — View & State Assertions
  // ═══════════════════════════════════════════════════════════

  /** Verify we're on the expected gym view
   *  @param {'dashboard'|'training'|'review'|'foundations'|'history'} expectedView */
  async verifyView(expectedView) {
    const actual = await this.#page.evaluate(() => {
      try {
        return window.__vai_gym?.getStore?.()?.view || null;
      } catch { return null; }
    });
    const match = actual === expectedView;
    this.#log('verify', `View "${expectedView}": ${match ? '✓' : `✗ (got "${actual}")`}`);
    return match;
  }

  /** Verify a dropdown has the expected value
   *  @param {string} query — dropdown search term
   *  @param {string} expected — expected selected text or value */
  async verifyDropdownValue(query, expected) {
    await this.scan();
    const dropdowns = await this.findDropdowns();
    const q = query.toLowerCase();
    const match = dropdowns.find(d => {
      const text = (d.text || '').toLowerCase();
      const label = (d.selectedText || '').toLowerCase();
      const dvaig = (d.dataVaiGym || []).join(' ').toLowerCase();
      const aria = (d.ariaLabel || '').toLowerCase();
      return text.includes(q) || label.includes(q) || dvaig.includes(q) || aria.includes(q) ||
             (d.options || []).some(o => o.text.toLowerCase().includes(q));
    });
    if (!match) {
      this.#log('verify', `Dropdown "${query}" NOT FOUND`);
      return false;
    }
    const currentText = (match.selectedText || match.selectedValue || '').toLowerCase();
    const currentValue = (match.selectedValue || '').toLowerCase();
    const expectedLower = expected.toLowerCase();
    const isMatch = currentText.includes(expectedLower) || currentValue.includes(expectedLower) || currentValue === expectedLower;
    this.#log('verify', `Dropdown "${query}" = "${match.selectedText}" (value="${match.selectedValue}") ${isMatch ? '✓' : `✗ (expected "${expected}")`}`);
    return isMatch;
  }

  /** Click a foundation card in the Foundations view by name
   *  Navigates to Foundations view, finds the card, clicks it.
   *  This should set the foundation and return to dashboard.
   *  @param {string} foundationName — partial name match */
  async clickFoundationCard(foundationName) {
    // Navigate to Foundations
    await this.navigateToView('foundations');
    await this.#sleep(500);
    await this.scan();

    // Foundation cards are buttons with the foundation name as text
    const el = await this.findElement(foundationName, { type: 'button' });
    if (el) {
      this.#log('click', `Foundation card: "${el.text.substring(0, 40)}"`);
      await this.click(el.x, el.y);
      await this.#sleep(600); // Wait for navigation back to dashboard
      return true;
    }
    // Try looking at all buttons for partial match
    const elements = this.#elementCache || await this.scan();
    const buttons = elements.filter(e => e.type === 'button' || e.affordance === 'clickable');
    const match = buttons.find(b =>
      b.text.toLowerCase().includes(foundationName.toLowerCase())
    );
    if (match) {
      this.#log('click', `Foundation card (fuzzy): "${match.text.substring(0, 40)}"`);
      await this.click(match.x, match.y);
      await this.#sleep(600);
      return true;
    }
    this.#log('find', `Foundation card "${foundationName}" NOT FOUND`);
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // COMPOSITE ACTIONS — High-level navigation
  // ═══════════════════════════════════════════════════════════

  /** Navigate to a gym view tab by clicking it visually */
  async navigateToView(viewName) {
    if (!this.#blind) {
      // SIGHTED: use shortcut
      await this.#page.evaluate((v) => {
        try { window.__vai_gym?.setView?.(v); } catch {}
      }, viewName);
      await this.#sleep(300);
      return true;
    }

    // BLIND: scan for the tab button and click it
    await this.scan();
    // View tabs contain text like "Dashboard", "Training", etc.
    const tabNames = {
      dashboard: 'Dashboard',
      training: 'Train',
      foundations: 'Foundations',
      history: 'History',
    };
    const tabText = tabNames[viewName] || viewName;
    const found = await this.clickElement(tabText);
    await this.#sleep(400);
    return found;
  }

  /** Start a training scenario — click the button visually */
  async startScenario() {
    if (!this.#blind) {
      await this.#page.evaluate(() => {
        try { window.__vai_gym?.startRandomScenario?.(); } catch {}
      });
      await this.#sleep(800);
      return true;
    }

    // BLIND: "From Scenario Bank" lives on the DASHBOARD view.
    // If we can't find it, navigate to Dashboard first.
    await this.scan();
    let found =
      await this.clickElement('scenario bank') ||
      await this.clickElement('bank');

    if (!found) {
      // Not on dashboard — navigate there
      this.#log('find', 'Bank button not visible, switching to Dashboard');
      await this.navigateToView('dashboard');
      await this.#sleep(600);
      await this.scan();
      found =
        await this.clickElement('scenario bank') ||
        await this.clickElement('bank') ||
        await this.clickElement('begin') ||
        await this.clickElement('start training') ||
        await this.clickElement('random');
    }

    if (found) {
      // After clicking "From Scenario Bank", the app auto-navigates to training view
      await this.#sleep(800);
    }
    return found;
  }

  /** Submit response — click the submit button visually */
  async submitResponse() {
    if (!this.#blind) {
      await this.#page.evaluate(async () => {
        try { await window.__vai_gym?.submitResponse?.(); } catch {}
      });
      await this.#sleep(1500);
      return true;
    }

    // BLIND: find and click the submit button
    await this.scan();
    const found =
      await this.clickElement('submit') ||
      await this.clickElement('send') ||
      await this.clickElement('grading');

    await this.#sleep(1500);
    return found;
  }

  /** Read the current scenario text from the screen */
  async readScenario() {
    const scenario = await this.#page.evaluate(() => {
      // Try to read from the DOM directly
      const cards = document.querySelectorAll('[class*="Card"]');
      const texts = [];
      cards.forEach(c => {
        const t = c.textContent?.trim();
        if (t && t.length > 20) texts.push(t);
      });
      // Also try from the store
      try {
        const state = window.__vai_gym?.getStore?.();
        if (state?.activeScenario) {
          return {
            situation: state.activeScenario.situation,
            hidden_need: state.activeScenario.hidden_need,
            foundation: state.activeScenario.foundation,
            fromStore: true,
          };
        }
      } catch {}
      return { texts, fromStore: false };
    });
    this.#log('read', scenario.fromStore
      ? `Scenario: [${scenario.foundation}] ${scenario.situation?.substring(0, 60)}...`
      : `Screen text: ${scenario.texts?.length || 0} blocks`);
    return scenario;
  }

  /** Set the cursor label (Vai/Opus) */
  async setLabel(label) {
    await this.#page.evaluate((l) => {
      try { window.__vai_cursor?.setLabel?.(l); } catch {}
    }, label);
    this.#log('label', label);
  }

  /** Enable the overlay system */
  /** Enable the entire overlay system — cursor + action log become visible */
  async enableOverlay() {
    await this.#page.evaluate(() => {
      try {
        // Turn on the overlay system (action log visibility)
        window.__vai_cursor_store?.setState?.({ overlayVisible: true });
        // Make the cursor itself visible at current position
        const s = window.__vai_cursor_store?.getState?.();
        if (s) {
          window.__vai_cursor_store.setState({
            cursor: { ...s.cursor, visible: true },
          });
        }
      } catch {}
    });
  }

  // ═══════════════════════════════════════════════════════════
  // FULL TRAINING ROUND — A complete scenario cycle
  // ═══════════════════════════════════════════════════════════

  /** Execute one full training round (visual mode)
   *  Returns: { success, screenshots, timing, actions } */
  async trainRound(responseText) {
    const roundStart = performance.now();
    const screenshots = [];

    // 1. See the screen
    screenshots.push(await this.see('round-start'));

    // 2. Navigate to DASHBOARD first — that's where "From Scenario Bank" lives
    await this.setLabel('Opus');
    await this.navigateToView('dashboard');
    screenshots.push(await this.see('dashboard-view'));

    // 3. Start scenario (clicks bank button, auto-navigates to training view)
    const started = await this.startScenario();
    await this.#sleep(500);
    screenshots.push(await this.see('scenario-loaded'));

    // 4. Read what's on screen (now on training view)
    const scenario = await this.readScenario();

    // 5. Switch to Vai, find textarea, type response
    await this.setLabel('Vai');
    const typed = await this.typeText(responseText);
    screenshots.push(await this.see('response-typed'));

    // 6. Submit
    const submitted = await this.submitResponse();
    screenshots.push(await this.see('submitted'));

    const totalMs = Math.round(performance.now() - roundStart);

    return {
      success: started && typed && submitted,
      scenario,
      screenshots,
      timing: { totalMs },
      actions: this.#actionLog.slice(-20), // last 20 actions
    };
  }

  // ═══════════════════════════════════════════════════════════
  // REPORT
  // ═══════════════════════════════════════════════════════════

  /** Get summary of all actions performed */
  getReport() {
    return {
      mode: this.#blind ? 'BLIND' : 'SIGHTED',
      totalActions: this.#actionLog.length,
      totalScreenshots: this.#shotCount,
      actions: [...this.#actionLog],
    };
  }

  /** Reset action log */
  reset() {
    this.#actionLog = [];
    this.#elementCache = null;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN RECORDING — Puppeteer screencast + visible REC indicator
  // ═══════════════════════════════════════════════════════════

  /** Start screen recording using Puppeteer's screencast API.
   *  Also injects a visible REC indicator in the overlay.
   *  @param {string} outputPath — path for the recorded webm file
   *  @returns {{ recording: boolean }} */
  async startRecording(outputPath) {
    if (this.#recording) {
      this.#log('see', 'Already recording');
      return { recording: true };
    }

    const savePath = outputPath || join(this.#screenshotDir, `vai-recording-${Date.now()}.webm`);
    await mkdir(join(savePath, '..'), { recursive: true }).catch(() => {});

    // Show REC indicator in the overlay
    await this.#page.evaluate(() => {
      try { window.__vai_cursor?.setRecording?.(true); } catch {}
    });

    // Start Puppeteer screencast
    try {
      const recorder = await this.#page.screencast({ path: savePath });
      this.#recording = { recorder, path: savePath, startTime: Date.now() };
      this.#log('see', `🔴 Recording started → ${savePath}`);
    } catch (err) {
      // screencast might not be available in all Puppeteer versions
      // Fall back to just showing the REC indicator
      this.#recording = { recorder: null, path: savePath, startTime: Date.now() };
      this.#log('see', `🔴 Recording indicator ON (screencast unavailable: ${err.message})`);
    }

    return { recording: true, path: savePath };
  }

  /** Stop screen recording and save the file */
  async stopRecording() {
    if (!this.#recording) {
      this.#log('see', 'Not recording');
      return null;
    }

    const { recorder, path, startTime } = this.#recording;
    const durationMs = Date.now() - startTime;

    // Stop Puppeteer screencast
    if (recorder) {
      try { await recorder.stop(); } catch {}
    }

    // Hide REC indicator
    await this.#page.evaluate(() => {
      try { window.__vai_cursor?.setRecording?.(false); } catch {}
    });

    this.#recording = null;
    this.#log('see', `⏹ Recording stopped (${Math.round(durationMs / 1000)}s) → ${path}`);
    return { path, durationMs };
  }

  /** Check if currently recording */
  get isRecording() { return !!this.#recording; }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════

  #log(type, msg) {
    const entry = { type, msg, time: Date.now() };
    this.#actionLog.push(entry);
    if (this.#verbose) {
      const icon = { see: '👁️', scan: '🔍', find: '🎯', move: '🖱️', click: '👆',
        type: '⌨️', key: '🔑', scroll: '📜', verify: '✅', read: '📖', label: '🏷️' }[type] || '•';
      console.log(`    ${icon} ${msg}`);
    }
  }

  async #sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export default VaiEyes;
