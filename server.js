#!/usr/bin/env node
/**
 * Stellar Summit Connect — zero-dependency server.
 * Run with: node server.js  (Node 18+)
 * Data is persisted to ./data (JSON files + photos). No database needed.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const ACCESS_KEY = process.env.ACCESS_KEY || 'PALTAISCOOL';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const PEOPLE_FILE = path.join(DATA_DIR, 'people.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const CONN_FILE = path.join(DATA_DIR, 'connections.json');
const TRIES_FILE = path.join(DATA_DIR, 'tries.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

fs.mkdirSync(PHOTOS_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const state = {
  people: readJson(PEOPLE_FILE, []),
  projects: readJson(PROJECTS_FILE, []),
  connections: readJson(CONN_FILE, []),
  tries: readJson(TRIES_FILE, []),
  questions: readJson(QUESTIONS_FILE, []),
};

function persist() {
  fs.writeFileSync(PEOPLE_FILE, JSON.stringify(state.people, null, 2));
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(state.projects, null, 2));
  fs.writeFileSync(CONN_FILE, JSON.stringify(state.connections, null, 2));
  fs.writeFileSync(TRIES_FILE, JSON.stringify(state.tries, null, 2));
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(state.questions, null, 2));
}

// ---------- magic-link auth (HMAC-signed tokens, same pattern as the
// dataroom: emailed link → 15 min token → 30-day signed session cookie) ----------

function loadSecret() {
  if (process.env.MAGIC_LINK_SECRET) return process.env.MAGIC_LINK_SECRET;
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch { /* first run */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s);
  return s;
}
const SECRET = loadSecret();
const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hsign = (ctx, payload) =>
  b64url(crypto.createHmac('sha256', SECRET).update(`${ctx}.${payload}`).digest());

function makeToken(ctx, data, ttlMs) {
  const payload = b64url(JSON.stringify({ ...data, x: Date.now() + ttlMs }));
  return `${payload}.${hsign(ctx, payload)}`;
}

function readToken(ctx, token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(hsign(ctx, payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() < data.x ? data : null;
  } catch { return null; }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sessionEmail = (req) => readToken('sess', cookies(req).ssc_session)?.e || null;
const sessionPerson = (req) => {
  const email = sessionEmail(req);
  return email ? state.people.find((p) => (p.email || '').toLowerCase() === email) : null;
};

// ---------- sanitization ----------

// email is NOT here on purpose: identity comes from the signed session cookie
const PERSON_FIELDS = {
  name: 120, role: 120, profileType: 20, country: 80, city: 80,
  x: 80, telegram: 80, linkedin: 160, lookingFor: 1200,
};
const PROJECT_FIELDS = { name: 160, oneLiner: 280, customer: 200, lookingFor: 500 };

function cleanText(body, fields) {
  const out = {};
  for (const [field, max] of Object.entries(fields)) {
    const v = body[field];
    if (typeof v === 'string') out[field] = v.trim().slice(0, max);
  }
  return out;
}

function cleanStringArray(arr, maxLen, maxItems) {
  if (!Array.isArray(arr)) return undefined;
  return arr
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, maxItems);
}

function cleanPerson(body) {
  const p = cleanText(body, PERSON_FIELDS);
  // handles are stored bare — the UI draws the @
  if (p.x) p.x = p.x.replace(/@/g, '');
  if (p.telegram) p.telegram = p.telegram.replace(/@/g, '');
  // city coordinates, geocoded client-side at save time
  if (Number.isFinite(body.lat) && Math.abs(body.lat) <= 90) p.lat = body.lat;
  if (Number.isFinite(body.lon) && Math.abs(body.lon) <= 180) p.lon = body.lon;
  return p;
}

function cleanProject(body) {
  const p = cleanText(body, PROJECT_FIELDS);
  const categories = cleanStringArray(body.categories, 60, 4);
  if (categories) p.categories = categories;
  const links = cleanStringArray(body.links, 300, 5);
  if (links) p.links = links;
  return p;
}

async function sendEmail(resendKey, to, subject, html) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || 'Stellar Summit Connect <esteban@paltalabs.io>',
      to: [to], subject, html,
    }),
  });
}

function savePhoto(id, dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  // remove any previous photo with a different extension
  for (const old of ['jpg', 'png', 'webp']) {
    const oldFile = path.join(PHOTOS_DIR, `${id}.${old}`);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }
  const file = `${id}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, file), buf);
  return `/photos/${file}`;
}

function publicPerson(p) {
  const { token, ...rest } = p;
  return rest;
}

// ---------- AI matchmaking helpers ----------

const matchCache = new Map(); // personId → {at, data}
const MATCH_TTL_MS = 10 * 60 * 1000;

function matchBlurb(p) {
  const projects = state.projects
    .filter((pr) => pr.members.includes(p.id))
    .map((pr) => ({
      name: pr.name, oneLiner: pr.oneLiner, categories: pr.categories,
      customer: pr.customer, lookingFor: pr.lookingFor,
    }));
  return {
    id: p.id, name: p.name, role: p.role, profile: p.profileType,
    location: [p.city, p.country].filter(Boolean).join(', '),
    lookingFor: p.lookingFor, projects,
  };
}

// ---------- stats ----------

function computeStats() {
  const people = state.people;
  const conns = state.connections;

  const byCategory = {};
  const byCountry = {};
  const byProfileType = { Technical: 0, Business: 0, Both: 0 };
  for (const p of people) {
    if (p.country) byCountry[p.country] = (byCountry[p.country] || 0) + 1;
    if (p.profileType && byProfileType[p.profileType] !== undefined) byProfileType[p.profileType]++;
  }
  for (const pr of state.projects) {
    for (const cat of pr.categories || []) byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  const pairKey = (a, b) => [a, b].sort().join('|');
  const pairs = new Set();
  const mutual = new Set();
  const perPerson = {};
  for (const c of conns) {
    pairs.add(pairKey(c.from, c.to));
    perPerson[c.from] = (perPerson[c.from] || 0) + 1;
    perPerson[c.to] = (perPerson[c.to] || 0) + 1;
    if (conns.some((o) => o.from === c.to && o.to === c.from)) mutual.add(pairKey(c.from, c.to));
  }

  const topConnectors = Object.entries(perPerson)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const triesPerProject = {};
  for (const t of state.tries) triesPerProject[t.to] = (triesPerProject[t.to] || 0) + 1;
  const topTried = Object.entries(triesPerProject)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    totalPeople: people.length,
    totalProjects: state.projects.length,
    totalConnections: pairs.size,
    mutualConnections: mutual.size,
    totalTries: state.tries.length,
    totalQuestions: state.questions.length,
    answeredQuestions: state.questions.filter((q) => q.answers.length).length,
    countries: Object.keys(byCountry).length,
    byCategory,
    byCountry,
    byProfileType,
    topConnectors,
    topTried,
    recentConnections: conns.slice(-12).reverse(),
  };
}

// ---------- http helpers ----------

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function serveFile(res, baseDir, relPath) {
  const file = path.join(baseDir, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(baseDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    // the emailed magic link arrives without the event-key header; the signed
    // token in it is its own proof
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/verify'
        && req.headers['x-event-key'] !== ACCESS_KEY) {
      return sendJson(res, 401, { error: 'wrong event password' });
    }

    // ---------- auth ----------

    if (route === 'POST /api/auth/request-link') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJson(res, 400, { error: 'that does not look like an email address' });
      }
      const token = makeToken('link', { e: email }, LINK_TTL_MS);
      const origin = process.env.SITE_URL ||
        `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
      const link = `${origin}/api/auth/verify?token=${token}`;

      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        console.log(`✦ magic link for ${email}: ${link}`);
        return sendJson(res, 200, {
          ok: true, devLink: link,
          note: 'RESEND_API_KEY is not set — link returned directly (dev mode)',
        });
      }
      const r = await sendEmail(resendKey, email, 'Your Stellar Summit Connect sign-in link', `
        <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px 0;color:#1a1a1a">
          <h2 style="margin:0 0 12px">✦ Stellar Summit Connect</h2>
          <p>Click the button below to sign in. The link is valid for 15 minutes.</p>
          <p style="margin:24px 0">
            <a href="${link}" style="background:#2a78d6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;display:inline-block;font-weight:600">Sign in ✦</a>
          </p>
          <p style="color:#7d8b8d;font-size:13px">If you didn't request this, you can ignore this email.</p>
        </div>`);
      if (!r.ok) {
        console.error('Resend error', r.status, await r.text().catch(() => ''));
        return sendJson(res, 502, { error: 'could not send the email, try again in a minute' });
      }
      return sendJson(res, 200, { ok: true, message: 'Link sent — check your inbox.' });
    }

    if (route === 'GET /api/auth/verify') {
      const data = readToken('link', url.searchParams.get('token'));
      if (!data) { res.writeHead(302, { Location: '/#join' }); return res.end(); }
      const session = makeToken('sess', { e: data.e }, SESSION_TTL_MS);
      const maxAge = Math.floor(SESSION_TTL_MS / 1000);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.writeHead(302, {
        'Set-Cookie': [
          `ssc_session=${session}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`,
          `ssc_email=${encodeURIComponent(data.e)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`,
        ],
        Location: '/#join',
      });
      return res.end();
    }

    if (route === 'GET /api/auth/me') {
      const email = sessionEmail(req);
      if (!email) return sendJson(res, 401, { error: 'not signed in' });
      const person = state.people.find((p) => (p.email || '').toLowerCase() === email) || null;
      return sendJson(res, 200, { email, person: person && publicPerson(person) });
    }

    if (route === 'POST /api/auth/logout') {
      res.writeHead(200, {
        'Set-Cookie': [
          'ssc_session=; Max-Age=0; Path=/',
          'ssc_email=; Max-Age=0; Path=/',
        ],
        'Content-Type': 'application/json',
      });
      return res.end('{"ok":true}');
    }

    // ---------- people ----------

    if (route === 'GET /api/people') {
      return sendJson(res, 200, { people: state.people.map(publicPerson) });
    }

    // upsert: your session email is your identity — you always edit yourself
    if (route === 'POST /api/people') {
      const email = sessionEmail(req);
      if (!email) return sendJson(res, 401, { error: 'sign in first (magic link)' });
      const body = await readBody(req);
      const updates = cleanPerson(body);
      if (!updates.name) return sendJson(res, 400, { error: 'name is required' });
      let person = state.people.find((p) => (p.email || '').toLowerCase() === email);
      let created = false;
      if (!person) {
        person = { id: crypto.randomUUID(), email, createdAt: new Date().toISOString() };
        state.people.push(person);
        created = true;
      }
      Object.assign(person, updates);
      const photoUrl = savePhoto(person.id, body.photo);
      if (photoUrl) person.photoUrl = photoUrl;
      persist();
      return sendJson(res, created ? 201 : 200, { person: publicPerson(person) });
    }

    if (route === 'GET /api/projects') {
      return sendJson(res, 200, { projects: state.projects });
    }

    if (route === 'POST /api/projects') {
      const person = sessionPerson(req);
      if (!person) return sendJson(res, 401, { error: 'sign in and create your profile first' });
      const body = await readBody(req);
      const project = cleanProject(body);
      if (!project.name) return sendJson(res, 400, { error: 'project name is required' });
      project.id = crypto.randomUUID();
      project.createdBy = person.id;
      project.members = [person.id];
      project.createdAt = new Date().toISOString();
      const imageUrl = savePhoto(`proj-${project.id}`, body.image);
      if (imageUrl) project.imageUrl = imageUrl;
      const iconUrl = savePhoto(`icon-${project.id}`, body.icon);
      if (iconUrl) project.iconUrl = iconUrl;
      state.projects.push(project);
      persist();
      return sendJson(res, 201, { project });
    }

    const projMatch = url.pathname.match(/^\/api\/projects\/([\w-]+)(?:\/(join|leave))?$/);
    if (projMatch && (req.method === 'PUT' || req.method === 'POST')) {
      const project = state.projects.find((x) => x.id === projMatch[1]);
      if (!project) return sendJson(res, 404, { error: 'project not found' });
      const person = sessionPerson(req);
      if (!person) return sendJson(res, 401, { error: 'sign in and create your profile first' });
      const body = await readBody(req);
      const action = projMatch[2];

      if (req.method === 'POST' && action === 'join') {
        if (!project.members.includes(person.id)) { project.members.push(person.id); persist(); }
        return sendJson(res, 200, { project });
      }
      if (req.method === 'POST' && action === 'leave') {
        project.members = project.members.filter((m) => m !== person.id);
        if (!project.members.length) state.projects = state.projects.filter((x) => x.id !== project.id);
        persist();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'PUT' && !action) {
        if (project.createdBy !== person.id) return sendJson(res, 403, { error: 'only the project creator can edit it' });
        const updates = cleanProject(body);
        if (!updates.name) return sendJson(res, 400, { error: 'project name is required' });
        Object.assign(project, updates);
        const imageUrl = savePhoto(`proj-${project.id}`, body.image);
        if (imageUrl) project.imageUrl = imageUrl;
        const iconUrl = savePhoto(`icon-${project.id}`, body.icon);
        if (iconUrl) project.iconUrl = iconUrl;
        persist();
        return sendJson(res, 200, { project });
      }
    }

    if (route === 'POST /api/connections') {
      const from = sessionPerson(req);
      if (!from) return sendJson(res, 401, { error: 'sign in and create your profile first' });
      const body = await readBody(req);
      const to = state.people.find((x) => x.id === body.to);
      if (!to) return sendJson(res, 404, { error: 'person not found' });
      if (from.id === to.id) return sendJson(res, 400, { error: 'cannot connect to yourself' });
      if (!state.connections.some((c) => c.from === from.id && c.to === to.id)) {
        state.connections.push({ from: from.id, to: to.id, at: new Date().toISOString() });
        persist();
      }
      return sendJson(res, 201, { ok: true });
    }

    if (route === 'GET /api/connections') {
      return sendJson(res, 200, { connections: state.connections });
    }

    if (route === 'POST /api/tries') {
      const from = sessionPerson(req);
      if (!from) return sendJson(res, 401, { error: 'sign in and create your profile first' });
      const body = await readBody(req);
      const project = state.projects.find((x) => x.id === body.to);
      if (!project) return sendJson(res, 404, { error: 'project not found' });
      if (project.members.includes(from.id)) return sendJson(res, 400, { error: 'cannot try your own project' });
      const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 280) : '';
      const existing = state.tries.find((t) => t.from === from.id && t.to === project.id);
      if (existing) {
        if (comment) existing.comment = comment;
      } else {
        state.tries.push({ from: from.id, to: project.id, comment, at: new Date().toISOString() });
      }
      persist();
      return sendJson(res, 201, { ok: true });
    }

    if (route === 'GET /api/tries') {
      return sendJson(res, 200, { tries: state.tries });
    }

    // ---------- public Q&A on people and projects ----------

    if (route === 'GET /api/questions') {
      return sendJson(res, 200, { questions: state.questions });
    }

    if (route === 'POST /api/questions') {
      const from = sessionPerson(req);
      if (!from) return sendJson(res, 401, { error: 'sign in and create your profile first' });
      const body = await readBody(req);
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : '';
      if (!text) return sendJson(res, 400, { error: 'question text is required' });
      const targetType = body.targetType === 'project' ? 'project' : 'person';
      const target = targetType === 'project'
        ? state.projects.find((x) => x.id === body.targetId)
        : state.people.find((x) => x.id === body.targetId);
      if (!target) return sendJson(res, 404, { error: 'target not found' });
      if (targetType === 'person' && target.id === from.id) {
        return sendJson(res, 400, { error: 'cannot ask yourself' });
      }
      const q = {
        id: crypto.randomUUID(), targetType, targetId: target.id,
        from: from.id, text, at: new Date().toISOString(), answers: [],
      };
      state.questions.push(q);
      persist();
      return sendJson(res, 201, { question: q });
    }

    const qMatch = url.pathname.match(/^\/api\/questions\/([\w-]+)(?:\/(answers))?$/);
    if (qMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      const q = state.questions.find((x) => x.id === qMatch[1]);
      if (!q) return sendJson(res, 404, { error: 'question not found' });
      const person = sessionPerson(req);
      if (!person) return sendJson(res, 401, { error: 'sign in and create your profile first' });

      const ownsTarget = q.targetType === 'person'
        ? q.targetId === person.id
        : (state.projects.find((x) => x.id === q.targetId)?.members || []).includes(person.id);

      if (req.method === 'POST' && qMatch[2] === 'answers') {
        if (!ownsTarget) return sendJson(res, 403, { error: 'only the person/team asked can answer' });
        const body = await readBody(req);
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 800) : '';
        if (!text) return sendJson(res, 400, { error: 'answer text is required' });
        const mine = q.answers.find((a) => a.by === person.id);
        if (mine) { mine.text = text; mine.at = new Date().toISOString(); } // edit your answer
        else q.answers.push({ by: person.id, text, at: new Date().toISOString() });
        persist();
        return sendJson(res, 201, { question: q });
      }
      if (req.method === 'DELETE' && !qMatch[2]) {
        if (q.from !== person.id && !ownsTarget) {
          return sendJson(res, 403, { error: 'only the asker or the target can delete a question' });
        }
        state.questions = state.questions.filter((x) => x.id !== q.id);
        persist();
        return sendJson(res, 200, { ok: true });
      }
    }

    if (route === 'GET /api/stats') {
      return sendJson(res, 200, computeStats());
    }

    // ---------- AI matchmaking (OpenRouter, cheap model) ----------

    if (route === 'POST /api/match') {
      const person = sessionPerson(req);
      if (!person) return sendJson(res, 401, { error: 'sign in and create your profile first' });
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) return sendJson(res, 503, { error: 'AI matching is not configured on this server' });

      const cached = matchCache.get(person.id);
      if (cached && Date.now() - cached.at < MATCH_TTL_MS) {
        return sendJson(res, 200, { ...cached.data, cached: true });
      }
      const others = state.people.filter((p) => p.id !== person.id);
      if (others.length < 2) return sendJson(res, 400, { error: 'not enough builders on the board yet' });

      const model = process.env.AI_MODEL || 'google/gemini-2.5-flash';
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 2500,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are the matchmaking engine of Stellar Summit São Paulo, an event for builders on the Stellar blockchain. ' +
                'Given ME (a builder) and OTHERS (everyone else at the event, with their projects), pick the 3-5 people I should meet, best first. ' +
                'Match on complementarity: what I/my projects are LOOKING FOR vs what they/their projects offer, customer overlap, category synergy, technical<->business pairing, same city/country for follow-ups. ' +
                'Answer ONLY with JSON: {"matches":[{"personId":"<their id>","name":"<their name>","reason":"<2-3 concrete sentences citing both sides — why THIS person, mentioning their project and mine>","icebreaker":"<one specific, casual opening line I can literally say to them at the event>"}]} ' +
                'Reasons must be specific (never generic networking advice). Write reason and icebreaker in the same language ME writes in (Spanish/Portuguese/English).',
            },
            { role: 'user', content: `ME:\n${JSON.stringify(matchBlurb(person))}\n\nOTHERS:\n${JSON.stringify(others.map(matchBlurb))}` },
          ],
        }),
      });
      if (!r.ok) {
        console.error('OpenRouter error', r.status, await r.text().catch(() => ''));
        return sendJson(res, 502, { error: 'the AI is unavailable right now, try again in a minute' });
      }
      const data = await r.json();
      const text = data.choices?.[0]?.message?.content || '';
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim());
      } catch {
        console.error('OpenRouter unparseable output:', text.slice(0, 300));
        return sendJson(res, 502, { error: 'the AI returned something unreadable, try again' });
      }
      const matches = (Array.isArray(parsed.matches) ? parsed.matches : [])
        .filter((m) => m && state.people.some((p) => p.id === m.personId) && m.personId !== person.id)
        .slice(0, 5)
        .map((m) => ({
          personId: String(m.personId),
          reason: String(m.reason || '').slice(0, 600),
          icebreaker: String(m.icebreaker || '').slice(0, 300),
        }));
      const result = { matches, generatedAt: new Date().toISOString(), model };
      matchCache.set(person.id, { at: Date.now(), data: result });
      return sendJson(res, 200, result);
    }

    if (route === 'GET /api/export') {
      return sendJson(res, 200, {
        exportedAt: new Date().toISOString(),
        people: state.people.map(publicPerson),
        projects: state.projects,
        connections: state.connections,
        tries: state.tries,
        questions: state.questions,
        stats: computeStats(),
      });
    }

    if (route === 'GET /api/export/people.csv') {
      const cols = ['name', 'role', 'profileType', 'country', 'city', 'x', 'telegram', 'linkedin', 'email', 'lookingFor'];
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = state.people.map((p) => {
        const projs = state.projects.filter((pr) => pr.members.includes(p.id)).map((pr) => pr.name).join('; ');
        return [...cols.map((c) => cell(p[c])), cell(projs)].join(',');
      });
      const csv = [...cols, 'projects'].join(',') + '\n' + rows.join('\n') + '\n';
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="stellar-summit-people.csv"',
      });
      return res.end('\ufeff' + csv); // BOM so Excel opens accents correctly
    }

    if (req.method === 'GET' && url.pathname.startsWith('/photos/')) {
      return serveFile(res, PHOTOS_DIR, url.pathname.slice('/photos/'.length));
    }

    if (req.method === 'GET') {
      return serveFile(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    }

    res.writeHead(405); res.end('Method not allowed');
  } catch (err) {
    sendJson(res, 400, { error: err.message || 'bad request' });
  }
});

server.listen(PORT, () => {
  console.log(`✦ Stellar Summit Connect running at http://localhost:${PORT}`);
});
