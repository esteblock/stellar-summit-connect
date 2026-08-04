/* Minimal Stellar logo flicker grid — ported from Stellar-Light/stellarlight
   FlickeringGrid (landing hover). Vanilla canvas, no deps.
   Used behind World sphere and Scroll gallery. */

const FLICKER = {
  canvas: null,
  ctx: null,
  squares: [],
  trail: [],
  raf: null,
  bound: false,
  host: null, // 'world' | 'scroll'
  size: 200,
  squareSize: 5,
  gridGap: 3,
  color: '#FDDA24',
  inactive: '#3a3a38',
  trailRadius: 56,
  time: 0,
  activation: 0,
  retraceAt: -1,
  logo: null,
};

function flickerHostWrap(host) {
  return document.getElementById(host === 'scroll' ? 'builders-gallery-wrap' : 'builders-sphere-wrap');
}

function flickerCanvasId(host) {
  return host === 'scroll' ? 'gallery-stellar-mark' : 'sphere-stellar-mark';
}

function flickerActive() {
  const view = document.getElementById('view-builders');
  if (!view || view.classList.contains('hidden')) return false;
  const wrap = flickerHostWrap(FLICKER.host);
  return !!(wrap && !wrap.classList.contains('hidden'));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function buildSquaresFromLogo(img) {
  const size = FLICKER.size;
  const sq = FLICKER.squareSize;
  const gap = FLICKER.gridGap;
  const step = sq + gap;
  const tmp = document.createElement('canvas');
  tmp.width = img.naturalWidth;
  tmp.height = img.naturalHeight;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(img, 0, 0);
  const { data } = tctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
  const sx = img.naturalWidth / size;
  const sy = img.naturalHeight / size;
  const squares = [];

  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const lx = Math.floor(x * sx);
      const ly = Math.floor(y * sy);
      const bw = Math.ceil(sq * sx);
      const bh = Math.ceil(sq * sy);
      let has = false;
      let alphaSum = 0;
      let n = 0;
      for (let by = 0; by < bh && ly + by < img.naturalHeight; by++) {
        for (let bx = 0; bx < bw && lx + bx < img.naturalWidth; bx++) {
          const a = data[((ly + by) * img.naturalWidth + (lx + bx)) * 4 + 3];
          alphaSum += a;
          n++;
          if (a > 50) has = true;
        }
      }
      if (has && n && alphaSum / n > 30) {
        squares.push({
          x, y, filled: 0, order: -1,
          phase: Math.random() * Math.PI * 2,
          intensity: 0.03 + Math.random() * 0.07,
        });
      }
    }
  }
  return squares;
}

function paintFlicker() {
  const ctx = FLICKER.ctx;
  const { size, squareSize: sq, color, inactive, trailRadius } = FLICKER;
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  FLICKER.time++;
  FLICKER.trail.forEach((p) => { p.age++; });

  const hovering = FLICKER.trail.length > 0;
  if (!hovering && FLICKER.retraceAt < 0) {
    FLICKER.retraceAt = FLICKER.time;
    const filled = FLICKER.squares.filter((s) => s.filled > 0 && s.order >= 0);
    const max = Math.max(0, ...filled.map((s) => s.order));
    filled.forEach((s) => { s.order = max - s.order; });
  } else if (hovering) {
    FLICKER.retraceAt = -1;
  }

  for (const s of FLICKER.squares) {
    let closest = Infinity;
    let age = 0;
    for (const t of FLICKER.trail) {
      const dx = s.x + sq / 2 - t.x;
      const dy = s.y + sq / 2 - t.y;
      const d = Math.hypot(dx, dy);
      if (d < closest) { closest = d; age = t.age; }
    }

    if (closest < trailRadius && hovering) {
      const target = Math.max(0, 1 - age / 60);
      s.filled = Math.min(1, s.filled + (target - s.filled) * 0.15);
      s.order = FLICKER.activation++;
    } else if (!hovering && s.filled > 0 && FLICKER.retraceAt >= 0) {
      if (FLICKER.time - FLICKER.retraceAt >= s.order * 0.8) {
        s.filled = Math.max(0, s.filled - 0.1);
        if (!s.filled) s.order = -1;
      }
    } else if (hovering && closest >= trailRadius) {
      s.filled = Math.max(0, s.filled - 0.02);
    }

    s.phase += 0.05 + Math.random() * 0.03;
    const flicker = Math.max(0, Math.sin(s.phase) * s.intensity);

    roundRect(ctx, s.x, s.y, sq, sq, 1.5);
    if (flicker > 0 && s.filled === 0) {
      const base = parseInt(inactive.slice(1), 16);
      const r = Math.min(255, ((base >> 16) & 255) + flicker * 180);
      const g = Math.min(255, ((base >> 8) & 255) + flicker * 180);
      const b = Math.min(255, (base & 255) + flicker * 180);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    } else {
      ctx.fillStyle = inactive;
    }
    ctx.fill();

    if (s.filled > 0) {
      roundRect(ctx, s.x, s.y, sq, sq, 1.5);
      const a = Math.floor(s.filled * 255).toString(16).padStart(2, '0');
      ctx.fillStyle = `${color}${a}`;
      ctx.fill();
    }
  }
}

function tickFlicker() {
  if (!flickerActive()) {
    FLICKER.raf = null;
    return;
  }
  paintFlicker();
  FLICKER.raf = requestAnimationFrame(tickFlicker);
}

function ensureFlickerLoop() {
  if (!FLICKER.raf) FLICKER.raf = requestAnimationFrame(tickFlicker);
}

function stopFlicker() {
  if (FLICKER.raf) {
    cancelAnimationFrame(FLICKER.raf);
    FLICKER.raf = null;
  }
  FLICKER.trail = [];
  FLICKER.host = null;
}

function feedFlickerTrail(clientX, clientY) {
  const canvas = FLICKER.canvas;
  if (!canvas || !flickerActive()) return;
  const rect = canvas.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return;
  }
  const scaleX = FLICKER.size / rect.width;
  const scaleY = FLICKER.size / rect.height;
  FLICKER.trail.unshift({
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
    age: 0,
  });
  if (FLICKER.trail.length > 25) FLICKER.trail.pop();
}

function bindFlickerPointer() {
  if (FLICKER.bound) return;
  FLICKER.bound = true;
  // Sample from both hosts — canvas has pointer-events:none so cards/sphere keep drag
  ['builders-sphere-wrap', 'builders-gallery-wrap'].forEach((id) => {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.addEventListener('pointermove', (e) => feedFlickerTrail(e.clientX, e.clientY));
    wrap.addEventListener('pointerleave', () => {
      if (flickerHostWrap(FLICKER.host) === wrap) FLICKER.trail = [];
    });
  });
}

function loadFlickerLogo() {
  return new Promise((resolve, reject) => {
    if (FLICKER.logo && FLICKER.logo.complete && FLICKER.logo.naturalWidth) {
      resolve(FLICKER.logo);
      return;
    }
    const img = new Image();
    img.onload = () => { FLICKER.logo = img; resolve(img); };
    img.onerror = reject;
    img.src = '/stellar-xlm-logo.png';
  });
}

/** @param {'world'|'scroll'} host */
function initStellarFlicker(host = 'world') {
  const canvas = document.getElementById(flickerCanvasId(host));
  const wrap = flickerHostWrap(host);
  if (!canvas || !wrap || wrap.classList.contains('hidden')) return;

  FLICKER.host = host;
  FLICKER.canvas = canvas;
  FLICKER.ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (host === 'scroll') {
    const w = wrap.clientWidth || 600;
    FLICKER.size = Math.max(200, Math.min(320, Math.round(w * 0.42)));
  } else {
    const stage = document.getElementById('builders-sphere');
    const stageSize = stage ? (parseInt(stage.style.width, 10) || stage.clientWidth || 400) : 400;
    FLICKER.size = Math.max(140, Math.min(220, Math.round(stageSize * 0.38)));
  }

  canvas.width = FLICKER.size;
  canvas.height = FLICKER.size;
  canvas.style.width = `${FLICKER.size}px`;
  canvas.style.height = `${FLICKER.size}px`;

  loadFlickerLogo().then((img) => {
    if (FLICKER.host !== host) return; // mode switched mid-load
    FLICKER.squares = buildSquaresFromLogo(img);
    FLICKER.time = 0;
    FLICKER.activation = 0;
    FLICKER.retraceAt = -1;
    FLICKER.trail = [];
    bindFlickerPointer();
    ensureFlickerLoop();
  }).catch(() => {});
}
