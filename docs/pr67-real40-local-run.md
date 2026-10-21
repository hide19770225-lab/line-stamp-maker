## Actual 40-artwork import verification

The CI workflow uses synthetic distinct 40-cell artwork, and is **not** a test of the user's original 40 Japanese sticker designs.

When the original 5x8 artwork sheet is available in the app checkout, run:

```bash
npm install --no-save --no-package-lock @playwright/test
npx playwright install chromium
python3 -m pip install pillow
bash tests/run_real40_local.sh "/path/to/original-40-sheet.png" /tmp/real40-proof
```

The runner checks 40 source cells for repeated artwork, opens all 40 editors in an emulated iPhone Chromium browser, asserts the 40 rendered PNGs are distinct, downloads the ZIP and compares every exported PNG with its expected browser rendering. It stores `result.json`, `expected.json`, `40.zip`, `iphone40-editor.png` and `http.log` in the output directory.

This is an **import/ZIP technical test**. It does not establish that automatic crop boundaries preserve every stroke or Japanese caption; inspect all 40 output PNGs against the original. It is not a physical iPhone Safari test. Do not merge PR #67 on synthetic CI alone.

A separately prepared 5x8 composite of already-cut-out PNGs can also be passed to the runner to exercise real 40-image content, but that does not validate raw-sheet segmentation. Prefer the original raw artwork sheet for release validation.
