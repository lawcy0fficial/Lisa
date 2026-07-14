/* LISA// — application logic
   No build step, no framework, no server. Pure DOM + localStorage. */
(function () {
  "use strict";

  const PROFILES_KEY = "lisa_checklist_profiles_v2";
  const LEGACY_PROGRESS_KEY = "lisa_checklist_progress_v1";
  const LEGACY_FLAG_KEY = "lisa_checklist_flags_v1";
  const OPEN_KEY = "lisa_checklist_open_cats_v1";
  const THEME_KEY = "lisa_checklist_theme_v1";

  const DATA = window.CHECKLIST_DATA || [];
  const TOTAL_ITEMS = DATA.reduce((sum, c) => sum + c.items.length, 0);
  const TOTAL_CATS = DATA.length;

  const CLUSTER_ORDER = ["Identity & Access","Injection & Input","Client-Side & Browser","APIs & Protocols","Infrastructure & Cloud","Business Logic & Commerce","Emerging & Specialized"];
  const CLUSTER_ABBR = {
    "Identity & Access":"IDN","Injection & Input":"INJ","Client-Side & Browser":"CLI",
    "APIs & Protocols":"API","Infrastructure & Cloud":"INF","Business Logic & Commerce":"LGC",
    "Emerging & Specialized":"EMR",
  };
  const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SEVERITY_ORDER = ["none", "critical", "high", "medium", "low"];
  const SEVERITY_LABEL = { none: "—", critical: "C", high: "H", medium: "M", low: "L" };
  const SEVERITY_NAME = { none: "No severity", critical: "Critical", high: "High", medium: "Medium", low: "Low" };

  /* ---------- profile store ---------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function blankProfile(name) {
    return { id: uid(), name: name || "Default", createdAt: new Date().toISOString(),
      progress: {}, flags: {}, severities: {}, notes: {} };
  }

  function loadProfileStore() {
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.profiles && Object.keys(parsed.profiles).length) return parsed;
      }
    } catch (e) { /* fall through to migration/default */ }

    // migrate legacy single-profile data if present
    let legacyProgress = {}, legacyFlags = {};
    try { const p = localStorage.getItem(LEGACY_PROGRESS_KEY); if (p) legacyProgress = JSON.parse(p); } catch (e) {}
    try { const f = localStorage.getItem(LEGACY_FLAG_KEY); if (f) legacyFlags = JSON.parse(f); } catch (e) {}

    const def = blankProfile("Default");
    def.id = "default";
    def.progress = legacyProgress || {};
    def.flags = legacyFlags || {};
    const store = { activeId: "default", profiles: { default: def } };
    return store;
  }

  function saveProfileStore() {
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profileStore)); }
    catch (e) { /* storage unavailable — fail silently */ }
  }

  let profileStore = loadProfileStore();
  function activeProfile() { return profileStore.profiles[profileStore.activeId]; }

  function listProfiles() {
    return Object.values(profileStore.profiles).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function createProfile(name) {
    const p = blankProfile(name);
    profileStore.profiles[p.id] = p;
    profileStore.activeId = p.id;
    saveProfileStore();
    refreshAll();
    renderProfileSwitcher();
    showToast(`Created profile “${p.name}”`);
  }

  function switchProfile(id) {
    if (!profileStore.profiles[id]) return;
    profileStore.activeId = id;
    saveProfileStore();
    refreshAll();
    renderProfileSwitcher();
    showToast(`Switched to “${profileStore.profiles[id].name}”`);
  }

  function renameActiveProfile(name) {
    const p = activeProfile();
    if (!name || !name.trim()) return;
    p.name = name.trim();
    saveProfileStore();
    renderProfileSwitcher();
    showToast("Profile renamed");
  }

  function deleteActiveProfile() {
    const ids = Object.keys(profileStore.profiles);
    if (ids.length <= 1) { showToast("Can't delete the only profile"); return; }
    const p = activeProfile();
    if (!confirm(`Delete profile “${p.name}” and all of its progress? This cannot be undone.`)) return;
    delete profileStore.profiles[p.id];
    profileStore.activeId = Object.keys(profileStore.profiles)[0];
    saveProfileStore();
    refreshAll();
    renderProfileSwitcher();
    showToast("Profile deleted");
  }

  /* ---------- state ---------- */
  let openCats = loadOpenCats();       // Set of catId — shared UI state across profiles
  let viewMode = "all";                // all | pending | done | flagged
  let sevFilter = "all";               // all | critical | high | medium | low
  let searchTerm = "";
  let activeClusters = new Set();      // empty = show all clusters

  function loadOpenCats() {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) { return new Set(); }
  }
  function saveOpenCats() {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openCats])); }
    catch (e) {}
  }

  function keyFor(catId, idx) { return catId + "-" + idx; }
  function isChecked(catId, idx) { return !!activeProfile().progress[keyFor(catId, idx)]; }
  function setChecked(catId, idx, val) {
    const k = keyFor(catId, idx);
    const p = activeProfile();
    if (val) p.progress[k] = true; else delete p.progress[k];
    saveProfileStore();
  }
  function isFlagged(catId, idx) { return !!activeProfile().flags[keyFor(catId, idx)]; }
  function setFlagged(catId, idx, val) {
    const k = keyFor(catId, idx);
    const p = activeProfile();
    if (val) p.flags[k] = true; else delete p.flags[k];
    saveProfileStore();
  }
  function flaggedCount() { return Object.keys(activeProfile().flags).length; }

  function getSeverity(catId, idx) { return activeProfile().severities[keyFor(catId, idx)] || "none"; }
  function setSeverity(catId, idx, val) {
    const k = keyFor(catId, idx);
    const p = activeProfile();
    if (val === "none") delete p.severities[k]; else p.severities[k] = val;
    saveProfileStore();
  }
  function cycleSeverity(catId, idx) {
    const cur = getSeverity(catId, idx);
    const next = SEVERITY_ORDER[(SEVERITY_ORDER.indexOf(cur) + 1) % SEVERITY_ORDER.length];
    setSeverity(catId, idx, next);
    return next;
  }

  function getNote(catId, idx) { return activeProfile().notes[keyFor(catId, idx)] || ""; }
  function setNote(catId, idx, text) {
    const k = keyFor(catId, idx);
    const p = activeProfile();
    if (text && text.trim()) p.notes[k] = text; else delete p.notes[k];
    saveProfileStore();
  }
  function hasNote(catId, idx) { return !!activeProfile().notes[keyFor(catId, idx)]; }

  function categoryDoneCount(cat) {
    let n = 0;
    for (let i = 0; i < cat.items.length; i++) if (isChecked(cat.id, i)) n++;
    return n;
  }
  function totalDoneCount() {
    let n = 0;
    for (const cat of DATA) n += categoryDoneCount(cat);
    return n;
  }

  function clusterStats(clusterName) {
    let total = 0, done = 0;
    for (const cat of DATA) {
      if (cat.cluster !== clusterName) continue;
      total += cat.items.length;
      done += categoryDoneCount(cat);
    }
    return { total, done, pct: total ? (done / total) * 100 : 0 };
  }

  /* ---------- DOM refs ---------- */
  const el = {
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),
    navToggle: document.getElementById("navToggle"),
    catList: document.getElementById("catList"),
    categories: document.getElementById("categories"),
    searchInput: document.getElementById("searchInput"),
    resultsMeta: document.getElementById("resultsMeta"),
    resultsCount: document.getElementById("resultsCount"),
    clearSearch: document.getElementById("clearSearch"),
    filterBtn: document.getElementById("filterPending"),
    filterLabel: document.getElementById("filterLabel"),
    statStrip: document.getElementById("statStrip"),
    heroTargetWrap: document.getElementById("heroTargetWrap"),
    exportBadgeBtn: document.getElementById("exportBadgeBtn"),
    exportJsonBtn: document.getElementById("exportJsonBtn"),
    importJsonInput: document.getElementById("importJsonInput"),
    resetBtn: document.getElementById("resetBtn"),
    toast: document.getElementById("toast"),
    statTotalInline: document.getElementById("statTotalInline"),
    statCatsInline: document.getElementById("statCatsInline"),
    clusterLegend: document.getElementById("clusterLegend"),
    bootOverlay: document.getElementById("bootOverlay"),
    bootConsole: document.getElementById("bootConsole"),
    expandAllBtn: document.getElementById("expandAllBtn"),
    collapseAllBtn: document.getElementById("collapseAllBtn"),
    exportMdBtn: document.getElementById("exportMdBtn"),
    exportCsvBtn: document.getElementById("exportCsvBtn"),
    randomBtn: document.getElementById("randomBtn"),
    themeToggle: document.getElementById("themeToggle"),
    sevFilterBtn: document.getElementById("sevFilterBtn"),
    sevFilterLabel: document.getElementById("sevFilterLabel"),
    profileSelect: document.getElementById("profileSelect"),
    profileNewBtn: document.getElementById("profileNewBtn"),
    profileRenameBtn: document.getElementById("profileRenameBtn"),
    profileDeleteBtn: document.getElementById("profileDeleteBtn"),
  };

  el.statTotalInline.textContent = TOTAL_ITEMS.toLocaleString();
  el.statCatsInline.textContent = TOTAL_CATS;
  document.getElementById("catCountLabel").textContent = TOTAL_CATS + " SECTIONS";

  /* ---------- count-up number animation ---------- */
  const countState = new WeakMap();
  function animateNumber(node, toValue, opts) {
    opts = opts || {};
    const suffix = opts.suffix || "";
    if (REDUCED_MOTION) { node.textContent = toValue.toLocaleString() + suffix; return; }
    const from = countState.get(node) || 0;
    countState.set(node, toValue);
    if (from === toValue) { node.textContent = toValue.toLocaleString() + suffix; return; }
    const dur = 450;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + (toValue - from) * eased);
      node.textContent = val.toLocaleString() + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* =========================================================
     RADAR / TARGET SVG (signature element)
     ========================================================= */
  const CLUSTER_HEX = {
    "Identity & Access":"#33D6C0","Injection & Input":"#FF4D6A","Client-Side & Browser":"#A78BFA",
    "APIs & Protocols":"#FF9A63","Infrastructure & Cloud":"#5B9DFF","Business Logic & Commerce":"#52D273",
    "Emerging & Specialized":"#FF6FB0",
  };

  function buildTargetSVG(size, pct, opts) {
    opts = opts || {};
    const cx = size / 2, cy = size / 2;
    const r = size * 0.42;
    const r2 = size * 0.24;
    const strokeW = Math.max(3, size * 0.018);
    const circumference = 2 * Math.PI * r;
    const offset = circumference * (1 - pct / 100);
    const showSweep = opts.sweep !== false;
    const fontBig = Math.round(size * 0.15);
    const fontSmall = Math.round(size * 0.045);

    let ticks = "";
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      const x1 = cx + Math.cos(rad) * (r + strokeW);
      const y1 = cy + Math.sin(rad) * (r + strokeW);
      const x2 = cx + Math.cos(rad) * (r + strokeW + size * 0.03);
      const y2 = cy + Math.sin(rad) * (r + strokeW + size * 0.03);
      ticks += `<line class="target-tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
    }

    let blips = "";
    if (opts.clusters && opts.clusters.length) {
      const n = opts.clusters.length;
      const br = r + strokeW + size * 0.09;
      opts.clusters.forEach((cl, i) => {
        const rad = (-90 + (360 / n) * i) * (Math.PI / 180);
        const bx = cx + Math.cos(rad) * br;
        const by = cy + Math.sin(rad) * br;
        const radius = 2 + (cl.pct / 100) * 3.4;
        const opacity = 0.28 + (cl.pct / 100) * 0.72;
        blips += `<circle class="cluster-blip" cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${radius.toFixed(2)}" fill="${cl.color}" opacity="${opacity.toFixed(2)}"><title>${cl.name}: ${Math.round(cl.pct)}%</title></circle>`;
      });
    }

    return `
<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${pct}% complete">
  <defs>
    <radialGradient id="targetGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#33D6C0" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#33D6C0" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" fill="#0A0E12"/>
  <circle cx="${cx}" cy="${cy}" r="${r + strokeW + size*0.06}" fill="url(#targetGlow)"/>
  ${ticks}
  <circle class="target-crosshair" x1="0" x2="${size}" y1="${cy}" y2="${cy}" cx="${cx}" cy="${cy}" r="${r*0.62}"/>
  <line class="target-crosshair" x1="${cx - r*0.14}" y1="${cy}" x2="${cx + r*0.14}" y2="${cy}"/>
  <line class="target-crosshair" x1="${cx}" y1="${cy - r*0.14}" x2="${cx}" y2="${cy + r*0.14}"/>
  <circle class="target-ring" cx="${cx}" cy="${cy}" r="${r}"/>
  <circle class="target-ring" cx="${cx}" cy="${cy}" r="${r2}"/>
  <circle class="target-progress" cx="${cx}" cy="${cy}"
    r="${r}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
  ${blips}
  ${showSweep ? `
  <g class="target-sweep">
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r}" stroke="#33D6C0" stroke-width="1.5" opacity="0.7"/>
    <circle class="target-dot pulse" cx="${cx}" cy="${cy - r}" r="3"/>
  </g>` : ""}
  <text class="target-pct" x="${cx}" y="${cy + fontBig*0.34}" font-size="${fontBig}" text-anchor="middle">${Math.round(pct)}%</text>
  <text class="target-pct-label" x="${cx}" y="${cy + fontBig*0.34 + fontSmall*1.9}" font-size="${fontSmall}" text-anchor="middle">COMPLETE</text>
</svg>`.trim();
  }

  function clusterBlipData() {
    return CLUSTER_ORDER.map((name) => {
      const s = clusterStats(name);
      return { name, pct: s.pct, color: CLUSTER_HEX[name] };
    });
  }

  function renderHeroTarget() {
    const done = totalDoneCount();
    const pct = TOTAL_ITEMS ? (done / TOTAL_ITEMS) * 100 : 0;
    el.heroTargetWrap.innerHTML = buildTargetSVG(220, pct, { sweep: true, clusters: clusterBlipData() });
  }

  /* =========================================================
     SIDEBAR
     ========================================================= */
  function renderSidebar() {
    el.catList.innerHTML = "";
    CLUSTER_ORDER.forEach((clusterName) => {
      const catsInCluster = DATA.filter((c) => c.cluster === clusterName);
      if (!catsInCluster.length) return;

      const headLi = document.createElement("li");
      headLi.className = "sidebar-cluster-head";
      headLi.style.setProperty("--cc", `var(--c-${clusterVar(clusterName)})`);
      headLi.innerHTML = `<span class="sw"></span>${escapeHtml(clusterName)}`;
      el.catList.appendChild(headLi);

      catsInCluster.forEach((cat) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.className = "cat-link";
        btn.dataset.cat = cat.id;
        btn.style.setProperty("--cc", `var(--c-${clusterVar(cat.cluster)})`);
        const done = categoryDoneCount(cat);
        const pct = cat.items.length ? (done / cat.items.length) * 100 : 0;
        btn.innerHTML = `
          <span class="sw"></span>
          <span class="cat-num">${String(cat.id).padStart(2, "0")}</span>
          <span class="cat-name">${escapeHtml(cat.title)}</span>
          <span class="cat-mini-bar"><span class="cat-mini-fill" style="width:${pct}%"></span></span>
        `;
        btn.addEventListener("click", () => {
          openCategory(cat.id, true);
          const target = document.getElementById("cat-" + cat.id);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          closeMobileSidebar();
        });
        li.appendChild(btn);
        el.catList.appendChild(li);
      });
    });
  }

  function updateSidebarProgress() {
    el.catList.querySelectorAll(".cat-link").forEach((btn) => {
      const cat = DATA.find((c) => String(c.id) === btn.dataset.cat);
      if (!cat) return;
      const done = categoryDoneCount(cat);
      const pct = cat.items.length ? (done / cat.items.length) * 100 : 0;
      btn.querySelector(".cat-mini-fill").style.width = pct + "%";
    });
  }

  /* =========================================================
     CLUSTER LEGEND / DOMAIN FILTER
     ========================================================= */
  function renderClusterLegend() {
    el.clusterLegend.innerHTML = CLUSTER_ORDER.map((name) => {
      const stats = clusterStats(name);
      const catCount = DATA.filter((c) => c.cluster === name).length;
      const active = activeClusters.has(name);
      return `<button type="button" class="cluster-chip${active ? " active" : ""}" data-cluster="${escapeHtml(name)}" style="--cc:var(--c-${clusterVar(name)})">
        <span class="sw"></span>${escapeHtml(name)} <span class="n">${catCount}</span>
      </button>`;
    }).join("");

    el.clusterLegend.querySelectorAll(".cluster-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.cluster;
        if (activeClusters.has(name)) activeClusters.delete(name);
        else activeClusters.add(name);
        renderClusterLegend();
        renderCategories();
      });
    });
  }

  function clusterVar(name) {
    return { "Identity & Access":"identity","Injection & Input":"injection","Client-Side & Browser":"clientside",
      "APIs & Protocols":"apis","Infrastructure & Cloud":"infra","Business Logic & Commerce":"logic",
      "Emerging & Specialized":"emerging" }[name] || "identity";
  }

  /* =========================================================
     STAT STRIP
     ========================================================= */
  function renderStatStrip() {
    const done = totalDoneCount();
    const pending = TOTAL_ITEMS - done;
    const pct = TOTAL_ITEMS ? Math.round((done / TOTAL_ITEMS) * 100) : 0;
    const catsStarted = DATA.filter((c) => categoryDoneCount(c) > 0).length;
    const catsComplete = DATA.filter((c) => categoryDoneCount(c) === c.items.length).length;

    if (!el.statStrip.dataset.built) {
      el.statStrip.innerHTML = `
        <div class="stat-cell"><span class="num" data-k="total">0</span><span class="lbl">Total test cases</span></div>
        <div class="stat-cell done"><span class="num" data-k="done">0</span><span class="lbl">Completed</span></div>
        <div class="stat-cell warn"><span class="num" data-k="pending">0</span><span class="lbl">Pending</span></div>
        <div class="stat-cell accent"><span class="num" data-k="pct">0%</span><span class="lbl">Coverage</span></div>
        <div class="stat-cell"><span class="num" data-k="cleared">0/${TOTAL_CATS}</span><span class="lbl">Sections cleared</span></div>
        <div class="stat-cell"><span class="num" data-k="progress">0</span><span class="lbl">Sections in progress</span></div>
        <div class="stat-cell flag"><span class="num" data-k="flagged">0</span><span class="lbl">Flagged priority</span></div>
      `;
      el.statStrip.dataset.built = "1";
    }
    animateNumber(el.statStrip.querySelector('[data-k="total"]'), TOTAL_ITEMS);
    animateNumber(el.statStrip.querySelector('[data-k="done"]'), done);
    animateNumber(el.statStrip.querySelector('[data-k="pending"]'), pending);
    animateNumber(el.statStrip.querySelector('[data-k="pct"]'), pct, { suffix: "%" });
    el.statStrip.querySelector('[data-k="cleared"]').textContent = `${catsComplete}/${TOTAL_CATS}`;
    animateNumber(el.statStrip.querySelector('[data-k="progress"]'), catsStarted);
    animateNumber(el.statStrip.querySelector('[data-k="flagged"]'), flaggedCount());
  }

  /* =========================================================
     CATEGORY / ITEM RENDERING (lazy body render on expand)
     ========================================================= */
  function catProgressRingSVG(cat) {
    const done = categoryDoneCount(cat);
    const pct = cat.items.length ? (done / cat.items.length) * 100 : 0;
    const r = 13, c = 2 * Math.PI * r;
    const offset = c * (1 - pct / 100);
    return `
      <svg class="cat-progress-ring" viewBox="0 0 34 34">
        <circle class="bg" cx="17" cy="17" r="${r}"/>
        <circle class="fg" cx="17" cy="17" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
        <text class="cat-progress-text" x="17" y="20">${Math.round(pct)}</text>
      </svg>`;
  }

  const revealObserver = (!REDUCED_MOTION && "IntersectionObserver" in window)
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: "0px 0px -60px 0px", threshold: 0.05 })
    : null;

  let firstCategoriesRender = true;
  function observeReveal(card, i) {
    if (!revealObserver || !firstCategoriesRender) return;
    card.classList.add("pre-reveal");
    card.style.setProperty("--reveal-i", i % 6);
    revealObserver.observe(card);
  }

  function buildCategoryCard(cat) {
    const card = document.createElement("article");
    card.className = "cat-card";
    card.id = "cat-" + cat.id;
    card.dataset.catId = cat.id;
    card.dataset.cluster = cat.cluster;
    card.style.setProperty("--cc", `var(--c-${clusterVar(cat.cluster)})`);

    const header = document.createElement("button");
    header.className = "cat-card-header";
    header.setAttribute("aria-expanded", "false");
    header.innerHTML = `
      <span class="cat-id">${String(cat.id).padStart(2, "0")}</span>
      <span class="cat-title-wrap">
        <p class="cat-title">${escapeHtml(cat.title)}</p>
        <span class="cat-count">${cat.items.length} test cases</span>
        <span class="cat-cluster-tag">${escapeHtml(cat.cluster)}</span>
      </span>
      <span class="cat-ring-slot">${catProgressRingSVG(cat)}</span>
      <svg class="cat-chevron" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
    `;

    const body = document.createElement("div");
    body.className = "cat-body";

    header.addEventListener("click", () => toggleCategory(cat.id));
    card.appendChild(header);
    card.appendChild(body);
    return card;
  }

  const STAR_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2.5l2.97 6.28 6.78.9-4.98 4.7 1.28 6.86L12 17.9l-6.05 3.34 1.28-6.86-4.98-4.7 6.78-.9L12 2.5z"/></svg>`;
  const COPY_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 9h11v11H9zM5 15V5a1 1 0 011-1h10"/></svg>`;
  const NOTE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 4h16v12H8l-4 4V4z"/></svg>`;

  function copyItemText(text, btn) {
    const done = () => {
      showToast("Copied test case to clipboard");
      if (btn) {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 900);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => showToast("Copy failed — clipboard unavailable"));
    } else {
      showToast("Clipboard unavailable in this browser");
    }
  }

  function onCycleSeverity(cat, idx, li, badge) {
    const next = cycleSeverity(cat.id, idx);
    badge.className = "item-sev-badge sev-" + next;
    badge.textContent = SEVERITY_LABEL[next];
    badge.title = SEVERITY_NAME[next] + " — click to change";
    li.dataset.sev = next;
    if (sevFilter !== "all" && sevFilter !== next) refreshCategoryBody(cat.id);
  }

  function onToggleNote(cat, idx, li, btn) {
    const existing = li.nextElementSibling;
    if (existing && existing.classList.contains("item-note-row")) {
      const ta = existing.querySelector("textarea");
      if (ta) {
        setNote(cat.id, idx, ta.value);
        const hasText = !!ta.value.trim();
        li.classList.toggle("has-note", hasText);
        btn.classList.toggle("active", hasText);
      }
      existing.remove();
      btn.classList.remove("editing");
      return;
    }
    btn.classList.add("editing");
    const row = document.createElement("li");
    row.className = "item-note-row";
    row.innerHTML = `<textarea class="item-note-input" placeholder="Add a note — finding reference, target detail, anything worth remembering…" rows="2"></textarea>`;
    const ta = row.querySelector("textarea");
    ta.value = getNote(cat.id, idx);
    let noteDebounce;
    ta.addEventListener("input", () => {
      clearTimeout(noteDebounce);
      noteDebounce = setTimeout(() => {
        setNote(cat.id, idx, ta.value);
        li.classList.toggle("has-note", !!ta.value.trim());
      }, 300);
    });
    li.insertAdjacentElement("afterend", row);
    ta.focus();
  }

  function refreshCategoryBody(catId) {
    const card = document.getElementById("cat-" + catId);
    if (!card || !card.classList.contains("open")) return;
    const cat = DATA.find((c) => c.id === catId);
    const body = card.querySelector(".cat-body");
    renderItemList(cat, body, currentFilterFn());
    requestAnimationFrame(() => { body.style.maxHeight = body.scrollHeight + "px"; });
  }

  function onToggleFlag(cat, idx, li, btn) {
    const val = !isFlagged(cat.id, idx);
    setFlagged(cat.id, idx, val);
    li.classList.toggle("flagged", val);
    btn.classList.toggle("active", val);
    btn.title = val ? "Unflag this test case" : "Flag as priority";
    renderStatStrip();
    if (viewMode === "flagged" && !val) refreshCategoryBody(cat.id);
  }

  function bulkSetChecked(cat, filterFn, val) {
    cat.items.forEach((text, idx) => {
      if (filterFn && !filterFn(cat, idx, text)) return;
      setChecked(cat.id, idx, val);
    });
    updateCategoryHeader(cat.id);
    updateSidebarProgress();
    renderClusterLegend();
    renderStatStrip();
    renderHeroTarget();
    refreshCategoryBody(cat.id);
    showToast(val ? `Checked all visible in “${cat.title}”` : `Cleared all visible in “${cat.title}”`);
  }

  function buildBodyToolbar(cat, filterFn, shownCount) {
    const bar = document.createElement("div");
    bar.className = "cat-body-toolbar";
    bar.innerHTML = `
      <button type="button" class="mini-btn" data-action="check-all">Check all</button>
      <button type="button" class="mini-btn" data-action="clear-all">Clear all</button>
      <span class="cat-body-toolbar-count">${shownCount.toLocaleString()} shown</span>
    `;
    bar.querySelector('[data-action="check-all"]').addEventListener("click", () => bulkSetChecked(cat, filterFn, true));
    bar.querySelector('[data-action="clear-all"]').addEventListener("click", () => bulkSetChecked(cat, filterFn, false));
    return bar;
  }

  function renderItemList(cat, body, filterFn) {
    const ul = document.createElement("ul");
    ul.className = "item-list";
    let shown = 0;
    cat.items.forEach((text, idx) => {
      if (filterFn && !filterFn(cat, idx, text)) return;
      shown++;
      const li = document.createElement("li");
      const checked = isChecked(cat.id, idx);
      const flagged = isFlagged(cat.id, idx);
      const sev = getSeverity(cat.id, idx);
      const noted = hasNote(cat.id, idx);
      li.className = "item-row" + (checked ? " checked" : "") + (flagged ? " flagged" : "") + (noted ? " has-note" : "");
      li.dataset.idx = idx;
      li.dataset.sev = sev;
      li.id = "row-" + cat.id + "-" + idx;

      const sevBadge = document.createElement("button");
      sevBadge.type = "button";
      sevBadge.className = "item-sev-badge sev-" + sev;
      sevBadge.textContent = SEVERITY_LABEL[sev];
      sevBadge.title = SEVERITY_NAME[sev] + " — click to change";
      sevBadge.addEventListener("click", (e) => { e.stopPropagation(); onCycleSeverity(cat, idx, li, sevBadge); });

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "item-checkbox";
      cb.checked = checked;
      cb.id = "item-" + cat.id + "-" + idx;
      cb.addEventListener("change", () => onToggleItem(cat, idx, cb.checked, li));

      const label = document.createElement("label");
      label.className = "item-text";
      label.setAttribute("for", cb.id);
      label.innerHTML = `<span class="item-idx">${String(idx + 1).padStart(3, "0")}</span>${highlightMatch(escapeHtml(text), searchTerm)}`;

      const actions = document.createElement("span");
      actions.className = "item-actions";

      const flagBtn = document.createElement("button");
      flagBtn.type = "button";
      flagBtn.className = "item-flag-btn" + (flagged ? " active" : "");
      flagBtn.title = flagged ? "Unflag this test case" : "Flag as priority";
      flagBtn.innerHTML = STAR_SVG;
      flagBtn.addEventListener("click", (e) => { e.stopPropagation(); onToggleFlag(cat, idx, li, flagBtn); });

      const noteBtn = document.createElement("button");
      noteBtn.type = "button";
      noteBtn.className = "item-note-btn" + (noted ? " active" : "");
      noteBtn.title = "Add / view note";
      noteBtn.innerHTML = NOTE_SVG;
      noteBtn.addEventListener("click", (e) => { e.stopPropagation(); onToggleNote(cat, idx, li, noteBtn); });

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "item-copy-btn";
      copyBtn.title = "Copy test case text";
      copyBtn.innerHTML = COPY_SVG;
      copyBtn.addEventListener("click", (e) => { e.stopPropagation(); copyItemText(text, copyBtn); });

      actions.appendChild(flagBtn);
      actions.appendChild(noteBtn);
      actions.appendChild(copyBtn);

      li.appendChild(sevBadge);
      li.appendChild(cb);
      li.appendChild(label);
      li.appendChild(actions);
      ul.appendChild(li);
    });
    body.innerHTML = "";
    if (shown === 0) {
      body.innerHTML = `<div class="no-results">No matching test cases in this section.</div>`;
    } else {
      if (cat.methodology) {
        const tip = document.createElement("div");
        tip.className = "cat-methodology";
        tip.innerHTML = `<span class="cat-methodology-tag">METHOD</span> ${escapeHtml(cat.methodology)}`;
        body.appendChild(tip);
      }
      body.appendChild(buildBodyToolbar(cat, filterFn, shown));
      body.appendChild(ul);
    }
    return shown;
  }

  function onToggleItem(cat, idx, val, li) {
    setChecked(cat.id, idx, val);
    li.classList.toggle("checked", val);
    if (val && !REDUCED_MOTION) {
      const cb = li.querySelector(".item-checkbox");
      cb.classList.add("checkbox-pulse");
      setTimeout(() => cb.classList.remove("checkbox-pulse"), 400);
      window.dispatchEvent(new CustomEvent("lisa:ping"));
    }
    updateCategoryHeader(cat.id);
    updateSidebarProgress();
    renderClusterLegend();
    renderStatStrip();
    renderHeroTarget();
  }

  function updateCategoryHeader(catId) {
    const cat = DATA.find((c) => c.id === catId);
    const card = document.getElementById("cat-" + catId);
    if (!cat || !card) return;
    const slot = card.querySelector(".cat-ring-slot");
    if (slot) slot.innerHTML = catProgressRingSVG(cat);
  }

  function toggleCategory(catId, forceOpen) {
    const card = document.getElementById("cat-" + catId);
    if (!card) return;
    const isOpen = card.classList.contains("open");
    const willOpen = forceOpen === true ? true : !isOpen;
    openCategory(catId, willOpen);
  }

  function openCategory(catId, willOpen) {
    const card = document.getElementById("cat-" + catId);
    if (!card) return;
    const cat = DATA.find((c) => c.id === catId);
    const body = card.querySelector(".cat-body");
    const header = card.querySelector(".cat-card-header");

    if (willOpen) {
      openCats.add(catId);
      card.classList.add("open");
      header.setAttribute("aria-expanded", "true");
      renderItemList(cat, body, currentFilterFn());
      // measure after render
      requestAnimationFrame(() => { body.style.maxHeight = body.scrollHeight + "px"; });
    } else {
      openCats.delete(catId);
      card.classList.remove("open");
      header.setAttribute("aria-expanded", "false");
      body.style.maxHeight = "0px";
    }
    saveOpenCats();
  }

  function currentFilterFn() {
    return (cat, idx, text) => {
      if (activeClusters.size && !activeClusters.has(cat.cluster)) return false;
      const checked = isChecked(cat.id, idx);
      if (viewMode === "pending" && checked) return false;
      if (viewMode === "done" && !checked) return false;
      if (viewMode === "flagged" && !isFlagged(cat.id, idx)) return false;
      if (sevFilter !== "all" && getSeverity(cat.id, idx) !== sevFilter) return false;
      if (searchTerm && !text.toLowerCase().includes(searchTerm)) return false;
      return true;
    };
  }

  function highlightMatch(html, term) {
    if (!term) return html;
    const idx = html.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return html;
    return html.slice(0, idx) + "<mark>" + html.slice(idx, idx + term.length) + "</mark>" + html.slice(idx + term.length);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderCategories() {
    el.categories.innerHTML = "";
    let totalVisible = 0;
    let anyOpenBySearch = false;
    const filterFn = currentFilterFn();

    DATA.forEach((cat, i) => {
      if (activeClusters.size && !activeClusters.has(cat.cluster)) return; // hidden by domain filter

      const card = buildCategoryCard(cat);
      el.categories.appendChild(card);
      observeReveal(card, i);

      const matchCount = cat.items.reduce((n, text, idx) => n + (filterFn(cat, idx, text) ? 1 : 0), 0);
      totalVisible += matchCount;

      const shouldOpen = (searchTerm && matchCount > 0) || (!searchTerm && openCats.has(cat.id));
      if (shouldOpen) {
        anyOpenBySearch = true;
        openCategory(cat.id, true);
      }
      // dim sections with zero matches during active search/filter
      if ((searchTerm || viewMode !== "all") && matchCount === 0) {
        card.style.opacity = "0.35";
      }
    });

    if (searchTerm || viewMode !== "all") {
      el.resultsMeta.hidden = false;
      el.resultsCount.textContent = `${totalVisible.toLocaleString()} matching test case${totalVisible === 1 ? "" : "s"}${searchTerm ? ` for “${searchTerm}”` : ""}`;
    } else {
      el.resultsMeta.hidden = true;
    }
    firstCategoriesRender = false;
  }

  /* =========================================================
     EXPORTS / IMPORT / RESET
     ========================================================= */
  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function slugify(s) {
    return (s || "profile").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "profile";
  }

  function exportBadgeSVG() {
    const done = totalDoneCount();
    const pct = TOTAL_ITEMS ? (done / TOTAL_ITEMS) * 100 : 0;
    const svg = buildTargetSVG(400, pct, { sweep: false, clusters: clusterBlipData() });
    downloadBlob(svg, `lisa-progress-${Math.round(pct)}pct.svg`, "image/svg+xml");
    showToast(`Exported progress target — ${Math.round(pct)}% (${done}/${TOTAL_ITEMS})`);
  }

  function exportProgressJSON() {
    const done = totalDoneCount();
    const p = activeProfile();
    const payload = {
      exported_at: new Date().toISOString(),
      profile: p.name,
      total_items: TOTAL_ITEMS,
      completed: done,
      percent: TOTAL_ITEMS ? +(done / TOTAL_ITEMS * 100).toFixed(2) : 0,
      progress: p.progress,
      flags: p.flags,
      severities: p.severities,
      notes: p.notes,
    };
    downloadBlob(JSON.stringify(payload, null, 2), `lisa-progress-${slugify(p.name)}.json`, "application/json");
    showToast("Progress exported as JSON");
  }

  function buildMarkdownExport() {
    const done = totalDoneCount();
    const pct = TOTAL_ITEMS ? Math.round((done / TOTAL_ITEMS) * 100) : 0;
    const p = activeProfile();
    const lines = [];
    lines.push("# LISA// Offensive Web Testing Manifest — Export");
    lines.push("");
    lines.push(`Profile: **${p.name}** — Exported ${new Date().toISOString()} — ${done.toLocaleString()}/${TOTAL_ITEMS.toLocaleString()} complete (${pct}%)`);
    lines.push("");
    CLUSTER_ORDER.forEach((clusterName) => {
      const cats = DATA.filter((c) => c.cluster === clusterName);
      if (!cats.length) return;
      lines.push(`## ${clusterName}`);
      cats.forEach((cat) => {
        lines.push("");
        lines.push(`### ${String(cat.id).padStart(2, "0")}. ${cat.title}`);
        lines.push(`*${cat.methodology || ""}*`);
        cat.items.forEach((text, idx) => {
          const box = isChecked(cat.id, idx) ? "x" : " ";
          const star = isFlagged(cat.id, idx) ? " ⭐" : "";
          const sev = getSeverity(cat.id, idx);
          const sevTag = sev !== "none" ? ` \`${sev.toUpperCase()}\`` : "";
          const note = getNote(cat.id, idx);
          lines.push(`- [${box}] ${text}${sevTag}${star}`);
          if (note) lines.push(`    - note: ${note.replace(/\n/g, " ")}`);
        });
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  function exportMarkdown() {
    const p = activeProfile();
    downloadBlob(buildMarkdownExport(), `lisa-checklist-${slugify(p.name)}.md`, "text/markdown");
    showToast("Checklist exported as Markdown");
  }

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCSVExport() {
    const rows = [["Cluster", "Category", "Item #", "Test Case", "Checked", "Severity", "Flagged", "Notes"]];
    DATA.forEach((cat) => {
      cat.items.forEach((text, idx) => {
        rows.push([
          cat.cluster, cat.title, idx + 1, text,
          isChecked(cat.id, idx) ? "yes" : "no",
          getSeverity(cat.id, idx),
          isFlagged(cat.id, idx) ? "yes" : "no",
          getNote(cat.id, idx),
        ]);
      });
    });
    return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  }

  function exportCSV() {
    const p = activeProfile();
    downloadBlob(buildCSVExport(), `lisa-checklist-${slugify(p.name)}.csv`, "text/csv");
    showToast("Checklist exported as CSV");
  }

  function importProgressJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed.progress !== "object") throw new Error("bad file");
        const p = activeProfile();
        p.progress = parsed.progress;
        if (parsed.flags && typeof parsed.flags === "object") p.flags = parsed.flags;
        if (parsed.severities && typeof parsed.severities === "object") p.severities = parsed.severities;
        if (parsed.notes && typeof parsed.notes === "object") p.notes = parsed.notes;
        saveProfileStore();
        refreshAll();
        showToast(`Progress imported into “${p.name}”`);
      } catch (e) {
        showToast("Import failed — invalid file");
      }
    };
    reader.readAsText(file);
  }

  function resetProgress() {
    const p = activeProfile();
    if (!confirm(`Reset all checklist progress in “${p.name}”? This cannot be undone.`)) return;
    p.progress = {};
    p.flags = {};
    p.severities = {};
    p.notes = {};
    saveProfileStore();
    refreshAll();
    showToast("Progress reset");
  }

  let toastTimer;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2600);
  }

  /* =========================================================
     PROFILE SWITCHER
     ========================================================= */
  function renderProfileSwitcher() {
    if (!el.profileSelect) return;
    const profiles = listProfiles();
    el.profileSelect.innerHTML = profiles.map((p) =>
      `<option value="${escapeHtml(p.id)}"${p.id === profileStore.activeId ? " selected" : ""}>${escapeHtml(p.name)}</option>`
    ).join("");
  }

  if (el.profileSelect) {
    el.profileSelect.addEventListener("change", (e) => switchProfile(e.target.value));
  }
  if (el.profileNewBtn) {
    el.profileNewBtn.addEventListener("click", () => {
      const name = prompt("Name this new engagement / profile:", "New target");
      if (name && name.trim()) createProfile(name.trim());
    });
  }
  if (el.profileRenameBtn) {
    el.profileRenameBtn.addEventListener("click", () => {
      const name = prompt("Rename profile:", activeProfile().name);
      if (name && name.trim()) renameActiveProfile(name.trim());
    });
  }
  if (el.profileDeleteBtn) {
    el.profileDeleteBtn.addEventListener("click", deleteActiveProfile);
  }

  /* =========================================================
     THEME TOGGLE
     ========================================================= */
  function loadTheme() {
    try { return localStorage.getItem(THEME_KEY) || "dark"; } catch (e) { return "dark"; }
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (el.themeToggle) el.themeToggle.setAttribute("aria-pressed", String(theme === "light"));
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }
  let currentTheme = loadTheme();
  applyTheme(currentTheme);
  if (el.themeToggle) {
    el.themeToggle.addEventListener("click", () => {
      currentTheme = currentTheme === "light" ? "dark" : "light";
      applyTheme(currentTheme);
    });
  }

  /* =========================================================
     JUMP TO RANDOM UNCHECKED ITEM
     ========================================================= */
  function jumpToRandomUnchecked() {
    const candidates = [];
    DATA.forEach((cat) => {
      if (activeClusters.size && !activeClusters.has(cat.cluster)) return;
      cat.items.forEach((text, idx) => {
        if (isChecked(cat.id, idx)) return;
        if (sevFilter !== "all" && getSeverity(cat.id, idx) !== sevFilter) return;
        candidates.push([cat, idx]);
      });
    });
    if (!candidates.length) { showToast("Nothing pending — everything in view is checked off"); return; }
    const [cat, idx] = candidates[Math.floor(Math.random() * candidates.length)];
    openCategory(cat.id, true);
    requestAnimationFrame(() => {
      const row = document.getElementById("row-" + cat.id + "-" + idx);
      if (row) {
        row.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
        row.classList.add("row-pulse");
        setTimeout(() => row.classList.remove("row-pulse"), 1600);
      }
    });
  }
  if (el.randomBtn) el.randomBtn.addEventListener("click", jumpToRandomUnchecked);
  if (el.exportCsvBtn) el.exportCsvBtn.addEventListener("click", exportCSV);


  function refreshAll() {
    renderProfileSwitcher();
    renderSidebar();
    renderClusterLegend();
    renderStatStrip();
    renderHeroTarget();
    renderCategories();
  }

  function closeMobileSidebar() {
    el.sidebar.classList.remove("open");
    el.sidebarBackdrop.classList.remove("show");
    el.navToggle.setAttribute("aria-expanded", "false");
  }

  el.navToggle.addEventListener("click", () => {
    const open = el.sidebar.classList.toggle("open");
    el.sidebarBackdrop.classList.toggle("show", open);
    el.navToggle.setAttribute("aria-expanded", String(open));
  });
  el.sidebarBackdrop.addEventListener("click", closeMobileSidebar);

  let searchDebounce;
  el.searchInput.addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    const val = e.target.value;
    searchDebounce = setTimeout(() => {
      searchTerm = val.trim().toLowerCase();
      renderCategories();
    }, 120);
  });

  el.clearSearch.addEventListener("click", () => {
    searchTerm = "";
    el.searchInput.value = "";
    renderCategories();
  });

  el.filterBtn.addEventListener("click", () => {
    const order = ["all", "pending", "done", "flagged"];
    const next = order[(order.indexOf(viewMode) + 1) % order.length];
    viewMode = next;
    el.filterBtn.dataset.mode = next;
    el.filterLabel.textContent = next.toUpperCase();
    renderCategories();
  });

  if (el.sevFilterBtn) {
    el.sevFilterBtn.addEventListener("click", () => {
      const order = ["all", "critical", "high", "medium", "low"];
      const next = order[(order.indexOf(sevFilter) + 1) % order.length];
      sevFilter = next;
      el.sevFilterBtn.dataset.sev = next;
      el.sevFilterLabel.textContent = next === "all" ? "ALL SEV" : SEVERITY_NAME[next].toUpperCase();
      renderCategories();
    });
  }

  el.exportBadgeBtn.addEventListener("click", exportBadgeSVG);
  el.heroTargetWrap.addEventListener("click", exportBadgeSVG);
  el.exportJsonBtn.addEventListener("click", exportProgressJSON);
  if (el.exportMdBtn) el.exportMdBtn.addEventListener("click", exportMarkdown);
  el.resetBtn.addEventListener("click", resetProgress);
  el.importJsonInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importProgressJSON(file);
    e.target.value = "";
  });

  if (el.expandAllBtn) el.expandAllBtn.addEventListener("click", () => {
    DATA.forEach((cat) => {
      if (activeClusters.size && !activeClusters.has(cat.cluster)) return;
      openCategory(cat.id, true);
    });
  });
  if (el.collapseAllBtn) el.collapseAllBtn.addEventListener("click", () => {
    DATA.forEach((cat) => openCategory(cat.id, false));
  });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement.isContentEditable;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      el.searchInput.focus();
    }
    if (e.key === "Escape" && document.activeElement === el.searchInput) {
      el.searchInput.blur();
    }
  });

  document.querySelectorAll(".btn-primary").forEach((btn) => {
    btn.addEventListener("mousemove", (e) => {
      const rect = btn.getBoundingClientRect();
      btn.style.setProperty("--mx", (e.clientX - rect.left) + "px");
      btn.style.setProperty("--my", (e.clientY - rect.top) + "px");
    });
  });

  window.addEventListener("beforeprint", () => {
    DATA.forEach((cat) => {
      if (activeClusters.size && !activeClusters.has(cat.cluster)) return;
      openCategory(cat.id, true);
    });
  });

  /* =========================================================
     BOOT SEQUENCE (once-per-session terminal intro)
     ========================================================= */
  function runBoot() {
    const seenKey = "lisa_boot_seen_v1";
    let seen = false;
    try { seen = sessionStorage.getItem(seenKey) === "1"; } catch (e) {}

    if (REDUCED_MOTION || seen || !el.bootOverlay) {
      document.body.classList.remove("boot-active");
      if (el.bootOverlay) el.bootOverlay.classList.add("hidden");
      return;
    }

    const lines = [
      `<span class="tag">lisa//</span> initializing offensive test manifest…`,
      `mounting dataset <span class="ok">✓</span> ${TOTAL_ITEMS.toLocaleString()} test cases indexed`,
      `resolving domains <span class="ok">✓</span> ${TOTAL_CATS} sections · 7 attack-surface clusters`,
      `restoring local progress <span class="ok">✓</span> no network calls made`,
    ];
    let i = 0;
    function nextLine() {
      if (i >= lines.length) {
        const bar = document.createElement("div");
        bar.className = "boot-bar";
        bar.innerHTML = `<div class="boot-bar-fill"></div>`;
        el.bootConsole.appendChild(bar);
        setTimeout(() => {
          try { sessionStorage.setItem(seenKey, "1"); } catch (e) {}
          document.body.classList.remove("boot-active");
          el.bootOverlay.classList.add("hidden");
        }, 950);
        return;
      }
      const div = document.createElement("div");
      div.className = "boot-line";
      div.innerHTML = lines[i];
      el.bootConsole.appendChild(div);
      i++;
      setTimeout(nextLine, 260);
    }
    setTimeout(nextLine, 120);
  }

  /* =========================================================
     SIGNAL SWEEP — hero canvas
     Ambient radar sweep behind the hero copy, echoing the same
     "target" metaphor as the progress ring. Each checked item
     fires a "lisa:ping" event that lands a bright contact blip.
     ========================================================= */
  function initSignalCanvas() {
    const canvas = document.getElementById("signalCanvas");
    const hero = document.getElementById("hero");
    if (!canvas || !hero) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cx = 0, cy = 0, radius = 0;
    let angle = -Math.PI / 2;
    let running = false;
    let rafId = null;
    const blips = [];   // ambient faint contacts
    const pings = [];   // bright checked-item pulses

    function resize() {
      const rect = hero.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const stacked = window.matchMedia("(max-width: 980px)").matches;
      if (stacked) {
        // hero-copy/hero-target stack vertically on mobile — center the sweep
        // near the top where the target ring sits instead of off to the right.
        cx = w * 0.5;
        cy = Math.min(h * 0.24, 130);
        radius = Math.min(w * 0.4, 140);
      } else {
        cx = w * 0.78; cy = h * 0.5;
        radius = Math.min(w * 0.24, h * 0.62, 230);
      }
      if (!blips.length) seedBlips();
    }

    function seedBlips() {
      const n = 10;
      for (let i = 0; i < n; i++) {
        blips.push({
          a: Math.random() * Math.PI * 2,
          r: radius * (0.25 + Math.random() * 0.72),
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 0.5,
        });
      }
    }

    function drawStatic() {
      ctx.clearRect(0, 0, w, h);
      drawRings();
      drawSweepLine(angle, 0.5);
      blips.forEach((b) => drawBlip(b, 0.35));
    }

    function drawRings() {
      ctx.save();
      ctx.strokeStyle = "rgba(51,214,192,.16)";
      ctx.lineWidth = 1;
      [0.34, 0.62, 0.86, 1].forEach((f) => {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * f, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.strokeStyle = "rgba(51,214,192,.1)";
      ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
      ctx.restore();
    }

    function drawSweepLine(a, alpha) {
      const grad = ctx.createConicGradient
        ? ctx.createConicGradient(a - Math.PI / 2, cx, cy)
        : null;
      ctx.save();
      if (grad) {
        grad.addColorStop(0, `rgba(51,214,192,${0.30 * alpha})`);
        grad.addColorStop(0.08, `rgba(51,214,192,0)`);
        grad.addColorStop(1, `rgba(51,214,192,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(51,214,192,${0.65 * alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.stroke();
      ctx.restore();
    }

    function drawBlip(b, alphaMul) {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(b.phase));
      const x = cx + Math.cos(b.a) * b.r;
      const y = cy + Math.sin(b.a) * b.r;
      ctx.save();
      ctx.fillStyle = `rgba(51,214,192,${0.5 * pulse * alphaMul})`;
      ctx.beginPath();
      ctx.arc(x, y, 2 + pulse * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function spawnPing() {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.2 + Math.random() * 0.75);
      pings.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, t: 0 });
      if (pings.length > 12) pings.shift();
    }

    function drawPings(dt) {
      for (let i = pings.length - 1; i >= 0; i--) {
        const p = pings[i];
        p.t += dt;
        const life = 900;
        if (p.t > life) { pings.splice(i, 1); continue; }
        const f = p.t / life;
        const r = 3 + f * 22;
        ctx.save();
        ctx.strokeStyle = `rgba(82,210,115,${(1 - f) * 0.85})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(82,210,115,${(1 - f) * 0.5})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    let last = 0;
    function frame(ts) {
      if (!running) return;
      const dt = last ? ts - last : 16;
      last = ts;
      angle += dt * 0.00085;
      blips.forEach((b) => { b.phase += dt * 0.0022 * b.speed; });

      ctx.clearRect(0, 0, w, h);
      drawRings();
      drawSweepLine(angle, 1);
      blips.forEach((b) => drawBlip(b, 1));
      drawPings(dt);

      rafId = requestAnimationFrame(frame);
    }

    function start() {
      if (running || REDUCED_MOTION) return;
      running = true;
      last = 0;
      rafId = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }

    resize();
    drawStatic();

    if (!REDUCED_MOTION) {
      let resizeTimer;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { resize(); if (!running) drawStatic(); }, 150);
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop(); else if (heroVisible) start();
      });
      let heroVisible = true;
      if ("IntersectionObserver" in window) {
        new IntersectionObserver((entries) => {
          heroVisible = entries[0].isIntersecting;
          if (heroVisible && !document.hidden) start(); else stop();
        }, { threshold: 0.05 }).observe(hero);
      } else {
        start();
      }
      window.addEventListener("lisa:ping", () => {
        spawnPing();
        if (!running) { drawStatic(); drawPings(0); }
      });
    }
  }

  /* ---------- init ---------- */
  refreshAll();
  runBoot();
  initSignalCanvas();
})();
