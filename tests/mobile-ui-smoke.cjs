const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 3, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
    const mode = page.locator('#production-mode');
    if (await mode.inputValue() !== 'easy') throw new Error('Recommended easy mode is not selected');
    const steps = page.locator('#easy-steps li');
    if (await steps.count() !== 5) throw new Error('Expected five guide steps');
    const viewport = await page.evaluate(() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth}));
    if (viewport.scrollWidth > viewport.width + 2) throw new Error('Horizontal overflow on iPhone viewport: ' + JSON.stringify(viewport));
    if (!(await page.locator('#easy-files').isVisible())) throw new Error('Upload input hidden');
    for (const id of ['#easy-process', '#easy-review', '#easy-export']) {
      if (!(await page.locator(id).isVisible())) throw new Error('Essential action is hidden: ' + id);
    }
    await page.screenshot({ path: '/tmp/stamp-atelier-mobile-preview.png', fullPage: true });
    await mode.selectOption('normal');
    if (await page.locator('#easy-panel').isVisible()) throw new Error('Easy panel did not hide in detailed mode');
    await mode.selectOption('easy');
    if (!(await page.locator('#easy-panel').isVisible())) throw new Error('Easy panel did not reopen');
    if (await steps.count() !== 5) throw new Error('Five-step guide disappeared after switching modes');
    if (errors.length) throw new Error('Browser JavaScript errors: ' + errors.join('; '));
    console.log('PASS mobile viewport, five-step guide, visible actions and mode switching');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
