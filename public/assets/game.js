// ==========================================================
// GOALRACE ENGINE — BROADCAST CLIENT
// Renders the stadium view from server TICK/INIT messages.
// No build step — plain DOM, kept deliberately simple so it
// survives a 1-3 hour stream without leaking memory.
// ==========================================================

const root = document.getElementById("root");
const stadium = document.getElementById("stadium");
const benchesEl = document.getElementById("benches");
const scoreboardEl = document.getElementById("scoreboard");
const fxLayer = document.getElementById("fxLayer");
const trophyLayer = document.getElementById("trophyLayer");
const jumbotron = document.getElementById("jumbotron");
const likesValue = document.getElementById("likesValue");
const timerValue = document.getElementById("timerValue");
const eventIndicator = document.getElementById("eventIndicator");
const giftGuide = document.getElementById("giftGuide");
const joinKeywords = document.getElementById("joinKeywords");

let countries = [];      // from server config
let gifts = {};          // from server config
let benchClusters = {};  // code -> cluster DOM element
let lastEventText = "";

function flagUrl(code) { return `/assets/flags/${code}.svg`; }

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}`);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "INIT") {
      countries = msg.config.COUNTRIES;
      gifts = msg.config.GIFTS;
      buildBenches();
      buildGiftGuide();
      applyState(msg.state);
      rebuildAllPlayers(msg.state);
    } else if (msg.type === "TICK") {
      applyState(msg.state);
      (msg.spawns || []).forEach(spawnPlayerEl);
      (msg.fx || []).forEach(handleFx);
    }
  };

  ws.onclose = () => setTimeout(connect, 1500); // auto-reconnect for long streams
}

// ---------------- STATIC STRUCTURE ----------------
function buildBenches() {
  benchesEl.innerHTML = "";
  benchClusters = {};
  countries.forEach((c) => {
    const bench = document.createElement("div");
    bench.className = "bench";
    bench.innerHTML = `
      <div class="bench__label"><img src="${flagUrl(c.code)}" alt="" /> ${c.name}</div>
      <div class="bench__cluster" id="cluster-${c.code}"></div>
    `;
    benchesEl.appendChild(bench);
    benchClusters[c.code] = bench.querySelector(".bench__cluster");
  });
}

function buildGiftGuide() {
  giftGuide.innerHTML = "";
  joinKeywords.textContent = countries.map((c) => c.keywords[0]).join(" · ");
  Object.entries(gifts).forEach(([key, g]) => {
    const chip = document.createElement("div");
    chip.className = "gift-chip";
    chip.innerHTML = `<img src="${g.asset}" alt="" /> ${g.label}`;
    giftGuide.appendChild(chip);
  });
}

// ---------------- STATE APPLICATION ----------------
function applyState(state) {
  likesValue.textContent = formatCount(state.likesTotal);
  timerValue.textContent = formatTime(state.timeRemaining);
  if (state.eventIndicator !== lastEventText) {
    eventIndicator.textContent = state.eventIndicator;
    lastEventText = state.eventIndicator;
  }
  jumbotron.textContent = state.ledMessage ? state.ledMessage : "GOALRACE";

  root.classList.toggle("chaos", !!state.chaosMode);
  stadium.classList.toggle("zoomed", !!state.cameraZoom);
  root.classList.toggle("slowmo", state.timeRemaining <= 10 && state.timeRemaining > 0 && state.status === "running");

  renderScoreboard(state.countries);
}

function renderScoreboard(countryState) {
  const rowHeight = 22;
  const ranked = countries
    .map((c) => ({ ...c, score: countryState[c.code] ? countryState[c.code].score : 0 }))
    .sort((a, b) => b.score - a.score);

  ranked.forEach((c, i) => {
    let row = document.getElementById(`score-${c.code}`);
    if (!row) {
      row = document.createElement("div");
      row.id = `score-${c.code}`;
      row.className = "score-row";
      row.innerHTML = `<img src="${flagUrl(c.code)}" alt="" /><span class="score-row__name">${c.name}</span><span class="score-row__value">0</span>`;
      scoreboardEl.appendChild(row);
    }
    row.style.top = `${i * rowHeight + 2}px`;
    row.classList.toggle("first", i === 0 && c.score > 0);
    row.querySelector(".score-row__value").textContent = c.score;
  });
}

// ---------------- PLAYERS ----------------
function rebuildAllPlayers(state) {
  countries.forEach((c) => {
    const bucket = state.countries[c.code];
    if (!bucket) return;
    bucket.players.forEach((p) => spawnPlayerEl({ id: p.id, country: c.code }));
  });
}

function spawnPlayerEl(spawn) {
  const cluster = benchClusters[spawn.country];
  if (!cluster) return;
  const country = countries.find((c) => c.code === spawn.country);
  const el = document.createElement("div");
  el.className = "player";
  el.style.background = country ? country.color : "#888";
  el.dataset.id = spawn.id;
  cluster.appendChild(el);

  // enforce visible cap client-side too — oldest fades, never the score
  const MAX_VISIBLE = 35;
  while (cluster.children.length > MAX_VISIBLE) {
    const oldest = cluster.firstElementChild;
    if (!oldest) break;
    oldest.classList.add("fading");
    setTimeout(() => oldest.remove(), 420);
  }
}

// ---------------- EFFECTS ----------------
function handleFx(fx) {
  if (fx.type === "GIFT") spawnGiftPop(fx);
  else if (fx.type === "FIREWORKS") spawnFireworks();
  else if (fx.type === "STADIUM_SHAKE") shakeStadium();
  else if (fx.type === "LED_FLASH") flashLed(fx.message);
  else if (fx.type === "SLOWMO_START") root.classList.add("slowmo");
  else if (fx.type === "MATCH_END") showTrophy(fx.winner);
}

function spawnGiftPop(fx) {
  const giftCfg = gifts[fx.gift];
  if (!giftCfg) return;
  const img = document.createElement("img");
  img.className = "gift-pop";
  img.src = giftCfg.asset;
  img.style.left = `${20 + Math.random() * 60}%`;
  img.style.top = `${30 + Math.random() * 40}%`;
  fxLayer.appendChild(img);
  setTimeout(() => img.remove(), 1500);
}

function spawnFireworks() {
  const colors = ["#2be6ff", "#ffd23f", "#ff3b5c", "#7CFC00"];
  for (let i = 0; i < 24; i++) {
    const dot = document.createElement("div");
    dot.className = "firework";
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 80;
    dot.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    dot.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    dot.style.left = "50%";
    dot.style.top = "35%";
    dot.style.background = colors[i % colors.length];
    fxLayer.appendChild(dot);
    setTimeout(() => dot.remove(), 950);
  }
}

function shakeStadium() {
  stadium.classList.add("shake");
  setTimeout(() => stadium.classList.remove("shake"), 420);
}

let ledTimeout = null;
function flashLed(message) {
  jumbotron.textContent = message;
  clearTimeout(ledTimeout);
  ledTimeout = setTimeout(() => { jumbotron.textContent = "GOALRACE"; }, 3000);
}

function showTrophy(winnerCode) {
  const country = countries.find((c) => c.code === winnerCode);
  const banner = document.createElement("div");
  banner.className = "trophy-banner";
  banner.innerHTML = country
    ? `🏆 <img src="${flagUrl(country.code)}" style="width:28px;height:19px;vertical-align:middle;border-radius:2px" /><br/>${country.name} WINS`
    : `🏆 MATCH COMPLETE`;
  trophyLayer.appendChild(banner);
  setTimeout(() => banner.remove(), 6000);
}

// ---------------- FORMATTING ----------------
function formatCount(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}
function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

connect();
