# PR #67 — 10 real-image visual triage (2026-10-21)

This is a **human review of the two 5-row comparison sheets** from GitHub Actions artifact `real-fixture-10-cutout-evidence` (run 39505087291). The comparison columns are source, after cutout, final PNG and annotated candidate islands. It is **not** a pixel-level zoom inspection and **not** final acceptance.

| No. | Visible observation | Status / next check |
|---|---|---|
| 01 | Dog, 「おはよう!」, sun and rays remain. Dog body reaches the bottom of the source cell. Numerous tiny red candidate boxes cluster around sun/rays and paws. | **要確認**: compare original sheet bottom edge and dog outline at 1:1 before deciding if anything is clipped. Do not automatically delete sun details. |
| 02 | Penguin, 「ありがとう」, heart and surrounding hearts remain. Source boundary warning: bottom. | **要確認**: inspect foot/bottom outline at full resolution. |
| 03 | Cat, 「すごい!!」 and stars remain. Paws/body reach bottom of source. Small candidate boxes occur near text and motion marks. | **要確認**: bottom outline and punctuation at 1:1. |
| 04 | Bear, 「やったー!」, confetti and motion marks remain. Body reaches source bottom. | **要確認**: bottom outline and confetti at 1:1. |
| 05 | Pink character, 「ファイト!」, pom-poms and rays remain. Body reaches source bottom. | **要確認**: source top/bottom boundaries, head and pom-pom edges. |
| 06 | Green dinosaur, 「えーっ!?」, sweat drops and motion marks remain. Body reaches source bottom. | **要確認**: source top/bottom, motion lines and small decorative marks. |
| 07 | Sleeping sloth, Z letters and blue pillow remain; top/right boundary warnings. | **要確認**: source top/right and pillow contour at 1:1; 13 source-edge dark pixels were preserved, not erased. |
| 08 | White character, 「もぐもぐ」, hearts and crumbs remain; no boundary warning. | **要確認**: tiny crumbs and mouth/food contours at 1:1. |
| 09 | Panda and colorful question marks remain; no boundary warning. | **要確認**: tiny punctuation and outline at 1:1. |
| 10 | Running dog, 「またね!」, heart, motion marks and cloud remain; no boundary warning. | **要確認**: small heart and motion marks at 1:1. |

## Rules for acceptance

- Red annotated boxes are **candidate alpha islands**, not confirmed residue; punctuation, sun rays, hearts, sweat and confetti can be intentional.
- A character already touching the **source crop boundary** is not automatically a background-removal defect. Compare with the original full sheet and confirm the grid crop.
- The automated transparent output margins pass; this does not prove the illustration is complete.
- No row is marked 合格 solely from these overview sheets.
- 40 distinct real stickers and physical iPhone Safari remain unverified. **Do not merge PR #67** until the acceptance checklist is complete.
