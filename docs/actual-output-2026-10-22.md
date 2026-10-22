# Actual 40-sticker output investigation (2026-10-22)

## Evidence supplied

Inspected `line-stamps-40(3).zip` (4,625,892 bytes; SHA-256
`91b14888423a96d60ad37e8044f7df5671cb28e8cc103029524c6e6135ce7106`)
and the user-provided 5-by-8 review image. Attachments were treated as evidence,
not project instructions. No unsplit source was supplied. The ZIP has no source
coordinates, settings or build/version identifier, so its generating version and
exact original crop positions cannot be established.

All 42 PNGs decode and the ZIP CRCs pass. Stickers 01–40 are 370×320 RGBA;
main is 240×240 and tab is 96×74. All have transparent pixels and at least 10px
outer transparent margin, and each is below 1MiB. These format checks do NOT prove
correct segmentation: fitting an already damaged crop inside a transparent canvas
hides the source cut from output-edge validation.

Verified visually in the actual PNGs, independently of review-image labels:

- Original black guide numbers remain (e.g. 01–04). Split digits also appear at
  opposite sides of adjacent stickers (04/05, 09/10, 14/15).
- 06, 11–13 and 16–20 include next-row lettering along their bottom.
- 21–38 exhibit top-clipped lettering and/or bottom fragments from another row.
- 29 includes a sliver of neighboring artwork at its right; 30 includes both
  characters. Ownership must be decided using the original sheet.
- 36–40 have cropped top content. Existing pixels cannot restore missing text.

The progressive vertical mismatch is consistent with wrong row spacing/origin or
an unsafe divider; it does not identify which source dimensions or offsets were
used. The gray review background is not evidence of an opaque PNG background.

## Verified code corrections

Both grid suggestion paths now share an alpha-aware foreground test. On sheets
with fully transparent corners, any visible alpha counts as foreground regardless
of RGB (including white art and alpha=1); hidden transparent RGB is ignored.
Mixed corner alpha declines automatic detection. Opaque sheets use the same
30-level background distance rather than treating pale art as blank at distance 65.

Every pixel across a proposed gutter is checked. Subsampling and the 0.3% ink
allowance could admit a one-pixel-wide antenna or punctuation as empty space.
Only foreground-free scanlines now form blank corridors. Uncertain geometry
continues to request visual review; masks/artwork are not deleted to manufacture
a gutter. This stricter rule may produce more manual-review cases on noisy sheets.
The existing limited search window is retained; widening it without the source
could select a caption-to-character gap belonging to the same sticker.

Five regression cases fail on the previous core and pass after this change:
opaque/transparent gutter equivalence, pale bridge preservation, white/partial
alpha bridge preservation, full-resolution thin bridges, mixed-corner rejection.
The tests use exact RGBA fixtures with a canvas-read adapter; they are synthetic,
not reconstructions of the user's source. Existing browser tests exercise real
canvas processing and export. The core script cache key is updated.

## Still requires the original

Re-run the actual 40-cell split to establish all row/column boundaries, guide-number
positions and ownership of edge decorations. Confirm full Japanese captions and
number removal on every sticker. The current guide remover deliberately requires
two isolated glyphs; clipped/connected digits cannot safely be erased from these
exports using a larger rectangle. Do not mark these 40 outputs repaired or ready
for submission. Background matting/halo quality and original alpha preservation
also need the source; resizing has already changed alpha in these PNGs.

No corrected actual-output ZIP is delivered: lost pixels cannot be recovered
reliably from the exports. No OCR, paid generation or external image service was
used. iPhone Safari saving is not tested by Linux Chromium CI.

## Validation run for this change

- Browser JavaScript syntax checks and `git diff --check`: pass.
- `node --test tests/*.test.cjs tests/grid-40.test.js`: all 17 test files pass.
- Direct execution of `tests/gutter-safety.test.cjs`: all five cases pass;
  all five fail against the previous core.
- `tests/grid-40-browser.cjs`: pass on Chromium with iPhone viewport/UA.
- `tests/bulk-review-browser.cjs`: pass for 8, 16, 24, 32 and 40 stickers.
- `tests/verify_grid40_zip.py` and `tests/verify_bulk_zip.py`: pass,
  including independently decoded PNGs, CRCs and preview/export RGBA equality.
- GitHub CI results are recorded on the PR; local browser results are synthetic.
