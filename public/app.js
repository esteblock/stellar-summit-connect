/* Stellar Summit Connect — frontend (no build step) */

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

// foil gradient pair per category — the holo-card signature is keyed to what the project IS
const CATEGORY_HUES = {
  'DeFi': ['#3987e5', '#9085e9'],
  'Payments & Remittances': ['#199e70', '#3987e5'],
  'RWA & Tokenization': ['#c98500', '#d95926'],
  'Wallets & On/Off-ramps': ['#3987e5', '#199e70'],
  'Infrastructure & Dev Tools': ['#9085e9', '#3987e5'],
  'AI x Web3': ['#d55181', '#9085e9'],
  'NFTs & Gaming': ['#d55181', '#c98500'],
  'Social & Community': ['#d95926', '#d55181'],
  'Security & Auditing': ['#e66767', '#c98500'],
  'Financial Inclusion & Impact': ['#199e70', '#c98500'],
  'Education': ['#3987e5', '#d55181'],
  'Other': ['#898781', '#c3c2b7'],
};

const state = {
  people: [],
  projects: [],
  tries: [],
  questions: [],
  key: localStorage.getItem('ssc-key') || '',
  me: null, // {email, id?} — set by /api/auth/me (signed session cookie)
  myConnections: new Set(JSON.parse(localStorage.getItem('ssc-conns') || '[]')),
  myTries: new Set(JSON.parse(localStorage.getItem('ssc-tries') || '[]')),
  photoDataUrl: null,
  pickedGeo: null, // {lat, lon} of the clicked city suggestion
  initialProjectIds: [],
  map: null,
  mapMarkers: null,
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
  if (view === 'builders' || view === 'projects') loadData();
  if (view === 'metrics') loadMetrics();
  if (view === 'map') loadData().then(renderMap);
  if (view === 'constellation') loadData().then(renderConstellation);
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

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
  if (kind === 'linkedin') {
    if (/^https?:\/\//i.test(h)) return h;
    if (h.includes('linkedin.com')) return `https://${h}`;
    return `https://www.linkedin.com/${h.startsWith('in/') || h.startsWith('company/') ? h : `in/${h}`}`;
  }
  return null;
}

function normalizeLink(l) {
  return /^https?:\/\//i.test(l) ? l : `https://${l}`;
}

function projectImage(pr) {
  if (pr.imageUrl) return pr.imageUrl;
  if (pr.links && pr.links.length) {
    // free keyless screenshot of the landing page (first load shows "generating…")
    return `https://s0.wp.com/mshots/v1/${encodeURIComponent(normalizeLink(pr.links[0]))}?w=640`;
  }
  return null;
}

function membersOf(pr) {
  return pr.members.map((id) => state.people.find((p) => p.id === id)).filter(Boolean);
}

function projectsOf(personId) {
  return state.projects.filter((pr) => pr.members.includes(personId));
}

async function api(path, opts) {
  const res = await fetch(path, {
    method: opts ? (opts.method || 'POST') : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-event-key': state.key },
    body: opts ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === 'wrong event password') {
    showGate();
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

// requires a signed-in user WITH a saved profile; routes to the right step if not
function requireProfile() {
  if (state.me && state.me.id) return true;
  toast(state.me ? 'Save your profile first ✦' : 'Sign in with your email first ✦');
  show('join');
  return false;
}

/* ---------- event password gate ---------- */

function showGate() {
  $('#gate').classList.remove('hidden');
  startLandingCanvas();
  $('#gate-input').focus();
}

/* landing hero: a drifting particle constellation — the product, as decoration */
let landingRaf = null;
function startLandingCanvas() {
  const canvas = $('#landing-canvas');
  if (!canvas || landingRaf) return;
  const ctx = canvas.getContext('2d');
  const dots = Array.from({ length: 42 }, () => ({
    x: Math.random(), y: Math.random(),
    vx: (Math.random() - 0.5) * 0.0006, vy: (Math.random() - 0.5) * 0.0006,
    tw: Math.random() * 6.28,
  }));
  let t = 0;
  const step = () => {
    if ($('#gate').classList.contains('hidden')) { landingRaf = null; return; }
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, w, h);
    t++;
    for (const d of dots) {
      d.x = (d.x + d.vx + 1) % 1;
      d.y = (d.y + d.vy + 1) % 1;
    }
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = (dots[i].x - dots[j].x) * w, dy = (dots[i].y - dots[j].y) * h;
        const dist = Math.hypot(dx, dy);
        if (dist < 130) {
          ctx.strokeStyle = `rgba(57,135,229,${(0.22 * (1 - dist / 130)).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(dots[i].x * w, dots[i].y * h);
          ctx.lineTo(dots[j].x * w, dots[j].y * h);
          ctx.stroke();
        }
      }
    }
    for (const d of dots) {
      const a = 0.45 + 0.35 * Math.sin(t / 50 + d.tw);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, 1.4, 0, 6.29);
      ctx.fill();
    }
    landingRaf = requestAnimationFrame(step);
  };
  landingRaf = requestAnimationFrame(step);
}

$('#gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  state.key = $('#gate-input').value.trim();
  localStorage.setItem('ssc-key', state.key);
  try {
    await loadData();
    $('#gate').classList.add('hidden');
    await fetchMe();
    prefillMyProfile();
    show(initialView);
  } catch {
    $('#gate-status').textContent = 'Wrong password — ask the organizers ✦';
  }
});

async function loadData() {
  const [{ people }, { projects }, { tries }, { questions }] = await Promise.all([
    api('/api/people'), api('/api/projects'), api('/api/tries'), api('/api/questions'),
  ]);
  state.people = people;
  state.projects = projects;
  state.tries = tries;
  state.questions = questions;
  fillFilterOptions();
  renderCards();
  renderProjectCards();
  refreshExistingOptions();
}

async function fetchMe() {
  try {
    const { email, person } = await api('/api/auth/me');
    state.me = { email, id: person ? person.id : null };
  } catch {
    state.me = null; // not signed in
  }
  updateJoinView();
}

/* ---------- shared project widgets (used in both card views) ---------- */

function tryRowHtml(pr) {
  const projectTries = state.tries.filter((t) => t.to === pr.id);
  const amMember = state.me && pr.members.includes(state.me.id);
  const quotes = projectTries.filter((t) => t.comment).slice(-2).map((t) => {
    const who = state.people.find((x) => x.id === t.from);
    return `<blockquote class="try-quote">“${esc(t.comment)}”${who ? ` <span>— ${esc(who.name)}</span>` : ''}</blockquote>`;
  }).join('');

  const parts = [];
  if (pr.links && pr.links.length) {
    parts.push(`<a class="btn small" href="${esc(normalizeLink(pr.links[0]))}" target="_blank" rel="noopener">Try it 🚀</a>`);
    if (!amMember) {
      parts.push(state.myTries.has(pr.id)
        ? `<button class="btn small connected" disabled>Tried 🧪✓</button>`
        : `<button class="btn small ghost" data-try="${esc(pr.id)}">I tried it 🧪</button>`);
    }
  }
  if (!amMember) parts.push(`<button class="btn small ghost" data-joinproj="${esc(pr.id)}">Join team +</button>`);
  if (state.me && pr.createdBy === state.me.id) {
    parts.push(`<button class="btn small ghost" data-editproj="${esc(pr.id)}">Edit ✎</button>`);
  }
  if (projectTries.length) parts.push(`<span class="try-count">${projectTries.length} tried it</span>`);
  return (parts.length ? `<div class="try-row">${parts.join('')}</div>` : '') + quotes;
}

// public Q&A block: anyone signed-in asks; only the person/team answers
function qaHtml(targetType, targetId) {
  const qs = state.questions.filter((q) => q.targetType === targetType && q.targetId === targetId);
  const nameOf = (id) => state.people.find((p) => p.id === id)?.name || 'someone';
  const iOwn = state.me && state.me.id && (targetType === 'person'
    ? targetId === state.me.id
    : (state.projects.find((x) => x.id === targetId)?.members || []).includes(state.me.id));

  const items = qs.slice(-3).map((q) => {
    const mine = state.me && q.from === state.me.id;
    return `<div class="qa-item">
      <div class="qa-q">💬 ${esc(q.text)}
        <span class="qa-by">— ${esc(nameOf(q.from))}</span>
        ${(mine || iOwn) ? `<button class="qa-del" data-qdel="${esc(q.id)}" title="Delete">✕</button>` : ''}
      </div>
      ${q.answers.map((a) => `<div class="qa-a">↳ ${esc(a.text)} <span class="qa-by">— ${esc(nameOf(a.by))}</span></div>`).join('')}
      ${iOwn ? `<button class="btn ghost small qa-btn" data-qanswer="${esc(q.id)}">${q.answers.some((a) => a.by === state.me.id) ? 'Edit answer' : 'Answer ↩'}</button>` : ''}
    </div>`;
  }).join('');

  const isSelf = state.me && targetType === 'person' && targetId === state.me.id;
  const key = `${targetType}:${targetId}`;
  return `<details class="qa" data-qa="${esc(key)}"${qaOpen.has(key) ? ' open' : ''}>
    <summary>💬 Q&amp;A${qs.length ? ` · ${qs.length}` : ''}</summary>
    ${qs.length > 3 ? `<div class="qa-by">${qs.length - 3} earlier question${qs.length - 3 === 1 ? '' : 's'} hidden</div>` : ''}
    ${items}
    ${!isSelf ? `<button class="btn ghost small qa-btn" data-qask="${esc(key)}">Ask ${targetType === 'project' ? 'the team' : 'them'} a question</button>` : ''}
  </details>`;
}

// keep Q&A sections open across the periodic re-renders
const qaOpen = new Set();
document.addEventListener('toggle', (e) => {
  const key = e.target.dataset?.qa;
  if (!key) return;
  if (e.target.open) qaOpen.add(key); else qaOpen.delete(key);
}, true);

function bindCardActions(rootSel) {
  document.querySelectorAll(`${rootSel} [data-connect]`).forEach((btn) =>
    btn.addEventListener('click', () => connect(btn.dataset.connect, btn)));
  document.querySelectorAll(`${rootSel} [data-try]`).forEach((btn) =>
    btn.addEventListener('click', () => markTried(btn.dataset.try)));
  document.querySelectorAll(`${rootSel} [data-joinproj]`).forEach((btn) =>
    btn.addEventListener('click', () => joinProject(btn.dataset.joinproj)));
  document.querySelectorAll(`${rootSel} [data-editproj]`).forEach((btn) =>
    btn.addEventListener('click', () => editProject(btn.dataset.editproj)));
  document.querySelectorAll(`${rootSel} [data-goto]`).forEach((btn) =>
    btn.addEventListener('click', () => show(btn.dataset.goto)));
  document.querySelectorAll(`${rootSel} [data-qask]`).forEach((btn) =>
    btn.addEventListener('click', () => askQuestion(...btn.dataset.qask.split(':'))));
  document.querySelectorAll(`${rootSel} [data-qanswer]`).forEach((btn) =>
    btn.addEventListener('click', () => answerQuestion(btn.dataset.qanswer)));
  document.querySelectorAll(`${rootSel} [data-qdel]`).forEach((btn) =>
    btn.addEventListener('click', () => deleteQuestion(btn.dataset.qdel)));
}

async function askQuestion(targetType, targetId) {
  if (!requireProfile()) return;
  const text = window.prompt('Your public question (everyone can see it):');
  if (!text || !text.trim()) return;
  try {
    await api('/api/questions', { body: { targetType, targetId, text: text.trim() } });
    toast('Question posted 💬');
    loadData();
  } catch (e) { toast(e.message); }
}

async function answerQuestion(questionId) {
  if (!requireProfile()) return;
  const q = state.questions.find((x) => x.id === questionId);
  const current = q?.answers.find((a) => a.by === state.me.id)?.text || '';
  const text = window.prompt('Your public answer:', current);
  if (!text || !text.trim()) return;
  try {
    await api(`/api/questions/${questionId}/answers`, { body: { text: text.trim() } });
    toast('Answer posted ↩');
    loadData();
  } catch (e) { toast(e.message); }
}

async function deleteQuestion(questionId) {
  if (!window.confirm('Delete this question?')) return;
  try {
    await api(`/api/questions/${questionId}`, { method: 'DELETE', body: {} });
    loadData();
  } catch (e) { toast(e.message); }
}

/* ---------- builders view ---------- */

function fillFilterOptions() {
  const cats = [...new Set(state.projects.flatMap((pr) => pr.categories || []))].sort();
  const countries = [...new Set(state.people.map((p) => p.country).filter(Boolean))].sort();
  const build = (sel, items, allLabel) => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      items.map((c) => `<option${c === prev ? ' selected' : ''}>${esc(c)}</option>`).join('');
  };
  build($('#filter-category'), cats, 'All categories');
  build($('#filter-country'), countries, 'All countries');
  build($('#pfilter-category'), cats, 'All categories');
}

function matchesFilters(p) {
  const q = $('#search').value.trim().toLowerCase();
  const cat = $('#filter-category').value;
  const type = $('#filter-type').value;
  const country = $('#filter-country').value;
  const myProjects = projectsOf(p.id);
  if (cat && !myProjects.some((pr) => (pr.categories || []).includes(cat))) return false;
  if (type && p.profileType !== type) return false;
  if (country && p.country !== country) return false;
  if (q) {
    const hay = [
      p.name, p.role, p.lookingFor, p.city, p.country,
      ...myProjects.flatMap((pr) => [pr.name, pr.oneLiner, ...(pr.categories || [])]),
    ].filter(Boolean).join(' ').toLowerCase();
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
  $('#cards').innerHTML = visible.map(personCardHtml).join('');
  bindCardActions('#cards');
}

function personCardHtml(p) {
  const place = [p.city, p.country].filter(Boolean).join(', ');
  const contacts = [
    p.x && `<a href="${esc(handleUrl('x', p.x))}" target="_blank" rel="noopener" title="X / Twitter">𝕏 ${esc(p.x.replace(/^@/, ''))}</a>`,
    p.telegram && `<a href="${esc(handleUrl('telegram', p.telegram))}" target="_blank" rel="noopener" title="Telegram">✈ ${esc(p.telegram.replace(/^@/, ''))}</a>`,
    p.linkedin && `<a href="${esc(handleUrl('linkedin', p.linkedin))}" target="_blank" rel="noopener" title="LinkedIn">in</a>`,
    p.email && `<a href="mailto:${esc(p.email)}" title="Email">✉</a>`,
  ].filter(Boolean).join('');

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

  const projHtml = projectsOf(p.id).map((pr) => `
    <div class="proj">
      <div class="proj-head"><strong>${pr.iconUrl ? `<img class="proj-mini-icon" src="${esc(pr.iconUrl)}" alt="" loading="lazy" />` : ''}${esc(pr.name)}</strong>
        ${pr.members.length > 1 ? `<span class="proj-team">👥 ${pr.members.length}</span>` : ''}</div>
      ${pr.oneLiner ? `<div class="card-oneliner">${esc(pr.oneLiner)}</div>` : ''}
      ${(pr.categories || []).length ? `<div class="badges">${pr.categories.map((c) => `<span class="badge cat">${esc(c)}</span>`).join('')}</div>` : ''}
      ${(pr.links || []).length ? `<div class="card-links">${pr.links.map((l) =>
        `<a href="${esc(normalizeLink(l))}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//, ''))}</a>`).join('')}</div>` : ''}
      ${tryRowHtml(pr)}
    </div>`).join('');

  return `<article class="card">
    <div class="card-head">
      ${avatarHtml(p)}
      <div class="card-head-info">
        <div class="card-name">${esc(p.name)}${isMe ? ' <span style="color:var(--ink-muted);font-weight:400">(you)</span>' : ''}</div>
        ${p.role ? `<div class="card-role">${esc(p.role)}</div>` : ''}
        ${place ? `<div class="card-place">📍 ${esc(place)}</div>` : ''}
      </div>
      ${p.profileType ? `<span class="badge type-${esc(p.profileType)}">${esc(p.profileType)}</span>` : ''}
    </div>
    ${projHtml}
    ${p.lookingFor ? `<div class="looking-for"><b>Looking for</b>${esc(p.lookingFor)}</div>` : ''}
    ${qaHtml('person', p.id)}
    <div class="card-foot">
      <div class="contact-icons">${contacts}</div>
      ${action}
    </div>
  </article>`;
}

/* ---------- projects view ---------- */

const triesOf = (projectId) => state.tries.filter((t) => t.to === projectId).length;

function renderProjectCards() {
  const q = $('#psearch').value.trim().toLowerCase();
  const cat = $('#pfilter-category').value;
  const visible = state.projects.filter((pr) => {
    if (cat && !(pr.categories || []).includes(cat)) return false;
    if (q) {
      const team = membersOf(pr).map((m) => m.name);
      const hay = [pr.name, pr.oneLiner, ...(pr.categories || []), ...team].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // leaderboard order: most tried first, then newest — the ranking is real data
  visible.sort((a, b) => triesOf(b.id) - triesOf(a.id) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  $('#projects-count').textContent =
    `${visible.length} project${visible.length === 1 ? '' : 's'} · most tried first` +
    (visible.length !== state.projects.length ? ` (of ${state.projects.length})` : '');
  $('#projects-empty').classList.toggle('hidden', state.projects.length > 0);
  $('#project-cards').innerHTML = visible.map((pr, i) => projectCardHtml(pr, i)).join('');
  bindCardActions('#project-cards');
  bindHoloCards();
}

function projectCardHtml(pr, rank = 99) {
  const [h1, h2] = CATEGORY_HUES[(pr.categories || [])[0]] || CATEGORY_HUES.Other;
  const img = projectImage(pr);
  const team = membersOf(pr);
  const tries = triesOf(pr.id);
  const questions = state.questions.filter((x) => x.targetType === 'project' && x.targetId === pr.id).length;
  const countries = [...new Set(team.map((m) => m.country).filter(Boolean))].join(' · ');

  const banner = img
    ? `<img class="proj-banner" src="${esc(img)}" alt="" loading="lazy"
         onerror="this.outerHTML='<div class=&quot;proj-patch&quot;><span>${esc(initials(pr.name))}</span></div>'" />`
    : `<div class="proj-patch"><span>${esc(initials(pr.name))}</span></div>`;

  return `<article class="card project-card holo" style="--h1:${h1};--h2:${h2}">
    <div class="holo-glare"></div>
    <div class="proj-banner-wrap">
      ${banner}
      ${rank === 0 && tries > 0 ? '<div class="hot-badge">🔥 Most tried</div>' : ''}
    </div>
    <div class="card-name proj-title">${pr.iconUrl ? `<img class="proj-mini-icon" src="${esc(pr.iconUrl)}" alt="" />` : ''}${esc(pr.name)}</div>
    ${pr.oneLiner ? `<div class="card-oneliner">${esc(pr.oneLiner)}</div>` : ''}
    ${(pr.categories || []).length ? `<div class="badges">${pr.categories.map((c) => `<span class="badge cat">${esc(c)}</span>`).join('')}</div>` : ''}
    <div class="crew">
      <div class="crew-stack">${team.map((m) => avatarHtml(m, 'avatar avatar-xs')).join('')}</div>
      <span class="crew-names">${esc(team.map((m) => m.name.split(' ')[0]).join(', '))}</span>
      ${countries ? `<span class="card-place">📍 ${esc(countries)}</span>` : ''}
    </div>
    <div class="stat-strip">
      <span title="times tried">🧪 ${tries}</span>
      <span title="questions">💬 ${questions}</span>
      <span title="team size">👥 ${team.length}</span>
      ${(pr.links || []).length ? pr.links.slice(0, 2).map((l) =>
        `<a href="${esc(normalizeLink(l))}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//, '').split('/')[0])}</a>`).join('') : ''}
    </div>
    ${tryRowHtml(pr)}
    ${qaHtml('project', pr.id)}
  </article>`;
}

// pointer-reactive foil tilt — the signature; off for touch and reduced-motion
function bindHoloCards() {
  if (window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.holo').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty('--px', px);
      card.style.setProperty('--py', py);
      card.style.transform =
        `perspective(900px) rotateX(${((0.5 - py) * 5).toFixed(2)}deg) rotateY(${((px - 0.5) * 7).toFixed(2)}deg)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });
}

['#psearch', '#pfilter-category'].forEach((sel) => $(sel).addEventListener('input', renderProjectCards));
['#search', '#filter-category', '#filter-type', '#filter-country'].forEach((sel) =>
  $(sel).addEventListener('input', renderCards));

/* ---------- map view ---------- */

function renderMap() {
  if (typeof L === 'undefined') {
    $('#map-note').textContent = 'Map library could not load (no internet?).';
    return;
  }
  if (!state.map) {
    state.map = L.map('map', { worldCopyJump: true }).setView([-10, -40], 3);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 12,
    }).addTo(state.map);
    // cluster overlapping pins into a count bubble; a tap fans them out
    state.mapMarkers = L.markerClusterGroup
      ? L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 44,
          spiderfyDistanceMultiplier: 1.6,
          iconCreateFunction: (cluster) => L.divIcon({
            className: 'pin-anchor',
            html: `<div class="pin-cluster">${cluster.getChildCount()}</div>`,
            iconSize: [42, 42], iconAnchor: [21, 21],
          }),
        }).addTo(state.map)
      : L.layerGroup().addTo(state.map); // plugin CDN unreachable — plain pins
    document.querySelectorAll('#map-mode input').forEach((r) => r.addEventListener('change', renderMap));
  }
  state.map.invalidateSize();
  state.mapMarkers.clearLayers();

  const mode = document.querySelector('#map-mode input:checked').value;
  let located = 0, unlocated = [];

  // exact city coords when the profile was geocoded, country centroid otherwise
  const personPos = (p) => {
    if (typeof p.lat === 'number' && typeof p.lon === 'number') {
      return { lat: p.lat, lon: p.lon, label: [p.city, p.country].filter(Boolean).join(', '), exact: true };
    }
    const c = countryCoord(p.country);
    return c ? { lat: c.lat, lon: c.lon, label: c.label, exact: false } : null;
  };

  // photo/logo pins; overlapping ones cluster and fan out on tap
  const addMarker = (pos, popup, { imgUrl, fallbackText, fallbackBg, shape }) => {
    const inner = imgUrl
      ? `<img src="${esc(imgUrl)}" alt="" />`
      : `<span style="background:${fallbackBg}">${esc(fallbackText)}</span>`;
    const icon = L.divIcon({
      className: 'pin-anchor',
      html: `<div class="pin ${shape}">${inner}</div>`,
      iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -20],
    });
    state.mapMarkers.addLayer(L.marker([pos.lat, pos.lon], { icon }).bindPopup(popup));
  };

  if (mode === 'people') {
    for (const p of state.people) {
      const pos = personPos(p);
      if (!pos) { unlocated.push(p.name); continue; }
      const projs = projectsOf(p.id).map((pr) => pr.name).join(', ');
      addMarker(pos,
        `<strong>${esc(p.name)}</strong><br>${esc(pos.label)}` +
        (projs ? `<br>🛠 ${esc(projs)}` : '') +
        (p.telegram ? `<br><a href="${esc(handleUrl('telegram', p.telegram))}" target="_blank">✈ ${esc(p.telegram)}</a>` : ''),
        { imgUrl: p.photoUrl, fallbackText: initials(p.name), fallbackBg: avatarColor(p.name), shape: 'pin-person' });
      located++;
    }
  } else {
    for (const pr of state.projects) {
      const team = membersOf(pr);
      const positions = [];
      const seenKeys = new Set();
      for (const m of team) {
        const pos = personPos(m);
        if (!pos) continue;
        const key = `${pos.lat.toFixed(1)},${pos.lon.toFixed(1)}`;
        if (!seenKeys.has(key)) { seenKeys.add(key); positions.push(pos); }
      }
      if (!positions.length) { unlocated.push(pr.name); continue; }
      const names = team.map((m) => m.name).join(', ');
      const [h1] = CATEGORY_HUES[(pr.categories || [])[0]] || CATEGORY_HUES.Other;
      positions.forEach((pos) => addMarker(pos,
        `<strong>${esc(pr.name)}</strong>` +
        (pr.oneLiner ? `<br>${esc(pr.oneLiner)}` : '') +
        `<br>👥 ${esc(names)}` +
        ((pr.links || []).length ? `<br><a href="${esc(normalizeLink(pr.links[0]))}" target="_blank">${esc(pr.links[0])}</a>` : ''),
        { imgUrl: pr.iconUrl, fallbackText: initials(pr.name), fallbackBg: h1, shape: 'pin-project' }));
      located++;
    }
  }

  const layers = state.mapMarkers.getLayers();
  if (layers.length) state.map.fitBounds(L.featureGroup(layers).getBounds().pad(0.3), { maxZoom: 5 });
  $('#map-note').textContent = unlocated.length
    ? `${located} located · not shown (country not recognized or empty): ${unlocated.slice(0, 4).join(', ')}${unlocated.length > 4 ? '…' : ''}`
    : (located ? `${located} located` : 'Nothing to show yet — join and set your country!');
}

/* ---------- actions ---------- */

async function connect(toId, btn) {
  if (!requireProfile()) return;
  try {
    await api('/api/connections', { body: { to: toId } });
    state.myConnections.add(toId);
    localStorage.setItem('ssc-conns', JSON.stringify([...state.myConnections]));
    btn.outerHTML = `<button class="btn small connected" disabled>Connected ✓</button>`;
    toast('Connection recorded — reach out via their contact links!');
  } catch (e) {
    toast(e.message);
  }
}

async function markTried(projectId) {
  if (!requireProfile()) return;
  const comment = window.prompt('Nice! Any quick feedback for the team? (optional)') || '';
  try {
    await api('/api/tries', { body: { to: projectId, comment } });
    state.myTries.add(projectId);
    localStorage.setItem('ssc-tries', JSON.stringify([...state.myTries]));
    toast('Recorded — thanks for trying their project! 🧪');
    loadData();
  } catch (e) {
    toast(e.message);
  }
}

function editProject(projectId) {
  show('join');
  setTimeout(() => {
    const block = document.querySelector(`.project-block[data-id="${CSS.escape(projectId)}"]`);
    if (!block) return;
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    block.classList.add('flash');
    setTimeout(() => block.classList.remove('flash'), 1800);
  }, 100);
}

async function joinProject(projectId) {
  if (!requireProfile()) return;
  const pr = state.projects.find((x) => x.id === projectId);
  if (!window.confirm(`Join the team of “${pr ? pr.name : 'this project'}”?`)) return;
  try {
    await api(`/api/projects/${projectId}/join`, { body: {} });
    toast('You joined the team! 🎉');
    loadData();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- sign in / sign out ---------- */

function updateJoinView() {
  const signedIn = !!state.me;
  $('#signin-box').classList.toggle('hidden', signedIn);
  $('#join-form').classList.toggle('hidden', !signedIn);
  if (signedIn) {
    $('#me-email').textContent = state.me.email;
    $('#form-title').textContent = state.me.id ? 'Edit your profile' : 'Add yourself to the map';
    $('#submit-btn').textContent = state.me.id ? 'Update profile ✦' : 'Join the constellation ✦';
  }
}

$('#signin-box').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('#signin-status');
  const email = $('#signin-email').value.trim();
  status.className = 'form-status';
  status.textContent = 'Sending…';
  try {
    const r = await api('/api/auth/request-link', { body: { email } });
    status.classList.add('ok');
    if (r.devLink) {
      status.innerHTML = `Dev mode (no email configured): <a href="${esc(r.devLink)}">open your sign-in link</a>`;
    } else {
      status.textContent = 'Link sent — check your inbox (and spam) ✉';
    }
  } catch (err) {
    status.classList.add('err');
    status.textContent = err.message;
  }
});

$('#signout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { body: {} }); } catch { /* cookie is gone anyway */ }
  state.me = null;
  form.reset();
  $('#my-projects').innerHTML = '';
  updateJoinView();
  toast('Signed out');
});

/* ---------- join form ---------- */

const form = $('#join-form');

/* ---------- country dropdown + city autocomplete (no typos on the map) ---------- */

// the @ is drawn by the field itself — strip any @ people type or paste
['x', 'telegram'].forEach((name) => {
  form.elements[name].addEventListener('input', (e) => {
    if (e.target.value.includes('@')) e.target.value = e.target.value.replace(/@/g, '');
  });
});

const countrySel = $('#country-select');

function fillCountrySelect() {
  const labels = Object.values(COUNTRY_COORDS).map((c) => c.label).sort();
  countrySel.innerHTML = '<option value="">Select your country…</option>' +
    labels.map((l) => `<option>${esc(l)}</option>`).join('') +
    '<option value="__other">Other…</option>';
}
fillCountrySelect();

function setCountryValue(raw) {
  if (!raw) { countrySel.value = ''; return; }
  const canonical = countryCoord(raw)?.label || raw;
  if (![...countrySel.options].some((o) => o.value === canonical)) {
    const opt = document.createElement('option');
    opt.textContent = canonical;
    countrySel.insertBefore(opt, countrySel.lastElementChild);
  }
  countrySel.value = canonical;
}

countrySel.addEventListener('change', () => {
  state.pickedGeo = null;
  if (countrySel.value === '__other') {
    const v = (window.prompt('Type your country:') || '').trim();
    if (v) setCountryValue(v);
    else countrySel.value = '';
  }
});

const cityInput = $('#city-input');
const citySugBox = $('#city-suggestions');
let cityTimer = null;

function hideCitySuggestions() { citySugBox.classList.add('hidden'); citySugBox.innerHTML = ''; }

cityInput.addEventListener('input', () => {
  state.pickedGeo = null;
  clearTimeout(cityTimer);
  const q = cityInput.value.trim();
  if (q.length < 2) { hideCitySuggestions(); return; }
  cityTimer = setTimeout(() => fetchCitySuggestions(q), 350);
});
cityInput.addEventListener('blur', () => setTimeout(hideCitySuggestions, 200)); // let clicks land first

async function fetchCitySuggestions(q) {
  // Photon (photon.komoot.io): open-source OSM geocoder built for autocomplete
  const country = countrySel.value && countrySel.value !== '__other' ? countrySel.value : '';
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(country ? `${q}, ${country}` : q)}&limit=8&lang=en`;
  let features = [];
  try { ({ features } = await fetch(url).then((r) => r.json())); } catch { return; }
  const rank = { city: 0, town: 1, village: 2, municipality: 3 };
  const results = (features || [])
    .filter((f) => f.properties.type in rank)
    .sort((a, b) => rank[a.properties.type] - rank[b.properties.type])
    .slice(0, 5);
  if (cityInput.value.trim() !== q || !results.length) { hideCitySuggestions(); return; }
  citySugBox.innerHTML = results.map((f, i) => {
    const p = f.properties;
    const where = [p.state, p.country].filter(Boolean).join(', ');
    return `<button type="button" data-i="${i}"><strong>${esc(p.name)}</strong>${where ? ` <span>${esc(where)}</span>` : ''}</button>`;
  }).join('');
  citySugBox.classList.remove('hidden');
  citySugBox.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
    const f = results[btn.dataset.i];
    cityInput.value = f.properties.name;
    state.pickedGeo = { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    if (f.properties.country) setCountryValue(f.properties.country);
    hideCitySuggestions();
  }));
}

function projectBlockEl(data = {}) {
  const el = document.createElement('div');
  el.className = 'project-block';
  el.dataset.id = data.id || '';

  if (data.joinOnly) {
    el.dataset.kind = 'join';
    el.innerHTML = `<div class="project-block-head">
      <span>${data.existingMember ? 'Member of' : 'Joining'} <strong>${esc(data.name)}</strong> · team of ${data.members.length}
        ${data.existingMember ? '<span class="mini-label">(only the creator can edit it)</span>' : ''}</span>
      <button type="button" class="btn ghost small pb-remove">✕ ${data.existingMember ? 'Leave' : 'Cancel'}</button></div>`;
  } else {
    el.dataset.kind = data.id ? 'edit' : 'new';
    el.innerHTML = `
      <div class="project-block-head">
        <strong>${data.id ? esc(data.name) : 'New project'}</strong>
        <button type="button" class="btn ghost small pb-remove">✕ ${data.id ? 'Leave project' : 'Remove'}</button>
      </div>
      <div class="grid-2">
        <label>Project name *<input class="pb-name" maxlength="160" value="${esc(data.name || '')}" placeholder="My cool dApp" /></label>
        <label>One-liner<input class="pb-oneliner" maxlength="280" value="${esc(data.oneLiner || '')}" placeholder="What does it do?" /></label>
      </div>
      <span class="mini-label">Categories (pick any)</span>
      <div class="pb-cats">${CATEGORIES.map((c) =>
        `<label class="cat-chip"><input type="checkbox" value="${esc(c)}"${(data.categories || []).includes(c) ? ' checked' : ''} /><span>${esc(c)}</span></label>`).join('')}</div>
      <span class="mini-label">Links (site, demo, repo…)</span>
      <div class="pb-links">${(data.links && data.links.length ? data.links : ['']).map((l) =>
        `<input class="pb-link" maxlength="300" value="${esc(l)}" placeholder="https://…" />`).join('')}</div>
      <div class="pb-tools">
        <button type="button" class="btn ghost small pb-add-link">+ link</button>
        <label class="btn ghost small">Logo 1:1<input type="file" class="pb-icon" accept="image/*" hidden /></label>
        <span class="mini-label pb-icon-note">${data.iconUrl ? 'logo ✓' : 'shown on map & constellation'}</span>
        <label class="btn ghost small">Banner<input type="file" class="pb-image" accept="image/*" hidden /></label>
        <span class="mini-label pb-image-note">${data.imageUrl ? 'banner ✓' : 'no banner → we screenshot your first link'}</span>
      </div>`;
  }

  el.querySelector('.pb-remove').addEventListener('click', () => { el.remove(); refreshExistingOptions(); });
  el.querySelector('.pb-add-link')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.className = 'pb-link';
    input.maxLength = 300;
    input.placeholder = 'https://…';
    el.querySelector('.pb-links').appendChild(input);
  });
  el.querySelector('.pb-image')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    el._imageDataUrl = await resizeImage(file, 900);
    el.querySelector('.pb-image-note').textContent = 'banner ready ✓';
  });
  el.querySelector('.pb-icon')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    el._iconDataUrl = await resizeImage(file, 256, true); // center-cropped square
    el.querySelector('.pb-icon-note').textContent = 'logo ready ✓';
  });
  return el;
}

$('#btn-new-project').addEventListener('click', () =>
  $('#my-projects').appendChild(projectBlockEl()));

function refreshExistingOptions() {
  const sel = $('#existing-projects');
  if (!sel) return;
  const blockIds = new Set([...document.querySelectorAll('.project-block')]
    .map((el) => el.dataset.id).filter(Boolean));
  const options = state.projects.filter((pr) =>
    !blockIds.has(pr.id) && !(state.me && pr.members.includes(state.me.id)));
  const prev = sel.value;
  sel.innerHTML = '<option value="">Join an existing project…</option>' +
    options.map((pr) => `<option value="${esc(pr.id)}"${pr.id === prev ? ' selected' : ''}>${esc(pr.name)} · team of ${pr.members.length}</option>`).join('');
}

$('#existing-projects').addEventListener('change', () => {
  const pr = state.projects.find((x) => x.id === $('#existing-projects').value);
  if (pr) {
    $('#my-projects').appendChild(projectBlockEl({ ...pr, joinOnly: true }));
    refreshExistingOptions();
  }
});

$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.photoDataUrl = await resizeImage(file, 640);
  const prev = $('#photo-preview');
  prev.style.backgroundImage = `url(${state.photoDataUrl})`;
  prev.textContent = '';
});

function resizeImage(file, maxSide, square = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      if (square) {
        const side = Math.min(img.width, img.height);
        canvas.width = canvas.height = Math.min(maxSide, side);
        canvas.getContext('2d').drawImage(img,
          (img.width - side) / 2, (img.height - side) / 2, side, side,
          0, 0, canvas.width, canvas.height);
      } else {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('#form-status');
  const btn = $('#submit-btn');
  const body = Object.fromEntries(new FormData(form).entries());
  if (state.photoDataUrl) body.photo = state.photoDataUrl;

  btn.disabled = true;
  status.className = 'form-status';
  status.textContent = 'Saving…';
  try {
    if (body.country === '__other') body.country = '';
    // exact coords if a city suggestion was clicked; otherwise geocode what was typed
    if (state.pickedGeo) {
      body.lat = state.pickedGeo.lat;
      body.lon = state.pickedGeo.lon;
    } else if (body.city || body.country) {
      try {
        const q = [body.city, body.country].filter(Boolean).join(', ');
        const geo = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`)
          .then((r) => r.json());
        if (geo[0]) { body.lat = parseFloat(geo[0].lat); body.lon = parseFloat(geo[0].lon); }
      } catch { /* offline — map falls back to country centroid */ }
    }
    // upsert: the server knows who we are from the session cookie
    const { person } = await api('/api/people', { body });
    state.me = { email: state.me.email, id: person.id };

    const keptIds = new Set();
    for (const el of document.querySelectorAll('.project-block')) {
      if (el.dataset.kind === 'join') {
        keptIds.add(el.dataset.id);
        await api(`/api/projects/${el.dataset.id}/join`, { body: {} });
        continue;
      }
      const proj = {
        name: el.querySelector('.pb-name').value.trim(),
        oneLiner: el.querySelector('.pb-oneliner').value.trim(),
        categories: [...el.querySelectorAll('.pb-cats input:checked')].map((i) => i.value),
        links: [...el.querySelectorAll('.pb-link')].map((i) => i.value.trim()).filter(Boolean),
      };
      if (el._imageDataUrl) proj.image = el._imageDataUrl;
      if (el._iconDataUrl) proj.icon = el._iconDataUrl;
      if (!proj.name) continue; // empty block — ignore
      if (el.dataset.kind === 'edit') {
        keptIds.add(el.dataset.id);
        await api(`/api/projects/${el.dataset.id}`, { method: 'PUT', body: proj });
      } else {
        const { project } = await api('/api/projects', { body: proj });
        keptIds.add(project.id);
      }
    }
    for (const id of state.initialProjectIds) {
      if (!keptIds.has(id)) await api(`/api/projects/${id}/leave`, { body: {} });
    }
    state.initialProjectIds = [...keptIds];

    status.classList.add('ok');
    status.textContent = 'Saved!';
    toast('Welcome to the constellation ✦');
    await loadData();
    prefillMyProfile();
    show('builders');
  } catch (err) {
    status.classList.add('err');
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function prefillMyProfile() {
  updateJoinView();
  if (!state.me || !state.me.id) return;
  const me = state.people.find((p) => p.id === state.me.id);
  if (!me) return;
  for (const [k, v] of Object.entries(me)) {
    if (k === 'country') continue; // handled below (select needs a matching option)
    const input = form.elements[k];
    if (input && typeof v === 'string') {
      input.value = (k === 'x' || k === 'telegram') ? v.replace(/@/g, '') : v;
    }
  }
  setCountryValue(me.country);
  if (me.photoUrl) {
    const prev = $('#photo-preview');
    prev.style.backgroundImage = `url(${me.photoUrl})`;
    prev.textContent = '';
  }
  const mine = projectsOf(me.id);
  state.initialProjectIds = mine.map((pr) => pr.id);
  const wrap = $('#my-projects');
  wrap.innerHTML = '';
  // your own creations are editable; teams you joined show as membership chips
  mine.forEach((pr) => wrap.appendChild(projectBlockEl(
    pr.createdBy === me.id ? pr : { ...pr, joinOnly: true, existingMember: true })));
  refreshExistingOptions();
}

/* ---------- metrics ---------- */

async function loadMetrics() {
  const [stats] = await Promise.all([api('/api/stats'), loadData()]);
  const personById = Object.fromEntries(state.people.map((p) => [p.id, p]));
  const projectById = Object.fromEntries(state.projects.map((p) => [p.id, p]));

  $('#stat-tiles').innerHTML = [
    [stats.totalPeople, 'Builders'],
    [stats.totalProjects, 'Projects'],
    [stats.totalConnections, 'Connections'],
    [stats.mutualConnections, 'Mutual matches'],
    [stats.totalTries, 'Projects tried'],
    [`${stats.answeredQuestions}/${stats.totalQuestions}`, 'Questions answered'],
    [stats.countries, 'Countries'],
  ].map(([v, label]) =>
    `<div class="tile"><div class="tile-value">${v}</div><div class="tile-label">${label}</div></div>`).join('');

  // Projects by category — single-hue horizontal bars, direct value labels
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

  $('#top-connectors').innerHTML = stats.topConnectors.length
    ? stats.topConnectors.map(({ id, count }) => {
        const p = personById[id];
        if (!p) return '';
        return `<li>${avatarHtml(p)}<span>${esc(p.name)}</span>
          <span class="conn-count">${count} connection${count === 1 ? '' : 's'}</span></li>`;
      }).join('')
    : '<li class="count-line">No connections yet — hit “Connect ✦” on someone’s card!</li>';

  $('#top-tried').innerHTML = stats.topTried.length
    ? stats.topTried.map(({ id, count }) => {
        const pr = projectById[id];
        if (!pr) return '';
        const team = membersOf(pr);
        return `<li>${team[0] ? avatarHtml(team[0]) : ''}<span>${esc(pr.name)}</span>
          <span class="conn-count">🧪 ${count}</span></li>`;
      }).join('')
    : '<li class="count-line">Try someone’s app and hit “I tried it 🧪”!</li>';

  $('#recent-connections').innerHTML = stats.recentConnections.length
    ? stats.recentConnections.map((c) => {
        const a = personById[c.from]; const b = personById[c.to];
        if (!a || !b) return '';
        const t = new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<li>${esc(a.name)}<span class="conn-arrow">→✦←</span>${esc(b.name)}<time>${t}</time></li>`;
      }).join('')
    : '<li class="count-line">Connections will show up here.</li>';
}

/* ---------- export ---------- */

async function download(path, filename) {
  const res = await fetch(path, { headers: { 'x-event-key': state.key } });
  if (!res.ok) { toast('Export failed'); return; }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#export-json').addEventListener('click', () =>
  download('/api/export', `stellar-summit-connect-${new Date().toISOString().slice(0, 10)}.json`));
$('#export-csv').addEventListener('click', () =>
  download('/api/export/people.csv', 'stellar-summit-people.csv'));

/* ---------- boot ---------- */

const initialView = ['builders', 'projects', 'constellation', 'map', 'join', 'metrics'].includes(location.hash.slice(1))
  ? location.hash.slice(1) : 'builders';
loadData()
  .then(async () => {
    await fetchMe();
    prefillMyProfile();
    show(initialView);
  })
  .catch(() => showGate()); // no/wrong event password yet
setInterval(() => {
  const active = document.querySelector('.tab.active')?.dataset.view;
  if (active === 'builders' || active === 'projects') loadData();
  if (active === 'metrics') loadMetrics();
}, 20000); // live-ish refresh while projected on a screen
