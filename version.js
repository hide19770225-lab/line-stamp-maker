(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const raw = window.STAMP_BUILD_INFO || {};
  const info = Object.freeze({
    version: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(raw.version || "") ? raw.version : null,
    commit: /^[a-f0-9]{40}$/i.test(raw.commit || "") ? raw.commit : null,
    builtAt: raw.builtAt && Number.isFinite(Date.parse(raw.builtAt)) ? raw.builtAt : null,
    environment: typeof raw.environment === "string" && raw.environment.trim() ? raw.environment : null,
    buildId: typeof raw.buildId === "string" ? raw.buildId : null,
  });
  $("version-button").textContent = `Ver. ${info.version || "不明"}`;
  $("build-version").textContent = info.version || "不明";
  $("build-commit").textContent = info.commit || "不明";
  $("build-environment").textContent = info.environment || "不明";
  $("build-time").textContent = info.builtAt
    ? new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(info.builtAt)) + " JST"
    : "不明";
  let checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL("build-info.json", location.href);
      url.searchParams.set("check", Date.now());
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("unavailable");
      const latest = await response.json();
      if (!latest.buildId || !info.buildId) {
        $("version-status").textContent = "ビルド情報が不明のため、更新を比較できません。古い画面の場合は設定を保存して再読み込みしてください。";
      } else if (latest.buildId !== info.buildId) {
        $("version-update").hidden = false;
        $("version-status").textContent = "公開ビルドが更新されています。設定をJSON保存してから再読み込みしてください。";
      } else {
        $("version-status").textContent = "この画面は現在配信中のビルドです。";
      }
    } catch {
      $("version-status").textContent = "公開ビルド情報を取得できません（不明）。古い画面の場合は設定を保存して再読み込みしてください。";
    } finally {
      clearTimeout(timer);
      checking = false;
    }
  }
  $("version-button").onclick = () => { $("version-dialog").showModal(); check(); };
  $("close-version").onclick = () => $("version-dialog").close();
  $("check-version").onclick = check;
  $("reload-version").onclick = () => {
    if (!confirm("加工設定はJSON保存しましたか？再読み込みで元画像の再選択が必要になります。")) return;
    const url = new URL(location.href);
    url.searchParams.set("reload", Date.now());
    location.replace(url.href);
  };
  window.addEventListener("pageshow", check);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})();
