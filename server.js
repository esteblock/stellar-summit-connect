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

fs.mkdirSync(PHOTOS_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const state = {
  people: readJson(PEOPLE_FILE, []),
  projects: readJson(PROJECTS_FILE, []),
  connections: readJson(CONN_FILE, []),
  tries: readJson(TRIES_FILE, []),
};

function persist() {
  fs.writeFileSync(PEOPLE_FILE, JSON.stringify(state.people, null, 2));
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(state.projects, null, 2));
  fs.writeFileSync(CONN_FILE, JSON.stringify(state.connections, null, 2));
  fs.writeFileSync(TRIES_FILE, JSON.stringify(state.tries, null, 2));
}

// ---------- sanitization ----------

const PERSON_FIELDS = {
  name: 120, role: 120, profileType: 20, country: 80, city: 80,
  x: 80, telegram: 80, email: 160, lookingFor: 1200,
};
const PROJECT_FIELDS = { name: 160, oneLiner: 280 };

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

// a mutating request must prove who it comes from: {personId, token}
function authedPerson(body) {
  const person = state.people.find((x) => x.id === body.personId);
  return person && body.token === person.token ? person : null;
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
    if (url.pathname.startsWith('/api/') && req.headers['x-event-key'] !== ACCESS_KEY) {
      return sendJson(res, 401, { error: 'wrong event password' });
    }

    if (route === 'GET /api/people') {
      return sendJson(res, 200, { people: state.people.map(publicPerson) });
    }

    if (route === 'POST /api/people') {
      const body = await readBody(req);
      const p = cleanPerson(body);
      if (!p.name) return sendJson(res, 400, { error: 'name is required' });
      p.id = crypto.randomUUID();
      p.token = crypto.randomBytes(16).toString('hex');
      p.createdAt = new Date().toISOString();
      const photoUrl = savePhoto(p.id, body.photo);
      if (photoUrl) p.photoUrl = photoUrl;
      state.people.push(p);
      persist();
      return sendJson(res, 201, { person: publicPerson(p), token: p.token });
    }

    const putMatch = url.pathname.match(/^\/api\/people\/([\w-]+)$/);
    if (req.method === 'PUT' && putMatch) {
      const person = state.people.find((x) => x.id === putMatch[1]);
      if (!person) return sendJson(res, 404, { error: 'not found' });
      const body = await readBody(req);
      if (body.token !== person.token) return sendJson(res, 403, { error: 'wrong token' });
      const updates = cleanPerson(body);
      if (!updates.name) return sendJson(res, 400, { error: 'name is required' });
      Object.assign(person, updates);
      const photoUrl = savePhoto(person.id, body.photo);
      if (photoUrl) person.photoUrl = photoUrl;
      persist();
      return sendJson(res, 200, { person: publicPerson(person) });
    }

    if (route === 'GET /api/projects') {
      return sendJson(res, 200, { projects: state.projects });
    }

    if (route === 'POST /api/projects') {
      const body = await readBody(req);
      const person = authedPerson(body);
      if (!person) return sendJson(res, 403, { error: 'join first (invalid person or token)' });
      const project = cleanProject(body);
      if (!project.name) return sendJson(res, 400, { error: 'project name is required' });
      project.id = crypto.randomUUID();
      project.createdBy = person.id;
      project.members = [person.id];
      project.createdAt = new Date().toISOString();
      const imageUrl = savePhoto(`proj-${project.id}`, body.image);
      if (imageUrl) project.imageUrl = imageUrl;
      state.projects.push(project);
      persist();
      return sendJson(res, 201, { project });
    }

    const projMatch = url.pathname.match(/^\/api\/projects\/([\w-]+)(?:\/(join|leave))?$/);
    if (projMatch && (req.method === 'PUT' || req.method === 'POST')) {
      const project = state.projects.find((x) => x.id === projMatch[1]);
      if (!project) return sendJson(res, 404, { error: 'project not found' });
      const body = await readBody(req);
      const person = authedPerson(body);
      if (!person) return sendJson(res, 403, { error: 'join first (invalid person or token)' });
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
        if (!project.members.includes(person.id)) return sendJson(res, 403, { error: 'only team members can edit' });
        const updates = cleanProject(body);
        if (!updates.name) return sendJson(res, 400, { error: 'project name is required' });
        Object.assign(project, updates);
        const imageUrl = savePhoto(`proj-${project.id}`, body.image);
        if (imageUrl) project.imageUrl = imageUrl;
        persist();
        return sendJson(res, 200, { project });
      }
    }

    if (route === 'POST /api/connections') {
      const body = await readBody(req);
      const from = state.people.find((x) => x.id === body.from);
      const to = state.people.find((x) => x.id === body.to);
      if (!from || !to) return sendJson(res, 404, { error: 'person not found' });
      if (from.id === to.id) return sendJson(res, 400, { error: 'cannot connect to yourself' });
      if (body.token !== from.token) return sendJson(res, 403, { error: 'wrong token' });
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
      const body = await readBody(req);
      const from = authedPerson({ personId: body.from, token: body.token });
      const project = state.projects.find((x) => x.id === body.to);
      if (!from || !project) return sendJson(res, 404, { error: 'person or project not found' });
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

    if (route === 'GET /api/stats') {
      return sendJson(res, 200, computeStats());
    }

    if (route === 'GET /api/export') {
      return sendJson(res, 200, {
        exportedAt: new Date().toISOString(),
        people: state.people.map(publicPerson),
        projects: state.projects,
        connections: state.connections,
        tries: state.tries,
        stats: computeStats(),
      });
    }

    if (route === 'GET /api/export/people.csv') {
      const cols = ['name', 'role', 'profileType', 'country', 'city', 'x', 'telegram', 'email', 'lookingFor'];
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
