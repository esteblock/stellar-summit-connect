/* Stellar Summit Connect — frontend (no dependencies) */

const CATEGORIES = [
  'DeFi',
  'Payments & Remittances',
  'RWA & Tokenization',
  'Wallets & On/Off-ramps',
  'Infrastructure & Dev Tools',
  'AI x Web3',
  'NFTs & Gaming',
  'Social & Community',
  'Security & Auditing',
  'Financial Inclusion & Impact',
  'Education',
  'Other',
];

const AVATAR_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

const state = {
  people: [],
  tries: [],
  me: JSON.parse(localStorage.getItem('ssc-me') || 'null'), // {id, token}
  myConnections: new Set(JSON.parse(localStorage.getItem('ssc-conns') || '[]')),
  myTries: new Set(JSON.parse(localStorage.getItem('ssc-tries') || '[]')),
  photoDataUrl: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/* ---------- navigation ---------- */

function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (view === 'builders') loadPeople();
  if (view === 'metrics') loadMetrics();
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => show(b.dataset.goto)));

/* ---------- helpers ---------- */

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function initials(name) {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function avatarColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function avatarHtml(p, cls = 'avatar') {
  if (p.photoUrl) return `<img class="${cls}" src="${esc(p.photoUrl)}" alt="" loading="lazy" />`;
  return `<div class="${cls}" style="background:${avatarColor(p.name || '?')}">${esc(initials(p.name || '?'))}</div>`;
}

function handleUrl(kind, value) {
  const h = value.replace(/^@/, '').trim();
  if (!h) return null;
  if (kind === 'x') return `https://x.com/${encodeURIComponent(h)}`;
  if (kind === 'telegram') return `https://t.me/${encodeURIComponent(h)}`;
  return null;
}

function normalizeLink(l) {
  return /^https?:\/\//i.test(l) ? l : `https://${l}`;
}

async function api(path, opts) {
  const res = await fetch(path, opts && {
    method: opts.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

/* ---------- builders dashboard ---------- */

async function loadPeople() {
  const [{ people }, { tries }] = await Promise.all([api('/api/people'), api('/api/tries')]);
  state.people = people;
  state.tries = tries;
  fillFilterOptions();
  renderCards();
}

function fillFilterOptions() {
  const catSel = $('#filter-category');
  const countrySel = $('#filter-country');
  const keep = (sel) => sel.value;
  const cats = [...new Set(state.people.map((p) => p.category).filter(Boolean))].sort();
  const countries = [...new Set(state.people.map((p) => p.country).filter(Boolean))].sort();
  const build = (sel, items, allLabel) => {
    const prev = keep(sel);
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      items.map((c) => `<option${c === prev ? ' selected' : ''}>${esc(c)}</option>`).join('');
  };
  build(catSel, cats, 'All categories');
  build(countrySel, countries, 'All countries');
}

function matchesFilters(p) {
  const q = $('#search').value.trim().toLowerCase();
  const cat = $('#filter-category').value;
  const type = $('#filter-type').value;
  const country = $('#filter-country').value;
  if (cat && p.category !== cat) return false;
  if (type && p.profileType !== type) return false;
  if (country && p.country !== country) return false;
  if (q) {
    const hay = [p.name, p.project, p.oneLiner, p.role, p.lookingFor, p.category, p.city, p.country]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderCards() {
  const visible = state.people.filter(matchesFilters);
  $('#builders-count').textContent =
    `${visible.length} builder${visible.length === 1 ? '' : 's'}` +
    (visible.length !== state.people.length ? ` (of ${state.people.length})` : '');
  $('#empty-state').classList.toggle('hidden', state.people.length > 0);
  $('#cards').innerHTML = visible.map(cardHtml).join('');

  document.querySelectorAll('[data-connect]').forEach((btn) =>
    btn.addEventListener('click', () => connect(btn.dataset.connect, btn)));
  document.querySelectorAll('[data-try]').forEach((btn) =>
    btn.addEventListener('click', () => markTried(btn.dataset.try, btn)));
}

function cardHtml(p) {
  const place = [p.city, p.country].filter(Boolean).join(', ');
  const contacts = [
    p.x && `<a href="${esc(handleUrl('x', p.x))}" target="_blank" rel="noopener" title="X / Twitter">𝕏 ${esc(p.x.replace(/^@/, ''))}</a>`,
    p.telegram && `<a href="${esc(handleUrl('telegram', p.telegram))}" target="_blank" rel="noopener" title="Telegram">✈ ${esc(p.telegram.replace(/^@/, ''))}</a>`,
    p.email && `<a href="mailto:${esc(p.email)}" title="Email">✉</a>`,
  ].filter(Boolean).join('');

  const links = (p.links || []).map((l) =>
    `<a href="${esc(normalizeLink(l))}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//, ''))}</a>`).join('');

  const isMe = state.me && state.me.id === p.id;
  const connected = state.myConnections.has(p.id);
  let action = '';
  if (isMe) {
    action = `<button class="btn ghost small" data-goto="join">Edit my profile</button>`;
  } else if (connected) {
    action = `<button class="btn small connected" disabled>Connected ✓</button>`;
  } else {
    action = `<button class="btn small primary" data-connect="${esc(p.id)}">Connect ✦</button>`;
  }

  // "try their app" block: link to open it + record that you tried it + feedback quotes
  const projectTries = state.tries.filter((t) => t.to === p.id);
  const quotes = projectTries.filter((t) => t.comment).slice(-2).map((t) => {
    const who = state.people.find((x) => x.id === t.from);
    return `<blockquote class="try-quote">“${esc(t.comment)}”${who ? ` <span>— ${esc(who.name)}</span>` : ''}</blockquote>`;
  }).join('');
  let tryBlock = '';
  if (!isMe && (p.links || []).length) {
    const tried = state.myTries.has(p.id);
    tryBlock = `<div class="try-row">
      <a class="btn small" href="${esc(normalizeLink(p.links[0]))}" target="_blank" rel="noopener">Try it 🚀</a>
      ${tried
        ? `<button class="btn small connected" disabled>Tried 🧪✓</button>`
        : `<button class="btn small ghost" data-try="${esc(p.id)}">I tried it 🧪</button>`}
      ${projectTries.length ? `<span class="try-count">${projectTries.length} tried it</span>` : ''}
    </div>${quotes}`;
  } else if (projectTries.length) {
    tryBlock = `<div class="try-row"><span class="try-count">🧪 ${projectTries.length} tried this project</span></div>${quotes}`;
  }

  return `<article class="card">
    <div class="card-head">
      ${avatarHtml(p)}
      <div class="card-head-info">
        <div class="card-name">${esc(p.name)}${isMe ? ' <span style="color:var(--ink-muted);font-weight:400">(you)</span>' : ''}</div>
        ${p.role ? `<div class="card-role">${esc(p.role)}</div>` : ''}
        ${place ? `<div class="card-place">📍 ${esc(place)}</div>` : ''}
      </div>
    </div>
    <div class="badges">
      ${p.category ? `<span class="badge cat">${esc(p.category)}</span>` : ''}
      ${p.profileType ? `<span class="badge type-${esc(p.profileType)}">${esc(p.profileType)}</span>` : ''}
    </div>
    ${p.project ? `<div class="card-project"><strong>${esc(p.project)}</strong></div>` : ''}
    ${p.oneLiner ? `<div class="card-oneliner">${esc(p.oneLiner)}</div>` : ''}
    ${p.lookingFor ? `<div class="looking-for"><b>Looking for</b>${esc(p.lookingFor)}</div>` : ''}
    ${links ? `<div class="card-links">${links}</div>` : ''}
    ${tryBlock}
    <div class="card-foot">
      <div class="contact-icons">${contacts}</div>
      ${action}
    </div>
  </article>`;
}

async function connect(toId, btn) {
  if (!state.me) {
    toast('Join first so people know who wants to connect ✦');
    show('join');
    return;
  }
  try {
    await api('/api/connections', { body: { from: state.me.id, to: toId, token: state.me.token } });
    state.myConnections.add(toId);
    localStorage.setItem('ssc-conns', JSON.stringify([...state.myConnections]));
    btn.outerHTML = `<button class="btn small connected" disabled>Connected ✓</button>`;
    toast('Connection recorded — reach out via their contact links!');
  } catch (e) {
    toast(e.message);
  }
}

async function markTried(toId, btn) {
  if (!state.me) {
    toast('Join first so we know who tried it ✦');
    show('join');
    return;
  }
  const comment = window.prompt('Nice! Any quick feedback for them? (optional)') || '';
  try {
    await api('/api/tries', { body: { from: state.me.id, to: toId, token: state.me.token, comment } });
    state.myTries.add(toId);
    localStorage.setItem('ssc-tries', JSON.stringify([...state.myTries]));
    toast('Recorded — thanks for trying their project! 🧪');
    loadPeople();
  } catch (e) {
    toast(e.message);
  }
}

['#search', '#filter-category', '#filter-type', '#filter-country'].forEach((sel) =>
  $(sel).addEventListener('input', renderCards));

/* ---------- join form ---------- */

const form = $('#join-form');
$('#category-select').innerHTML =
  '<option value="">Pick a category…</option>' + CATEGORIES.map((c) => `<option>${c}</option>`).join('');

$('#add-link').addEventListener('click', () => {
  if (document.querySelectorAll('.link-input').length >= 5) return;
  const label = document.createElement('label');
  label.innerHTML = '<input class="link-input" maxlength="300" placeholder="https://…" />';
  $('#links-wrap').appendChild(label);
});

$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.photoDataUrl = await resizeImage(file, 640);
  const prev = $('#photo-preview');
  prev.style.backgroundImage = `url(${state.photoDataUrl})`;
  prev.textContent = '';
});

function resizeImage(file, maxSide) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('#form-status');
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  body.links = [...document.querySelectorAll('.link-input')].map((i) => i.value.trim()).filter(Boolean);
  if (state.photoDataUrl) body.photo = state.photoDataUrl;

  const btn = $('#submit-btn');
  btn.disabled = true;
  status.className = 'form-status';
  status.textContent = 'Saving…';
  try {
    if (state.me) {
      body.token = state.me.token;
      await api(`/api/people/${state.me.id}`, { method: 'PUT', body });
      toast('Profile updated ✦');
    } else {
      const { person, token } = await api('/api/people', { body });
      state.me = { id: person.id, token };
      localStorage.setItem('ssc-me', JSON.stringify(state.me));
      toast('Welcome to the constellation ✦');
    }
    status.classList.add('ok');
    status.textContent = 'Saved!';
    show('builders');
  } catch (err) {
    status.classList.add('err');
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

async function prefillMyProfile() {
  if (!state.me) return;
  try {
    const { people } = await api('/api/people');
    const me = people.find((p) => p.id === state.me.id);
    if (!me) { // server data was reset — start fresh
      state.me = null;
      localStorage.removeItem('ssc-me');
      return;
    }
    $('#form-title').textContent = 'Edit your profile';
    $('#submit-btn').textContent = 'Update profile ✦';
    for (const [k, v] of Object.entries(me)) {
      const input = form.elements[k];
      if (input && typeof v === 'string') {
        if (input instanceof RadioNodeList) input.value = v;
        else input.value = v;
      }
    }
    const linkInputs = () => [...document.querySelectorAll('.link-input')];
    (me.links || []).forEach((l, i) => {
      if (!linkInputs()[i]) $('#add-link').click();
      linkInputs()[i].value = l;
    });
    if (me.photoUrl) {
      const prev = $('#photo-preview');
      prev.style.backgroundImage = `url(${me.photoUrl})`;
      prev.textContent = '';
    }
  } catch { /* offline or server restarting — leave the blank form */ }
}

/* ---------- metrics ---------- */

async function loadMetrics() {
  const [stats, { people }] = await Promise.all([api('/api/stats'), api('/api/people')]);
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  $('#stat-tiles').innerHTML = [
    [stats.totalPeople, 'Builders'],
    [stats.totalConnections, 'Connections'],
    [stats.mutualConnections, 'Mutual matches'],
    [stats.totalTries, 'Projects tried'],
    [stats.countries, 'Countries'],
  ].map(([v, label]) =>
    `<div class="tile"><div class="tile-value">${v}</div><div class="tile-label">${label}</div></div>`).join('');

  // Builders by category — single-hue horizontal bars, direct value labels
  const cats = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(([, n]) => n));
  $('#chart-category').innerHTML = cats.length
    ? cats.map(([cat, n]) => `<div class="hbar-row" title="${esc(cat)}: ${n}">
        <div class="hbar-label">${esc(cat)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(n / max) * 100}%"></div></div>
        <div class="hbar-value">${n}</div>
      </div>`).join('')
    : '<p class="count-line">No data yet.</p>';

  // Technical vs Business — segmented bar + legend (identity never color-alone)
  const pt = stats.byProfileType;
  const segs = [
    ['Technical', pt.Technical, 'var(--series-1)'],
    ['Business', pt.Business, 'var(--series-2)'],
    ['Both', pt.Both, 'var(--series-3)'],
  ].filter(([, n]) => n > 0);
  const totalPt = segs.reduce((s, [, n]) => s + n, 0);
  $('#chart-type').innerHTML = totalPt
    ? `<div class="split-bar">${segs.map(([label, n, color]) =>
        `<div class="split-seg" style="width:${(n / totalPt) * 100}%;background:${color}" title="${label}: ${n}"></div>`).join('')}</div>
      <div class="legend">${segs.map(([label, n, color]) =>
        `<div class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label} · ${n}</div>`).join('')}</div>`
    : '<p class="count-line">No data yet.</p>';

  // Most connected
  $('#top-connectors').innerHTML = stats.topConnectors.length
    ? stats.topConnectors.map(({ id, count }) => {
        const p = byId[id];
        if (!p) return '';
        return `<li>${avatarHtml(p)}<span>${esc(p.name)}</span>
          <span class="conn-count">${count} connection${count === 1 ? '' : 's'}</span></li>`;
      }).join('')
    : '<li class="count-line">No connections yet — hit “Connect ✦” on someone’s card!</li>';

  // Most tried projects
  $('#top-tried').innerHTML = stats.topTried.length
    ? stats.topTried.map(({ id, count }) => {
        const p = byId[id];
        if (!p) return '';
        return `<li>${avatarHtml(p)}<span>${esc(p.project || p.name)}</span>
          <span class="conn-count">🧪 ${count}</span></li>`;
      }).join('')
    : '<li class="count-line">Try someone’s app and hit “I tried it 🧪”!</li>';

  // Recent connections feed
  $('#recent-connections').innerHTML = stats.recentConnections.length
    ? stats.recentConnections.map((c) => {
        const a = byId[c.from]; const b = byId[c.to];
        if (!a || !b) return '';
        const t = new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<li>${esc(a.name)}<span class="conn-arrow">→✦←</span>${esc(b.name)}<time>${t}</time></li>`;
      }).join('')
    : '<li class="count-line">Connections will show up here.</li>';
}

/* ---------- boot ---------- */

const initialView = ['builders', 'join', 'metrics'].includes(location.hash.slice(1))
  ? location.hash.slice(1) : 'builders';
show(initialView);
loadPeople().then(prefillMyProfile);
setInterval(() => {
  const active = document.querySelector('.tab.active')?.dataset.view;
  if (active === 'builders') loadPeople();
  if (active === 'metrics') loadMetrics();
}, 20000); // live-ish refresh while projected on a screen
