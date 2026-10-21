# Real 40-artwork acceptance: source-layout blocker

The original Japanese 40-artwork sheet (1152×1366) is NOT a clean uniform 5×8 grid. Artwork, captions and printed numbers cross nominal cell boundaries. A 5×8 uniform crop may cut captions or import neighboring labels. The original sheet must not be certified as 40 clean stickers just because all 40 slots export, source-cell ORB mapping passes, or PNG dimensions are valid.

Two distinct tests are necessary:

1. **Application-flow regression with 40 distinct designs:** Reassemble the 40 already-reviewed transparent PNGs into a *new*, separated 5×8 sheet (5 columns, 8 rows). This exercises import, editor navigation, and ZIP export using 40 distinct designs, but is NOT proof that the raw original sheet can be segmented correctly. The reassembled sheet is a local test fixture, not a user-ready export.
2. **Original-sheet acceptance:** Run the unmodified original source through the app and inspect each of the 40 cutouts for missing parts, neighboring captions, and printed numbering. Mark this test **blocked / not passed** if the raw sheet cannot be segmented without manual corrections.

The original source's uneven artwork placement cannot be repaired by merely changing the confidence threshold in `tests/audit_real40_mapping.py`. ORB matches establish source identity, not cutout completeness or clean boundaries.

Do not merge PR #67 until the real 40-image application run and physical iPhone Safari workflow have been reviewed.
