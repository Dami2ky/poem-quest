/* ══════════════════════════════════════════════
   CloudSync · 家庭数据云同步(两游戏共用,零依赖)
   用法(在各自 game.js 初始化,见文末注释):
     CloudSync.init({ game, collect(), apply(state), render() })
     CloudSync.pull() / CloudSync.schedulePush()
   服务端:server/game-sync(见 vault 搭建记录);离线自动降级为纯本地
   ══════════════════════════════════════════════ */
(function () {
  const PROD_URL = "https://game.yejiatian.top";
  const isLocal = ["localhost", "127.0.0.1", "0.0.0.0"].includes(location.hostname)
    || /^192\.168\./.test(location.hostname);
  const BASE = isLocal ? "http://localhost:18760" : PROD_URL;

  let cfg = null;            // {game, collect, apply, render}
  let status = "off";        // off | ready | syncing | offline
  let pushTimer = null;

  // ── 本地配置(口令/自动开关,按游戏隔离) ──
  function conf() {
    try { return JSON.parse(localStorage.getItem(cfg.game + "_cloud") || "{}"); }
    catch (e) { return {}; }
  }
  function setConf(patch) {
    localStorage.setItem(cfg.game + "_cloud", JSON.stringify({ ...conf(), ...patch }));
  }

  // ════════ 客户端合并(与服务端 game-sync.py 同规则,双保险) ════════
  const merge = {
    records(a, b) {
      const seen = new Set(), out = [];
      for (const r of [...(a || []), ...(b || [])]) {
        const fp = [r.ym, r.p, r.kind, r.label, r.stars].join("|");
        if (!seen.has(fp)) { seen.add(fp); out.push(r); }
      }
      out.sort((x, y) => (y.ym || "").localeCompare(x.ym || ""));
      return out.slice(0, 400);
    },
    byMax(a, b) {
      const out = { ...(a || {}) };
      for (const k in (b || {})) {
        const v = b[k];
        if (typeof v === "number" && typeof out[k] === "number" ? v > out[k] : true) out[k] = v;
      }
      return out;
    },
    nestedMax(a, b) {
      const out = { ...(a || {}) };
      for (const k in (b || {})) {
        const v = b[k];
        if (v && typeof v === "object") out[k] = merge.byMax(out[k], v);
        else if (typeof v === "number") out[k] = Math.max(out[k] || 0, v);
        else if (!(k in out)) out[k] = v;
      }
      return out;
    },
    roster(a, b) {
      const out = [], names = new Set();
      for (const p of [...(a || []), ...(b || [])]) {
        if (!names.has(p.name)) { names.add(p.name); out.push({ id: p.id, name: p.name, avatar: p.avatar }); }
      }
      return out;
    },
    union(a, b) {
      const out = [...(a || [])];
      for (const x of b || []) if (!out.includes(x)) out.push(x);
      return out;
    },
  };

  function mergePayload(cloudState, localPayload) {
    const rules = cfg.game === "poem"
      ? { roster: merge.roster, records: merge.records, best: merge.nestedMax, themes: merge.nestedMax, unlocked: merge.union, versus: merge.byMax, removed: merge.union }
      : { roster: merge.roster, records: merge.records, progress: merge.nestedMax, versus: merge.byMax, removed: merge.union };
    const out = {};
    for (const key in rules) out[key] = rules[key](cloudState && cloudState[key], localPayload[key]);
    // 墓碑:已删除玩家从合并后的花名册中剔除(防并集复活)
    if (out.removed && out.roster) out.roster = out.roster.filter(p => !out.removed.includes(p.name));
    return out;
  }

  // ════════ 网络 ════════
  async function api(path, body) {
    const code = conf().code || "";
    const res = await fetch(BASE + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Family-Code": code },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 403) throw new Error("口令不对");
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function pull() {
    if (!cfg || !conf().code) return;
    setStatus("syncing");
    try {
      const state = await api("/api/state");
      const merged = mergePayload(state[cfg.game], cfg.collect());
      cfg.apply(merged);
      setStatus("ready");
      cfg.render && cfg.render();
    } catch (e) {
      setStatus(e.message === "口令不对" ? "off" : "offline");
    }
  }

  async function push() {
    if (!cfg || !conf().code) return;
    setStatus("syncing");
    try {
      const res = await api("/api/push", { game: cfg.game, payload: cfg.collect() });
      cfg.apply(res.state);   // 以服务端合并结果为准回写本地
      setStatus("ready");
    } catch (e) {
      setStatus(e.message === "口令不对" ? "off" : "offline");
    }
  }

  function schedulePush() {
    if (!cfg || !conf().code || conf().auto === false) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 3000);
  }

  // ════════ UI(云图标 + 面板) ════════
  function ensureUI() {
    if (document.getElementById("cloud-btn")) return;
    const btn = document.createElement("button");
    btn.id = "cloud-btn";
    btn.title = "家庭云同步";
    btn.textContent = "☁️";
    btn.addEventListener("click", openPanel);
    document.body.appendChild(btn);

    const panel = document.createElement("div");
    panel.id = "cloud-panel";
    panel.className = "hidden";
    panel.innerHTML = `
      <div class="cp-card">
        <div class="cp-title">☁️ 家庭云同步 <span id="cp-status"></span></div>
        <p class="cp-desc">全家在同一网址共享花名册、成绩与进度。<br>首次使用请输入家庭口令。</p>
        <input id="cp-code" class="cp-input" placeholder="家庭口令(6位)" maxlength="10" autocomplete="off">
        <div class="cp-row">
          <button id="cp-save" class="cp-btn">保存口令并同步</button>
          <button id="cp-now" class="cp-btn">立即同步</button>
        </div>
        <label class="cp-auto"><input type="checkbox" id="cp-auto" checked> 自动同步(每轮结算后上传)</label>
        <div id="cp-hint" class="cp-hint"></div>
        <button id="cp-close" class="cp-close">关闭</button>
      </div>`;
    document.body.appendChild(panel);

    const $ = id => panel.querySelector("#" + id);
    $("cp-save").addEventListener("click", () => {
      const v = $("cp-code").value.trim();
      if (!v) return;
      setConf({ code: v });
      $("cp-hint").textContent = "";
      pull().then(() => $("cp-hint").textContent = statusText());
    });
    $("cp-now").addEventListener("click", async () => {
      $("cp-hint").textContent = "同步中…";
      await push();
      $("cp-hint").textContent = statusText();
    });
    $("cp-auto").addEventListener("change", e => setConf({ auto: e.target.checked }));
    $("cp-close").addEventListener("click", () => panel.classList.add("hidden"));
  }

  function statusText() {
    return { off: "未设置口令", ready: "✅ 已同步", syncing: "🔄 同步中…", offline: "🔌 暂时连不上(可离线玩)" }[status] || status;
  }

  function setStatus(s) {
    status = s;
    ensureUI();
    const btn = document.getElementById("cloud-btn");
    const icon = { off: "☁️", ready: "☁️", syncing: "🔄", offline: "🔌" }[s] || "☁️";
    btn.textContent = icon;
    btn.style.opacity = s === "off" ? 0.55 : 1;
    const st = document.getElementById("cp-status");
    if (st) st.textContent = " " + statusText();
  }

  function openPanel() {
    ensureUI();
    const panel = document.getElementById("cloud-panel");
    panel.classList.remove("hidden");
    const c = conf();
    panel.querySelector("#cp-code").value = c.code || "";
    panel.querySelector("#cp-auto").checked = c.auto !== false;
    panel.querySelector("#cp-hint").textContent = statusText();
  }

  // ════════ 对外 API ════════
  window.CloudSync = {
    init(config) {
      cfg = config;
      ensureUI();
      setStatus(conf().code ? "ready" : "off");
      if (conf().code) pull();   // 打开即拉一次
    },
    pull,
    push,
    schedulePush,
  };
})();
