/* ══════════════════════════════════════════════
   诗词大闯关 · 游戏逻辑
   题库来自 bank.js(由 tools/build_poem_quest_bank.py 生成)
   ══════════════════════════════════════════════ */

const BANK = window.POEM_BANK;
const ROUND_CHOICE = 5;    // 选择题每轮题数
const ROUND_FILL = 4;      // 填空题每轮条数
const MAX_HEARTS = 3;
const CHOICE_TIME = 20;    // 选择题限时(秒)
const FILL_TIME = 25;      // 填空题限时(秒)

const GRADE_CN = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六",
                   7: "七", 8: "八", 9: "九", 10: "十", 11: "十一", 12: "十二" };
const POET_EMOJI = ["🧑‍🎨", "👨‍📖", "🧙", "🧝", "👨‍🌾", "🧑‍💼", "🎭", "🖌️"];

/* ════════ 小工具 ════════ */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; }
}

/* ════════ 音效引擎(Web Audio 合成,零音频文件) ════════ */
const Sound = {
  ctx: null,
  enabled: load("pq_sound", true),
  bgmTimer: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur = 0.15, type = "sine", vol = 0.18, delay = 0) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },
  click()   { this.tone(620, 0.07, "triangle", 0.12); },
  correct() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, "sine", 0.16, i * 0.09)); },
  wrong()   { this.tone(180, 0.3, "square", 0.1); this.tone(140, 0.35, "square", 0.08, 0.12); },
  fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.16, i * 0.13)); },
  fail()    { [330, 262, 196].forEach((f, i) => this.tone(f, 0.3, "sawtooth", 0.07, i * 0.18)); },
  startBGM() {
    if (!this.enabled || this.bgmTimer) return;
    const notes = [523.25, 587.33, 659.25, 783.99, 880.00];
    this.bgmTimer = setInterval(() => {
      const f = notes[Math.floor(Math.random() * notes.length)];
      this.tone(f, 1.4, "sine", 0.028);
      if (Math.random() < 0.35) this.tone(f / 2, 1.8, "sine", 0.02, 0.3);
    }, 950);
  },
  stopBGM() { clearInterval(this.bgmTimer); this.bgmTimer = null; },
  toggle() {
    this.enabled = !this.enabled;
    save("pq_sound", this.enabled);
    if (this.enabled) { this.startBGM(); this.click(); } else this.stopBGM();
    $("#sound-toggle").textContent = this.enabled ? "🔊" : "🔇";
  }
};

/* ════════ 存档 ════════ */
const bestStars = load("pq_best", {});        // {"6:choice": 3}
const unlocked = new Set(load("pq_unlocked", []));  // 诗人名
const versusRec = load("pq_versus", { p1: 0, p2: 0 });
const savedNames = load("pq_names", { p1: "诺一", p2: "艺家" });

/* ════════ v1.1:家庭玩家花名册 / 成绩记录 / 主题进度 ════════ */
const AVATARS = ["🥷", "🎶", "👑", "🐉", "🦊", "🐼", "🦉", "🐯", "🧚", "🤴", "👸", "🐶", "🐰", "🐧"];

let roster = load("pq_roster", null);
if (!roster || !roster.length) {
  // 从旧双人对战名迁移初始花名册与战绩(名字键)
  roster = [
    { id: 1, name: savedNames.p1 || "诺一", avatar: "🥷" },
    { id: 2, name: savedNames.p2 || "艺家", avatar: "🎶" },
  ];
  save("pq_roster", roster);
  if (versusRec.p1 !== undefined) {
    const vr = {};
    vr[roster[0].name] = versusRec.p1 || 0;
    vr[roster[1].name] = versusRec.p2 || 0;
    save("pq_versus", vr);
    Object.keys(versusRec).forEach(k => delete versusRec[k]);
    Object.assign(versusRec, vr);
  }
}
let currentPid = load("pq_current", roster[0].id);
if (!roster.some(p => p.id === currentPid)) currentPid = roster[0].id;

const records = load("pq_records", []);   // [{p, ava, ym(YYYY-MM), kind, label, stars}] 新的在前
const themeProg = load("pq_themes", {});  // {themeId: {cleared, stars}}

function me() { return roster.find(p => p.id === currentPid) || roster[0]; }
function nowYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addRecord(kind, label, stars) {
  records.unshift({ p: me().name, ava: me().avatar, ym: nowYM(), kind, label, stars: stars || null });
  if (records.length > 200) records.length = 200;
  save("pq_records", records);
  CloudSync.schedulePush();   // 云同步:每条成绩自动上传(去抖 3s)
}

/* ════════ 运行状态 ════════ */
let quiz = null;      // 当前对局
let gradeMode = "choice";  // choice | fill
let timer = null;

/* ════════ 屏幕与弹层 ════════ */
function showScreen(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  $("#" + id).classList.add("active");
  if (id === "screen-title") CloudSync.pull();   // 回主页时拉取家人最新数据
}
function openOverlay(html) {
  $("#overlay-card").innerHTML = html;
  $("#overlay").classList.remove("hidden");
}
function closeOverlay() { $("#overlay").classList.add("hidden"); }

function confetti(n = 30) {
  const layer = $("#confetti-layer");
  const pieces = ["✨", "🎉", "⭐", "🌸", "🍃", "🎊", "📜"];
  for (let i = 0; i < n; i++) {
    const sp = document.createElement("span");
    sp.textContent = pieces[Math.floor(Math.random() * pieces.length)];
    sp.style.left = Math.random() * 100 + "vw";
    sp.style.fontSize = (16 + Math.random() * 22) + "px";
    sp.style.animationDuration = (1.4 + Math.random() * 1.6) + "s";
    sp.style.animationDelay = (Math.random() * 0.5) + "s";
    layer.appendChild(sp);
    setTimeout(() => sp.remove(), 3600);
  }
}

/* ════════ 诗人解锁 ════════ */
function tryUnlock(author) {
  if (!BANK.poets[author] || unlocked.has(author)) return null;
  unlocked.add(author);
  save("pq_unlocked", [...unlocked]);
  return author;
}

/* ════════ 标题屏 ════════ */
$("#btn-grade").addEventListener("click", () => {
  Sound.click(); Sound.startBGM();
  renderGrades();
  showScreen("screen-grade");
});
$("#btn-theme").addEventListener("click", () => {
  Sound.click(); Sound.startBGM();
  renderThemes();
  showScreen("screen-theme");
});
$("#btn-versus").addEventListener("click", () => {
  Sound.click(); Sound.startBGM();
  renderVsPickers();
  showScreen("screen-vs-setup");
});
$("#btn-poets").addEventListener("click", () => {
  Sound.click();
  renderPoets();
  showScreen("screen-poets");
});
$("#btn-honor").addEventListener("click", () => {
  Sound.click();
  renderHonor();
  showScreen("screen-honor");
});
$("#player-chip").addEventListener("click", () => {
  Sound.click();
  renderRoster();
  showScreen("screen-player");
});
$("#sound-toggle").addEventListener("click", () => Sound.toggle());

$$(".btn-back").forEach(btn =>
  btn.addEventListener("click", () => {
    Sound.click();
    if (quiz) stopTimer();
    showScreen(btn.dataset.back);
  })
);

/* ════════ 年级选择 ════════ */
$("#mode-choice").addEventListener("click", () => setMode("choice"));
$("#mode-fill").addEventListener("click", () => setMode("fill"));

function setMode(m) {
  gradeMode = m;
  Sound.click();
  $("#mode-choice").classList.toggle("active", m === "choice");
  $("#mode-fill").classList.toggle("active", m === "fill");
  renderGrades();
}

function renderGrades() {
  const groups = [
    { label: "小学", grades: [1, 2, 3, 4, 5, 6] },
    { label: "初中", grades: [7, 8, 9] },
    { label: "高中", grades: [10, 11, 12] },
  ];
  const box = $("#grade-groups");
  box.innerHTML = "";
  groups.forEach(g => {
    const div = document.createElement("div");
    div.className = "grade-group";
    const btns = g.grades.map(gr => {
      const n = gradeMode === "choice"
        ? BANK.questions.filter(q => q.grade === gr).length
        : BANK.fills.filter(f => f.grade === gr).length;
      const stars = bestStars[`${gr}:${gradeMode}`] || 0;
      return `<button class="grade-btn" data-grade="${gr}">
        <div class="g-name">${GRADE_CN[gr]}年级</div>
        <div class="g-count">${n} 题 ${stars ? "⭐".repeat(stars) : ""}</div>
      </button>`;
    }).join("");
    div.innerHTML = `<h3>${g.label}</h3><div class="grade-grid">${btns}</div>`;
    box.appendChild(div);
  });
  box.querySelectorAll(".grade-btn").forEach(b =>
    b.addEventListener("click", () => { Sound.click(); startRound(+b.dataset.grade); })
  );
}

/* ════════ 计时器 ════════ */
function stopTimer() { clearInterval(timer); timer = null; }

function startTimer(seconds, onTimeout) {
  stopTimer();
  quiz.timeLeft = seconds;
  quiz.locked = false;
  const bar = $("#timer-bar");
  bar.classList.remove("danger");
  bar.style.width = "100%";
  const t0 = Date.now();
  timer = setInterval(() => {
    const elapsed = (Date.now() - t0) / 1000;
    quiz.timeLeft = Math.max(0, seconds - elapsed);
    bar.style.width = (quiz.timeLeft / seconds * 100) + "%";
    if (quiz.timeLeft <= 5) bar.classList.add("danger");
    if (quiz.timeLeft <= 0) onTimeout();
  }, 100);
}

/* ════════ 年级闯关 ════════ */
function startRound(grade) {
  const qs = gradeMode === "choice"
    ? shuffle(BANK.questions.filter(q => q.grade === grade)).slice(0, ROUND_CHOICE)
        .map(q => ({ ...q, type: "choice" }))
    : shuffle(BANK.fills.filter(f => f.grade === grade)).slice(0, ROUND_FILL)
        .map(f => ({ ...f, type: "fill" }));
  if (!qs.length) return;
  quiz = {
    kind: "grade", grade, qs, qIdx: 0,
    hearts: MAX_HEARTS, correctCount: 0, unlockedNow: [], locked: false
  };
  showScreen("screen-quiz");
  $("#grade-badge").textContent = `${GRADE_CN[grade]}年级 · ${gradeMode === "choice" ? "选择题" : "填空题"}`;
  $("#versus-bar").classList.add("hidden");
  renderQuestion();
}

function renderQuestion() {
  const item = quiz.qs[quiz.qIdx];
  $("#q-count").textContent = `${quiz.qIdx + 1} / ${quiz.qs.length}`;
  $("#hearts").textContent = "❤️".repeat(quiz.hearts) + "🖤".repeat(MAX_HEARTS - quiz.hearts);

  const isChoice = (item.type || "choice") === "choice";
  $("#choice-area").classList.toggle("hidden", !isChoice);
  $("#fill-area").classList.toggle("hidden", isChoice);

  const card = $(".q-card");
  card.style.animation = "none";
  void card.offsetWidth;
  card.style.animation = "";

  if (isChoice) {
    $("#q-book").textContent = `《${item.title}》`;
    $("#q-text").textContent = item.q;
    const opts = shuffle(item.options.map((text, i) => ({ text, correct: i === item.answer })));
    const letters = ["A", "B", "C", "D"];
    const box = $("#options");
    box.innerHTML = "";
    opts.forEach((o, i) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.dataset.correct = o.correct;
      btn.innerHTML = `<span class="opt-letter">${letters[i]}</span><span>${o.text}</span>`;
      btn.addEventListener("click", () => answerChoice(btn, o.correct));
      box.appendChild(btn);
    });
    startTimer(CHOICE_TIME, () => answerChoice(null, false, true));
  } else {
    renderFill(item);
    startTimer(FILL_TIME, () => finishFill(false, true));
  }
}

/* ── 选择题作答 ── */
function answerChoice(btn, correct, timeout = false) {
  if (quiz.locked) return;
  quiz.locked = true;
  stopTimer();
  const item = quiz.qs[quiz.qIdx];
  $$("#options .option").forEach(el => {
    if (el.dataset.correct === "true") el.classList.add("correct");
    else if (el === btn) el.classList.add("wrong");
    else el.classList.add("dim");
  });
  settle(correct, timeout, item.options[item.answer]);
}

/* ── 填空题渲染与交互 ── */
let fillState = null;

function renderFill(item) {
  $("#fill-book").textContent = `《${item.title}》· ${item.author}`;
  const line = $("#fill-line");
  line.innerHTML = "";
  const parts = item.display.split("□");
  fillState = { item, slots: [], attempts: 0 };
  parts.forEach((seg, i) => {
    if (seg) {
      const s = document.createElement("span");
      s.className = "seg";
      s.textContent = seg;
      line.appendChild(s);
    }
    if (i < parts.length - 1) {
      const slot = document.createElement("button");
      slot.className = "slot";
      slot.addEventListener("click", () => unfillSlot(slot));
      line.appendChild(slot);
      fillState.slots.push({ el: slot, char: null });
    }
  });
  const pool = $("#char-pool");
  pool.innerHTML = "";
  item.pool.forEach(ch => {
    const b = document.createElement("button");
    b.className = "pool-char";
    b.textContent = ch;
    b.addEventListener("click", () => fillSlot(b, ch));
    pool.appendChild(b);
  });
}

function fillSlot(btn, ch) {
  if (quiz.locked) return;
  Sound.click();
  const empty = fillState.slots.find(s => !s.char);
  if (!empty || btn.classList.contains("used")) return;
  empty.char = ch;
  empty.el.textContent = ch;
  empty.el.classList.add("filled");
  btn.classList.add("used");
  empty.btn = btn;
  if (fillState.slots.every(s => s.char)) judgeFill();
}

function unfillSlot(slotEl) {
  if (quiz.locked) return;
  const s = fillState.slots.find(x => x.el === slotEl);
  if (!s || !s.char) return;
  Sound.click();
  s.btn.classList.remove("used");
  s.char = null; s.btn = null;
  slotEl.textContent = "";
  slotEl.classList.remove("filled");
}

function judgeFill() {
  const joined = fillState.slots.map(s => s.char).join("");
  const correct = joined === fillState.item.chars.join("");
  if (correct) {
    fillState.slots.forEach(s => s.el.style.borderColor = "#3f9e57");
    finishFill(true);
  } else {
    fillState.attempts++;
    fillState.slots.forEach(s => { s.el.classList.add("shake"); });
    Sound.wrong();
    setTimeout(() => {
      fillState.slots.forEach(s => {
        s.el.classList.remove("shake");
        if (s.btn) s.btn.classList.remove("used");
        s.char = null; s.btn = null;
        s.el.textContent = "";
        s.el.classList.remove("filled");
        s.el.style.borderColor = "";
      });
      if (fillState.attempts >= 2) finishFill(false);  // 两次点错判错
    }, 550);
  }
}

function finishFill(correct, timeout = false) {
  if (quiz.locked) return;
  quiz.locked = true;
  stopTimer();
  settle(correct, timeout, fillState.item.chars.join(""));
}

/* ── 判定与反馈(两种题型共用) ── */
function settle(correct, timeout, answerText) {
  const item = quiz.qs[quiz.qIdx];
  let unlockName = null;
  if (correct) {
    Sound.correct();
    confetti(12);
    quiz.correctCount++;
    unlockName = tryUnlock(item.author);
    if (unlockName) quiz.unlockedNow.push(unlockName);
  } else {
    Sound.wrong();
    quiz.hearts--;
    $("#hearts").textContent = "❤️".repeat(quiz.hearts) + "🖤".repeat(MAX_HEARTS - quiz.hearts);
  }

  setTimeout(() => {
    let answerLine = answerText;
    if (item.type === "fill" && !correct) {
      let idx = 0;
      answerLine = item.display.replace(/□/g, () => item.chars[idx++] || "");
    }
    openOverlay(`
      <div class="ov-emoji">${correct ? "🎉" : (timeout ? "⏰" : "💫")}</div>
      <div class="ov-title ${correct ? "good" : "bad"}">${correct ? "答对了!" : (timeout ? "超时啦!" : "答错了~")}</div>
      ${!correct ? `<div class="ov-sub">正确答案:${answerLine}</div>` : ""}
      ${unlockName ? `<div class="ov-unlock">🔓 解锁诗人:${unlockName}(图鉴 +1)</div>` : ""}
      <div class="ov-fact"><b>你知道吗?</b><br>${item.fact}</div>
      <div class="ov-actions">
        <button class="btn ${correct ? "btn-blue" : "btn-red"}" id="ov-next">${nextLabel()}</button>
      </div>
    `);
    $("#ov-next").addEventListener("click", nextStep);
  }, correct ? 700 : 900);
}

function nextLabel() {
  if (quiz.kind === "versus") return quiz.qIdx >= quiz.qs.length - 1 ? "看结果" : "下一位 →";
  if (quiz.hearts <= 0) return "再试一次";
  return quiz.qIdx >= quiz.qs.length - 1 ? "看结算" : "下一题 →";
}

function nextStep() {
  Sound.click();
  if (quiz.kind === "versus") {
    if (quiz.qIdx >= quiz.qs.length - 1) return endVersus();
    quiz.qIdx++;
    quiz.turn = quiz.turn === "p1" ? "p2" : "p1";
    closeOverlay();
    renderVersusQuestion();
    return;
  }
  if (quiz.hearts <= 0) return failRound();
  if (quiz.qIdx >= quiz.qs.length - 1) return quiz.kind === "theme" ? endThemeRound() : endRound();
  quiz.qIdx++;
  closeOverlay();
  renderQuestion();
}

/* ── 年级回合结束 ── */
function endRound() {
  const stars = Math.max(1, quiz.hearts);
  const key = `${quiz.grade}:${gradeMode}`;
  bestStars[key] = Math.max(bestStars[key] || 0, stars);
  save("pq_best", bestStars);
  addRecord("grade", `${GRADE_CN[quiz.grade]}年级${gradeMode === "choice" ? "选择" : "填空"}`, stars);
  Sound.fanfare();
  confetti(40);
  const total = quiz.qs.length;
  openOverlay(`
    <div class="ov-emoji">🏆</div>
    <div class="ov-title good">${GRADE_CN[quiz.grade]}年级 · 挑战完成!</div>
    <div class="ov-stars">${"⭐".repeat(stars)}${"✩".repeat(3 - stars)}</div>
    <div class="ov-sub">答对 ${quiz.correctCount} / ${total} 题</div>
    ${quiz.unlockedNow.length ? `<div class="ov-unlock">🔓 本轮解锁:${quiz.unlockedNow.join("、")}</div>` : ""}
    <div class="ov-actions">
      <button class="btn btn-blue" id="ov-again">🔁 再来一轮</button>
      <button class="btn btn-plain" id="ov-change" style="color:var(--ink)">📚 换年级</button>
    </div>
  `);
  $("#ov-again").addEventListener("click", () => { Sound.click(); closeOverlay(); startRound(quiz.grade); });
  $("#ov-change").addEventListener("click", () => { Sound.click(); closeOverlay(); renderGrades(); showScreen("screen-grade"); });
}

function failRound() {
  Sound.fail();
  closeOverlay();
  const retry = () => quiz.kind === "theme" ? startThemeRound(quiz.themeId) : startRound(quiz.grade);
  openOverlay(`
    <div class="ov-emoji">🍂</div>
    <div class="ov-title bad">墨尽笔枯!</div>
    <p style="margin:8px 0 4px;font-size:15px">心用完了…读一读小知识,再来一遍!</p>
    <div class="ov-actions">
      <button class="btn btn-red" id="ov-retry">🔁 重闯本轮</button>
      <button class="btn btn-plain" id="ov-g1" style="color:var(--ink)">↩️ 换个玩法</button>
    </div>
  `);
  $("#ov-retry").addEventListener("click", () => { Sound.click(); closeOverlay(); retry(); });
  $("#ov-g1").addEventListener("click", () => {
    Sound.click(); closeOverlay();
    quiz.kind === "theme" ? (renderThemes(), showScreen("screen-theme"))
                          : (renderGrades(), showScreen("screen-grade"));
  });
}

/* ════════ 双人对战(v1.1:从花名册选人) ════════ */
let vsSel = { p1: null, p2: null };   // 玩家 id

function renderVsPickers() {
  if (vsSel.p1 === null || !roster.some(p => p.id === vsSel.p1)) vsSel.p1 = currentPid;
  const other = roster.find(p => p.id !== vsSel.p1);
  if (vsSel.p2 === null || !roster.some(p => p.id === vsSel.p2) || vsSel.p2 === vsSel.p1) {
    vsSel.p2 = other ? other.id : vsSel.p1;
  }
  ["p1", "p2"].forEach(side => {
    const box = $("#roster-vs-" + side);
    box.innerHTML = "";
    roster.forEach(p => {
      const chip = document.createElement("button");
      chip.className = "rm-chip" + (vsSel[side] === p.id ? ` sel-${side}` : "");
      chip.textContent = `${p.avatar} ${p.name}`;
      chip.addEventListener("click", () => {
        Sound.click();
        vsSel[side] = p.id;
        if (vsSel.p1 === vsSel.p2) {  // 同人回避:自动把另一边换成别人
          const alt = roster.find(x => x.id !== p.id);
          if (alt) vsSel[side === "p1" ? "p2" : "p1"] = alt.id;
        }
        renderVsPickers();
      });
      box.appendChild(chip);
    });
    const sel = roster.find(p => p.id === vsSel[side]);
    $("#vs-label-" + side).textContent = `${sel.avatar} ${side === "p1" ? "甲方" : "乙方"}`;
  });
}

$("#btn-start-versus").addEventListener("click", () => {
  Sound.click();
  startVersus();
});

function startVersus() {
  const P1 = roster.find(p => p.id === vsSel.p1) || roster[0];
  const P2 = roster.find(p => p.id === vsSel.p2) || roster[1] || roster[0];
  const easy = shuffle(BANK.questions.filter(q => q.grade <= 6)).slice(0, 3);
  const hard = shuffle(BANK.questions.filter(q => q.grade >= 7)).slice(0, 3);
  quiz = {
    kind: "versus",
    qs: shuffle([...easy, ...hard]).map(q => ({ ...q, type: "choice" })),
    qIdx: 0,
    turn: "p1",
    hearts: MAX_HEARTS,
    p1: { name: P1.name, avatar: P1.avatar, score: 0 },
    p2: { name: P2.name, avatar: P2.avatar, score: 0 },
    unlockedNow: [], locked: false
  };
  showScreen("screen-quiz");
  $("#grade-badge").textContent = "双人对战";
  $("#hearts").textContent = "";
  $("#versus-bar").classList.remove("hidden");
  gradeMode = "choice";  // 对战固定选择题
  renderVersusQuestion();
}

function renderVersusQuestion() {
  const item = quiz.qs[quiz.qIdx];
  $("#q-count").textContent = `${quiz.qIdx + 1} / ${quiz.qs.length}`;
  $("#vs-p1").classList.toggle("active", quiz.turn === "p1");
  $("#vs-p2").classList.toggle("active", quiz.turn === "p2");
  $("#vs-p1 .vs-nm").textContent = quiz.p1.name;
  $("#vs-p2 .vs-nm").textContent = quiz.p2.name;
  $("#vs-p1 .vs-ava").textContent = quiz.p1.avatar;
  $("#vs-p2 .vs-ava").textContent = quiz.p2.avatar;
  $("#vs-p1 .vs-score").textContent = quiz.p1.score;
  $("#vs-p2 .vs-score").textContent = quiz.p2.score;
  $("#vs-turn").textContent = `轮到 ${quiz[quiz.turn].name} 了`;

  $("#choice-area").classList.remove("hidden");
  $("#fill-area").classList.add("hidden");
  $("#q-book").textContent = `《${item.title}》· ${item.grade <= 6 ? "🌱" : "🌟"}`;
  $("#q-text").textContent = item.q;
  const opts = shuffle(item.options.map((text, i) => ({ text, correct: i === item.answer })));
  const letters = ["A", "B", "C", "D"];
  const box = $("#options");
  box.innerHTML = "";
  opts.forEach((o, i) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.dataset.correct = o.correct;
    btn.innerHTML = `<span class="opt-letter">${letters[i]}</span><span>${o.text}</span>`;
    btn.addEventListener("click", () => answerVersus(btn, o.correct));
    box.appendChild(btn);
  });
  const card = $(".q-card");
  card.style.animation = "none";
  void card.offsetWidth;
  card.style.animation = "";
  startTimer(CHOICE_TIME, () => answerVersus(null, false, true));
}

function answerVersus(btn, correct, timeout = false) {
  if (quiz.locked) return;
  quiz.locked = true;
  stopTimer();
  const item = quiz.qs[quiz.qIdx];
  $$("#options .option").forEach(el => {
    if (el.dataset.correct === "true") el.classList.add("correct");
    else if (el === btn) el.classList.add("wrong");
    else el.classList.add("dim");
  });
  let pts = 0;
  if (correct) {
    Sound.correct();
    confetti(12);
    pts = 10 + Math.ceil(quiz.timeLeft / 4);
    quiz[quiz.turn].score += pts;
    const un = tryUnlock(item.author);
    if (un) quiz.unlockedNow.push(un);
  } else {
    Sound.wrong();
  }
  setTimeout(() => {
    openOverlay(`
      <div class="ov-emoji">${correct ? "🎉" : (timeout ? "⏰" : "💫")}</div>
      <div class="ov-title ${correct ? "good" : "bad"}">${correct ? `${quiz[quiz.turn].name} 答对了!` : (timeout ? `${quiz[quiz.turn].name} 超时啦!` : `${quiz[quiz.turn].name} 答错了~`)}</div>
      ${correct ? `<div class="ov-pts">+${pts} 分!</div>` : `<div class="ov-sub">正确答案:${item.options[item.answer]}</div>`}
      <div class="ov-fact"><b>你知道吗?</b><br>${item.fact}</div>
      <div class="ov-actions"><button class="btn btn-blue" id="ov-next">${nextLabel()}</button></div>
    `);
    $("#ov-next").addEventListener("click", nextStep);
  }, correct ? 700 : 900);
}

function endVersus() {
  const { p1, p2 } = quiz;
  const winner = p1.score === p2.score ? null : (p1.score > p2.score ? p1 : p2);
  if (winner) versusRec[winner.name] = (versusRec[winner.name] || 0) + 1;
  save("pq_versus", versusRec);
  const winnerPid = winner && roster.find(p => p.name === winner.name)?.id;
  if (winnerPid !== undefined && winnerPid !== null) {
    const prev = currentPid;
    currentPid = winnerPid; save("pq_current", currentPid);
    addRecord("versus", `对战 ${quiz.p1.name} ${p1.score} : ${p2.score} ${quiz.p2.name}`, null);
    currentPid = prev; save("pq_current", currentPid);
  }
  $("#vr-emoji").textContent = winner ? "🏆" : "🤝";
  $("#vr-title").textContent = winner ? `${winner.name} 获胜!` : "平局,势均力敌!";
  if (winner) { Sound.fanfare(); confetti(46); } else Sound.correct();
  $("#vr-scores").innerHTML = `
    <div class="vr-player"><div class="vr-ava">${p1.avatar}</div><div class="vr-name">${p1.name}</div><div class="vr-pts">${p1.score}</div></div>
    <div class="vr-vs">VS</div>
    <div class="vr-player"><div class="vr-ava">${p2.avatar}</div><div class="vr-name">${p2.name}</div><div class="vr-pts">${p2.score}</div></div>`;
  const histLine = roster.map(p => `${p.name} ${versusRec[p.name] || 0} 胜`).join(" · ");
  $("#vr-history").textContent = `历史战绩:${histLine}`;
  showScreen("screen-versus-result");
}

$("#btn-vr-again").addEventListener("click", () => { Sound.click(); startVersus(); });

/* ════════ 诗人图鉴 ════════ */
function renderPoets() {
  const grid = $("#poets-grid");
  const entries = Object.entries(BANK.poets);
  $("#poets-count").textContent = `已解锁 ${unlocked.size} / ${entries.length} 位`;
  grid.innerHTML = "";
  entries.forEach(([name, p], i) => {
    const isOpen = unlocked.has(name);
    const card = document.createElement("div");
    card.className = "poet-card" + (isOpen ? "" : " locked");
    card.innerHTML = `
      <div class="p-emoji">${isOpen ? POET_EMOJI[i % POET_EMOJI.length] : "❓"}</div>
      <div class="p-name">${isOpen ? name : "待解锁"}</div>
      <div class="p-dyn">${isOpen ? p.dynasty + "代" : "答对 TA 的题来解锁"}</div>`;
    card.addEventListener("click", () => {
      Sound.click();
      if (!isOpen) {
        openOverlay(`
          <div class="ov-emoji">🔒</div>
          <div class="ov-title">还未解锁</div>
          <p style="margin:10px 0;font-size:15px">在年级闯关或对战中答对这位诗人的题,就能解锁 TA 的名片!</p>
          <div class="ov-actions"><button class="btn btn-plain" id="ov-close" style="color:var(--ink)">知道了</button></div>`);
        $("#ov-close").addEventListener("click", () => { Sound.click(); closeOverlay(); });
        return;
      }
      openOverlay(`
        <div class="ov-emoji">${POET_EMOJI[i % POET_EMOJI.length]}</div>
        <div class="ov-title">${name}</div>
        <div class="ov-sub">${p.dynasty}代 · ${p.years}</div>
        <div class="ov-fact"><b>小传</b><br>${p.bio}</div>
        <div class="ov-fact"><b>代表作</b><br>${p.works}</div>
        <div class="ov-actions"><button class="btn btn-plain" id="ov-close" style="color:var(--ink)">收下名片</button></div>`);
      $("#ov-close").addEventListener("click", () => { Sound.click(); closeOverlay(); });
    });
    grid.appendChild(card);
  });
}

/* ════════ v1.1:主题闯关 ════════ */
const TIER_LABEL = { main: "主线 · 万象", emotion: "情感 · 支线", advanced: "进阶 · 大师" };

function isThemeUnlocked(t) {
  if (t.unlock === "always") return true;
  if (t.unlock.startsWith("after:")) return !!(themeProg[t.unlock.slice(6)] || {}).cleared;
  if (t.unlock === "all_main") {
    return BANK.themes.filter(x => x.tier === "main").every(x => (themeProg[x.id] || {}).cleared);
  }
  return true;
}

function themeUnlockHint(t) {
  if (isThemeUnlocked(t)) return null;
  if (t.unlock.startsWith("after:")) {
    const prev = BANK.themes.find(x => x.id === t.unlock.slice(6));
    return `先通关「${prev ? prev.name : "?"}」解锁`;
  }
  return "主线四关全通后解锁";
}

function renderThemes() {
  const groups = [["main"], ["emotion"], ["advanced"]];
  const box = $("#theme-groups");
  box.innerHTML = "";
  groups.forEach(([tier]) => {
    const list = BANK.themes.filter(t => t.tier === tier);
    if (!list.length) return;
    const div = document.createElement("div");
    div.className = "theme-group";
    div.innerHTML = `<h3>${TIER_LABEL[tier]}</h3><div class="theme-grid"></div>`;
    const grid = div.querySelector(".theme-grid");
    list.forEach(t => {
      const ok = isThemeUnlocked(t);
      const prog = themeProg[t.id] || {};
      const card = document.createElement("button");
      card.className = "theme-card" + (ok ? "" : " locked");
      card.style.setProperty("--tc", t.color);
      card.innerHTML = `
        ${ok ? "" : `<span class="t-lock">🔒</span>`}
        <div class="t-head"><span class="t-icon">${t.icon}</span><span class="t-name">${t.name}</span></div>
        <div class="t-quote">${t.quote}</div>
        <div class="t-meta">${t.poemIds.length} 首 · <span class="t-stars">${prog.cleared ? "⭐".repeat(prog.stars || 1) : (ok ? "未通关" : "")}</span></div>`;
      if (ok) {
        card.addEventListener("click", () => { Sound.click(); startThemeRound(t.id); });
      } else {
        card.addEventListener("click", () => {
          Sound.wrong();
          card.querySelector(".t-meta").textContent = themeUnlockHint(t);
        });
      }
      grid.appendChild(card);
    });
    box.appendChild(div);
  });
}

function startThemeRound(themeId) {
  const t = BANK.themes.find(x => x.id === themeId);
  const ids = new Set(t.poemIds);
  const qs = shuffle(BANK.questions.filter(q => (q.themes || []).includes(themeId))).slice(0, 5)
    .map(q => ({ ...q, type: "choice" }));
  const fs = shuffle(BANK.fills.filter(f => (f.themes || []).includes(themeId))).slice(0, 2)
    .map(f => ({ ...f, type: "fill" }));
  if (qs.length + fs.length < 3) return;
  quiz = {
    kind: "theme", themeId, qs: shuffle([...qs, ...fs]), qIdx: 0,
    hearts: MAX_HEARTS, correctCount: 0, unlockedNow: [], locked: false
  };
  showScreen("screen-quiz");
  $("#grade-badge").textContent = `${t.icon} ${t.name}`;
  $("#versus-bar").classList.add("hidden");
  renderQuestion();
}

function endThemeRound() {
  const t = BANK.themes.find(x => x.id === quiz.themeId);
  const stars = Math.max(1, quiz.hearts);
  const prog = themeProg[quiz.themeId] || {};
  const firstClear = !prog.cleared;
  prog.cleared = true;
  prog.stars = Math.max(prog.stars || 0, stars);
  themeProg[quiz.themeId] = prog;
  save("pq_themes", themeProg);
  addRecord("theme", `${t.icon}${t.name} 通关`, stars);
  Sound.fanfare();
  confetti(46);

  // 结算时提示新解锁的主题(解锁条件刚被本次通关满足,且尚未通关的)
  const justUnlocked = BANK.themes.filter(x => {
    if ((themeProg[x.id] || {}).cleared || !isThemeUnlocked(x)) return false;
    if (x.unlock === `after:${quiz.themeId}`) return true;
    if (x.unlock === "all_main" && (themeProg[quiz.themeId] || {}).cleared) {
      return BANK.themes.filter(m => m.tier === "main").every(m => (themeProg[m.id] || {}).cleared);
    }
    return false;
  });
  const unlockLine = justUnlocked.length
    ? `<div class="ov-unlock">🔓 新主题解锁:${justUnlocked.map(x => x.icon + x.name).join("、")}</div>` : "";

  openOverlay(`
    <div class="ov-emoji">${t.icon}</div>
    <div class="ov-title good">${t.name} · 通关!</div>
    <div class="ov-stars">${"⭐".repeat(stars)}${"✩".repeat(3 - stars)}</div>
    <div class="ov-sub">答对 ${quiz.correctCount} / ${quiz.qs.length} 题</div>
    ${firstClear ? `<div class="ov-unlock">🏅 首次通关,记入荣誉榜!</div>` : ""}
    ${unlockLine}
    <div class="ov-fact"><b>${t.quote}</b></div>
    <div class="ov-actions">
      <button class="btn btn-green" id="ov-t-again">🔁 再闯一次</button>
      <button class="btn btn-plain" id="ov-t-back" style="color:var(--ink)">🎴 换主题</button>
    </div>
  `);
  $("#ov-t-again").addEventListener("click", () => { Sound.click(); closeOverlay(); startThemeRound(quiz.themeId); });
  $("#ov-t-back").addEventListener("click", () => { Sound.click(); closeOverlay(); renderThemes(); showScreen("screen-theme"); });
}

/* ════════ v1.1:花名册 ════════ */
let pickedAvatar = AVATARS[0];

function updatePlayerChip() {
  const p = me();
  $("#player-chip").textContent = `${p.avatar} ${p.name} ▾`;
}

function renderRoster() {
  updatePlayerChip();
  const grid = $("#roster-grid");
  grid.innerHTML = "";
  roster.forEach(p => {
    const stars = records.filter(r => r.p === p.name && r.stars).reduce((s, r) => s + r.stars, 0);
    const wins = versusRec[p.name] || 0;
    const themesN = new Set(records.filter(r => r.p === p.name && r.kind === "theme").map(r => r.label)).size;
    const card = document.createElement("div");
    card.className = "roster-card" + (p.id === currentPid ? " current" : "");
    card.innerHTML = `
      ${roster.length > 1 ? `<button class="r-del" title="移除玩家">✕</button>` : ""}
      <div class="r-avatar">${p.avatar}</div>
      <div class="r-name">${p.name}</div>
      <div class="r-tag">${p.id === currentPid ? "▶ 当前玩家" : "点击上场"}</div>
      <div class="r-tag">⭐${stars} · 🏅${themesN} · 🏆${wins}</div>`;
    card.addEventListener("click", e => {
      if (e.target.classList.contains("r-del")) return;
      Sound.click();
      currentPid = p.id;
      save("pq_current", currentPid);
      renderRoster();
    });
    card.querySelector(".r-del")?.addEventListener("click", e => {
      e.stopPropagation();
      openOverlay(`
        <div class="ov-emoji">👋</div>
        <div class="ov-title">移除「${p.name}」?</div>
        <p style="margin:8px 0;font-size:14.5px">TA 的成绩记录会保留在荣誉榜,但玩家卡将删除</p>
        <div class="ov-actions">
          <button class="btn btn-red" id="ov-del-yes">移除</button>
          <button class="btn btn-plain" id="ov-del-no" style="color:var(--ink)">取消</button>
        </div>`);
      $("#ov-del-yes").addEventListener("click", () => {
        Sound.click();
        roster = roster.filter(x => x.id !== p.id);
        if (currentPid === p.id) { currentPid = roster[0].id; save("pq_current", currentPid); }
        save("pq_roster", roster);
        closeOverlay();
        renderRoster();
      });
      $("#ov-del-no").addEventListener("click", () => { Sound.click(); closeOverlay(); });
    });
    grid.appendChild(card);
  });
  renderAvatarPick();
}

function renderAvatarPick() {
  const box = $("#avatar-pick");
  box.innerHTML = "";
  AVATARS.forEach(a => {
    const b = document.createElement("button");
    b.textContent = a;
    if (a === pickedAvatar) b.classList.add("sel");
    b.addEventListener("click", () => { Sound.click(); pickedAvatar = a; renderAvatarPick(); });
    box.appendChild(b);
  });
}

$("#btn-add-player").addEventListener("click", () => {
  const name = ($("#new-player-name").value.trim() || "").slice(0, 6);
  if (!name) return Sound.wrong();
  if (roster.some(p => p.name === name)) {
    Sound.wrong();
    $("#new-player-name").value = "";
    return;
  }
  Sound.correct();
  roster.push({ id: Date.now(), name, avatar: pickedAvatar });
  save("pq_roster", roster);
  $("#new-player-name").value = "";
  renderRoster();
});

/* ════════ v1.1:家庭荣誉榜 ════════ */
function renderHonor() {
  updatePlayerChip();
  // 每位玩家汇总卡
  const sum = $("#honor-summary");
  sum.innerHTML = "";
  roster.forEach(p => {
    const stars = records.filter(r => r.p === p.name && r.stars).reduce((s, r) => s + r.stars, 0);
    const rounds = records.filter(r => r.p === p.name).length;
    const wins = versusRec[p.name] || 0;
    const themesN = new Set(records.filter(r => r.p === p.name && r.kind === "theme").map(r => r.label)).size;
    const card = document.createElement("div");
    card.className = "honor-card";
    card.innerHTML = `
      <div class="h-ava">${p.avatar}</div>
      <div class="h-name">${p.name}</div>
      <div class="h-stat">累计 <b>${stars}</b> ⭐ · <b>${themesN}</b> 🎴<br>完成 <b>${rounds}</b> 轮 · 对战 <b>${wins}</b> 胜</div>`;
    sum.appendChild(card);
  });
  // 时间线
  $("#honor-sub").textContent = `共 ${records.length} 条成绩 · 按时间倒序`;
  const tl = $("#honor-timeline");
  tl.innerHTML = "";
  if (!records.length) {
    tl.innerHTML = `<div class="tl-item"><span class="tl-text">还没有成绩,去闯一关吧!</span></div>`;
    return;
  }
  records.forEach(r => {
    const div = document.createElement("div");
    div.className = "tl-item";
    const star = r.stars ? `<span class="tl-star">${"⭐".repeat(r.stars)}</span>` : "";
    const kindIcon = r.kind === "theme" ? "🎴" : r.kind === "versus" ? "⚔️" : "📖";
    div.innerHTML = `<span class="tl-ym">${r.ym}</span><span class="tl-ava">${r.ava || "👤"}</span>
      <span class="tl-text"><b>${r.p}</b> ${kindIcon} ${r.label}</span>${star}`;
    tl.appendChild(div);
  });
}

/* ════════ 启动 ════════ */
document.addEventListener("pointerdown", function once() {
  Sound.ensure();
  if (Sound.enabled) Sound.startBGM();
  document.removeEventListener("pointerdown", once);
});
$("#sound-toggle").textContent = Sound.enabled ? "🔊" : "🔇";
updatePlayerChip();

/* ════════ 云同步初始化(家庭数据集:花名册/成绩/进度/图鉴) ════════ */
CloudSync.init({
  game: "poem",
  collect: () => ({
    roster,
    records,
    best: bestStars,
    themes: themeProg,
    unlocked: [...unlocked],
    versus: versusRec,
  }),
  apply: s => {
    roster = s.roster || roster;
    save("pq_roster", roster);
    records.length = 0; records.push(...(s.records || [])); save("pq_records", records);
    Object.keys(bestStars).forEach(k => delete bestStars[k]); Object.assign(bestStars, s.best || {}); save("pq_best", bestStars);
    Object.keys(themeProg).forEach(k => delete themeProg[k]); Object.assign(themeProg, s.themes || {}); save("pq_themes", themeProg);
    unlocked.clear(); (s.unlocked || []).forEach(x => unlocked.add(x)); save("pq_unlocked", [...unlocked]);
    Object.keys(versusRec).forEach(k => delete versusRec[k]); Object.assign(versusRec, s.versus || {}); save("pq_versus", versusRec);
    if (roster.length && !roster.some(p => p.id === currentPid)) {
      currentPid = roster[0].id; save("pq_current", currentPid);
    }
    updatePlayerChip();
  },
  render: () => {
    const id = document.querySelector(".screen.active")?.id;
    if (id === "screen-honor") renderHonor();
    if (id === "screen-poets") renderPoets();
    if (id === "screen-theme") renderThemes();
    if (id === "screen-player") renderRoster();
  },
});
