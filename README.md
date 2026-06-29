# GoalRace Engine

TikTok LIVE interactive stadium broadcast simulator. Comments join a country
team, likes/comments/gifts/follows score points and spawn players, top score
wins after 6 minutes.

## Quick start (in GitHub Codespaces)

```bash
npm install
npm start
```

Then open the forwarded port:
- Broadcast view (what goes live): `/` (index.html)
- Admin control room: `/admin.html`

Set your admin token before using the control room — it must match `ADMIN_TOKEN`
below.

## Environment variables

| Variable | Purpose | Required? |
|---|---|---|
| `PORT` | server port | no, defaults to 3000 |
| `ADMIN_TOKEN` | password the admin panel needs to send commands | yes — change from the default |
| `TIKTOK_USERNAME` | the TikTok account to watch for real LIVE events | only for real (non-test) mode |
| `TIKTOK_SIGN_API_KEY` | signing key required by `tiktok-live-connector` v2+ | only for real mode |

## Test Mode

You don't need a real TikTok LIVE running to test this. In the admin panel:
1. Click **Start** (match control)
2. Click **▶ Start Test Match**

Fake likes/comments/gifts will stream in automatically so you can check
animations, scoring, and performance before going live for real.

## Going live for real

`tiktok-live-connector` is an **unofficial, reverse-engineered** library — it
is not a supported TikTok API, can break when TikTok changes things, and as of
its v2 release it requires a signing API key from a third-party sign server
(the connector itself can no longer sign requests for free). See
`server.js` → `connectRealTikTok()` for where that plugs in.

## File map

```
goalrace/
├── server.js        Express + WebSocket server, match loop, test simulator
├── config.js        Countries, gifts, timing — edit values here
├── public/
│   ├── index.html   Broadcast view (what you put on stream)
│   ├── admin.html   Control room
│   ├── style.css    Broadcast styling
│   ├── game.js       Broadcast client logic
│   ├── admin.js      Admin client logic
│   └── assets/      Placeholder SVG flags + gift icons — swap with your own art
```

## Notes on this build

- Players are rendered as simple colored dots (jersey color per country), not
  low-poly 3D models — that keeps it light enough for hours of continuous
  uptime on free Codespaces compute. Swapping in sprite art or a Three.js layer
  is a drop-in enhancement later if you want it.
- Flags and gift icons are placeholder SVGs generated for this build. Replace
  the files in `public/assets/flags` and `public/assets/gifts` with your own
  art any time — same filenames, same folder.
