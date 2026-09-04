/* ============================================================
   偏爱到骨 · 阅读器逻辑
   纯静态、零依赖、零网络请求。
   ============================================================ */

(() => {
  "use strict";

  const CHAPTERS_DIR = "chapters/";
  const MANIFEST_URL = CHAPTERS_DIR + "_manifest.json";
  const META_URL = "assets/meta.json";

  // ---------- 状态 ----------
  const state = {
    chapters: [],          // [{num, title, volume}]
    current: 1,            // 当前章号
    manifest: null,        // 完整 manifest
    meta: { title: "偏爱到骨", author: "", intro: "" },
    settings: {
      fontSize: 18,
      lineHeight: 1.75,
      fontFamily: "serif",
      theme: "auto",
      clickPaginate: true,
      horizontalFlip: false,
    },
    progress: {},          // { 1: 0.34, ... } 章节阅读百分比
  };

  // ---------- 工具 ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const pad3 = (n) => String(n).padStart(3, "0");

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    return r.json();
  }

  // ---------- 初始化 ----------
  async function init() {
    loadSettings();
    applySettings();
    bindUI();
    bindKeyboard();
    bindClickPaginate();

    try {
      const [manifest, meta] = await Promise.all([
        fetchJSON(MANIFEST_URL),
        fetchJSON(META_URL).catch(() => ({})),
      ]);
      state.manifest = manifest;
      state.chapters = manifest.chapters;
      state.meta = { ...state.meta, ...meta };
      $("#brandTitle").textContent = state.meta.title || "偏爱到骨";
    } catch (e) {
      console.error(e);
      $("#chapter").innerHTML =
        '<p class="loading">章节清单加载失败。请确认 chapters/_manifest.json 存在并通过 HTTP（不能直接 file:// 打开）访问。</p>';
      return;
    }

    // 起始章：URL hash > 上次记忆 > 第一章
    const start = resolveStartChapter();
    await loadChapter(start, { skipHash: true });
    restoreScroll();
  }

  function resolveStartChapter() {
    const hash = location.hash;
    const m = hash.match(/#(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= state.chapters.length) return n;
    }
    const last = parseInt(localStorage.getItem("pia:lastChapter") || "1", 10);
    if (last >= 1 && last <= state.chapters.length) return last;
    return 1;
  }

  // ---------- 章节加载 ----------
  async function loadChapter(num, opts = {}) {
    if (!state.chapters.length) return;
    num = Math.max(1, Math.min(state.chapters.length, num));
    state.current = num;
    localStorage.setItem("pia:lastChapter", String(num));

    // URL hash（不触发滚动）
    if (!opts.skipHash) {
      history.replaceState(null, "", "#" + num);
    } else {
      history.replaceState(null, "", "#" + num);
    }

    const article = $("#chapter");
    article.classList.add("is-loading");
    article.innerHTML = '<p class="loading">载入中…</p>';

    let data;
    try {
      data = await fetchJSON(CHAPTERS_DIR + pad3(num) + ".json");
    } catch (e) {
      article.innerHTML = '<p class="loading">章节加载失败。</p>';
      return;
    }

    renderChapter(data);
    article.classList.remove("is-loading");

    // 顶部条
    const chap = state.chapters[num - 1];
    $("#brandChapter").textContent =
      "第" + pad3(num) + "章 · " + (chap ? chap.title : "");

    // 章末导航
    const end = $("#chapterEnd");
    end.hidden = false;
    end.querySelector('[data-action="prev"]').disabled = (num === 1);
    end.querySelector('[data-action="next"]').disabled =
      (num === state.chapters.length);

    // 进度条 / 滚动位置
    if (opts.scrollTo !== undefined) {
      window.scrollTo({ top: opts.scrollTo, behavior: "auto" });
    } else if (!opts.restoreFromProgress) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    updateProgress();
    updateTopbarButtons();

    // 标题栏
    document.title = `第${pad3(num)}章 ${data.title} · ${state.meta.title}`;
  }

  function renderChapter(data) {
    const article = $("#chapter");
    const ch = state.chapters[data.num - 1];
    const volume = (data.volume || ch?.volume || "").trim();

    let html = "";
    html += '<header class="ch-title">';
    html += `<span class="ch-num">第${pad3(data.num)}章</span>`;
    html += `<span class="ch-name">${escapeHtml(data.title || "")}</span>`;
    html += "</header>";
    if (volume && !/终章|后记|尾声/.test(data.title || "")) {
      html += `<div class="ch-volume">— ${escapeHtml(volume)} —</div>`;
    }

    // 正文按 \n\n 分段，单 \n 视为同一段
    const paras = data.body
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of paras) {
      html += `<p>${escapeHtml(p)}</p>`;
    }

    article.innerHTML = html;
  }

  // ---------- 设置 / 持久化 ----------
  function loadSettings() {
    try {
      const raw = localStorage.getItem("pia:settings");
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch {}
    try {
      const raw = localStorage.getItem("pia:progress");
      if (raw) state.progress = JSON.parse(raw);
    } catch {}
  }
  function saveSettings() {
    localStorage.setItem("pia:settings", JSON.stringify(state.settings));
  }
  function saveProgress() {
    localStorage.setItem("pia:progress", JSON.stringify(state.progress));
  }

  function applySettings() {
    const s = state.settings;
    document.documentElement.style.setProperty("--font-size", s.fontSize + "px");
    document.documentElement.style.setProperty("--line-height", String(s.lineHeight));
    document.documentElement.style.setProperty(
      "--font-family",
      s.fontFamily === "sans"
        ? '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", sans-serif'
        : '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", "宋体", serif'
    );
    // 主题
    let theme = s.theme;
    if (theme === "auto") {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "night"
        : "paper";
    }
    if (theme === "auto") theme = "paper";
    document.documentElement.setAttribute("data-theme", theme);

    // 横向翻页
    const reader = $("#reader");
    reader.classList.toggle("is-horizontal", s.horizontalFlip);

    // 设置面板按钮高亮
    $$(".setting-buttons").forEach((group) => {
      const key = group.dataset.setting;
      group.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("is-active", String(s[key]) === b.dataset.value);
      });
    });
    // 开关
    $$('.switch input[type="checkbox"]').forEach((input) => {
      const key = input.dataset.setting;
      input.checked = !!s[key];
    });
  }

  function updateTopbarButtons() {
    const num = state.current;
    const topPrev = $('header [data-action="prev"]');
    const topNext = $('header [data-action="next"]');
    if (topPrev) topPrev.disabled = (num === 1);
    if (topNext) topNext.disabled = (num === state.chapters.length);
  }

  // ---------- UI 绑定 ----------
  function bindUI() {
    // 顶部 + 章末按钮（用事件代理）
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      switch (action) {
        case "prev":  loadChapter(state.current - 1); break;
        case "next":  loadChapter(state.current + 1); break;
        case "toc":   openOverlay("toc"); break;
        case "settings": openOverlay("settings"); break;
        case "about": openAbout(); break;
        case "start": closeOverlay(); loadChapter(1); break;
        case "last": closeOverlay();
          const last = parseInt(localStorage.getItem("pia:lastChapter") || "1", 10);
          loadChapter(last);
          break;
        case "close": closeOverlay(); break;
      }
    });

    // 遮罩点击关闭
    $("#scrim").addEventListener("click", closeOverlay);

    // 设置项变更
    $$(".setting-buttons button").forEach((b) => {
      b.addEventListener("click", () => {
        const group = b.parentElement;
        const key = group.dataset.setting;
        let val = b.dataset.value;
        if (key === "fontSize") val = parseInt(val, 10);
        else if (key === "lineHeight") val = parseFloat(val);
        state.settings[key] = val;
        saveSettings();
        applySettings();
      });
    });
    $$('.switch input[type="checkbox"]').forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.setting;
        state.settings[key] = input.checked;
        saveSettings();
        applySettings();
      });
    });

    // 目录搜索
    $("#tocSearch").addEventListener("input", () => {
      renderTocList($("#tocSearch").value.trim());
    });

    // 跳章
    $("#gotoConfirm").addEventListener("click", () => doGoto());
    $("#gotoInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") doGoto();
    });

    // 滚动 → 进度
    let raf = 0;
    window.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        updateProgress();
        raf = 0;
      });
    }, { passive: true });

    // 顶边/底部显示菜单：移动端监听 touchstart，桌面端监听 mousemove
    let lastActivity = 0;
    const idle = 2500;
    const showBar = () => {
      const tb = $("#topbar");
      tb.classList.add("is-visible");
      tb.setAttribute("aria-hidden", "false");
      lastActivity = Date.now();
    };
    const hideBarIfIdle = () => {
      if (Date.now() - lastActivity > idle) {
        const tb = $("#topbar");
        tb.classList.remove("is-visible");
        tb.setAttribute("aria-hidden", "true");
      }
    };
    ["mousemove", "touchstart", "keydown", "click"].forEach((ev) =>
      window.addEventListener(ev, () => { showBar(); }, { passive: true })
    );
    setInterval(hideBarIfIdle, 1000);
    showBar();
  }

  // ---------- 进度 ----------
  function updateProgress() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    $("#progressBar").style.width = (p * 100).toFixed(2) + "%";
    state.progress[state.current] = p;
    // 防抖保存
    clearTimeout(updateProgress._t);
    updateProgress._t = setTimeout(saveProgress, 400);
  }

  function restoreScroll() {
    const p = state.progress[state.current];
    if (typeof p === "number" && p > 0) {
      // 等图片/字体稳定后定位
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: max * p, behavior: "auto" });
      });
    }
  }

  // ---------- 键盘 ----------
  function bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      // 输入框里不拦截
      const tag = (e.target.tagName || "").toLowerCase();
      const isEditable = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if (isEditable) return;

      switch (e.key) {
        case "ArrowLeft":
          if (e.metaKey || e.ctrlKey || e.altKey) {
            loadChapter(state.current - 1);
          } else {
            window.scrollBy({ top: -80, behavior: "smooth" });
          }
          break;
        case "ArrowRight":
          if (e.metaKey || e.ctrlKey || e.altKey) {
            loadChapter(state.current + 1);
          } else {
            window.scrollBy({ top: 80, behavior: "smooth" });
          }
          break;
        case "ArrowUp":
          window.scrollBy({ top: -window.innerHeight * 0.85, behavior: "smooth" });
          break;
        case "ArrowDown":
          window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
          break;
        case " ":
          e.preventDefault();
          window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
          break;
        case "Home":
          window.scrollTo({ top: 0, behavior: "smooth" });
          break;
        case "End":
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
          break;
        case "Escape":
          if (anyOverlayOpen()) closeOverlay();
          else hideTopbar();
          break;
        case "g":
          openOverlay("goto");
          break;
        case "t":
          openOverlay("toc");
          break;
        case "?":
        case "/":
          if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
            openOverlay("help");
          }
          break;
      }
    });
  }

  function hideTopbar() {
    $("#topbar").classList.remove("is-visible");
  }

  // ---------- 点击翻页 ----------
  function bindClickPaginate() {
    let lastTap = 0;
    document.addEventListener("click", (e) => {
      // 浮窗/按钮/链接不参与
      if (e.target.closest("button, a, input, [data-action], .overlay")) return;
      if (!state.settings.clickPaginate) return;

      // 顶边 80px 区域：显示菜单
      if (e.clientY < 80) {
        $("#topbar").classList.add("is-visible");
        return;
      }
      // 底部 100px：忽略，让章末按钮可点
      const fromBottom = window.innerHeight - e.clientY;
      if (fromBottom < 100 && state.current < state.chapters.length) {
        // 落在章末按钮区，让按钮自己处理
        return;
      }

      const x = e.clientX;
      const w = window.innerWidth;
      if (x < w / 3) {
        loadChapter(state.current - 1);
      } else if (x > (w * 2) / 3) {
        loadChapter(state.current + 1);
      } else {
        // 中央：切换菜单
        $("#topbar").classList.toggle("is-visible");
      }
    });
  }

  // ---------- 浮窗 ----------
  const OVERLAYS = {
    toc: "#tocPanel",
    settings: "#settingsPanel",
    goto: "#gotoPanel",
    help: "#helpPanel",
    about: "#aboutPanel",
  };
  function openOverlay(name) {
    closeOverlay();
    const sel = OVERLAYS[name];
    if (!sel) return;
    const el = $(sel);
    el.hidden = false;
    $("#scrim").hidden = false;
    if (name === "toc") {
      renderTocList($("#tocSearch").value.trim());
    } else if (name === "goto") {
      const input = $("#gotoInput");
      input.value = state.current;
      setTimeout(() => input.select(), 30);
    } else if (name === "about") {
      openAbout();
    }
  }
  function openAbout() {
    $("#aboutTitle").textContent = state.meta.title || "偏爱到骨";
    $("#aboutAuthor").textContent = state.meta.author ? "作者：" + state.meta.author : "";
    $("#aboutIntro").textContent = state.meta.intro || "";
    const readCount = Object.keys(state.progress).filter((k) => state.progress[k] >= 0.95).length;
    $("#aboutStats").textContent =
      `共 ${state.chapters.length} 章 · 已读完 ${readCount} 章`;
    openOverlay("about");
  }
  function closeOverlay() {
    Object.values(OVERLAYS).forEach((s) => { $(s).hidden = true; });
    $("#scrim").hidden = true;
  }
  function anyOverlayOpen() {
    return Object.values(OVERLAYS).some((s) => !$(s).hidden);
  }

  function renderTocList(filter) {
    const list = $("#tocList");
    if (!state.chapters.length) {
      list.innerHTML = '<p class="muted">目录为空</p>';
      return;
    }
    const f = (filter || "").toLowerCase();
    const showAll = !f;
    let html = "";
    let lastVol = null;
    state.chapters.forEach((c) => {
      if (!showAll) {
        const hit =
          String(c.num).includes(f) ||
          ("第" + c.num + "章").includes(f) ||
          (c.title || "").toLowerCase().includes(f);
        if (!hit) return;
      }
      const vol = (c.volume || "").trim();
      if (vol && vol !== lastVol && showAll) {
        html += `<div class="toc-volume">— ${escapeHtml(vol)} —</div>`;
        lastVol = vol;
      }
      const isCurrent = c.num === state.current;
      const isRead = state.progress[c.num] >= 0.95;
      html += `<button type="button" class="toc-item ${isCurrent ? "is-current" : ""} ${isRead ? "is-read" : ""}" data-num="${c.num}">`;
      html += `<span class="toc-num">第${pad3(c.num)}章</span>`;
      html += `<span class="toc-title">${escapeHtml(c.title || "")}</span>`;
      html += "</button>";
    });
    if (!html) html = '<p class="muted">没有匹配的章节</p>';
    list.innerHTML = html;

    // 绑定点击
    list.querySelectorAll(".toc-item").forEach((b) => {
      b.addEventListener("click", () => {
        const n = parseInt(b.dataset.num, 10);
        closeOverlay();
        loadChapter(n);
      });
    });

    // 滚到当前章
    const cur = list.querySelector(".is-current");
    if (cur) cur.scrollIntoView({ block: "center" });
  }

  function doGoto() {
    const v = parseInt($("#gotoInput").value, 10);
    if (!v || v < 1 || v > state.chapters.length) return;
    closeOverlay();
    loadChapter(v);
  }

  // ---------- 启动 ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
