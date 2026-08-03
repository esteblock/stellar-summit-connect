/* Constellation ✦ — a live force-directed star map of the event.
   People are stars (colored by profile type, sized by connections),
   projects are golden diamonds, edges are connections / team / tried-it.
   Hand-rolled physics on canvas — no libraries. */

const CV = {
  nodes: [], edges: [], byId: {},
  canvas: null, ctx: null, raf: null, w: 0, h: 0, dpr: 1,
  hover: null, dragging: null, selected: null,
  images: {}, bgStars: [], posCache: {}, t: 0,
  filters: { conn: false, try: false, member: true }, // which edge kinds are visible
  replay: null, // {min, max, begun, dur} while the timelapse is playing
  simTime: Infinity,
};

function cvSimTime() {
  if (!CV.replay) return Infinity;
  const p = Math.min(1, (performance.now() - CV.replay.begun) / CV.replay.dur);
  return CV.replay.min + (CV.replay.max - CV.replay.min) * p;
}

const cvNodeVisible = (n) => n.bornAt <= CV.simTime;
const cvVisibleEdges = () => CV.edges.filter((e) =>
  CV.filters[e.kind] && e.bornAt <= CV.simTime &&
  cvNodeVisible(CV.byId[e.a]) && cvNodeVisible(CV.byId[e.b]));

const CV_COLORS = { Technical: '#3987e5', Business: '#d95926', Both: '#199e70', project: '#c98500' };

async function renderConstellation() {
  const { connections } = await api('/api/connections');

  const degree = {};
  const bump = (id, n = 1) => { degree[id] = (degree[id] || 0) + n; };

  const born = (iso) => (iso ? Date.parse(iso) || 0 : 0);
  const personBorn = Object.fromEntries(state.people.map((p) => [p.id, born(p.createdAt)]));

  const pairSeen = new Set();
  const edges = [];
  for (const c of connections) {
    bump(c.from); bump(c.to);
    const key = [c.from, c.to].sort().join('|');
    if (pairSeen.has(key)) {
      const e = edges.find((x) => x.kind === 'conn' && [x.a, x.b].sort().join('|') === key);
      if (e) e.mutual = true;
      continue;
    }
    pairSeen.add(key);
    edges.push({ a: c.from, b: c.to, kind: 'conn', mutual: false, bornAt: born(c.at) });
  }
  for (const pr of state.projects) {
    for (const m of pr.members) {
      edges.push({ a: m, b: pr.id, kind: 'member', bornAt: Math.max(born(pr.createdAt), personBorn[m] || 0) });
      bump(pr.id);
    }
  }
  for (const t of state.tries) {
    edges.push({ a: t.from, b: t.to, kind: 'try', bornAt: born(t.at) });
    bump(t.to);
  }

  const nodes = [];
  for (const p of state.people) {
    nodes.push({
      id: p.id, type: 'person', label: p.name, color: CV_COLORS[p.profileType] || CV_COLORS.Both,
      r: 13 + 2.5 * Math.sqrt(degree[p.id] || 0), data: p, bornAt: born(p.createdAt),
    });
    if (p.photoUrl && !CV.images[p.id]) {
      const img = new Image();
      img.src = p.photoUrl;
      CV.images[p.id] = img;
    }
  }
  for (const pr of state.projects) {
    nodes.push({
      id: pr.id, type: 'project', label: pr.name, color: CV_COLORS.project,
      r: 12 + 2.5 * Math.sqrt(degree[pr.id] || 0), data: pr, bornAt: born(pr.createdAt),
    });
    if (pr.iconUrl && !CV.images[pr.id]) {
      const img = new Image();
      img.src = pr.iconUrl;
      CV.images[pr.id] = img;
    }
  }

  CV.canvas = document.getElementById('constellation');
  CV.ctx = CV.canvas.getContext('2d');
  sizeConstellation();

  // keep positions stable across data refreshes; new nodes start on a ring
  nodes.forEach((n, i) => {
    const cached = CV.posCache[n.id];
    const angle = (i / nodes.length) * 2 * Math.PI;
    n.x = cached ? cached.x : CV.w / 2 + (CV.w / 3.2) * Math.cos(angle);
    n.y = cached ? cached.y : CV.h / 2 + (CV.h / 3.2) * Math.sin(angle);
    n.vx = 0; n.vy = 0;
  });
  CV.nodes = nodes;
  CV.edges = edges.filter((e) => nodes.some((n) => n.id === e.a) && nodes.some((n) => n.id === e.b));
  CV.byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  if (!CV.bgStars.length) {
    for (let i = 0; i < 140; i++) {
      CV.bgStars.push({ fx: Math.random(), fy: Math.random(), phase: Math.random() * 6.28, size: Math.random() < 0.15 ? 1.6 : 1 });
    }
  }
  if (!CV._bound) bindConstellationEvents();
  if (!CV.raf) tickConstellation();
}

function sizeConstellation() {
  const wrap = document.getElementById('constellation-wrap');
  CV.dpr = window.devicePixelRatio || 1;
  CV.w = wrap.clientWidth;
  CV.h = wrap.clientHeight;
  CV.canvas.width = CV.w * CV.dpr;
  CV.canvas.height = CV.h * CV.dpr;
  CV.ctx.setTransform(CV.dpr, 0, 0, CV.dpr, 0, 0);
}

function stopConstellation() {
  if (CV.raf) { cancelAnimationFrame(CV.raf); CV.raf = null; }
  for (const n of CV.nodes) CV.posCache[n.id] = { x: n.x, y: n.y };
}

function tickConstellation() {
  const active = !document.getElementById('view-constellation').classList.contains('hidden');
  if (!active) { stopConstellation(); return; }
  CV.simTime = cvSimTime();
  if (CV.replay && performance.now() - CV.replay.begun > CV.replay.dur + 1500) {
    CV.replay = null; // hold the finished frame briefly, then back to live
    document.getElementById('cv-replay').textContent = '⏪ Timelapse';
  }
  stepPhysics();
  drawConstellation();
  CV.t += 1;
  CV.raf = requestAnimationFrame(tickConstellation);
}

function startTimelapse() {
  const times = [...CV.nodes.map((n) => n.bornAt), ...CV.edges.map((e) => e.bornAt)].filter((t) => t > 0);
  if (times.length < 2) return;
  const min = Math.min(...times), max = Math.max(...times);
  if (max - min < 1000) return; // everything appeared at once — nothing to replay
  CV.replay = { min: min - (max - min) * 0.02, max, begun: performance.now(), dur: 12000 };
  CV.selected = null;
  showConstellationTip(null);
  document.getElementById('cv-replay').textContent = '⏹ Stop';
}

function stepPhysics() {
  const nodes = CV.nodes.filter(cvNodeVisible);
  const REST = { member: 85, conn: 150, try: 170 };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = (Math.sin(i * 7 + j) || 0.1); dy = 1; d2 = 2; }
      const d = Math.sqrt(d2);
      const f = Math.min(4, 2600 / d2);
      dx /= d; dy /= d;
      a.vx -= f * dx; a.vy -= f * dy;
      b.vx += f * dx; b.vy += f * dy;
    }
  }
  for (const e of cvVisibleEdges()) {
    const a = CV.byId[e.a], b = CV.byId[e.b];
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const f = 0.012 * (d - REST[e.kind]);
    a.vx += f * dx / d; a.vy += f * dy / d;
    b.vx -= f * dx / d; b.vy -= f * dy / d;
  }
  for (const n of nodes) {
    n.vx += (CV.w / 2 - n.x) * 0.0012;
    n.vy += (CV.h / 2 - n.y) * 0.0012;
    if (CV.dragging === n) { n.vx = 0; n.vy = 0; continue; }
    n.vx *= 0.82; n.vy *= 0.82;
    n.x += Math.max(-6, Math.min(6, n.vx));
    n.y += Math.max(-6, Math.min(6, n.vy));
    const pad = n.r + 6;
    n.x = Math.max(pad, Math.min(CV.w - pad, n.x));
    n.y = Math.max(pad, Math.min(CV.h - pad, n.y));
  }
}

function drawConstellation() {
  const ctx = CV.ctx;
  ctx.clearRect(0, 0, CV.w, CV.h);

  // twinkling background
  for (const s of CV.bgStars) {
    const alpha = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(CV.t / 40 + s.phase));
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(s.fx * CV.w, s.fy * CV.h, s.size, s.size);
  }

  const focus = CV.hover || CV.selected;
  const related = new Set();
  if (focus) {
    related.add(focus.id);
    for (const e of cvVisibleEdges()) {
      if (e.a === focus.id) related.add(e.b);
      if (e.b === focus.id) related.add(e.a);
    }
  }
  const dimmed = (id) => focus && !related.has(id);

  // edges
  for (const e of cvVisibleEdges()) {
    const a = CV.byId[e.a], b = CV.byId[e.b];
    const dim = focus && !(related.has(a.id) && related.has(b.id) && (e.a === focus.id || e.b === focus.id || !focus));
    const isFocusEdge = focus && (e.a === focus.id || e.b === focus.id);
    let alpha = focus ? (isFocusEdge ? 0.9 : 0.06) : 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.setLineDash(e.kind === 'try' ? [4, 5] : []);
    if (e.kind === 'conn') {
      ctx.strokeStyle = `rgba(57,135,229,${0.55 * alpha})`;
      ctx.lineWidth = e.mutual ? 2.4 : 1.2;
    } else if (e.kind === 'try') {
      ctx.strokeStyle = `rgba(217,89,38,${0.5 * alpha})`;
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * alpha})`;
      ctx.lineWidth = 2;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // nodes
  const showLabels = CV.nodes.length <= 45;
  for (const n of CV.nodes) {
    if (!cvNodeVisible(n)) continue;
    const dim = dimmed(n.id);
    ctx.globalAlpha = dim ? 0.18 : 1;

    // glow
    const glow = ctx.createRadialGradient(n.x, n.y, n.r * 0.4, n.x, n.y, n.r * 2.2);
    glow.addColorStop(0, `${n.color}55`);
    glow.addColorStop(1, `${n.color}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r * 2.2, 0, 6.29);
    ctx.fill();

    if (n.type === 'project') {
      const icon = CV.images[n.id];
      const s = n.r * 1.25;
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = n.color;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      if (icon && icon.complete && icon.naturalWidth) {
        // clip to the diamond, then draw the logo upright inside it
        ctx.beginPath();
        ctx.rect(-s / 2 + 1, -s / 2 + 1, s - 2, s - 2);
        ctx.clip();
        ctx.rotate(-Math.PI / 4);
        ctx.drawImage(icon, -n.r, -n.r, n.r * 2, n.r * 2);
        ctx.rotate(Math.PI / 4);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    } else {
      const img = CV.images[n.id];
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 6.29);
      ctx.fillStyle = n.color;
      ctx.fill();
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r - 1.5, 0, 6.29);
        ctx.clip();
        ctx.drawImage(img, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
        ctx.restore();
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = `600 ${Math.max(9, n.r * 0.72)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(n.label || '?'), n.x, n.y + 0.5);
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 6.29);
      ctx.strokeStyle = (CV.hover === n || CV.selected === n) ? '#ffffff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = (CV.hover === n || CV.selected === n) ? 2 : 1;
      ctx.stroke();
    }

    if (showLabels || CV.hover === n || CV.selected === n) {
      ctx.fillStyle = dim ? 'rgba(195,194,183,0.4)' : '#c3c2b7';
      ctx.font = '11.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(n.label, n.x, n.y + n.r + 5);
    }
    ctx.globalAlpha = 1;
  }

  // timelapse progress bar + clock
  if (CV.replay) {
    const p = Math.min(1, (performance.now() - CV.replay.begun) / CV.replay.dur);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(16, CV.h - 22, CV.w - 32, 4);
    ctx.fillStyle = '#3987e5';
    ctx.fillRect(16, CV.h - 22, (CV.w - 32) * p, 4);
    ctx.fillStyle = '#c3c2b7';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const when = new Date(CV.simTime);
    ctx.fillText(`⏪ ${when.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`, 16, CV.h - 30);
  }
}

function nodeAt(x, y) {
  for (let i = CV.nodes.length - 1; i >= 0; i--) {
    const n = CV.nodes[i];
    if (!cvNodeVisible(n)) continue;
    if (Math.hypot(n.x - x, n.y - y) <= n.r + 4) return n;
  }
  return null;
}

function bindConstellationEvents() {
  CV._bound = true;

  document.querySelectorAll('.edge-toggle').forEach((btn) =>
    btn.addEventListener('click', () => {
      const kind = btn.dataset.edge;
      CV.filters[kind] = !CV.filters[kind];
      btn.classList.toggle('off', !CV.filters[kind]);
    }));

  document.getElementById('cv-replay').addEventListener('click', () => {
    if (CV.replay) {
      CV.replay = null;
      document.getElementById('cv-replay').textContent = '⏪ Timelapse';
    } else {
      startTimelapse();
    }
  });

  const canvas = CV.canvas;
  const pos = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  };

  canvas.addEventListener('pointerdown', (ev) => {
    const [x, y] = pos(ev);
    const n = nodeAt(x, y);
    if (n) { CV.dragging = n; CV._moved = false; canvas.setPointerCapture(ev.pointerId); }
  });
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = pos(ev);
    if (CV.dragging) {
      CV.dragging.x = x; CV.dragging.y = y;
      CV._moved = true;
      return;
    }
    CV.hover = nodeAt(x, y);
    canvas.style.cursor = CV.hover ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerup', (ev) => {
    if (CV.dragging && !CV._moved) {
      CV.selected = CV.selected === CV.dragging ? null : CV.dragging;
      showConstellationTip(CV.selected);
    }
    CV.dragging = null;
  });
  canvas.addEventListener('pointerleave', () => { CV.hover = null; });
  window.addEventListener('resize', () => {
    if (!document.getElementById('view-constellation').classList.contains('hidden')) sizeConstellation();
  });
}

function showConstellationTip(n) {
  const tip = document.getElementById('cv-tip');
  if (!n) { tip.classList.add('hidden'); return; }
  if (n.type === 'person') {
    const p = n.data;
    const projs = projectsOf(p.id).map((pr) => pr.name).join(', ');
    tip.innerHTML = `
      <div class="cv-tip-head">${avatarHtml(p)}<div><strong>${esc(p.name)}</strong>
        ${p.role ? `<div class="card-role">${esc(p.role)}</div>` : ''}</div></div>
      ${projs ? `<div>🛠 ${esc(projs)}</div>` : ''}
      ${p.lookingFor ? `<div class="card-oneliner">Looking for: ${esc(p.lookingFor.slice(0, 120))}${p.lookingFor.length > 120 ? '…' : ''}</div>` : ''}
      <div class="cv-tip-links">
        ${p.telegram ? `<a href="${esc(handleUrl('telegram', p.telegram))}" target="_blank">✈ Telegram</a>` : ''}
        ${p.x ? `<a href="${esc(handleUrl('x', p.x))}" target="_blank">𝕏</a>` : ''}
        ${p.email ? `<a href="mailto:${esc(p.email)}">✉ Email</a>` : ''}
      </div>`;
  } else {
    const pr = n.data;
    const team = membersOf(pr).map((m) => m.name).join(', ');
    const tries = state.tries.filter((t) => t.to === pr.id).length;
    tip.innerHTML = `
      <div class="cv-tip-head"><span class="cv-diamond-lg"></span><div><strong>${esc(pr.name)}</strong>
        ${pr.oneLiner ? `<div class="card-role">${esc(pr.oneLiner)}</div>` : ''}</div></div>
      ${team ? `<div>👥 ${esc(team)}</div>` : ''}
      ${tries ? `<div>🧪 ${tries} tried it</div>` : ''}
      ${(pr.links || []).length ? `<div class="cv-tip-links"><a href="${esc(normalizeLink(pr.links[0]))}" target="_blank">Try it 🚀</a></div>` : ''}`;
  }
  tip.classList.remove('hidden');
}
