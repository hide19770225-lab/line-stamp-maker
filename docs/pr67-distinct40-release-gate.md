# PR #67: distinct 40-artwork validation status (2026-10-21)

## Confirmed

- Browser CI on commit `781e347`: both workflow suites passed.
- Browser regression includes a 5x8 **synthetic distinct-cell** sheet and checks editor navigation, ZIP download and pixel-level output against in-browser renders.
- Separately, the user's actual LINE submission candidate v4 has 40 individual RGBA 370x320 PNGs, plus main and tab images. An offline audit of the 40 individual files found **zero near-duplicate pairs** using 32x32 RGB comparisons (threshold mean RGB difference < 3), minimum content margin 20 px, and maximum PNG size 153,213 bytes.
- A white-background 5x8 composite of those **already-processed** 40 PNGs was prepared for a subsequent import test.

## Not yet confirmed

- The actual 40-artwork composite has **not** been run through the web app's import/cutout pipeline. A composite of finished transparent PNGs is not equivalent to the original raw artwork sheet; its passing would not independently prove correct segmentation of the original.
- No physical iPhone Safari end-to-end test has been run.
- Offline file checks and automated pixel checks do not substitute for final per-sticker human visual approval.

## Release gate

Do **not** merge this PR or declare full iPhone production readiness solely from passing synthetic-fixture CI. Next, run the real 40-artwork sheet through the app, inspect all 40 outputs, and complete physical Safari smoke testing.
