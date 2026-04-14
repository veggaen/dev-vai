import { launchVisualBrowser, maximizeBrowserWindow, wait } from './visual-browser.mjs';

const { browser: b, page: p } = await launchVisualBrowser();
const viewport = await maximizeBrowserWindow(p);
console.log(`Viewport ${viewport.width}x${viewport.height} on screen ${viewport.screenWidth}x${viewport.screenHeight}`);

const logs = [];
p.on('console', msg => logs.push({ type: msg.type(), text: msg.text() }));
p.on('pageerror', err => logs.push({ type: 'pageerror', text: err.message }));

await p.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
await wait(3000);

// Deep diagnostic on all groups, panels, separators and builder content
const debug = await p.evaluate(() => {
  // Use correct react-resizable-panels data attributes
  const groups = document.querySelectorAll('[data-group]');
  const panels = document.querySelectorAll('[data-panel]');
  const separators = document.querySelectorAll('[data-separator]');

  const panelInfo = Array.from(panels).map(el => ({
    id: el.id,
    size: `${el.offsetWidth}x${el.offsetHeight}`,
    style: el.getAttribute('style')?.substring(0, 200),
    childCount: el.children.length,
  }));

  const groupInfo = Array.from(groups).map(el => ({
    id: el.id,
    size: `${el.offsetWidth}x${el.offsetHeight}`,
    style: el.getAttribute('style')?.substring(0, 200),
    childCount: el.children.length,
    childIds: Array.from(el.children).map(c => c.id || c.tagName).join(', '),
  }));

  const sepInfo = Array.from(separators).map(el => ({
    id: el.id,
    size: `${el.offsetWidth}x${el.offsetHeight}`,
    style: el.getAttribute('style')?.substring(0, 200),
  }));

  // Check builder interior specifically
  const builder = document.getElementById('builder');
  let builderInner = null;
  if (builder) {
    const innerGroup = builder.querySelector('[data-group]');
    const innerPanels = builder.querySelectorAll('[data-panel]');
    const innerSeps = builder.querySelectorAll('[data-separator]');
    builderInner = {
      hasInnerGroup: !!innerGroup,
      innerGroupId: innerGroup?.id,
      innerGroupSize: innerGroup ? `${innerGroup.offsetWidth}x${innerGroup.offsetHeight}` : null,
      innerPanelCount: innerPanels.length,
      innerPanelIds: Array.from(innerPanels).map(p => p.id),
      innerSepCount: innerSeps.length,
      // Check PreviewPanel
      previewPanel: innerPanels.length > 0 ? {
        id: innerPanels[0].id,
        size: `${innerPanels[0].offsetWidth}x${innerPanels[0].offsetHeight}`,
        firstChildTag: innerPanels[0].children[0]?.tagName,
        firstChildClass: innerPanels[0].children[0]?.className?.substring(0, 100),
      } : null,
    };
  }

  // Test resize handle interactability
  const resizeHandles = document.querySelectorAll('[data-separator]');
  const handleStats = Array.from(resizeHandles).map(h => {
    const rect = h.getBoundingClientRect();
    const computed = window.getComputedStyle(h);
    return {
      id: h.id,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      cursor: computed.cursor,
      pointerEvents: computed.pointerEvents,
      zIndex: computed.zIndex,
    };
  });

  return {
    groupCount: groups.length, groupInfo,
    panelCount: panels.length, panelInfo,
    separatorCount: separators.length, sepInfo,
    builderInner,
    handleStats,
  };
});

console.log(JSON.stringify(debug, null, 2));

// Test drag: try mouse drag on first separator
const sep = await p.$('[data-separator]');
if (sep) {
  const box = await sep.boundingBox();
  console.log('\n=== Drag Test ===');
  console.log('Separator at:', JSON.stringify(box));

  // Measure chat panel before drag
  const beforeW = await p.evaluate(() => document.getElementById('chat')?.offsetWidth);
  
  // Simulate drag right by 100px
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 10 });
  await p.mouse.up();
  await wait(500);

  const afterW = await p.evaluate(() => document.getElementById('chat')?.offsetWidth);
  console.log(`Chat panel: ${beforeW}px → ${afterW}px (delta: ${afterW - beforeW}px)`);
  console.log(afterW !== beforeW ? 'DRAG WORKS!' : 'DRAG BROKEN - no size change');
}

console.log('\n=== Console Errors ===');
logs.filter(l => l.type === 'error' || l.type === 'pageerror')
  .forEach(e => console.log(`[${e.type}] ${e.text}`));

await p.screenshot({ path: 'scripts/screenshots/regression-check.png' });
console.log('\nScreenshot: scripts/screenshots/regression-check.png');
await b.close();
