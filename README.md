# ✦ Stellar Summit Connect

A tiny networking board for **Stellar Summit São Paulo**: see who's here, what
they're building, what they're looking for — then connect, do business, and
**try each other's apps**.

Zero dependencies. One command. No database.

## Run it

```bash
node server.js
# → http://localhost:3000
```

Data is persisted to `./data` (JSON files + uploaded photos), which is
gitignored.

## Share it with the room

Attendees need to reach your machine. Options, easiest first:

1. **Cloudflare tunnel** (free, public URL, no account needed):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   Put the printed URL in a QR code and project it.
2. **Same Wi-Fi**: share `http://<your-lan-ip>:3000` (find it with `ip a` or `ifconfig`).
3. **Deploy** to any Node host (Render, Railway, Fly.io, a VPS). Set `PORT` if
   needed. Note: the filesystem must be persistent for data to survive restarts.

## What it does

- **Join** — a form: name (the only required field), role, project, one-liner,
  category, technical/business, country & city, X, Telegram, email, up to 5
  project links, photo (resized in the browser), and an open "what are you
  looking for" field.
- **Builders** — live dashboard of everyone, with search and filters by
  category, technical/business, and country. Contact links (X / Telegram /
  email) on every card.
- **Connect ✦** — one tap records a connection; mutual connections count as
  matches.
- **Try it 🚀 / I tried it 🧪** — open someone's project, then record that you
  tried it and leave one-line feedback that shows on their card.
- **Metrics** — builders, connections, mutual matches, project tries, countries;
  builders by category; technical vs business split; most connected people;
  most tried projects; latest connections feed.

Your identity (a token) is stored in your browser's localStorage when you join —
that's what lets you edit your profile and attribute your connections. No
passwords, no accounts.

## Notes

- Chart colors are from a CVD-validated dark palette (deliberate dark theme).
- Everything anyone submits is visible to everyone with the URL — share only
  what you'd put on your conference badge.
