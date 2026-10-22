# PR #67 — independent 40-design source edge audit (2026-10-21)

Source: Library image `かわいい40種の日本語スタンプシート.png` (1152×1366); 5×8 adaptive crops with x boundaries 0,230,461,691,922,1152 and y boundaries 0,165,332,497,661,826,987,1164,1366. The source is **not** the original 10-pose CI fixture. Analysis is offline Python, **not a browser export**.

A number-removal candidate ZIP was inspected, checking colored pixels in each left/right 8-pixel strip in the upper 155px. **18/40 cells had colored pixels at one or both edges**: 04,05,09,10,11,14,15,17,19,20,23,24,25,26,27,29,30,40. This is a conservative *attention flag*, not proof that all 18 contain residue.

Visual review of the contact sheet suggests these cases need first-priority attention:
- **04**: next cell's number appears at the far right.
- **05**: a star at the left may be a legitimate decoration, not trash.
- **09**: a number appears at the right and a star/other mark at left; do not trim blindly.
- **10**: hearts extend to the left edge; preserve valid hearts.
- **14**: adjacent colored elements visible at the right.
- **15**: house illustration at left; do not remove without identifying intended ownership.
- **17**: **「今向かってる」 text appears cut at right**; a crop may be inherently too narrow. Requires original sheet inspection and adaptive boundary or source reconstruction.
- **20**: motion/exclamation at left, may be valid.
- **24**: left-edge character/outline may be valid; inspect.
- **25**: decorative rays at left, likely intentional.
- **26**: top caption reaches right boundary; check character integrity.
- **29**: **neighboring character visibly enters from right**; cannot resolve with alpha island deletion without risking artwork.
- **30**: a second character is part of the intended scene, so preserve it.
- **40**: left-edge character/hand may be intended; preserve.

Next step: obtain safe per-cell ownership masks or manually adjust boundaries for the problematic cells. **Do not automatically erase the entire 8px strip.** Any algorithm must retain intentional text, antennae, rays, hearts and limbs. A full 40-design ZIP output and physical iPhone Safari acceptance are still pending. Keep PR #67 unmerged.
