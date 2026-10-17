/* Local phrase dictionary. No image classification is performed or implied. */
(function (root) {
  "use strict";
  const groups = {
    unknown: { label: "未分類（自動判定しません）", phrases: [] },
    smile: {
      label: "笑顔・うれしい",
      phrases: [
        "ありがとう",
        "うれしい！",
        "やったー！",
        "いいね！",
        "大好き",
        "最高！",
        "楽しみ♪",
        "わーい！",
        "にこにこ",
        "またね",
      ],
    },
    cry: {
      label: "泣き顔・悲しい",
      phrases: [
        "ごめんね",
        "さみしい",
        "しょんぼり",
        "泣いちゃう",
        "つらいよ",
        "残念…",
        "会いたいな",
        "助けて〜",
        "ぐすん",
        "大丈夫かな",
      ],
    },
    angry: {
      label: "怒り顔・不満",
      phrases: [
        "ぷんぷん",
        "もう！",
        "ちょっと待って",
        "むむっ",
        "だめだよ",
        "困ったな",
        "聞いてよ〜",
        "えーっ",
        "納得できない",
        "がまん中",
      ],
    },
    surprised: {
      label: "驚き顔",
      phrases: [
        "びっくり！",
        "えっ！？",
        "ほんとに？",
        "まさか！",
        "すごい！",
        "なんと！",
        "そうなの？",
        "わあ！",
        "おおっ",
        "信じられない",
      ],
    },
    sleepy: {
      label: "眠そう・寝ている",
      phrases: [
        "おやすみ",
        "ねむい…",
        "すやすや",
        "また明日",
        "ひと休み",
        "お先に失礼",
        "もう寝ます",
        "のんびり中",
        "あと5分…",
        "おつかれさま",
      ],
    },
    greeting: {
      label: "あいさつ・返事",
      phrases: [
        "おはよう",
        "こんにちは",
        "こんばんは",
        "よろしくね",
        "了解です",
        "はーい",
        "ただいま",
        "いってきます",
        "いってらっしゃい",
        "おかえり",
      ],
    },
    support: {
      label: "応援・やさしい",
      phrases: [
        "応援してるよ",
        "無理しないでね",
        "だいじょうぶ",
        "ゆっくりでいいよ",
        "がんばって",
        "お大事に",
        "いつも感謝です",
        "よろしくお願いします",
        "お疲れさまです",
        "気をつけてね",
      ],
    },
  };
  function candidates(emotion) {
    return (groups[emotion] || groups.unknown).phrases.slice();
  }
  function choose(emotion, used = [], offset = 0) {
    const pool = candidates(emotion);
    if (!pool.length) return null;
    const free = pool.filter((text) => !used.includes(text));
    const values = free.length ? free : pool;
    return values[((offset % values.length) + values.length) % values.length];
  }
  // Neutral daily phrases: assignment is by number, never by inferred emotion.
  function automatic(rows) {
    const pool = [
      ...groups.greeting.phrases,
      ...groups.smile.phrases,
      ...groups.support.phrases,
      ...groups.sleepy.phrases,
      "ありがとうね",
      "また連絡するね",
      "よろしくです",
      "確認します",
    ];
    const used = new Set(
      rows.map((row) => row.caption.normalize("NFKC").trim()).filter(Boolean),
    );
    return rows.map((row) => {
      if (row.caption.trim()) return { ...row };
      const caption = pool.find(
        (text) => !used.has(text.normalize("NFKC").trim()),
      );
      if (!caption) throw new Error("重複しない候補が不足しています。");
      used.add(caption.normalize("NFKC").trim());
      return { ...row, caption };
    });
  }
  function duplicates(rows) {
    const counts = new Map();
    for (const row of rows) {
      const key = row.caption.normalize("NFKC").trim();
      if (!key) continue;
      if (!counts.has(key)) counts.set(key, []);
      counts.get(key).push(row.slot);
    }
    return [...counts.entries()]
      .filter(([, slots]) => slots.length > 1)
      .map(([caption, slots]) => ({ caption, slots }));
  }
  const api = { groups, candidates, choose, duplicates, automatic };
  root.StampSuggestions = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
