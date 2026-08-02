# ✦ Stellar Summit Connect

A networking board for **Stellar Summit São Paulo**: see who's here, what
they're building, what they're looking for — then connect, join teams, do
business, and **try each other's apps**.

Zero npm dependencies. One command. No database.

## Run it

```bash
node server.js
# → http://localhost:3000
```

- **Event password**: defaults to `PALTAISCOOL`. Change it with
  `ACCESS_KEY=mysecret node server.js`. Every API call requires it; visitors
  enter it once and it's remembered in their browser.
- **Magic-link sign-in (email = identity)**: to create or edit anything you
  sign in with your email — the server emails you an HMAC-signed link (15 min
  TTL) that sets a 30-day signed session cookie. You can only edit *your own*
  profile, projects and answers. Configure with:
  ```bash
  RESEND_API_KEY=re_xxx \
  FROM_EMAIL="Stellar Summit Connect <you@yourdomain.io>" \
  SITE_URL=https://your-public-url \
  node server.js
  ```
  (Same Resend setup as the dataroom; `MAGIC_LINK_SECRET` is optional — a
  secret is auto-generated and persisted in `data/secret.key`.)
  **Without `RESEND_API_KEY` the server runs in dev mode**: the sign-in link
  is returned directly in the UI instead of being emailed.
- Data is persisted to `./data` (plain JSON files + uploaded photos), which is
  gitignored. Copy that folder and you have the whole database.

## Share it with the room

Attendees need to reach your machine. Options, easiest first:

1. **Cloudflare tunnel** (free public URL, no account needed):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
2. **Same Wi-Fi**: share `http://<your-lan-ip>:3000`.
3. **Deploy** to any Node host (Render, Railway, Fly.io, a VPS). The
   filesystem must be persistent for data to survive restarts.

**QR trick**: point the QR to
`https://<your-url>/enter.html?key=PALTAISCOOL` — people who scan it skip the
password screen entirely.

## What it does

- **Join** — sign in with your email (magic link), then your profile: name
  (the only required field), role, technical/business, country & city, X,
  Telegram, LinkedIn, photo (resized in the browser), and an open "what are
  you looking for" field. Plus **your projects**: create as many as you want
  (each with one-liner, multiple categories, up to 5 links, and an optional
  image) or **join an existing project's team** with one tap. City is
  geocoded (OpenStreetMap Nominatim) so your pin lands on the map.
- **Public Q&A** — ask any person or project team a public question from
  their card; only the person asked (or the project's team members) can
  answer, and answers are editable. Askers and targets can delete questions.
- **Builders** — everyone's cards with search and filters by category,
  technical/business, and country. Contact links on every card.
- **Projects** — project-centric view: image (uploaded, or an automatic
  screenshot of the project's landing page via WordPress mshots), categories,
  team members, links.
- **Constellation ✦** — the cool one: a live force-directed star map.
  People are stars (colored by profile type, sized by connections), projects
  are golden diamonds; lines show connections (thicker = mutual), team
  membership, and who tried what. Drag the stars, click one for details.
  Hand-rolled canvas physics, no libraries.
- **Map** — a world map (Leaflet + OpenStreetMap/CARTO dark tiles) with
  city-level pins for people or projects; falls back to country centroids.
- **Connect ✦ / Try it 🚀 / I tried it 🧪 / Join team +** — one-tap social
  actions; feedback quotes show on project cards.
- **Metrics** — builders, projects, connections, mutual matches, tries,
  countries; projects by category; technical vs business; most connected;
  most tried; latest-connections feed. Plus **⬇ Export**: full database as
  JSON or contacts as CSV (Excel-ready).

Your identity (a token) lives in your browser's localStorage when you join —
that's what lets you edit your profile, your projects, and attribute your
connections. No passwords, no accounts.

## Notes

- The event password is a courtesy lock, not real security — everything
  behind it is visible to everyone who has it. Share what you'd put on your
  conference badge.
- Chart colors are from a CVD-validated dark palette (deliberate dark theme).
- External services used (all free, no keys): unpkg CDN for Leaflet,
  CARTO/OSM map tiles, Nominatim geocoding, WordPress mshots screenshots.
  Everything else is self-contained.
