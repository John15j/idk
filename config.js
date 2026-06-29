// ============================================================
// GOALRACE ENGINE — CONFIG
// Single source of truth for match timing, countries, and gifts.
// Tweak values here rather than hunting through server.js.
// ============================================================

module.exports = {
  // ---- Server ----
  PORT: process.env.PORT || 3000,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "changeme123",

  // ---- Match timing ----
  MATCH_DURATION_SECONDS: 360, // 6 minutes
  BREAK_SECONDS: 15,
  SLOWMO_THRESHOLD_SECONDS: 10, // last N seconds trigger slow-mo
  AUTO_RESTART: true,

  // ---- Performance ----
  MAX_PLAYERS_PER_TEAM: 35,
  EVENT_BATCH_MS: 75, // server flushes queued events this often

  // ---- Scoring ----
  POINTS: {
    like: 1, // per like batch tick (see server.js LIKE_BATCH_DIVISOR)
    comment: 2,
    follow: 10,
    share: 15,
  },
  LIKE_BATCH_DIVISOR: 20, // 1 point per 20 likes, to avoid runaway scores

  // ---- Countries ----
  // keywords = lowercase comment text that joins a viewer to this team
  COUNTRIES: [
    { code: "hn", name: "Honduras", color: "#0073CF", keywords: ["hon", "honduras", "catracho", "hn"] },
    { code: "mx", name: "Mexico", color: "#006847", keywords: ["mex", "mexico", "méxico", "mx"] },
    { code: "br", name: "Brazil", color: "#FFD700", keywords: ["br", "brazil", "brasil", "bra"] },
    { code: "us", name: "USA", color: "#3C3B6E", keywords: ["usa", "us", "america", "eeuu"] },
    { code: "ar", name: "Argentina", color: "#75AADB", keywords: ["arg", "argentina"] },
    { code: "co", name: "Colombia", color: "#FCD116", keywords: ["col", "colombia"] },
    { code: "gt", name: "Guatemala", color: "#4997D0", keywords: ["gt", "guate", "guatemala", "chapin"] },
    { code: "sv", name: "El Salvador", color: "#0047AB", keywords: ["sv", "salvador", "elsalvador", "guanaco"] },
  ],

  // ---- Gifts (internal asset system — never hot-link TikTok's own gift images) ----
  GIFTS: {
    rose: { label: "Rose", points: 5, asset: "/assets/gifts/rose.svg", big: false, spawnMultiplier: 1 },
    lion: { label: "Lion", points: 150, asset: "/assets/gifts/lion.svg", big: true, spawnMultiplier: 5 },
    galaxy: { label: "Galaxy", points: 500, asset: "/assets/gifts/galaxy.svg", big: true, spawnMultiplier: 10 },
    moneygun: { label: "Money Gun", points: 1000, asset: "/assets/gifts/moneygun.svg", big: true, spawnMultiplier: 20 },
  },

  // ---- Real TikTok connection (optional — off unless you set these) ----
  // tiktok-live-connector v2+ now requires a signing API key (TikTok locked down
  // the unofficial endpoint). Get one from a sign-server provider (e.g. Euler Stream)
  // and set it as an env var — never hardcode it in this file.
  TIKTOK_USERNAME: process.env.TIKTOK_USERNAME || "",
  TIKTOK_SIGN_API_KEY: process.env.TIKTOK_SIGN_API_KEY || "",
};
