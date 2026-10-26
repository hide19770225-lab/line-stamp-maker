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
    // Verify the actual upload flow shows the resolved layout near the picker.
    const source = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = 1000;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 600, 1000);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) {
        ctx.fillStyle = '#398a66';
        ctx.fillRect(30 + x * 112, 24 + y * 122, 35, 35);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#easy-target').selectOption('40');
    await page.locator('#easy-layout').selectOption('auto');
    await page.locator('#easy-files').setInputFiles({
      name: 'forty-grid-test.png', mimeType: 'image/png',
      buffer: Buffer.from(source, 'base64'),
    });
    await page.waitForFunction(() => document.querySelector('#easy-upload-feedback').textContent.includes('読み込み済み'), null, { timeout: 30000 });
    const feedback = await page.locator('#easy-upload-feedback').textContent();
    if (!feedback.includes('配置：5列×8段（自動設定）')) {
      throw new Error('Grid recognition feedback missing or incorrect: ' + feedback);
    }
    const chosenFile = await page.locator('#easy-files').evaluate(input => input.files?.[0]?.name || '');
    if (chosenFile !== 'forty-grid-test.png') {
      throw new Error('Native file picker lost its selected filename: ' + chosenFile);
    }
    console.log('PASS selected filename remains visible in the native file control');
    // The visual-review cards must keep successful technical details collapsed.
    // This assertion guards the UI contract without bypassing visual approval.
    // The app CSP disallows fetch; inspect the checked-out source in Node.
    const sourceText = require('fs').readFileSync('app.js', 'utf8');
    const compactReview = sourceText.includes('audit-technical-details') &&
      sourceText.includes('検査の詳細を表示') &&
      sourceText.includes('検出位置の確認');
    if (!compactReview) throw new Error('Compact review controls missing');
    console.log('PASS compact review disclosure controls are present');
    // Exercise generated review cards and native disclosure behavior.
    await page.locator('#easy-process').click();
    await page.waitForFunction(() =>
      document.querySelectorAll('#bulk-results .bulk-result').length === 42 &&
      !document.body.classList.contains('busy'), null, { timeout: 120000 });
    const normalCard = page.locator('#bulk-results .bulk-result[data-status="正常"]').first();
    if (await normalCard.count() === 0) throw new Error('No successful audit card');
    const details = normalCard.locator('details.audit-technical-details').first();
    if (await details.count() !== 1) throw new Error('Collapsible audit details missing');
    if (await details.evaluate(el => el.open)) throw new Error('Audit details initially expanded');
    await details.locator('summary').click();
    if (!(await details.evaluate(el => el.open))) throw new Error('Audit details did not expand');
    await details.locator('summary').click();
    if (await details.evaluate(el => el.open)) throw new Error('Audit details did not collapse');
    console.log('PASS 42 actual review cards and audit details open/close');


    console.log('PASS automatic 5x8 selection and visible upload feedback');
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
