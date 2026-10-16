(() => {
  "use strict";
  const C = window.StampCore,
    $ = (id) => document.getElementById(id);
  const state = {
    sources: [],
    selectedSource: 0,
    selectedStamp: -1,
    main: 0,
    tab: 0,
    busy: false,
    brush: "none",
    zipURL: null,
    dirty: false,
  };
  let toastTimer,
    drawing = false,
    lastPoint = null,
    dragLine = null,
    nextId = 1;
  const stamps = () => state.sources.flatMap((source) => source.stamps || []);
  function notify(message, error = false, persistent = false) {
    clearTimeout(toastTimer);
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
    $("status").hidden = false;
    if (!persistent)
      toastTimer = setTimeout(() => {
        $("status").hidden = true;
      }, 6500);
  }
  function invalidate() {
    state.dirty = true;
    if (state.zipURL) {
      URL.revokeObjectURL(state.zipURL);
      state.zipURL = null;
    }
    $("download-link").hidden = true;
  }
  async function task(action) {
    if (state.busy) return;
    state.busy = true;
    document.body.classList.add("busy");
    const buttons = [...document.querySelectorAll("button")].filter(
      (button) => !button.disabled,
    );
    buttons.forEach((button) => {
      button.disabled = true;
    });
    $("file-input").disabled = true;
    try {
      await action();
    } catch (error) {
      console.error(error);
      notify(
        error.message ||
          "処理できませんでした。画像を確認して再度お試しください。",
        true,
      );
    } finally {
      state.busy = false;
      document.body.classList.remove("busy");
      buttons.forEach((button) => {
        button.disabled = false;
      });
      $("file-input").disabled = false;
    }
  }
  const frame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    );
  function nextStep(index) {
    document
      .querySelectorAll(".steps li")
      .forEach((step, i) => step.classList.toggle("current", i === index));
  }
  const signature = (s) =>
    JSON.stringify([s.xs, s.ys, s.mode, s.tolerance, s.color]);
  function addSource(image, name) {
    state.sources.push({
      id: nextId++,
      image,
      name,
      xs: [0, 0.5, 1],
      ys: [0, 0.2, 0.4, 0.6, 0.8, 1],
      stamps: [],
      mode: "auto",
      tolerance: 24,
      color: "#ffffff",
    });
    state.selectedSource = state.sources.length - 1;
    invalidate();
    renderSources();
    renderSourceEditor();
    nextStep(1);
  }
  async function decodeFile(file) {
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) &&
      !/\.(png|jpe?g|webp)$/i.test(file.name)
    )
      throw new Error(`${file.name}: PNG・JPEG・WebPを選んでください。`);
    if (file.size > 40 * 1024 * 1024)
      throw new Error(`${file.name}: 40MB以内の画像を選んでください。`);
    let image, release;
    if (typeof createImageBitmap === "function") {
      try {
        image = await createImageBitmap(file, {
          imageOrientation: "from-image",
        });
        release = () => image.close();
      } catch {
        /* Safari fallback below. */
      }
    }
    if (!image) {
      const url = URL.createObjectURL(file),
        img = new Image();
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () =>
            reject(
              new Error(
                "画像を読み込めませんでした。別のPNG/JPEG画像をお試しください。",
              ),
            );
          img.src = url;
        });
        image = img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const width = image.width || image.naturalWidth,
      height = image.height || image.naturalHeight;
    if (width < 20 || height < 50) {
      release?.();
      throw new Error("画像が小さすぎます。2列×5段の画像を選んでください。");
    }
    // Bound retained memory on mobile. Original file is never retained or transmitted.
    const ratio = Math.min(1, 2560 / Math.max(width, height)),
      output = C.canvas(Math.round(width * ratio), Math.round(height * ratio));
    output.getContext("2d").drawImage(image, 0, 0, output.width, output.height);
    release?.();
    return output;
  }
  async function importFiles(files) {
    const remaining = 4 - state.sources.length;
    if (remaining <= 0) {
      notify(
        "読み込める画像は最大4枚です。不要な画像を削除してください。",
        true,
      );
      return;
    }
    const chosen = Array.from(files).slice(0, remaining);
    if (files.length > remaining)
      notify(`最大4枚までのため、先頭の${remaining}枚を読み込みます。`);
    await task(async () => {
      let loaded = 0;
      for (const file of chosen) {
        notify(
          `画像を読み込み中… ${loaded + 1} / ${chosen.length}`,
          false,
          true,
        );
        await frame();
        try {
          addSource(await decodeFile(file), file.name);
          loaded++;
        } catch (error) {
          notify(error.message, true);
        }
      }
      if (loaded) {
        renderResults();
        notify(
          `${loaded}枚を読み込みました。分割線を確認して加工してください。`,
        );
      }
    });
    $("file-input").value = "";
  }
  $("file-input").addEventListener("change", (e) =>
    importFiles(e.target.files),
  );
  for (const type of ["dragenter", "dragover"])
    $("dropzone").addEventListener(type, (e) => {
      e.preventDefault();
      $("dropzone").classList.add("dragover");
    });
  for (const type of ["dragleave", "drop"])
    $("dropzone").addEventListener(type, (e) => {
      e.preventDefault();
      $("dropzone").classList.remove("dragover");
      if (type === "drop" && !state.busy) importFiles(e.dataTransfer.files);
    });
  $("sample-button").addEventListener("click", () => {
    if (state.sources.length >= 4) {
      notify("画像は最大4枚です。", true);
      return;
    }
    const image = C.canvas(800, 1600),
      ctx = image.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 800, 1600);
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 2; col++) {
        const x = col * 400 + 200,
          y = row * 320 + 155;
        ctx.save();
        ctx.translate(x, y);
        ctx.lineWidth = 7;
        ctx.strokeStyle = "#44664d";
        ctx.fillStyle = "#fffef4";
        for (const ex of [-63, 63]) {
          ctx.beginPath();
          ctx.ellipse(ex, -78, 30, 60, ex < 0 ? -0.25 : 0.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.ellipse(0, 8, 107, 91, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#eeb7ae";
        for (const ex of [-66, 66]) {
          ctx.beginPath();
          ctx.ellipse(ex, 30, 21, 12, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#44664d";
        for (const ex of [-35, 35]) {
          ctx.beginPath();
          ctx.arc(ex, 0, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(-15, 32);
        ctx.quadraticCurveTo(0, 48 + row * 2, 15, 32);
        ctx.stroke();
        ctx.fillStyle = ["#6c9471", "#d2a591", "#b5accc", "#c2b16b", "#8dbac0"][
          row
        ];
        ctx.beginPath();
        ctx.ellipse(0, 112, 39, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    addSource(image, `おためし・白うさぎ ${state.sources.length + 1}`);
    notify("サンプルを追加しました。白い体を残した透過を試せます。");
  });
  function renderSources() {
    $("source-count").textContent = `${state.sources.length} / 4 枚`;
    $("source-list").replaceChildren();
    $("source-select").replaceChildren();
    state.sources.forEach((source, index) => {
      const card = document.createElement("div");
      card.className = "source-card";
      const thumb = C.canvas(48, 60);
      thumb.getContext("2d").drawImage(source.image, 0, 0, 48, 60);
      const img = document.createElement("img");
      img.src = thumb.toDataURL();
      img.alt = `元画像 ${index + 1}`;
      const name = document.createElement("div");
      name.className = "source-name";
      name.textContent = source.name;
      const detail = document.createElement("small");
      detail.textContent = `${source.image.width} × ${source.image.height} · ${source.stamps.length ? (source.processSignature === signature(source) ? "10個 加工済み" : "設定変更あり・再加工が必要") : "未加工"}`;
      name.append(detail);
      const edit = document.createElement("button");
      edit.textContent = "調整";
      edit.setAttribute("aria-label", `元画像${index + 1}を調整`);
      edit.onclick = () => {
        if (state.busy) return;
        state.selectedSource = index;
        renderSourceEditor();
        $("split-section").scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      };
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.setAttribute("aria-label", `元画像${index + 1}を削除`);
      remove.onclick = () => {
        if (
          state.busy ||
          !confirm("この元画像と、対応する10個の編集内容を削除しますか？")
        )
          return;
        source.image.width = source.image.height = 1;
        state.sources.splice(index, 1);
        state.selectedSource = Math.min(
          state.selectedSource,
          state.sources.length - 1,
        );
        invalidate();
        renderSources();
        renderSourceEditor();
        renderResults();
      };
      card.append(img, name, edit, remove);
      $("source-list").append(card);
      $("source-select").add(
        new Option(`${index + 1}. ${source.name}`, String(index)),
      );
    });
    $("process-button").textContent =
      state.sources.length > 1
        ? "この画像を10個に分割・透過する →"
        : "10個に分割して、透過を確認 →";
  }
  $("source-select").onchange = () => {
    state.selectedSource = Number($("source-select").value);
    renderSourceEditor();
  };
  function renderSourceEditor() {
    const source = state.sources[state.selectedSource];
    $("split-section").hidden = !source;
    if (!source) return;
    $("source-select").value = String(state.selectedSource);
    $("background-mode").value = source.mode;
    $("background-color").value = source.color;
    $("tolerance").value = source.tolerance;
    $("tolerance-value").textContent = source.tolerance;
    renderGridControls();
    drawSplit();
  }
  function renderGridControls() {
    const source = state.sources[state.selectedSource];
    $("grid-controls").replaceChildren();
    for (const [axis, values] of [
      ["xs", source.xs],
      ["ys", source.ys],
    ])
      values.forEach((value, i) => {
        const label = document.createElement("label");
        label.textContent = `${axis === "xs" ? "縦" : "横"}線 ${i + 1}（%）`;
        const input = document.createElement("input");
        input.type = "number";
        input.inputMode = "decimal";
        input.min = "0";
        input.max = "100";
        input.step = ".1";
        input.value = (value * 100).toFixed(1);
        input.onchange = () => {
          changeGrid(axis, i, Number(input.value) / 100);
          input.value = (source[axis][i] * 100).toFixed(1);
          drawSplit();
        };
        label.append(input);
        $("grid-controls").append(label);
      });
  }
  function changeGrid(axis, index, value) {
    const s = state.sources[state.selectedSource],
      lines = s[axis];
    if (!Number.isFinite(value)) return;
    const gap = Math.max(
      0.004,
      2 / (axis === "xs" ? s.image.width : s.image.height),
    );
    lines[index] = Math.max(
      index ? lines[index - 1] + gap : 0,
      Math.min(index < lines.length - 1 ? lines[index + 1] - gap : 1, value),
    );
    invalidate();
  }
  function drawSplit() {
    const source = state.sources[state.selectedSource];
    if (!source) return;
    const c = $("split-canvas"),
      ratio = Math.min(
        1,
        640 / Math.max(source.image.width, source.image.height),
      );
    c.width = Math.round(source.image.width * ratio);
    c.height = Math.round(source.image.height * ratio);
    const ctx = c.getContext("2d");
    ctx.drawImage(source.image, 0, 0, c.width, c.height);
    ctx.fillStyle = "#173b2a66";
    ctx.fillRect(0, 0, source.xs[0] * c.width, c.height);
    ctx.fillRect(source.xs[2] * c.width, 0, c.width, c.height);
    ctx.fillRect(
      source.xs[0] * c.width,
      0,
      (source.xs[2] - source.xs[0]) * c.width,
      source.ys[0] * c.height,
    );
    ctx.fillRect(
      source.xs[0] * c.width,
      source.ys[5] * c.height,
      (source.xs[2] - source.xs[0]) * c.width,
      c.height,
    );
    ctx.strokeStyle = "#21875c";
    ctx.lineWidth = 2;
    for (const x of source.xs) {
      const xx = Math.max(1, Math.min(c.width - 1, x * c.width));
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, c.height);
      ctx.stroke();
    }
    for (const y of source.ys) {
      const yy = Math.max(1, Math.min(c.height - 1, y * c.height));
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(c.width, yy);
      ctx.stroke();
    }
    for (let r = 0; r < 5; r++)
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = "#217653";
        ctx.fillRect(
          source.xs[col] * c.width + 5,
          source.ys[r] * c.height + 5,
          22,
          20,
        );
        ctx.fillStyle = "white";
        ctx.font = "11px sans-serif";
        ctx.fillText(
          String(r * 2 + col + 1).padStart(2, "0"),
          source.xs[col] * c.width + 9,
          source.ys[r] * c.height + 19,
        );
      }
  }
  $("split-canvas").onpointerdown = (e) => {
    if (state.busy) return;
    const rect = e.currentTarget.getBoundingClientRect(),
      source = state.sources[state.selectedSource];
    const x = (e.clientX - rect.left) / rect.width,
      y = (e.clientY - rect.top) / rect.height;
    const candidates = [
      ...source.xs.map((v, i) => ({
        axis: "xs",
        i,
        distance: Math.abs(v - x) * rect.width,
      })),
      ...source.ys.map((v, i) => ({
        axis: "ys",
        i,
        distance: Math.abs(v - y) * rect.height,
      })),
    ].sort((a, b) => a.distance - b.distance);
    if (candidates[0].distance < 28) {
      dragLine = candidates[0];
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  $("split-canvas").onpointermove = (e) => {
    if (!dragLine) return;
    const r = e.currentTarget.getBoundingClientRect();
    changeGrid(
      dragLine.axis,
      dragLine.i,
      dragLine.axis === "xs"
        ? (e.clientX - r.left) / r.width
        : (e.clientY - r.top) / r.height,
    );
    drawSplit();
  };
  function endGridDrag() {
    if (dragLine) {
      dragLine = null;
      renderGridControls();
    }
  }
  $("split-canvas").onpointerup = endGridDrag;
  $("split-canvas").onpointercancel = endGridDrag;
  $("reset-grid").onclick = () => {
    const source = state.sources[state.selectedSource];
    source.xs = [0, 0.5, 1];
    source.ys = [0, 0.2, 0.4, 0.6, 0.8, 1];
    invalidate();
    renderSourceEditor();
  };
  for (const id of ["background-mode", "background-color", "tolerance"])
    $(id).addEventListener("input", () => {
      const source = state.sources[state.selectedSource];
      if (!source) return;
      source.mode = $("background-mode").value;
      source.color = $("background-color").value;
      source.tolerance = Number($("tolerance").value);
      $("tolerance-value").textContent = source.tolerance;
      invalidate();
    });
  $("process-button").onclick = () => {
    const source = state.sources[state.selectedSource];
    if (
      source.stamps.length &&
      !confirm(
        "この元画像を分割し直します。対応する10個のセリフと透過修正をリセットしますか？",
      )
    )
      return;
    task(async () => {
      const tiles = [];
      for (let row = 0; row < 5; row++)
        for (let column = 0; column < 2; column++) {
          notify(`分割・背景透過中… ${row * 2 + column + 1} / 10`, false, true);
          await frame();
          tiles.push(
            C.createTile(
              source,
              column,
              row,
              source.mode,
              source.tolerance,
              source.color,
            ),
          );
        }
      source.stamps = tiles;
      source.processSignature = signature(source);
      invalidate();
      renderSources();
      renderResults();
      nextStep(2);
      notify(
        "10個を作成しました。画像をタップして、白い部分と透過を確認してください。",
      );
      $("results-section").scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    });
  };
  function renderResults() {
    const all = stamps();
    $("results-section").hidden = !all.length;
    $("export-section").hidden = !all.length;
    $("stamp-count").textContent = `${all.length} / 40 個`;
    $("stamp-grid").replaceChildren();
    all.forEach((stamp, i) => {
      const button = document.createElement("button");
      button.className = `stamp-card${stamp.reviewed ? " reviewed" : ""}`;
      button.setAttribute("aria-label", `スタンプ${i + 1}を編集・透過確認`);
      const c = C.canvas(370, 320);
      c.className = "stamp-canvas";
      C.renderStamp(stamp, c);
      const footer = document.createElement("footer"),
        number = document.createElement("span"),
        review = document.createElement("span");
      number.textContent = `${String(i + 1).padStart(2, "0")}.png`;
      review.className = "review-state";
      review.textContent = stamp.reviewed ? "✓ 確認済み" : "透過を確認";
      footer.append(number, review);
      button.append(c, footer);
      button.onclick = () => {
        if (!state.busy) openEditor(i);
      };
      $("stamp-grid").append(button);
    });
    state.main = Math.max(0, Math.min(state.main, all.length - 1));
    state.tab = Math.max(0, Math.min(state.tab, all.length - 1));
    for (const id of ["main-select", "tab-select"]) {
      $(id).replaceChildren();
      all.forEach((_, i) =>
        $(id).add(
          new Option(`スタンプ ${String(i + 1).padStart(2, "0")}`, String(i)),
        ),
      );
    }
    $("main-select").value = String(state.main);
    $("tab-select").value = String(state.tab);
    updateSpecial();
    updateValidation();
  }
  function copyCanvas(from, to) {
    to.width = from.width;
    to.height = from.height;
    to.getContext("2d").drawImage(from, 0, 0);
  }
  function updateSpecial() {
    const all = stamps();
    if (!all.length) return;
    copyCanvas(C.specialImage(all[state.main], 240, 240), $("main-preview"));
    copyCanvas(C.specialImage(all[state.tab], 96, 74), $("tab-preview"));
  }
  for (const [id, key] of [
    ["main-select", "main"],
    ["tab-select", "tab"],
  ])
    $(id).onchange = () => {
      state[key] = Number($(id).value);
      invalidate();
      updateSpecial();
    };
  $("preview-background").onchange = () => {
    $("stamp-grid").className = `stamp-grid ${$("preview-background").value}`;
  };
  function validation() {
    const all = stamps(),
      rendered = all.map((stamp) => C.renderStamp(stamp));
    const unreviewed = all.filter((s) => !s.reviewed).length,
      empty = rendered.flatMap((r, i) => (r.empty ? [i + 1] : [])),
      clipped = rendered.flatMap((r, i) => (r.textClipped ? [i + 1] : []));
    const stale = state.sources.flatMap((s, i) =>
      s.stamps.length && s.processSignature !== signature(s) ? [i + 1] : [],
    );
    return {
      all,
      rendered,
      unreviewed,
      empty,
      clipped,
      stale,
      complete:
        all.length === 40 &&
        state.sources.length === 4 &&
        state.sources.every((s) => s.stamps.length === 10),
    };
  }
  function updateValidation() {
    const v = validation(),
      list = $("validation-list");
    list.replaceChildren();
    function item(message, type = "") {
      const li = document.createElement("li");
      li.className = type;
      li.textContent = message;
      list.append(li);
    }
    item(
      v.complete
        ? "40個のスタンプとメイン・タブの計42画像"
        : `${v.all.length}個でテスト中。申請用には4枚すべてを加工して40個にしてください。`,
      v.complete ? "" : "warning",
    );
    item("スタンプ 370 × 320px・PNG・偶数寸法");
    item("メイン 240 × 240px / タブ 96 × 74px");
    item("外周10pxの透明な余白を確保");
    item(
      v.unreviewed
        ? `透過の目視確認：あと${v.unreviewed}個`
        : "全スタンプの透過を目視確認済み",
      v.unreviewed ? "warning" : "",
    );
    if (v.stale.length)
      item(
        `設定変更を反映するため、元画像${v.stale.join(", ")}を分割し直してください。`,
        "error",
      );
    if (v.empty.length)
      item(`空の画像があります：${v.empty.join(", ")}番`, "error");
    if (v.clipped.length)
      item(
        `文字が枠からはみ出します：${v.clipped.join(", ")}番（文字を小さくする・位置を調整）`,
        "error",
      );
    item("1画像1MB以下・ZIP 20MB以下を保存時に検査", "pending");
    $("download-button").textContent = v.complete
      ? "申請用ZIPを作成して保存 ↓"
      : `${v.all.length}個のテストZIPを保存 ↓`;
    $("download-note").textContent = v.complete
      ? "iPhoneでは保存後「ファイル」アプリから確認できます。"
      : "テスト用ZIPです。10・20・30個では、このツールの40個セットとして申請できません。";
    return v;
  }
  $("apply-captions").onclick = () => {
    if (state.busy) return;
    const lines = $("bulk-captions").value.replace(/\r/g, "").split("\n");
    if (
      lines.length > 40 ||
      lines.some((line) => Array.from(line).length > 120)
    ) {
      notify("40行以内、各行120文字以内で入力してください。", true);
      return;
    }
    stamps().forEach((stamp, i) => {
      stamp.caption = lines[i] || "";
    });
    invalidate();
    renderResults();
    notify("セリフを一覧に反映しました。長いセリフは表示を確認してください。");
  };
  function selected() {
    return stamps()[state.selectedStamp];
  }
  function openEditor(index) {
    state.selectedStamp = index;
    const stamp = selected();
    state.brush = "none";
    $("dialog-title").textContent =
      `スタンプ ${String(index + 1).padStart(2, "0")} を編集`;
    $("caption-text").value = stamp.caption;
    $("font-family").value = stamp.style.font;
    $("text-color").value = stamp.style.color;
    $("text-outline").checked = stamp.style.outline;
    for (const [id, key] of [
      ["font-size", "size"],
      ["text-x", "x"],
      ["text-y", "y"],
    ]) {
      $(id).value = stamp.style[key];
      $(`${id}-value`).textContent = stamp.style[key];
    }
    $("reviewed-checkbox").checked = stamp.reviewed;
    document
      .querySelectorAll("[data-brush]")
      .forEach((b) =>
        b.classList.toggle("selected", b.dataset.brush === "none"),
      );
    drawEditor();
    if (!$("stamp-dialog").open) {
      $("stamp-dialog").showModal();
      document.body.classList.add("modal-open");
    }
  }
  function drawEditor() {
    if (selected()) C.renderStamp(selected(), $("edit-canvas"));
  }
  function closeEditor() {
    $("stamp-dialog").close();
  }
  $("close-dialog").onclick = closeEditor;
  $("stamp-dialog").addEventListener("close", () => {
    drawing = false;
    document.body.classList.remove("modal-open");
    renderResults();
  });
  $("edit-background").onchange = () => {
    $("edit-preview").className = `edit-preview ${$("edit-background").value}`;
  };
  for (const id of [
    "caption-text",
    "font-family",
    "font-size",
    "text-x",
    "text-y",
    "text-color",
    "text-outline",
  ])
    $(id).addEventListener("input", () => {
      const stamp = selected();
      if (!stamp) return;
      stamp.caption = $("caption-text").value;
      stamp.style = {
        font: $("font-family").value,
        size: Number($("font-size").value),
        x: Number($("text-x").value),
        y: Number($("text-y").value),
        color: $("text-color").value,
        outline: $("text-outline").checked,
      };
      for (const name of ["font-size", "text-x", "text-y"])
        $(`${name}-value`).textContent = $(name).value;
      invalidate();
      drawEditor();
    });
  $("reviewed-checkbox").onchange = () => {
    selected().reviewed = $("reviewed-checkbox").checked;
    invalidate();
  };
  $("apply-style-all").onclick = () => {
    const style = { ...selected().style };
    stamps().forEach((stamp) => {
      stamp.style = { ...style };
    });
    invalidate();
    drawEditor();
    notify("文字のフォント・サイズ・位置・色を全スタンプに適用しました。");
  };
  $("save-edit").onclick = () => {
    if (!$("reviewed-checkbox").checked) {
      notify(
        "白い部分と透過の仕上がりを確認して、チェックを入れてください。",
        true,
      );
      $("reviewed-checkbox").focus();
      return;
    }
    selected().reviewed = true;
    invalidate();
    const next = stamps().findIndex(
      (stamp, i) => i > state.selectedStamp && !stamp.reviewed,
    );
    if (next >= 0) openEditor(next);
    else {
      closeEditor();
      notify("確認を保存しました。申請前チェックからZIPを作成できます。");
    }
  };
  for (const button of document.querySelectorAll("[data-brush]"))
    button.onclick = () => {
      state.brush = button.dataset.brush;
      document
        .querySelectorAll("[data-brush]")
        .forEach((b) => b.classList.toggle("selected", b === button));
      $("edit-canvas").style.cursor =
        state.brush === "none" ? "default" : "crosshair";
    };
  $("brush-size").oninput = () => {
    $("brush-value").textContent = $("brush-size").value;
  };
  function snapshot(stamp) {
    stamp.undo.push(stamp.mask.slice());
    if (stamp.undo.length > 8) stamp.undo.shift();
  }
  function brushPoint(e) {
    const r = $("edit-canvas").getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * 370) / r.width,
      y: ((e.clientY - r.top) * 320) / r.height,
    };
  }
  function paint(x, y) {
    const stamp = selected(),
      radius = Number($("brush-size").value) / 2;
    for (
      let py = Math.max(10, Math.floor(y - radius));
      py < Math.min(310, Math.ceil(y + radius));
      py++
    )
      for (
        let px = Math.max(10, Math.floor(x - radius));
        px < Math.min(360, Math.ceil(x + radius));
        px++
      ) {
        if ((px - x) ** 2 + (py - y) ** 2 <= radius ** 2) {
          const p = py * 370 + px;
          stamp.mask[p] =
            state.brush === "restore" ? stamp.original.data[p * 4 + 3] : 0;
        }
      }
  }
  $("edit-canvas").onpointerdown = (e) => {
    if (state.brush === "none") return;
    e.preventDefault();
    drawing = true;
    snapshot(selected());
    lastPoint = brushPoint(e);
    paint(lastPoint.x, lastPoint.y);
    e.currentTarget.setPointerCapture(e.pointerId);
    selected().reviewed = false;
    $("reviewed-checkbox").checked = false;
    invalidate();
    drawEditor();
  };
  $("edit-canvas").onpointermove = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = brushPoint(e),
      dx = p.x - lastPoint.x,
      dy = p.y - lastPoint.y,
      count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    for (let i = 1; i <= count; i++)
      paint(lastPoint.x + (dx * i) / count, lastPoint.y + (dy * i) / count);
    lastPoint = p;
    drawEditor();
  };
  function endPaint() {
    drawing = false;
    lastPoint = null;
  }
  $("edit-canvas").onpointerup = endPaint;
  $("edit-canvas").onpointercancel = endPaint;
  $("undo-brush").onclick = () => {
    const stamp = selected();
    if (stamp.undo.length) {
      stamp.mask = stamp.undo.pop();
      stamp.reviewed = false;
      $("reviewed-checkbox").checked = false;
      invalidate();
      drawEditor();
    }
  };
  $("reset-mask").onclick = () => {
    const stamp = selected();
    snapshot(stamp);
    stamp.mask = stamp.autoMask.slice();
    stamp.reviewed = false;
    $("reviewed-checkbox").checked = false;
    invalidate();
    drawEditor();
  };
  function triggerDownload(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
  }
  $("download-single").onclick = () =>
    task(async () => {
      const stamp = selected(),
        result = C.renderStamp(stamp);
      if (result.empty || result.textClipped)
        throw new Error(
          "空の画像または文字のはみ出しがあります。調整してください。",
        );
      const blob = await C.pngBlob(result.canvas),
        url = URL.createObjectURL(blob);
      triggerDownload(
        url,
        `${String(state.selectedStamp + 1).padStart(2, "0")}.png`,
      );
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  $("download-button").onclick = () =>
    task(async () => {
      const v = updateValidation();
      if (v.stale.length)
        throw new Error(
          `元画像${v.stale.join(", ")}の分割・透過設定が変更されています。分割し直してから保存してください。`,
        );
      if (v.empty.length || v.clipped.length)
        throw new Error(
          "空の画像または文字のはみ出しがあります。申請前チェックの番号を修正してください。",
        );
      if (v.complete && v.unreviewed)
        throw new Error(
          `申請用ZIPを作る前に、あと${v.unreviewed}個の透過を編集画面で確認してください。`,
        );
      nextStep(3);
      const files = [];
      for (let i = 0; i < v.all.length; i++) {
        notify(`PNGを作成中… ${i + 1} / ${v.all.length + 2}`, false, true);
        await frame();
        const blob = await C.pngBlob(v.rendered[i].canvas);
        if (blob.size > 1024 * 1024)
          throw new Error(`${i + 1}番の画像が1MBを超えています。`);
        files.push({ name: `${String(i + 1).padStart(2, "0")}.png`, blob });
      }
      for (const [name, canvas] of [
        ["main.png", $("main-preview")],
        ["tab.png", $("tab-preview")],
      ]) {
        const blob = await C.pngBlob(canvas);
        if (blob.size > 1024 * 1024)
          throw new Error(`${name}が1MBを超えています。`);
        files.push({ name, blob });
      }
      notify("ZIPにまとめています…", false, true);
      await frame();
      const zip = await C.makeZip(files);
      if (zip.size > 20 * 1024 * 1024)
        throw new Error("ZIPがこのツールの安全上限20MBを超えています。");
      if (state.zipURL) URL.revokeObjectURL(state.zipURL);
      state.zipURL = URL.createObjectURL(zip);
      const name = v.complete
        ? "line-stamps-40.zip"
        : `line-stamps-test-${v.all.length}.zip`;
      $("download-link").href = state.zipURL;
      $("download-link").download = name;
      $("download-link").hidden = false;
      const li = document.createElement("li");
      li.textContent = `実ファイル検査OK：${files.length}画像・${(zip.size / 1024 / 1024).toFixed(2)}MB`;
      $("validation-list").append(li);
      state.dirty = false;
      triggerDownload(state.zipURL, name);
      notify(
        `${files.length}画像のZIPを作成しました。保存が始まらない場合は「作成したZIPを保存する」をタップしてください。`,
      );
    });
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty && state.sources.length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
})();
