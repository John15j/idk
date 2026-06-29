// ============================================================
// GOALRACE — CONTROL ROOM CLIENT  (admin.js)
// ============================================================

const adminTokenEl   = document.getElementById("adminToken");
const saveTokenBtn   = document.getElementById("saveToken");
const wsStatusEl     = document.getElementById("wsStatus");
const wsStatusPip    = document.getElementById("wsStatusPip");
const tiktokStatusEl = document.getElementById("tiktokStatus");
const tiktokStatusPip= document.getElementById("tiktokStatusPip");
const fpsEl          = document.getElementById("fpsCounter");
const matchStatusEl  = document.getElementById("matchStatus");
const timeRemainingEl= document.getElementById("timeRemaining");
const totalPlayersEl = document.getElementById("totalPlayers");
const logEl          = document.getElementById("adminLog");
const ledInput       = document.getElementById("ledInput");
const ledSend        = document.getElementById("ledSend");

// persist token in localStorage (never sent to any third party)
adminTokenEl.value = localStorage.getItem("goalrace_admin_token") || "";
saveTokenBtn.addEventListener("click", () => {
  localStorage.setItem("goalrace_admin_token", adminTokenEl.value.trim());
  log("Token saved locally.");
});

let ws = null;
let lastEventText = "";

// ── helpers ──────────────────────────────────────────────────
function setPip(pip, state) {
  pip.className = "status-pip " + (state === "on" ? "on" : state === "mid" ? "mid" : "off");
}
function setStatus(el, pip, text, state) {
  el.textContent = text;
  setPip(pip, state);
}

function log(text) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  logEl.prepend(line);
  while (logEl.children.length > 50) logEl.removeChild(logEl.lastChild);
}

function formatTime(seconds) {
  const s = Math.max(0, seconds || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,"0")}`;
}

// ── WebSocket ────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    setStatus(wsStatusEl, wsStatusPip, "connected", "on");
    log("WebSocket connected.");
  };
  ws.onclose = () => {
    setStatus(wsStatusEl, wsStatusPip, "disconnected", "off");
    log("WebSocket disconnected — retrying…");
    setTimeout(connect, 1500);
  };
  ws.onerror = () => setStatus(wsStatusEl, wsStatusPip, "error", "off");

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "INIT" || msg.type === "TICK") applyState(msg.state);
    if (msg.type === "ADMIN_ERROR") log(`⚠ ${msg.message}`);
  };
}

function applyState(state) {
  matchStatusEl.textContent = state.status || "—";
  timeRemainingEl.textContent = formatTime(state.timeRemaining);

  let total = 0;
  Object.values(state.countries || {}).forEach(c => { total += c.players ? c.players.length : 0; });
  totalPlayersEl.textContent = total;

  // TikTok status pip
  const tt = state.tiktokStatus || "disconnected";
  if (tt === "connected")       setStatus(tiktokStatusEl, tiktokStatusPip, "connected",  "on");
  else if (tt === "test mode" || tt === "connecting" || tt === "reconnecting")
                                 setStatus(tiktokStatusEl, tiktokStatusPip, tt, "mid");
  else                           setStatus(tiktokStatusEl, tiktokStatusPip, "offline", "off");

  if (state.eventIndicator && state.eventIndicator !== lastEventText) {
    lastEventText = state.eventIndicator;
    log(state.eventIndicator);
  }
}

// ── send command ──────────────────────────────────────────────
function sendAdmin(action, payload) {
  if (!ws || ws.readyState !== 1) { log("Not connected yet — try again."); return; }
  ws.send(JSON.stringify({ type:"ADMIN", token: adminTokenEl.value.trim(), action, payload: payload || {} }));
  log(`→ ${action}${payload ? " " + JSON.stringify(payload) : ""}`);
}

// ── button wiring ─────────────────────────────────────────────
document.querySelectorAll(".btn[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    const action  = btn.dataset.action;
    const payload = btn.dataset.payload ? JSON.parse(btn.dataset.payload) : undefined;
    sendAdmin(action, payload);
  });
});

ledSend.addEventListener("click", () => {
  const message = ledInput.value.trim();
  if (message) { sendAdmin("ledMessage", { message }); ledInput.value = ""; }
});
ledInput.addEventListener("keydown", e => { if (e.key === "Enter") ledSend.click(); });

// ── FPS counter ───────────────────────────────────────────────
let frames = 0, lastFpsTime = performance.now();
(function fpsLoop() {
  frames++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsEl.textContent = frames;
    frames = 0;
    lastFpsTime = now;
  }
  requestAnimationFrame(fpsLoop);
})();

connect();
