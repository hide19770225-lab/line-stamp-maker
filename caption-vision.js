/* Local reference matching. No general face/pose model or network requests. */
(function (root) {
  "use strict";
  const SIDE = 32;
  const STORAGE_KEY = "stamp-atelier-pose-references-v1";
  const labels = new Set([
    "smile",
    "angry",
    "cry",
    "sleepy",
    "surprised",
    "worried",
    "wave",
    "bow",
    "approve",
    "joy",
    "love",
    "greeting",
    "support",
  ]);
  function learned() {
    try {
      const rows = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(rows)
        ? rows
            .filter(
              (r) =>
                labels.has(r.emotion) &&
                /^[0-9a-f]{4096}$/.test(r.features) &&
                typeof r.label === "string",
            )
            .slice(-40)
        : [];
    } catch (_) {
      return [];
    }
  }
  function remember(image, mask, emotion, label) {
    if (!labels.has(emotion))
      throw new Error(
        "表情・ポーズを手動選択してください。未分類の画像は記憶できません。",
      );
    const vector = descriptor(image, mask);
    if (!vector) throw new Error("見本にできる不透明な画像がありません。");
    const features = vector.map((v) => v.toString(16)).join("");
    const rows = learned().filter((r) => r.features !== features);
    rows.push({
      id: "local-" + Date.now(),
      emotion,
      label: String(label).slice(0, 60),
      features,
    });
    if (!root.localStorage)
      throw new Error("このブラウザでは見本を保存できません。");
    root.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-40)));
    return Math.min(rows.length, 40);
  }
  function clearLearned() {
    root.localStorage?.removeItem(STORAGE_KEY);
  }

  function descriptor(image, mask) {
    const { width: w, height: h, data } = image;
    if (!w || !h || data.length !== w * h * 4 || mask.length !== w * h)
      return null;
    let left = w,
      top = h,
      right = -1,
      bottom = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x,
          j = i * 4;
        if (mask[i] < 64 || Math.min(data[j], data[j + 1], data[j + 2]) > 225)
          continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    if (right < left || bottom < top) return null;
    const span = Math.max(right - left + 1, bottom - top + 1) * 1.08,
      cx = (left + right + 1) / 2,
      cy = (top + bottom + 1) / 2;
    const values = [];
    for (let y = 0; y < SIDE; y++)
      for (let x = 0; x < SIDE; x++) {
        const sum = [0, 0, 0, 0];
        for (const oy of [0.25, 0.75])
          for (const ox of [0.25, 0.75]) {
            const sx = Math.floor(cx + ((x + ox) / SIDE - 0.5) * span),
              sy = Math.floor(cy + ((y + oy) / SIDE - 0.5) * span);
            const inside = sx >= 0 && sx < w && sy >= 0 && sy < h,
              i = sy * w + sx,
              a = inside ? mask[i] / 255 : 0;
            for (let c = 0; c < 3; c++)
              sum[c] += inside ? (data[i * 4 + c] / 255) * a + 1 - a : 1;
            sum[3] += a;
          }
        values.push(...sum.map((v) => Math.round((v / 4) * 15)));
      }
    return values;
  }
  function match(image, mask) {
    const vector = descriptor(image, mask);
    const unknown = {
      emotion: "unknown",
      method: "reference",
      reason: "見本との一致が不十分：判定できず",
    };
    if (!vector) return unknown;
    const references = [
      ...(root.StampCaptionReferences ||
        (typeof module !== "undefined"
          ? require("./caption-references.js")
          : [])),
      ...learned(),
    ];
    const scores = references
      .map((ref) => {
        let sum = 0;
        for (let i = 0; i < vector.length; i++)
          sum += Math.abs(vector[i] - parseInt(ref.features[i], 16));
        return { ref, distance: sum / vector.length / 15 };
      })
      .sort((a, b) => a.distance - b.distance);
    if (!scores.length) return unknown;
    const best = scores[0],
      other = scores.find((s) => s.ref.emotion !== best.ref.emotion),
      gap = other ? other.distance - best.distance : 0;
    // Tight closed-set matching, deliberately abstain on unfamiliar/ambiguous pictures.
    if (best.distance > 0.045 || gap < 0.012)
      return {
        ...unknown,
        distance: best.distance,
        gap,
        reason:
          best.distance > 0.045
            ? "判定できず：このキャラクター・ポーズに近い見本がありません。表情を手動選択して見本を記憶できます。"
            : "判定できず：複数の表情・ポーズの見本と似ていて区別できません。手動確認が必要です。",
      };
    return {
      emotion: best.ref.emotion,
      method: "reference",
      distance: best.distance,
      gap,
      reason: `画素見本照合：${best.ref.label}に近い画像（推測・要確認）。見本との差 ${(best.distance * 100).toFixed(1)}%。汎用的な表情認識ではありません。`,
    };
  }
  function fingerprint(image, mask) {
    const v = descriptor(image, mask) || [];
    let n = 2166136261;
    for (const k of v) n = Math.imul(n ^ k, 16777619) >>> 0;
    return n;
  }
  const api = {
    descriptor,
    match,
    fingerprint,
    remember,
    learned,
    clearLearned,
  };
  root.StampCaptionVision = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
