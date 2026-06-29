// ============================================================
// GOALRACE ENGINE — SERVER
// Express serves /public. WebSocket pushes batched game-state
// updates to every connected client (broadcast view + admin).
// ============================================================

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const config = require("./config");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ------------------------------------------------------------
// GAME STATE (in memory — single match running at a time)
// ------------------------------------------------------------
function freshCountryState() {
  const obj = {};
  for (const c of config.COUNTRIES) {
    obj[c.code] = { score: 0, players: [] }; // players = [{id, username}]
  }
  return obj;
}

const state = {
  status: "idle", // idle | running | paused | break
  timeRemaining: config.MATCH_DURATION_SECONDS,
  countries: freshCountryState(),
  likesTotal: 0,
  likesSinceLastPoint: 0,
  eventIndicator: "Waiting for kickoff",
  chaosMode: false,
  chaosUntil: 0,
  ledMessage: "",
  cameraZoom: false,
  testMode: false,
  tiktokStatus: "disconnected", // disconnected | connecting | connected
  viewerJoinedCountry: {}, // username -> country code (sticky team assignment)
};

let matchTimer = null;
let breakTimer = null;
let playerSeq = 1;

// Queues flushed every EVENT_BATCH_MS to avoid flooding the socket / DOM
let spawnQueue = []; // [{id, username, country}]
let fxQueue = []; // [{type, payload}]

function resetMatch() {
  state.status = "idle";
  state.timeRemaining = config.MATCH_DURATION_SECONDS;
  state.countries = freshCountryState();
  state.likesTotal = 0;
  state.likesSinceLastPoint = 0;
  state.eventIndicator = "Waiting for kickoff";
  state.chaosMode = false;
  state.ledMessage = "";
  state.viewerJoinedCountry = {};
  spawnQueue = [];
  fxQueue = [];
}

// ------------------------------------------------------------
// WEBSOCKET BROADCAST
// ------------------------------------------------------------
function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

function flushQueues() {
  if (spawnQueue.length === 0 && fxQueue.length === 0 && !flushQueues._dirty) return;
  broadcast({
    type: "TICK",
    state: publicState(),
    spawns: spawnQueue,
    fx: fxQueue,
  });
  spawnQueue = [];
  fxQueue = [];
  flushQueues._dirty = false;
}
setInterval(flushQueues, config.EVENT_BATCH_MS);

function publicState() {
  // Strip server-only bookkeeping before sending to clients
  return {
    status: state.status,
    timeRemaining: state.timeRemaining,
    countries: state.countries,
    likesTotal: state.likesTotal,
    eventIndicator: state.eventIndicator,
    chaosMode: state.chaosMode,
    ledMessage: state.ledMessage,
    cameraZoom: state.cameraZoom,
    testMode: state.testMode,
    tiktokStatus: state.tiktokStatus,
  };
}

// ------------------------------------------------------------
// CORE EVENT HANDLER — every like/comment/gift/follow funnels here,
// whether it came from TEST MODE or a real TikTok connection.
// ------------------------------------------------------------
function resolveCountryForUser(username, commentText) {
  // Sticky assignment: once joined, a viewer stays on their team
  if (state.viewerJoinedCountry[username]) return state.viewerJoinedCountry[username];

  if (commentText) {
    const lower = commentText.toLowerCase();
    for (const c of config.COUNTRIES) {
      if (c.keywords.some((kw) => lower.includes(kw))) {
        state.viewerJoinedCountry[username] = c.code;
        return c.code;
      }
    }
  }
  return null;
}

function spawnPlayer(countryCode, username) {
  if (state.status !== "running") return;
  const bucket = state.countries[countryCode];
  if (!bucket) return;
  const id = `p${playerSeq++}`;
  bucket.players.push({ id, username });
  if (bucket.players.length > config.MAX_PLAYERS_PER_TEAM) {
    bucket.players.shift(); // oldest fades out, score is untouched
  }
  spawnQueue.push({ id, username, country: countryCode });
  flushQueues._dirty = true;
}

function addScore(countryCode, points) {
  if (!state.countries[countryCode]) return;
  state.countries[countryCode].score += points;
  flushQueues._dirty = true;
}

function handleEvent(evt) {
  // evt: { type: 'like'|'comment'|'gift'|'follow'|'share', username, comment, giftKey, likeCount }
  if (state.status !== "running") return;

  if (evt.type === "like") {
    state.likesTotal += evt.likeCount || 1;
    state.likesSinceLastPoint += evt.likeCount || 1;
    flushQueues._dirty = true;
    // Likes only spawn/score once we cross the divisor threshold, so a like-spam
    // burst doesn't flood the DOM with one player per like.
    while (state.likesSinceLastPoint >= config.LIKE_BATCH_DIVISOR) {
      state.likesSinceLastPoint -= config.LIKE_BATCH_DIVISOR;
      const country = state.viewerJoinedCountry[evt.username] || randomCountry();
      addScore(country, config.POINTS.like);
      spawnPlayer(country, evt.username || "fan");
    }
    return;
  }

  if (evt.type === "comment") {
    const country = resolveCountryForUser(evt.username, evt.comment);
    if (!country) return; // didn't match a team keyword — no-op
    addScore(country, config.POINTS.comment);
    spawnPlayer(country, evt.username);
    return;
  }

  if (evt.type === "follow") {
    const country = resolveCountryForUser(evt.username, null) || randomCountry();
    addScore(country, config.POINTS.follow);
    spawnPlayer(country, evt.username);
    return;
  }

  if (evt.type === "share") {
    const country = resolveCountryForUser(evt.username, null) || randomCountry();
    addScore(country, config.POINTS.share);
    spawnPlayer(country, evt.username);
    return;
  }

  if (evt.type === "gift") {
    const giftCfg = config.GIFTS[evt.giftKey];
    if (!giftCfg) return;
    const country = resolveCountryForUser(evt.username, null) || randomCountry();
    addScore(country, giftCfg.points);
    for (let i = 0; i < giftCfg.spawnMultiplier; i++) {
      spawnPlayer(country, evt.username);
    }
    state.eventIndicator = `${evt.username} sent ${giftCfg.label}!`;
    fxQueue.push({ type: "GIFT", gift: evt.giftKey, country, username: evt.username });
    if (giftCfg.big) triggerBigGiftEffects(evt.giftKey, country);
    flushQueues._dirty = true;
  }
}

function randomCountry() {
  const list = config.COUNTRIES;
  return list[Math.floor(Math.random() * list.length)].code;
}

function triggerBigGiftEffects(giftKey, country) {
  state.chaosMode = true;
  state.chaosUntil = Date.now() + 6000;
  state.cameraZoom = true;
  fxQueue.push({ type: "FIREWORKS" });
  fxQueue.push({ type: "STADIUM_SHAKE" });
  fxQueue.push({ type: "LED_FLASH", message: `${giftKey.toUpperCase()} INCOMING` });
  setTimeout(() => {
    state.cameraZoom = false;
    flushQueues._dirty = true;
  }, 2500);
}

// chaos mode auto-expires
setInterval(() => {
  if (state.chaosMode && Date.now() > state.chaosUntil) {
    state.chaosMode = false;
    flushQueues._dirty = true;
  }
}, 500);

// ------------------------------------------------------------
// MATCH LOOP
// ------------------------------------------------------------
function startMatch() {
  if (state.status === "running") return;
  if (state.status === "idle") resetMatch();
  state.status = "running";
  state.eventIndicator = "Match underway";
  flushQueues._dirty = true;

  clearInterval(matchTimer);
  matchTimer = setInterval(() => {
    if (state.status !== "running") return;
    state.timeRemaining -= 1;

    if (state.timeRemaining === config.SLOWMO_THRESHOLD_SECONDS) {
      state.eventIndicator = "FINAL SURGE";
      fxQueue.push({ type: "SLOWMO_START" });
    }

    if (state.timeRemaining <= 0) {
      endMatch();
      return;
    }
    flushQueues._dirty = true;
  }, 1000);
}

function pauseMatch() {
  if (state.status !== "running") return;
  state.status = "paused";
  state.eventIndicator = "Match paused";
  flushQueues._dirty = true;
}

function resumeMatch() {
  if (state.status !== "paused") return;
  state.status = "running";
  state.eventIndicator = "Match resumed";
  flushQueues._dirty = true;
}

function extendTime(seconds) {
  state.timeRemaining += seconds;
  flushQueues._dirty = true;
}

function skipHalftime() {
  // In this simple model "halftime" = jump straight to final-surge window
  state.timeRemaining = Math.min(state.timeRemaining, config.SLOWMO_THRESHOLD_SECONDS);
  flushQueues._dirty = true;
}

function endMatch() {
  clearInterval(matchTimer);
  state.status = "break";
  const ranked = Object.entries(state.countries).sort((a, b) => b[1].score - a[1].score);
  const winnerCode = ranked[0] ? ranked[0][0] : null;
  const winner = config.COUNTRIES.find((c) => c.code === winnerCode);
  state.eventIndicator = winner ? `${winner.name} WINS THE MATCH` : "Match complete";
  fxQueue.push({ type: "MATCH_END", winner: winnerCode });
  flushQueues._dirty = true;

  clearTimeout(breakTimer);
  breakTimer = setTimeout(() => {
    resetMatch();
    flushQueues._dirty = true;
    if (config.AUTO_RESTART) startMatch();
  }, config.BREAK_SECONDS * 1000);
}

// ------------------------------------------------------------
// TEST MODE — fake TikTok event generator (no network required)
// ------------------------------------------------------------
let testInterval = null;
const TEST_USERNAMES = ["maria_hn", "carlos21", "j.lopez", "luchadora", "fanboy99", "_brasileira_", "elpibe", "tica_loca"];
const TEST_COMMENTS = ["hon", "mex", "vamos honduras", "brasil!!", "usa usa", "arg", "col vamos", "gt", "sv let's go"];
const TEST_GIFT_KEYS = Object.keys(config.GIFTS);

function randomTestUsername() {
  return TEST_USERNAMES[Math.floor(Math.random() * TEST_USERNAMES.length)];
}

function startTestMode() {
  state.testMode = true;
  state.tiktokStatus = "test mode";
  stopTestMode(false);
  testInterval = setInterval(() => {
    if (state.status !== "running") return;
    const roll = Math.random();
    const username = TEST_USERNAMES[Math.floor(Math.random() * TEST_USERNAMES.length)];

    if (roll < 0.55) {
      handleEvent({ type: "like", username, likeCount: Math.ceil(Math.random() * 15) });
    } else if (roll < 0.9) {
      const comment = TEST_COMMENTS[Math.floor(Math.random() * TEST_COMMENTS.length)];
      handleEvent({ type: "comment", username, comment });
    } else if (roll < 0.96) {
      handleEvent({ type: "follow", username });
    } else {
      const giftKey = TEST_GIFT_KEYS[Math.floor(Math.random() * TEST_GIFT_KEYS.length)];
      handleEvent({ type: "gift", username, giftKey });
    }
  }, 180);
  flushQueues._dirty = true;
}

function stopTestMode(updateFlag = true) {
  clearInterval(testInterval);
  testInterval = null;
  if (updateFlag) {
    state.testMode = false;
    state.tiktokStatus = "disconnected";
    flushQueues._dirty = true;
  }
}

function simulateBigGift() {
  const username = TEST_USERNAMES[Math.floor(Math.random() * TEST_USERNAMES.length)];
  const giftKey = TEST_GIFT_KEYS[TEST_GIFT_KEYS.length - 1]; // moneygun — biggest
  handleEvent({ type: "gift", username, giftKey });
}

// ------------------------------------------------------------
// OPTIONAL: REAL TIKTOK CONNECTION
// Requires `npm install tiktok-live-connector` and a sign-server API key.
// Left disabled unless TIKTOK_USERNAME + TIKTOK_SIGN_API_KEY are set.
// ------------------------------------------------------------
let tiktokConnection = null;

async function connectRealTikTok() {
  if (!config.TIKTOK_USERNAME) {
    console.log("[tiktok] TIKTOK_USERNAME not set — staying in test mode only.");
    return;
  }
  if (!config.TIKTOK_SIGN_API_KEY) {
    console.warn("[tiktok] TIKTOK_SIGN_API_KEY not set. As of the current tiktok-live-connector,");
    console.warn("[tiktok] a signing API key is required (TikTok now blocks unsigned connections).");
    return;
  }

  try {
    // Lazy require so the app still boots if the package isn't installed yet.
    const { TikTokLiveConnection } = require("tiktok-live-connector");
    state.tiktokStatus = "connecting";
    flushQueues._dirty = true;

    tiktokConnection = new TikTokLiveConnection(config.TIKTOK_USERNAME, {
      signApiKey: config.TIKTOK_SIGN_API_KEY,
    });

    tiktokConnection.on("chat", (data) => {
      handleEvent({ type: "comment", username: data.user?.uniqueId || data.uniqueId, comment: data.comment });
    });
    tiktokConnection.on("gift", (data) => {
      // Map TikTok's gift name to our internal asset keys as best-effort.
      const key = (data.giftName || "").toLowerCase();
      const matched = Object.keys(config.GIFTS).find((k) => key.includes(k));
      if (matched) handleEvent({ type: "gift", username: data.user?.uniqueId, giftKey: matched });
    });
    tiktokConnection.on("like", (data) => {
      handleEvent({ type: "like", username: data.user?.uniqueId, likeCount: data.likeCount || 1 });
    });
    tiktokConnection.on("follow", (data) => {
      handleEvent({ type: "follow", username: data.user?.uniqueId });
    });
    tiktokConnection.on("share", (data) => {
      handleEvent({ type: "share", username: data.user?.uniqueId });
    });
    tiktokConnection.on("disconnected", () => {
      state.tiktokStatus = "disconnected";
      flushQueues._dirty = true;
    });

    await tiktokConnection.connect();
    state.tiktokStatus = "connected";
    flushQueues._dirty = true;
    console.log("[tiktok] connected to", config.TIKTOK_USERNAME);
  } catch (err) {
    state.tiktokStatus = "disconnected";
    flushQueues._dirty = true;
    console.error("[tiktok] connection failed:", err.message);
  }
}

// ------------------------------------------------------------
// WEBSOCKET CONNECTION HANDLING
// ------------------------------------------------------------
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "INIT", state: publicState(), config: clientConfig() }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "ADMIN" ) {
      if (msg.token !== config.ADMIN_TOKEN) {
        ws.send(JSON.stringify({ type: "ADMIN_ERROR", message: "Invalid admin token" }));
        return;
      }
      handleAdminAction(msg.action, msg.payload || {});
    }
  });
});

function handleAdminAction(action, payload) {
  switch (action) {
    case "start": startMatch(); break;
    case "pause": pauseMatch(); break;
    case "resume": resumeMatch(); break;
    case "reset": clearInterval(matchTimer); clearTimeout(breakTimer); stopTestMode(false); resetMatch(); break;
    case "extend": extendTime(payload.seconds || 30); break;
    case "skipHalftime": skipHalftime(); break;
    case "fireworks": fxQueue.push({ type: "FIREWORKS" }); flushQueues._dirty = true; break;
    case "moneygun": simulateBigGift(); break;
    case "simulateBigGift": simulateBigGift(); break;
    case "simulateBigGift": simulateBigGift(); break;
    case "chaosToggle":
      state.chaosMode = !state.chaosMode;
      state.chaosUntil = state.chaosMode ? Date.now() + 8000 : 0;
      flushQueues._dirty = true;
      break;
    case "cameraZoom":
      state.cameraZoom = !state.cameraZoom;
      flushQueues._dirty = true;
      break;
    case "ledMessage":
      state.ledMessage = (payload.message || "").slice(0, 60);
      flushQueues._dirty = true;
      break;
    case "testStart": startTestMode(); break;
    case "testStop": stopTestMode(); break;
    case "connectTikTok": connectRealTikTok(); break;

    // ---- expanded test-mode simulators (admin-triggered, on top of the
    // automatic random generator) — each reuses handleEvent so scoring,
    // spawning, and fx all go through the exact same path as real events ----
    case "simulateLikes": {
      const username = randomTestUsername();
      handleEvent({ type: "like", username, likeCount: payload.count || 50 });
      break;
    }
    case "simulateComment": {
      const username = randomTestUsername();
      const country = payload.country && config.COUNTRIES.find((c) => c.code === payload.country);
      const comment = country ? country.keywords[0] : TEST_COMMENTS[Math.floor(Math.random() * TEST_COMMENTS.length)];
      handleEvent({ type: "comment", username, comment });
      break;
    }
    case "simulateFollow": {
      handleEvent({ type: "follow", username: randomTestUsername() });
      break;
    }
    case "simulateGift": {
      const giftKey = payload.giftKey && config.GIFTS[payload.giftKey] ? payload.giftKey : "rose";
      handleEvent({ type: "gift", username: randomTestUsername(), giftKey });
      break;
    }
    case "simulateGiftSpam": {
      const giftKey = payload.giftKey && config.GIFTS[payload.giftKey] ? payload.giftKey : "rose";
      const count = payload.count || 8;
      let sent = 0;
      const spam = setInterval(() => {
        handleEvent({ type: "gift", username: randomTestUsername(), giftKey });
        if (++sent >= count) clearInterval(spam);
      }, 220);
      break;
    }
    case "simulateConnectionLoss": {
      state.tiktokStatus = "reconnecting";
      state.eventIndicator = "Connection lost — reconnecting...";
      fxQueue.push({ type: "CONNECTION_LOST" });
      flushQueues._dirty = true;
      break;
    }
    case "simulateReconnect": {
      state.tiktokStatus = state.testMode ? "test mode" : "connected";
      state.eventIndicator = "Reconnected";
      fxQueue.push({ type: "CONNECTION_RESTORED" });
      flushQueues._dirty = true;
      break;
    }
    default: console.log("[admin] unknown action", action);
  }
}

function clientConfig() {
  return { COUNTRIES: config.COUNTRIES, GIFTS: config.GIFTS, MATCH_DURATION_SECONDS: config.MATCH_DURATION_SECONDS };
}

// ------------------------------------------------------------
server.listen(config.PORT, () => {
  console.log(`GoalRace Engine listening on port ${config.PORT}`);
  console.log(`Broadcast view: http://localhost:${config.PORT}/`);
  console.log(`Admin panel:    http://localhost:${config.PORT}/admin.html`);
});
