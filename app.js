(function () {
  "use strict";

  const DATA = window.ROLL_DATA;
  const Core = window.RollCore;
  if (!DATA || !Core) {
    document.body.innerHTML =
      '<main class="empty-state"><h1>数据没有加载</h1><p>请刷新页面重试。</p></main>';
    throw new Error("ROLL data or core failed to load");
  }

  const $ = (selector, node = document) => node.querySelector(selector);
  const $$ = (selector, node = document) => [...node.querySelectorAll(selector)];
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
          char
        ]
    );
  const shopById = new Map(DATA.shops.map((shop) => [shop.id, shop]));
  const groupById = new Map(DATA.meta.groups.map((group) => [group.key, group]));
  const STORAGE = {
    prefs: "roll.wineandchord.preferences.v1",
    filters: "roll.wineandchord.filters.v1",
    mode: "roll.wineandchord.mode.v1",
  };
  const PAGE_SIZE = 48;
  const MODE_META = {
    case: { label: "开箱", icon: "package-open", hint: "卡带滚动后停在一张饭票" },
    wheel: { label: "转盘", icon: "circle-dot", hint: "八家店铺同场转动" },
    cards: { label: "翻牌", icon: "layers-2", hint: "八张牌里挑一张翻开" },
    fortune: { label: "抽签", icon: "sparkles", hint: "签筒停下时今日饭运揭晓" },
    gacha: { label: "扭蛋", icon: "circle-dashed", hint: "一颗饭票胶囊正在出口等你" },
    slot: { label: "老虎机", icon: "dices", hint: "三列店名同步停住" },
  };
  const RARITY = {
    legend: "高分命中",
    epic: "稳健命中",
    rare: "顺口命中",
    common: "随机命中",
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      showToast("浏览器没有保存成功，请检查隐私设置");
    }
  }

  const state = {
    filters: Core.normalizeFilters(loadJSON(STORAGE.filters, Core.DEFAULT_FILTERS)),
    prefs: Core.normalizePrefs(loadJSON(STORAGE.prefs, Core.DEFAULT_PREFS)),
    mode: MODE_META[loadJSON(STORAGE.mode, "case")] ? loadJSON(STORAGE.mode, "case") : "case",
    poolView: "all",
    visibleCount: PAGE_SIZE,
    currentResult: null,
    lastRollId: null,
    rolling: false,
    awaitingCards: false,
    cardChoices: [],
    currentPool: [],
    queryTimer: 0,
    toastTimer: 0,
    lastDetailTrigger: null,
  };

  const els = {
    heroRoll: $("#heroRoll"),
    heroSummary: $("#heroSummary"),
    datasetStatus: $("#datasetStatus"),
    footerDataNote: $("#footerDataNote"),
    modeBar: $("#modeBar"),
    machineLabel: $("#machineLabel"),
    machineStatus: $("#machineStatus"),
    machineHint: $("#machineHint"),
    rollStage: $("#rollStage"),
    rollButton: $("#rollButton"),
    rollButtonText: $("#rollButtonText"),
    rulePoolCount: $("#rulePoolCount"),
    recentRuleText: $("#recentRuleText"),
    whitelistRuleText: $("#whitelistRuleText"),
    favoritesRuleText: $("#favoritesRuleText"),
    excludeRecentToggle: $("#excludeRecentToggle"),
    onlyWhitelistToggle: $("#onlyWhitelistToggle"),
    favoritesOnlyToggle: $("#favoritesOnlyToggle"),
    resultPanel: $("#resultPanel"),
    poolGrid: $("#poolGrid"),
    poolResultText: $("#poolResultText"),
    filterRibbon: $("#filterRibbon"),
    libraryTabs: $("#libraryTabs"),
    searchInput: $("#searchInput"),
    clearSearch: $("#clearSearch"),
    sortSelect: $("#sortSelect"),
    clearFilters: $("#clearFilters"),
    loadMoreButton: $("#loadMoreButton"),
    detailDialog: $("#detailDialog"),
    detailContent: $("#detailContent"),
    prefsDialog: $("#prefsDialog"),
    prefsContent: $("#prefsContent"),
    confirmDialog: $("#confirmDialog"),
    confirmTitle: $("#confirmTitle"),
    confirmText: $("#confirmText"),
    confirmAccept: $("#confirmAccept"),
    soundButton: $("#soundButton"),
    importInput: $("#importInput"),
    toast: $("#toast"),
  };

  function refreshIcons(scope = document) {
    if (window.lucide?.createIcons) {
      window.lucide.createIcons({
        root: scope,
        attrs: { "stroke-width": 2.25 },
      });
    }
  }

  function showToast(message, actionLabel = "", action = null) {
    clearTimeout(state.toastTimer);
    els.toast.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    els.toast.append(text);
    if (actionLabel && action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = actionLabel;
      button.addEventListener(
        "click",
        () => {
          action();
          els.toast.classList.remove("is-visible");
        },
        { once: true }
      );
      els.toast.append(button);
    }
    els.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(
      () => els.toast.classList.remove("is-visible"),
      3200
    );
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.append(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    }
  }

  const wait = (ms) =>
    new Promise((resolve) =>
      window.setTimeout(
        resolve,
        !state.prefs.motion ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 80
          : ms
      )
    );

  const formatCount = (value) => value.toLocaleString("zh-CN");

  function formatTime(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function persistPrefs() {
    saveJSON(STORAGE.prefs, state.prefs);
  }

  function persistFilters() {
    saveJSON(STORAGE.filters, state.filters);
  }

  function poolForRules() {
    return Core.candidatePool(DATA.shops, state.filters, state.prefs, {
      avoidId: state.lastRollId,
    });
  }

  function filteredShops({ ignoreRules = true } = {}) {
    const blacklist = new Set(state.prefs.blacklist);
    const whitelist = new Set(state.prefs.whitelist);
    const favorites = new Set(state.prefs.favorites);
    let source = DATA.shops;
    if (state.poolView === "favorites") {
      source = source.filter((shop) => favorites.has(shop.id));
    } else if (state.poolView === "whitelist") {
      source = source.filter((shop) => whitelist.has(shop.id));
    } else if (state.poolView === "blacklist") {
      source = source.filter((shop) => blacklist.has(shop.id));
    } else {
      source = source.filter((shop) => !blacklist.has(shop.id));
    }
    if (state.poolView === "blacklist") {
      const query = state.filters.q.trim().toLowerCase();
      source = query
        ? source.filter((shop) => shop.name.toLowerCase().includes(query))
        : source;
      return Core.sortShops(source, state.filters.sort);
    }
    if (ignoreRules) return Core.sortShops(source.filter((shop) => Core.matchesFilters(shop, state.filters)), state.filters.sort);
    return Core.candidatePool(DATA.shops, state.filters, state.prefs, {
      ignoreHistory: true,
    }).shops;
  }

  function savedViewShops() {
    if (state.poolView === "blacklist") return filteredShops();
    return filteredShops();
  }

  function updateModeBar() {
    els.modeBar.innerHTML = Core.MODES.map(
      (mode) => `
        <button
          class="mode-button"
          type="button"
          role="tab"
          data-mode="${mode.key}"
          aria-selected="${mode.key === state.mode}"
          ${state.rolling || state.awaitingCards ? "disabled" : ""}
        >
          <i data-lucide="${mode.icon}" aria-hidden="true"></i>
          ${mode.label}
        </button>`
    ).join("");
    refreshIcons(els.modeBar);
  }

  function updateRuleSummary() {
    const pool = poolForRules();
    state.currentPool = pool.shops;
    const countText = `${formatCount(pool.shops.length)} 家`;
    els.rulePoolCount.textContent = countText;
    els.recentRuleText.textContent = state.prefs.excludeRecent
      ? `最近 ${state.prefs.excludeRecent} 次`
      : "已关闭";
    els.whitelistRuleText.textContent = state.prefs.onlyWhitelist
      ? `${state.prefs.whitelist.length} 家可用`
      : "未启用";
    els.favoritesRuleText.textContent = state.prefs.favoritesOnly
      ? `${state.prefs.favorites.length} 家可用`
      : "未启用";
    els.excludeRecentToggle.checked = state.prefs.excludeRecent > 0;
    els.onlyWhitelistToggle.checked = state.prefs.onlyWhitelist;
    els.favoritesOnlyToggle.checked = state.prefs.favoritesOnly;
    els.heroSummary.innerHTML = pool.shops.length
      ? `当前可 Roll <b>${formatCount(pool.shops.length)}</b> 家 · 共收录 ${formatCount(
          DATA.shops.length
        )} 家`
      : "当前规则下没有可用门店";
    els.datasetStatus.textContent = `${DATA.meta.sourceCount} 张截图 · ${formatCount(
      DATA.shops.length
    )} 家`;
    if (pool.recovered) {
      els.heroSummary.innerHTML =
        "最近记录覆盖了全部结果，本轮已临时允许旧店";
    }
    els.excludeRecentToggle.disabled = state.rolling || state.awaitingCards;
    els.onlyWhitelistToggle.disabled = state.rolling || state.awaitingCards;
    els.favoritesOnlyToggle.disabled = state.rolling || state.awaitingCards;
    els.rollButton.disabled = state.rolling || !pool.shops.length;
    els.rollButtonText.textContent = state.awaitingCards
      ? "替我选"
      : state.rolling
        ? "抽取中"
        : "Roll 一次";
    const mode = MODE_META[state.mode];
    els.machineLabel.textContent = mode.label;
    els.machineHint.textContent = state.awaitingCards
      ? "点一张牌，或让我替你选"
      : state.rolling
        ? "正在缩小范围"
        : mode.hint;
    els.machineStatus.textContent = state.awaitingCards
      ? "等你翻牌"
      : state.rolling
        ? "运转"
        : "待命";
  }

  function sampleShops(pool, count) {
    const copy = [...pool];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(count, copy.length));
  }

  function idleCard(shop, index) {
    return `
      <div class="idle-card">
        <span>${escape(groupById.get(shop.group)?.name || "外卖")}</span>
        <b>${escape(Core.shortName(shop.name))}</b>
        <small>${escape(shop.rating ? `${shop.rating.toFixed(1)} 分` : "评分待确认")} · ${
          escape(Core.formatMinute(shop.deliveryMin))
        }</small>
      </div>`;
  }

  function renderIdleStage() {
    if (state.rolling || state.awaitingCards) return;
    const sample = sampleShops(state.currentPool, 3);
    els.rollStage.innerHTML = `<div class="idle-stack">${sample
      .map(idleCard)
      .join("")}</div>`;
  }

  function renderCaseAnimation(pool, winner) {
    const cards = sampleShops(pool.filter((shop) => shop.id !== winner.id), 17);
    const insertAt = Math.min(cards.length, 12);
    cards.splice(insertAt, 0, winner);
    els.rollStage.innerHTML = `
      <div class="roller">
        <div class="case-window">
          <div class="case-track" id="caseTrack">
            ${cards
              .map(
                (shop) => `
                  <div class="mini-case" data-case-id="${shop.id}">
                    <img src="${escape(shop.image)}" alt="" loading="lazy" />
                    <b>${escape(Core.shortName(shop.name))}</b>
                  </div>`
              )
              .join("")}
          </div>
        </div>
      </div>`;
    const track = $("#caseTrack", els.rollStage);
    requestAnimationFrame(() => {
      const target = $(`[data-case-id="${winner.id}"]`, track);
      const left = target.offsetLeft - track.parentElement.clientWidth / 2 + target.clientWidth / 2;
      track.style.transition =
        "transform 1450ms cubic-bezier(0.16, 0.82, 0.14, 1)";
      track.style.transform = `translateX(${-left}px)`;
      window.setTimeout(() => target.classList.add("is-winner"), 1450);
    });
  }

  function renderWheelAnimation(pool, winner) {
    const sampled = sampleShops(pool, 8);
    if (!sampled.some((shop) => shop.id === winner.id)) sampled[0] = winner;
    const colors = ["#ff4a45", "#ffd447", "#1f49ff", "#77e1bb"];
    const step = 360 / sampled.length;
    const slices = sampled
      .map((shop, index) => {
        const start = index * step - 90;
        const end = start + step;
        const r = 104;
        const x1 = 110 + r * Math.cos((start * Math.PI) / 180);
        const y1 = 110 + r * Math.sin((start * Math.PI) / 180);
        const x2 = 110 + r * Math.cos((end * Math.PI) / 180);
        const y2 = 110 + r * Math.sin((end * Math.PI) / 180);
        const mid = start + step / 2;
        const tx = 110 + 60 * Math.cos((mid * Math.PI) / 180);
        const ty = 110 + 60 * Math.sin((mid * Math.PI) / 180);
        return `<path d="M110 110 L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z" fill="${colors[index % colors.length]}"/>
          <text x="${tx}" y="${ty}" fill="${index % 4 === 1 ? "#17233f" : "#fff"}" font-size="8" text-anchor="middle" dominant-baseline="middle">${escape(
            Core.shortName(shop.name).slice(0, 7)
          )}</text>`;
      })
      .join("");
    const winnerIndex = sampled.findIndex((shop) => shop.id === winner.id);
    const targetAngle = 360 * 6 - winnerIndex * step;
    els.rollStage.innerHTML = `
      <div class="wheel-wrap">
        <svg class="wheel-disc" id="wheelDisc" viewBox="0 0 220 220" aria-label="店铺转盘">
          <circle cx="110" cy="110" r="108" fill="#17233f"/>
          ${slices}
          <circle cx="110" cy="110" r="15" fill="#17233f"/>
        </svg>
        <span class="wheel-pointer" aria-hidden="true"></span>
        <span class="wheel-hub" aria-hidden="true">R</span>
      </div>`;
    requestAnimationFrame(() => {
      $("#wheelDisc", els.rollStage).style.transform = `rotate(${targetAngle}deg)`;
    });
  }

  function renderCards(pool) {
    state.cardChoices = sampleShops(pool, Math.min(8, pool.length));
    state.awaitingCards = true;
    els.rollStage.innerHTML = `
      <div class="cards-table" id="cardsTable">
        ${state.cardChoices
          .map(
            (shop, index) => `
              <button class="pick-card is-shuffling" type="button" data-card-index="${index}" aria-label="翻开第 ${index + 1} 张牌">
                <span>${index + 1}</span>
              </button>`
          )
          .join("")}
      </div>`;
    window.setTimeout(() => {
      $$(".pick-card", els.rollStage).forEach((card) =>
        card.classList.remove("is-shuffling")
      );
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 900);
    updateRuleSummary();
    playSound("fanfare", "epic");
  }

  function renderFortuneAnimation(pool, winner) {
    const sample = sampleShops(pool, 3);
    els.rollStage.innerHTML = `
      <div class="fortune-machine">
        <div class="fortune-tube is-shaking" id="fortuneTube" aria-label="正在摇签">
          <i></i>
        </div>
        <p class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></p>
      </div>`;
    window.setTimeout(() => {
      els.rollStage.innerHTML = `
        <div class="fortune-result">
          <span class="section-kicker">今日签面</span>
          <b>${escape(Core.shortName(winner.name))}</b>
          <small>${sample.length} 支签里，这一支先落在了你面前</small>
        </div>`;
    }, 1350);
  }

  function renderGachaAnimation(pool, winner) {
    const sample = sampleShops(pool, 5);
    els.rollStage.innerHTML = `
      <div class="gacha-stage">
        <div class="gacha-machine">
          <div class="gacha-globe">✦</div>
          <span class="gacha-knob is-turning" id="gachaKnob"></span>
          <div class="capsule is-dropping" id="capsule"></div>
        </div>
        <p class="sr-only">正在抽取 ${escape(sample.map((shop) => shop.name).join("、"))}</p>
      </div>`;
    window.setTimeout(() => {
      $("#capsule", els.rollStage)?.classList.remove("is-dropping");
      $("#gachaKnob", els.rollStage)?.classList.remove("is-turning");
    }, 1050);
  }

  function renderSlotAnimation(pool, winner) {
    const sample = sampleShops(pool, 12);
    const names = sample.map((shop) => Core.shortName(shop.name));
    const cycles = Array.from({ length: 3 }, (_, index) => {
      const current = sample[(index * 3 + 1) % sample.length] || winner;
      return `<div class="slot-reel is-spinning" data-slot="${index}">${escape(
        Core.shortName(current.name)
      )}</div>`;
    }).join("");
    els.rollStage.innerHTML = `
      <div class="slot-machine">
        <div class="slot-reels" id="slotReels">${cycles}</div>
        <div class="slot-lights" aria-hidden="true">${Array.from({ length: 9 })
          .map(() => "<i></i>")
          .join("")}</div>
      </div>`;
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      $$(".slot-reel", els.rollStage).forEach((reel, index) => {
        reel.textContent = names[(frame + index * 3) % names.length] || winner.name;
      });
    }, 120);
    window.setTimeout(() => {
      clearInterval(timer);
      $$(".slot-reel", els.rollStage).forEach((reel) => {
        reel.classList.remove("is-spinning");
        reel.textContent = Core.shortName(winner.name);
      });
    }, 1250);
  }

  function renderRollAnimation(pool, winner) {
    if (state.mode === "case") return renderCaseAnimation(pool, winner);
    if (state.mode === "wheel") return renderWheelAnimation(pool, winner);
    if (state.mode === "fortune") return renderFortuneAnimation(pool, winner);
    if (state.mode === "gacha") return renderGachaAnimation(pool, winner);
    return renderSlotAnimation(pool, winner);
  }

  let audioContext = null;
  function audio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioContext = audioContext || new AudioCtor();
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function tone(frequency, duration, offset = 0, volume = 0.05) {
    if (!state.prefs.sound) return;
    const context = audio();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + offset;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playSound(kind, rarity = "common") {
    if (!state.prefs.sound) return;
    if (kind === "tick") tone(1350, 0.035, 0, 0.025);
    if (kind === "roll") {
      tone(220, 0.12, 0, 0.035);
      tone(330, 0.12, 0.11, 0.035);
      tone(440, 0.16, 0.22, 0.04);
    }
    if (kind === "fanfare") {
      const notes =
        rarity === "legend"
          ? [523, 659, 784, 1047, 1319]
          : rarity === "epic"
            ? [523, 659, 784, 1047]
            : [587, 784, 988];
      notes.forEach((frequency, index) =>
        tone(frequency, 0.28, index * 0.08, 0.045)
      );
    }
  }

  function resultReason(shop, poolSize) {
    const factors = [];
    if (shop.rating >= 4.7) factors.push(`${shop.rating.toFixed(1)} 分`);
    if (Number.isFinite(shop.deliveryMin) && shop.deliveryMin <= 30) {
      factors.push(`${shop.deliveryMin} 分钟送达`);
    }
    if (shop.deliveryFee === 0) factors.push("免配送费");
    if (Number.isFinite(shop.minOrder) && shop.minOrder <= 20) factors.push("低起送");
    if (shop.tags?.includes("离得近")) factors.push(shop.distanceText);
    return `从 ${formatCount(poolSize)} 家可用门店等概率命中${
      factors.length ? `，符合 ${factors.slice(0, 3).join("、")}` : ""
    }`;
  }

  function renderResult(shop, poolSize) {
    const rarity = Core.rarity(shop);
    const favorite = state.prefs.favorites.includes(shop.id);
    const whitelist = state.prefs.whitelist.includes(shop.id);
    const tags = [...new Set([...(shop.tags || []), ...(shop.promotions || [])])].slice(0, 4);
    els.resultPanel.className = `result-panel result-panel--${rarity}`;
    els.resultPanel.innerHTML = `
      <div class="result-media">
        <img src="${escape(shop.image)}" alt="${escape(shop.name)}" />
      </div>
      <div class="result-copy">
        <span class="result-rarity">${RARITY[rarity]}</span>
        <h3 tabindex="-1" id="resultTitle">${escape(shop.name)}</h3>
        <p class="result-reason">${escape(resultReason(shop, poolSize))}</p>
        <div class="result-facts">
          <span>${escape(shop.rating ? `★ ${shop.rating.toFixed(1)}` : "评分待确认")}</span>
          <span>${escape(Core.formatMinute(shop.deliveryMin))}</span>
          <span>${escape(Core.formatMoney(shop.minOrder))} 起送</span>
          <span>${escape(
            shop.deliveryFee === 0
              ? "免配送费"
              : Number.isFinite(shop.deliveryFee)
                ? `配送 ${Core.formatMoney(shop.deliveryFee)}`
                : "配送费待确认"
          )}</span>
          <span>${escape(shop.salesText)}</span>
        </div>
        ${
          tags.length
            ? `<div class="result-facts">${tags
                .map((tag) => `<span>${escape(tag)}</span>`)
                .join("")}</div>`
            : ""
        }
        <div class="result-actions">
          <button class="button button-primary" type="button" data-result-action="accept">
            <i data-lucide="utensils" aria-hidden="true"></i>
            就这家
          </button>
          <button class="button button-quiet" type="button" data-result-action="again">
            <i data-lucide="rotate-cw" aria-hidden="true"></i>
            换一个
          </button>
          <button class="button button-quiet" type="button" data-result-action="favorite" aria-pressed="${favorite}">
            <i data-lucide="heart" aria-hidden="true"></i>
            ${favorite ? "已收藏" : "收藏"}
          </button>
          <button class="button button-quiet" type="button" data-result-action="whitelist" aria-pressed="${whitelist}">
            <i data-lucide="badge-check" aria-hidden="true"></i>
            ${whitelist ? "已白名单" : "白名单"}
          </button>
          <button class="button button-quiet" type="button" data-result-action="blacklist">
            <i data-lucide="ban" aria-hidden="true"></i>
            拉黑
          </button>
          <button class="button button-quiet" type="button" data-result-action="detail">
            <i data-lucide="panel-right-open" aria-hidden="true"></i>
            详情
          </button>
          <button class="button button-quiet" type="button" data-result-action="copy">
            <i data-lucide="copy" aria-hidden="true"></i>
            分享
          </button>
        </div>
      </div>`;
    els.resultPanel.hidden = false;
    refreshIcons(els.resultPanel);
    $("#resultTitle", els.resultPanel)?.focus({ preventScroll: true });
  }

  function finalizeRoll(shop, poolSize) {
    state.rolling = false;
    state.awaitingCards = false;
    state.currentResult = shop;
    state.lastRollId = shop.id;
    state.prefs = Core.recordRoll(shop, state.mode, state.prefs);
    persistPrefs();
    renderResult(shop, poolSize);
    updateAll();
    playSound("fanfare", Core.rarity(shop));
    els.resultPanel.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  }

  async function beginRoll() {
    if (state.rolling) return;
    if (state.awaitingCards) {
      const index = Math.floor(Math.random() * state.cardChoices.length);
      pickCard(index);
      return;
    }
    const pool = poolForRules();
    if (!pool.shops.length) {
      showToast("当前规则下没有可选门店，先放宽一个条件");
      return;
    }
    state.rolling = true;
    state.currentResult = null;
    els.resultPanel.hidden = true;
    updateRuleSummary();
    updateModeBar();
    playSound("roll");
    const poolSize = pool.shops.length;
    if (state.mode === "cards") {
      renderCards(pool.shops);
      state.rolling = false;
      updateModeBar();
      updateRuleSummary();
      return;
    }
    const winner = Core.chooseCandidate(pool.shops);
    renderRollAnimation(pool.shops, winner);
    const ticks = window.setInterval(() => playSound("tick"), 150);
    await wait(state.mode === "case" || state.mode === "wheel" ? 1650 : 1450);
    clearInterval(ticks);
    finalizeRoll(winner, poolSize);
  }

  function pickCard(index) {
    if (!state.awaitingCards || !state.cardChoices[index]) return;
    const shop = state.cardChoices[index];
    const cards = $$(".pick-card", els.rollStage);
    cards.forEach((card, cardIndex) => {
      card.disabled = true;
      if (cardIndex !== index) card.style.opacity = "0.3";
    });
    const chosen = cards[index];
    chosen.classList.add("is-picked");
    chosen.innerHTML = `
      <img src="${escape(shop.image)}" alt="" />
      <span>${escape(Core.shortName(shop.name))}</span>`;
    state.rolling = true;
    updateRuleSummary();
    window.setTimeout(() => finalizeRoll(shop, state.currentPool.length), 260);
  }

  function groupLabel(key) {
    return groupById.get(key)?.name || "其他";
  }

  function filterChip({ label, filter, value, active, count, red = false }) {
    return `
      <button
        class="filter-chip${red ? " chip-red" : ""}"
        type="button"
        data-filter="${filter}"
        data-value="${escape(value)}"
        aria-pressed="${Boolean(active)}"
      >
        <span class="chip-dot" aria-hidden="true"></span>
        ${escape(label)}
        ${Number.isFinite(count) ? `<i>${count}</i>` : ""}
      </button>`;
  }

  function renderFilters() {
    const facets = Core.facetCounts(DATA.shops, state.filters, state.prefs);
    const filters = state.filters;
    const groupChips = [
      filterChip({
        label: "全部菜系",
        filter: "group",
        value: "",
        active: !filters.groups.length,
      }),
      ...DATA.meta.groups.map((group) =>
        filterChip({
          label: group.name,
          filter: "group",
          value: group.key,
          active: filters.groups.includes(group.key),
          count: facets.groups[group.key] || 0,
        })
      ),
    ];
    const optionRow = (key, label) =>
      Core.FILTER_OPTIONS[key]
        .map(([value, text]) =>
          filterChip({
            label: text,
            filter: key,
            value,
            active: String(filters[key]) === String(value),
          })
        )
        .join("");
    els.filterRibbon.innerHTML = `
      <div class="filter-row">
        <b>菜系</b>
        <div class="chip-set">${groupChips.join("")}</div>
      </div>
      <div class="filter-row">
        <b>评分</b>
        <div class="chip-set">${optionRow("rating", "评分")}</div>
      </div>
      <div class="filter-row">
        <b>送达</b>
        <div class="chip-set">${optionRow("delivery", "送达")}</div>
      </div>
      <div class="filter-row">
        <b>起送</b>
        <div class="chip-set">${optionRow("minOrder", "起送")}</div>
      </div>
      <div class="filter-row">
        <b>距离</b>
        <div class="chip-set">${optionRow("distance", "距离")}</div>
      </div>
      <div class="filter-row">
        <b>配送费</b>
        <div class="chip-set">${optionRow("fee", "配送费")}</div>
      </div>
      <div class="filter-row">
        <b>配送方式</b>
        <div class="chip-set">${optionRow("channel", "配送方式")}</div>
      </div>`;
    els.sortSelect.innerHTML = Core.FILTER_OPTIONS.sort
      .map(
        ([value, label]) =>
          `<option value="${value}"${value === filters.sort ? " selected" : ""}>${label}</option>`
      )
      .join("");
    els.searchInput.value = filters.q;
    els.clearSearch.hidden = !filters.q;
  }

  function cardMarkers(shop) {
    const markers = [];
    if (state.prefs.favorites.includes(shop.id)) {
      markers.push(`<span class="list-marker list-marker--red"><i data-lucide="heart" aria-hidden="true"></i></span>`);
    }
    if (state.prefs.whitelist.includes(shop.id)) {
      markers.push(`<span class="list-marker list-marker--white"><i data-lucide="badge-check" aria-hidden="true"></i></span>`);
    }
    return markers.length ? `<div class="card-list-marker">${markers.join("")}</div>` : "";
  }

  function cardHTML(shop) {
    const favorite = state.prefs.favorites.includes(shop.id);
    const whitelist = state.prefs.whitelist.includes(shop.id);
    const blacklisted = state.prefs.blacklist.includes(shop.id);
    const tags = (shop.tags || []).slice(0, 3);
    return `
      <article class="shop-card" data-id="${escape(shop.id)}">
        <div class="shop-cover">
          <img src="${escape(shop.image)}" alt="" loading="lazy" decoding="async" />
          <span class="shop-category">${escape(shop.category)}</span>
          <span class="shop-rating">${shop.rating ? `★ ${shop.rating.toFixed(1)}` : "评分待确认"}</span>
          ${cardMarkers(shop)}
        </div>
        <div class="shop-body">
          <div class="shop-title-wrap">
            <h3 class="shop-title">
              <button type="button" data-action="detail" title="${escape(shop.name)}">${escape(shop.name)}</button>
            </h3>
            <button
              class="quick-action"
              type="button"
              data-action="favorite"
              aria-label="${favorite ? "取消收藏" : "收藏"}"
              aria-pressed="${favorite}"
              title="${favorite ? "取消收藏" : "收藏"}"
            >
              <i data-lucide="heart" aria-hidden="true"></i>
            </button>
          </div>
          <p class="shop-subtitle">${escape(shop.salesText)} · ${escape(
            shop.deliveryMode || "配送方式待确认"
          )}</p>
          <div class="shop-facts">
            <span><b>${escape(shop.deliveryMin ? `${shop.deliveryMin} 分` : "—")}</b>送达</span>
            <span><b>${escape(Core.formatMoney(shop.minOrder))}</b>起送</span>
            <span><b>${escape(
              shop.deliveryFee === 0 ? "免费" : Core.formatMoney(shop.deliveryFee)
            )}</b>配送费</span>
          </div>
          <div class="shop-tags">${tags
            .map((tag) => `<span>${escape(tag)}</span>`)
            .join("")}</div>
          <div class="shop-card-actions">
            <span>${escape(Core.formatDistance(shop.distance))}</span>
            <div class="inline-actions">
              <button
                type="button"
                data-action="whitelist"
                aria-label="${whitelist ? "移出白名单" : "加入白名单"}"
                title="${whitelist ? "移出白名单" : "加入白名单"}"
                class="${whitelist ? "is-active" : ""}"
              >
                <i data-lucide="badge-check" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                data-action="blacklist"
                aria-label="${blacklisted ? "移出黑名单" : "加入黑名单"}"
                title="${blacklisted ? "移出黑名单" : "加入黑名单"}"
                class="${blacklisted ? "is-danger" : ""}"
              >
                <i data-lucide="${blacklisted ? "rotate-ccw" : "ban"}" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </article>`;
  }

  function historyHTML() {
    if (!state.prefs.history.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="history"></i></div>
          <h3>还没有记录</h3>
          <p>第一次 Roll 之后，结果会留在这里。</p>
        </div>`;
    }
    return `<div class="history-list">${state.prefs.history
      .slice(0, state.visibleCount)
      .map((entry) => {
        const shop = shopById.get(entry.id);
        if (!shop) return "";
        return `
          <article class="history-item" data-id="${escape(shop.id)}">
            <img src="${escape(shop.image)}" alt="" loading="lazy" />
            <div>
              <b>${escape(shop.name)}</b>
              <small>${escape(formatTime(entry.at))} · ${escape(
                MODE_META[entry.mode]?.label || entry.mode
              )}${entry.rolledOnly ? " · 仅 Roll" : " · 已确定"}</small>
            </div>
            <div class="history-actions">
              <button class="button button-quiet" type="button" data-action="detail">详情</button>
              <button class="button button-quiet" type="button" data-action="favorite">
                ${state.prefs.favorites.includes(shop.id) ? "已收藏" : "收藏"}
              </button>
            </div>
          </article>`;
      })
      .join("")}</div>`;
  }

  function updateTabCounts(shops) {
    $("#allCount").textContent = DATA.shops.length;
    $("#favoritesCount").textContent = state.prefs.favorites.length;
    $("#whitelistCount").textContent = state.prefs.whitelist.length;
    $("#blacklistCount").textContent = state.prefs.blacklist.length;
    $("#historyCount").textContent = state.prefs.history.length;
    $$("[data-pool-view]", els.libraryTabs).forEach((tab) =>
      tab.setAttribute("aria-selected", String(tab.dataset.poolView === state.poolView))
    );
    return shops;
  }

  function emptyPoolHTML() {
    const messages = {
      all: ["没有符合条件的店", "试试减少几个筛选条件。"],
      favorites: ["收藏夹还是空的", "在饭池卡片上点一下爱心。"],
      whitelist: ["白名单还没有店", "把常吃的店加入白名单。"],
      blacklist: ["黑名单是空的", "被拉黑的店会在这里集中管理。"],
    };
    const [title, text] = messages[state.poolView] || messages.all;
    return `
      <div class="empty-state">
        <div class="empty-icon"><i data-lucide="search-x"></i></div>
        <h3>${title}</h3>
        <p>${text}</p>
        <button class="button button-quiet" type="button" data-action="clear-filters">
          <i data-lucide="rotate-ccw" aria-hidden="true"></i>
          清除筛选
        </button>
      </div>`;
  }

  function renderPool() {
    const all = savedViewShops();
    updateTabCounts(all);
    const visible = all.slice(0, state.visibleCount);
    els.poolGrid.dataset.view = state.filters.view;
    $$("[data-view]", $(".view-toggle")).forEach((button) =>
      button.setAttribute("aria-pressed", String(button.dataset.view === state.filters.view))
    );
    if (state.poolView === "history") {
      els.poolGrid.dataset.view = "list";
      els.poolGrid.innerHTML = historyHTML();
    } else {
      els.poolGrid.innerHTML = visible.length
        ? visible.map(cardHTML).join("")
        : emptyPoolHTML();
    }
    const viewLabel =
      state.poolView === "all"
        ? "饭池"
        : state.poolView === "favorites"
          ? "收藏"
          : state.poolView === "whitelist"
            ? "白名单"
            : state.poolView === "blacklist"
              ? "黑名单"
              : "记录";
    els.poolResultText.innerHTML =
      state.poolView === "history"
        ? `共 <b>${state.prefs.history.length}</b> 条记录`
        : `${viewLabel}里共 <b>${formatCount(all.length)}</b> 家 · 当前显示 ${Math.min(
            visible.length,
            all.length
          )}`;
    els.loadMoreButton.hidden =
      state.poolView === "history"
        ? state.visibleCount >= state.prefs.history.length
        : state.visibleCount >= all.length;
    refreshIcons(els.poolGrid);
  }

  function updateAll() {
    document.documentElement.classList.toggle("reduce-motion", !state.prefs.motion);
    updateRuleSummary();
    updateModeBar();
    renderFilters();
    renderPool();
    renderIdleStage();
    updateSoundButton();
  }

  function resetVisibleCount() {
    state.visibleCount = PAGE_SIZE;
  }

  function togglePreference(key, id) {
    const shop = shopById.get(id);
    if (!shop) return;
    const wasActive = state.prefs[key].includes(id);
    state.prefs = Core.toggleList(state.prefs, key, id);
    persistPrefs();
    updateAll();
    if (state.currentResult?.id === id) renderResult(shop, state.currentPool.length);
    const labels = { favorites: "收藏", whitelist: "白名单", blacklist: "黑名单" };
    showToast(
      `${wasActive ? "已移出" : "已加入"}${labels[key]}：${shop.name}`,
      "撤销",
      () => {
        state.prefs = Core.toggleList(state.prefs, key, id);
        persistPrefs();
        updateAll();
        if (state.currentResult?.id === id) renderResult(shop, state.currentPool.length);
      }
    );
  }

  function openDetail(id, trigger = document.activeElement) {
    const shop = shopById.get(id);
    if (!shop) return;
    state.lastDetailTrigger = trigger;
    const favorite = state.prefs.favorites.includes(shop.id);
    const whitelist = state.prefs.whitelist.includes(shop.id);
    const blacklisted = state.prefs.blacklist.includes(shop.id);
    const tags = [...new Set([...(shop.tags || []), ...(shop.promotions || [])])];
    els.detailContent.innerHTML = `
      <div class="detail-hero">
        <div class="detail-hero-media">
          <img src="${escape(shop.image)}" alt="" />
        </div>
        <div class="detail-heading">
          <span class="result-rarity">${RARITY[Core.rarity(shop)]}</span>
          <h2 id="detailTitle">${escape(shop.name)}</h2>
          <p>${escape(shop.category)} · ${escape(shop.description)}</p>
          <div class="detail-actions">
            <button class="button button-primary" type="button" data-detail-action="copy-name">
              <i data-lucide="copy" aria-hidden="true"></i>
              复制店名
            </button>
            <button class="button button-quiet" type="button" data-detail-action="favorite">
              <i data-lucide="heart" aria-hidden="true"></i>
              ${favorite ? "取消收藏" : "收藏"}
            </button>
            <button class="button button-quiet" type="button" data-detail-action="whitelist">
              <i data-lucide="badge-check" aria-hidden="true"></i>
              ${whitelist ? "移出白名单" : "加入白名单"}
            </button>
            <button class="button button-quiet" type="button" data-detail-action="blacklist">
              <i data-lucide="${blacklisted ? "rotate-ccw" : "ban"}" aria-hidden="true"></i>
              ${blacklisted ? "移出黑名单" : "加入黑名单"}
            </button>
          </div>
        </div>
      </div>
      <dl class="detail-facts">
        <div class="detail-fact"><dt>评分</dt><dd>${shop.rating ? shop.rating.toFixed(1) : "待确认"}</dd></div>
        <div class="detail-fact"><dt>送达</dt><dd>${escape(Core.formatMinute(shop.deliveryMin))}</dd></div>
        <div class="detail-fact"><dt>起送</dt><dd>${escape(Core.formatMoney(shop.minOrder))}</dd></div>
        <div class="detail-fact"><dt>配送费</dt><dd>${escape(
          shop.deliveryFee === 0 ? "免费" : Core.formatMoney(shop.deliveryFee)
        )}</dd></div>
      </dl>
      <section class="detail-section">
        <h3>截图线索</h3>
        <p>${escape(shop.deliveryMode || "配送方式待确认")} · ${escape(
          Core.formatDistance(shop.distance)
        )} · ${escape(shop.salesText)}</p>
        <div class="detail-notes">${tags.map((tag) => `<span>${escape(tag)}</span>`).join("")}</div>
      </section>
      <section class="detail-section">
        <h3>数据口径</h3>
        <p>${escape(DATA.meta.disclaimer)}</p>
        <p>来源定位：${escape(shop.source)} · ${formatCount(shop.sourceY)}px。</p>
        <p>数据集版本：${escape(DATA.meta.builtAt)}。</p>
      </section>`;
    refreshIcons(els.detailContent);
    if (!els.detailDialog.open) els.detailDialog.showModal();
    history.replaceState(null, "", `#shop=${encodeURIComponent(shop.id)}`);
  }

  function closeDetail() {
    if (els.detailDialog.open) els.detailDialog.close();
    if (location.hash.startsWith("#shop=")) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    state.lastDetailTrigger?.focus?.();
  }

  function sourcesHTML() {
    return `
      <section class="prefs-section prefs-section--wide" id="sourceSection">
        <h3>数据来源</h3>
        <p>${escape(DATA.meta.area)} · ${escape(DATA.meta.dataKind)} · ${escape(
          DATA.meta.liveData ? "实时" : "非实时快照"
        )}</p>
        <p><a href="inventory.html" target="_blank" rel="noopener">打开完整截图清单</a></p>
        <table class="source-table">
          <thead><tr><th>截图</th><th>SHA-256</th></tr></thead>
          <tbody>
            ${DATA.meta.sources
              .map(
                (source) =>
                  `<tr><td>${escape(source.file)}</td><td><code>${escape(
                    source.sha256
                  )}</code></td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>`;
  }

  function renderPrefs() {
    const favoriteCount = state.prefs.favorites.length;
    const whitelistCount = state.prefs.whitelist.length;
    const blacklistCount = state.prefs.blacklist.length;
    const selectedCount = DATA.shops.filter((shop) => shop.rating >= 4.7).length;
    els.prefsContent.innerHTML = `
      <p class="section-kicker">Preferences</p>
      <p>${escape(DATA.meta.disclaimer)}</p>
      <div class="prefs-grid">
        <section class="prefs-section">
          <h3>抽取规则</h3>
          <p>默认避开最近已经出现过的结果。</p>
          <label class="number-select">
            <span>避开最近</span>
            <select id="excludeRecentSelect" aria-label="避开最近几次">
              ${[0, 1, 2, 3, 5, 8, 10]
                .map(
                  (value) =>
                    `<option value="${value}"${
                      value === state.prefs.excludeRecent ? " selected" : ""
                    }>${value ? `${value} 次` : "关闭"}</option>`
                )
                .join("")}
            </select>
          </label>
        </section>
        <section class="prefs-section">
          <h3>允许范围</h3>
          <p>只从白名单或收藏中抽取。</p>
          <div class="prefs-actions">
            <button class="button button-quiet" type="button" data-prefs-action="only-whitelist" aria-pressed="${state.prefs.onlyWhitelist}">
              <i data-lucide="badge-check"></i>
              白名单 ${whitelistCount}
            </button>
            <button class="button button-quiet" type="button" data-prefs-action="favorites-only" aria-pressed="${state.prefs.favoritesOnly}">
              <i data-lucide="heart"></i>
              收藏 ${favoriteCount}
            </button>
          </div>
        </section>
        <section class="prefs-section">
          <h3>声音与动画</h3>
          <p>设置只保存在当前浏览器。</p>
          <div class="prefs-actions">
            <button class="button button-quiet" type="button" data-prefs-action="sound" aria-pressed="${state.prefs.sound}">
              <i data-lucide="${state.prefs.sound ? "volume-2" : "volume-x"}"></i>
              ${state.prefs.sound ? "音效开" : "音效关"}
            </button>
            <button class="button button-quiet" type="button" data-prefs-action="motion" aria-pressed="${state.prefs.motion}">
              <i data-lucide="sparkles"></i>
              ${state.prefs.motion ? "动画开" : "动画关"}
            </button>
          </div>
        </section>
        <section class="prefs-section">
          <h3>数据概况</h3>
          <p>截图中的 ${DATA.shops.length} 个店铺条目。</p>
          <div class="data-stats">
            <div class="data-stat"><b>${DATA.shops.length}</b><span>店铺条目</span></div>
            <div class="data-stat"><b>${DATA.meta.sourceCount}</b><span>原始截图</span></div>
            <div class="data-stat"><b>${selectedCount}</b><span>4.7+ 店铺</span></div>
            <div class="data-stat"><b>${blacklistCount}</b><span>黑名单</span></div>
          </div>
        </section>
        <section class="prefs-section prefs-section--wide">
          <h3>名单管理</h3>
          <p>这些数据仅存储在当前浏览器，不会上传。</p>
          <div class="prefs-actions">
            <button class="button button-quiet" type="button" data-prefs-action="clear-favorites">清空收藏 (${favoriteCount})</button>
            <button class="button button-quiet" type="button" data-prefs-action="clear-whitelist">清空白名单 (${whitelistCount})</button>
            <button class="button button-danger" type="button" data-prefs-action="clear-blacklist">清空黑名单 (${blacklistCount})</button>
            <button class="button button-quiet" type="button" data-prefs-action="import">导入偏好</button>
            <button class="button button-quiet" type="button" data-prefs-action="export">导出偏好</button>
            <button class="button button-danger" type="button" data-prefs-action="reset">重置全部</button>
          </div>
        </section>
        ${sourcesHTML()}
      </div>`;
    refreshIcons(els.prefsContent);
    if (!els.prefsDialog.open) els.prefsDialog.showModal();
  }

  function updateSoundButton() {
    const icon = state.prefs.sound ? "volume-2" : "volume-x";
    els.soundButton.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
    els.soundButton.setAttribute("aria-pressed", String(state.prefs.sound));
    els.soundButton.setAttribute("aria-label", state.prefs.sound ? "关闭音效" : "开启音效");
    refreshIcons(els.soundButton);
    const machineSound = $("#machineSound");
    if (machineSound) {
      machineSound.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
      refreshIcons(machineSound);
    }
  }

  function setPreferenceFlag(key) {
    state.prefs[key] = !state.prefs[key];
    persistPrefs();
    updateAll();
    renderPrefs();
  }

  function downloadPreferences() {
    const payload = Core.exportPayload(state.prefs, DATA.meta);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `roll-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("偏好文件已导出");
  }

  function confirmAction(title, text, acceptLabel = "确认") {
    return new Promise((resolve) => {
      els.confirmTitle.textContent = title;
      els.confirmText.textContent = text;
      els.confirmAccept.textContent = acceptLabel;
      const onClose = () => {
        els.confirmDialog.removeEventListener("close", onClose);
        resolve(els.confirmDialog.returnValue === "confirm");
      };
      els.confirmDialog.addEventListener("close", onClose);
      els.confirmDialog.showModal();
    });
  }

  async function clearPreferenceList(key) {
    const labels = {
      favorites: "收藏",
      whitelist: "白名单",
      blacklist: "黑名单",
    };
    if (!state.prefs[key].length) {
      showToast(`${labels[key]}已经是空的`);
      return;
    }
    const ok = await confirmAction(
      `清空${labels[key]}？`,
      `将移除 ${state.prefs[key].length} 条本地记录。`,
      "清空"
    );
    if (!ok) return;
    state.prefs[key] = [];
    if (key === "favorites") state.prefs.favoritesOnly = false;
    if (key === "whitelist") state.prefs.onlyWhitelist = false;
    persistPrefs();
    updateAll();
    renderPrefs();
    showToast(`${labels[key]}已清空`);
  }

  async function resetPreferences() {
    const ok = await confirmAction(
      "重置全部偏好？",
      "收藏、白名单、黑名单、历史记录和抽取规则都会恢复默认。",
      "重置"
    );
    if (!ok) return;
    state.prefs = Core.normalizePrefs(Core.DEFAULT_PREFS);
    state.filters = Core.normalizeFilters({ ...Core.DEFAULT_FILTERS, view: state.filters.view });
    state.lastRollId = null;
    state.currentResult = null;
    els.resultPanel.hidden = true;
    persistPrefs();
    persistFilters();
    updateAll();
    renderPrefs();
    showToast("偏好已重置");
  }

  async function handleImport(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast("文件太大，未导入");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      state.prefs = Core.sanitizeImport(parsed, DATA.shops);
      persistPrefs();
      updateAll();
      renderPrefs();
      showToast("偏好已导入");
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    } finally {
      els.importInput.value = "";
    }
  }

  function bindEvents() {
    els.modeBar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");
      if (!button || state.rolling || state.awaitingCards) return;
      state.mode = button.dataset.mode;
      saveJSON(STORAGE.mode, state.mode);
      state.currentResult = null;
      els.resultPanel.hidden = true;
      updateAll();
    });

    els.heroRoll.addEventListener("click", () => {
      $("#roll").scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
      window.setTimeout(beginRoll, 220);
    });
    els.rollButton.addEventListener("click", beginRoll);
    $("#machineSound").addEventListener("click", () => {
      state.prefs.sound = !state.prefs.sound;
      persistPrefs();
      updateSoundButton();
    });
    els.soundButton.addEventListener("click", () => {
      state.prefs.sound = !state.prefs.sound;
      persistPrefs();
      updateSoundButton();
    });

    els.excludeRecentToggle.addEventListener("change", (event) => {
      state.prefs.excludeRecent = event.target.checked
        ? Math.max(1, state.prefs.excludeRecent || 3)
        : 0;
      persistPrefs();
      updateAll();
    });
    els.onlyWhitelistToggle.addEventListener("change", (event) => {
      if (
        event.target.checked &&
        !state.prefs.whitelist.length
      ) {
        event.target.checked = false;
        showToast("白名单还是空的，先加入一家常吃门店");
        return;
      }
      state.prefs.onlyWhitelist = event.target.checked;
      persistPrefs();
      updateAll();
    });
    els.favoritesOnlyToggle.addEventListener("change", (event) => {
      if (
        event.target.checked &&
        !state.prefs.favorites.length
      ) {
        event.target.checked = false;
        showToast("收藏夹还是空的，先收藏一家店");
        return;
      }
      state.prefs.favoritesOnly = event.target.checked;
      persistPrefs();
      updateAll();
    });

    els.resultPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-result-action]");
      if (!button || !state.currentResult) return;
      const shop = state.currentResult;
      const action = button.dataset.resultAction;
      if (action === "accept") {
        state.prefs = Core.confirmChoice(shop, state.mode, state.prefs);
        persistPrefs();
        updateAll();
        showToast(`已确定：${shop.name}`);
      }
      if (action === "again") beginRoll();
      if (action === "favorite") togglePreference("favorites", shop.id);
      if (action === "whitelist") togglePreference("whitelist", shop.id);
      if (action === "blacklist") togglePreference("blacklist", shop.id);
      if (action === "detail") openDetail(shop.id, button);
      if (action === "copy") {
        const ok = await copyText(Core.buildShareText(shop, DATA.meta));
        showToast(ok ? "分享文案已复制" : "复制失败，请检查浏览器权限");
      }
    });

    els.libraryTabs.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-pool-view]");
      if (!tab) return;
      state.poolView = tab.dataset.poolView;
      resetVisibleCount();
      renderPool();
    });

    els.filterRibbon.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-filter]");
      if (!chip) return;
      const { filter, value } = chip.dataset;
      if (filter === "group") {
        state.filters.groups = !value
          ? []
          : state.filters.groups.includes(value)
            ? state.filters.groups.filter((group) => group !== value)
            : [...state.filters.groups, value];
      } else {
        state.filters[filter] = value;
      }
      resetVisibleCount();
      persistFilters();
      updateAll();
    });

    els.searchInput.addEventListener("input", (event) => {
      clearTimeout(state.queryTimer);
      state.queryTimer = window.setTimeout(() => {
        state.filters.q = event.target.value.trim();
        resetVisibleCount();
        persistFilters();
        updateAll();
      }, 140);
    });
    els.clearSearch.addEventListener("click", () => {
      state.filters.q = "";
      resetVisibleCount();
      persistFilters();
      updateAll();
      els.searchInput.focus();
    });
    els.sortSelect.addEventListener("change", (event) => {
      state.filters.sort = event.target.value;
      resetVisibleCount();
      persistFilters();
      updateAll();
    });
    $(".view-toggle").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      state.filters.view = button.dataset.view;
      persistFilters();
      renderPool();
    });
    els.clearFilters.addEventListener("click", () => {
      state.filters = Core.normalizeFilters({
        ...Core.DEFAULT_FILTERS,
        view: state.filters.view,
      });
      resetVisibleCount();
      persistFilters();
      updateAll();
    });
    els.loadMoreButton.addEventListener("click", () => {
      state.visibleCount += PAGE_SIZE;
      renderPool();
    });

    els.poolGrid.addEventListener("click", (event) => {
      if (event.target.closest('[data-action="clear-filters"]')) {
        els.clearFilters.click();
        return;
      }
      const actionButton = event.target.closest("[data-action]");
      const item = event.target.closest("[data-id]");
      if (!item) return;
      const id = item.dataset.id;
      if (!actionButton || actionButton.dataset.action === "detail") {
        openDetail(id, actionButton || item);
        return;
      }
      event.stopPropagation();
      const keys = {
        favorite: "favorites",
        whitelist: "whitelist",
        blacklist: "blacklist",
      };
      togglePreference(keys[actionButton.dataset.action], id);
    });

    document.addEventListener("keydown", (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if (
        event.key.toLowerCase() === "r" &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        beginRoll();
      }
    });

    els.detailDialog.addEventListener("click", async (event) => {
      if (event.target === els.detailDialog || event.target.closest("[data-close-dialog]")) {
        closeDetail();
        return;
      }
      const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
      if (!action) return;
      const id = new URLSearchParams(location.hash.slice(1)).get("shop");
      const shop = shopById.get(id);
      if (!shop) return;
      if (action === "copy-name") {
        const ok = await copyText(shop.name);
        showToast(ok ? "店名已复制" : "复制失败");
      }
      if (["favorite", "whitelist", "blacklist"].includes(action)) {
        const keys = {
          favorite: "favorites",
          whitelist: "whitelist",
          blacklist: "blacklist",
        };
        togglePreference(keys[action], shop.id);
        openDetail(shop.id, state.lastDetailTrigger);
      }
    });
    els.detailDialog.addEventListener("close", () => {
      if (location.hash.startsWith("#shop=")) {
        history.replaceState(null, "", `${location.pathname}${location.search}`);
      }
    });

    const openPrefs = () => {
      state.prefs = Core.normalizePrefs(state.prefs);
      renderPrefs();
    };
    $("#prefsButton").addEventListener("click", openPrefs);
    $("#prefsButtonSecondary").addEventListener("click", openPrefs);
    $("#rulesButton").addEventListener("click", openPrefs);
    $("#sourceButton").addEventListener("click", () => {
      renderPrefs();
      requestAnimationFrame(() =>
        $("#sourceSection", els.prefsContent)?.scrollIntoView({ block: "start" })
      );
    });
    els.prefsDialog.addEventListener("click", (event) => {
      if (event.target === els.prefsDialog || event.target.closest("[data-close-dialog]")) {
        els.prefsDialog.close();
        return;
      }
      const action = event.target.closest("[data-prefs-action]")?.dataset.prefsAction;
      if (!action) return;
      if (action === "only-whitelist") {
        state.prefs.onlyWhitelist = !state.prefs.onlyWhitelist;
        persistPrefs();
        updateAll();
        renderPrefs();
      }
      if (action === "favorites-only") {
        state.prefs.favoritesOnly = !state.prefs.favoritesOnly;
        persistPrefs();
        updateAll();
        renderPrefs();
      }
      if (action === "sound") setPreferenceFlag("sound");
      if (action === "motion") setPreferenceFlag("motion");
      if (action === "import") els.importInput.click();
      if (action === "export") downloadPreferences();
      if (action === "clear-favorites") clearPreferenceList("favorites");
      if (action === "clear-whitelist") clearPreferenceList("whitelist");
      if (action === "clear-blacklist") clearPreferenceList("blacklist");
      if (action === "reset") resetPreferences();
    });
    els.prefsDialog.addEventListener("change", (event) => {
      if (event.target.id !== "excludeRecentSelect") return;
      state.prefs.excludeRecent = Number(event.target.value);
      persistPrefs();
      updateAll();
    });
    $("#exportButton").addEventListener("click", downloadPreferences);
    $("#importButton").addEventListener("click", () => els.importInput.click());
    els.importInput.addEventListener("change", () => handleImport(els.importInput.files[0]));

    document.addEventListener(
      "error",
      (event) => {
        if (event.target.tagName === "IMG") {
          event.target.style.opacity = "0";
        }
      },
      true
    );
  }

  function checkData() {
    const ids = new Set();
    for (const shop of DATA.shops) {
      if (!shop.id || ids.has(shop.id)) throw new Error("店铺 ID 重复或缺失");
      if (!shop.name || !shop.image) throw new Error(`店铺数据不完整：${shop.id}`);
      ids.add(shop.id);
    }
    if (DATA.meta.shopCount !== DATA.shops.length) {
      throw new Error("店铺数量与元数据不一致");
    }
  }

  function openSharedShop() {
    const id = new URLSearchParams(location.hash.slice(1)).get("shop");
    if (id && shopById.has(id)) {
      window.setTimeout(() => openDetail(id, document.body), 220);
    }
  }

  function init() {
    checkData();
    document.documentElement.dataset.ready = "true";
    els.footerDataNote.textContent = `${DATA.meta.area} · ${DATA.meta.sourceCount} 张截图 · ${formatCount(
      DATA.shops.length
    )} 个店铺条目 · ${DATA.meta.builtAt}`;
    document.documentElement.classList.toggle("reduce-motion", !state.prefs.motion);
    bindEvents();
    updateAll();
    updateSoundButton();
    refreshIcons();
    openSharedShop();
  }

  try {
    init();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <main class="empty-state">
        <div class="empty-icon"><i data-lucide="database-zap"></i></div>
        <h1>页面初始化失败</h1>
        <p>${escape(error.message)}</p>
      </main>`;
    refreshIcons();
  }
})();
