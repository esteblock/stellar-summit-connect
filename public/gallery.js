/* Builders 3D scroll gallery — lightweight CSS-perspective tunnel.
   Inspired by infinite depth galleries, without Three.js / WebGL. */

const GALLERY = {
  wrap: null,
  stage: null,
  people: [],
  slots: [],
  velocity: 0,
  autoPlay: true,
  lastInteract: 0,
  raf: null,
  bound: false,
  depth: 1100,
  visible: 16,
  speed: 1,
  _lastTs: 0,
  _dragging: false,
  _moved: false,
  _pressX: 0,
  _pressY: 0,
  _pressTarget: null,
};

function gallerySpatial(i) {
  const a = (i * 2.618) % (Math.PI * 2);
  const b = (i * 1.618 + 1.05) % (Math.PI * 2);
  const xr = (i % 3) * 0.95;
  const yr = ((i + 1) % 4) * 0.7;
  return {
    x: Math.sin(a) * xr * 95,
    y: Math.cos(b) * yr * 58,
  };
}

function galleryIsActive() {
  const view = document.getElementById('view-builders');
  const wrap = document.getElementById('builders-gallery-wrap');
  return !!(view && !view.classList.contains('hidden')
    && wrap && !wrap.classList.contains('hidden'));
}

function fillGalleryCard(el, person) {
  if (!person) return;
  if (el.dataset.galleryId === person.id) return;
  el.dataset.galleryId = person.id;
  el.setAttribute('aria-label', person.name || 'Builder');
  const projs = typeof projectsOf === 'function' ? projectsOf(person.id) : [];
  const projectName = projs[0]?.name || '';
  const color = avatarColor(person.name || '?');
  const ini = esc(initials(person.name || '?'));
  const face = person.photoUrl
    ? `<img class="gallery-avatar" src="${esc(person.photoUrl)}" alt="" draggable="false" loading="lazy" />`
    : `<span class="gallery-avatar gallery-fallback" style="background:${color}">${ini}</span>`;
  el.innerHTML = `
    <div class="gallery-card-head">
      ${face}
      <div class="gallery-card-info">
        <div class="gallery-card-name">${esc(person.name || '')}</div>
        ${projectName
          ? `<div class="gallery-card-project">${esc(projectName)}</div>`
          : (person.role ? `<div class="gallery-card-project">${esc(person.role)}</div>` : '')}
      </div>
    </div>`;
}

function paintGallery() {
  if (!GALLERY.stage || !GALLERY.people.length) return;
  const n = GALLERY.people.length;
  const depth = GALLERY.depth;
  const half = depth / 2;

  GALLERY.slots.forEach((slot, i) => {
    let z = slot.z;
    while (z >= depth) z -= depth;
    while (z < 0) z += depth;
    slot.z = z;

    const t = z / depth;
    let opacity = 1;
    if (t < 0.1) opacity = t / 0.1;
    else if (t > 0.82) opacity = Math.max(0, 1 - (t - 0.82) / 0.16);

    const scale = 0.72 + (1 - t) * 0.38;
    const blur = t > 0.78 ? ((t - 0.78) / 0.22) * 1.6 : t < 0.08 ? ((0.08 - t) / 0.08) * 1.2 : 0;
    const { x, y } = gallerySpatial(i);
    const worldZ = z - half;
    const person = GALLERY.people[((slot.imageIndex % n) + n) % n];
    fillGalleryCard(slot.el, person);

    const el = slot.el;
    el.style.opacity = String(opacity);
    el.style.zIndex = String(Math.round(1000 - z));
    el.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';
    el.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), ${(-worldZ).toFixed(1)}px) scale(${scale.toFixed(3)})`;
    el.style.visibility = opacity < 0.02 ? 'hidden' : 'visible';
    el.style.pointerEvents = opacity > 0.35 ? 'auto' : 'none';
  });
}

function tickGallery(ts) {
  if (!galleryIsActive()) {
    GALLERY.raf = null;
    if (typeof stopFlicker === 'function' && typeof FLICKER !== 'undefined' && FLICKER.host === 'scroll') {
      stopFlicker();
    }
    return;
  }
  if (!GALLERY._lastTs) GALLERY._lastTs = ts;
  const dt = Math.min(0.05, (ts - GALLERY._lastTs) / 1000);
  GALLERY._lastTs = ts;

  if (!GALLERY._dragging && GALLERY.autoPlay && Date.now() - GALLERY.lastInteract > 3200) {
    // Drift toward camera (same direction as scroll-down)
    GALLERY.velocity -= 14 * dt * GALLERY.speed;
  }
  GALLERY.velocity *= 0.90;
  if (Math.abs(GALLERY.velocity) < 0.2) GALLERY.velocity = 0;

  const depth = GALLERY.depth;
  const n = GALLERY.people.length;
  const advance = n > 0 ? (GALLERY.slots.length % n) || n : 0;

  if (Math.abs(GALLERY.velocity) > 0.05 && n) {
    const dz = Math.max(-220, Math.min(220, GALLERY.velocity)) * dt;
    GALLERY.slots.forEach((slot) => {
      let z = slot.z + dz;
      let wrapsFwd = 0;
      let wrapsBack = 0;
      if (z >= depth) {
        wrapsFwd = Math.floor(z / depth);
        z -= depth * wrapsFwd;
      } else if (z < 0) {
        wrapsBack = Math.ceil(-z / depth);
        z += depth * wrapsBack;
      }
      if (wrapsFwd) slot.imageIndex = (slot.imageIndex + wrapsFwd * advance) % n;
      if (wrapsBack) slot.imageIndex = ((slot.imageIndex - wrapsBack * advance) % n + n) % n;
      slot.z = z;
    });
  }

  paintGallery();
  GALLERY.raf = requestAnimationFrame(tickGallery);
}

function ensureGalleryLoop() {
  if (!GALLERY.raf) {
    GALLERY._lastTs = 0;
    GALLERY.raf = requestAnimationFrame(tickGallery);
  }
}

function openGalleryPerson(id) {
  const person = GALLERY.people.find((p) => p.id === id);
  if (person && typeof openBuilderDetail === 'function') openBuilderDetail(person);
}

/** Move tunnel cards immediately (wheel/drag), not the page. */
function applyGalleryScroll(rawDeltaY) {
  if (!GALLERY.people.length || !GALLERY.slots.length) return;
  // Scroll down → cards toward camera → decrease z
  const amount = -rawDeltaY * 2.8;
  const depth = GALLERY.depth;
  const n = GALLERY.people.length;
  const advance = (GALLERY.slots.length % n) || n;

  GALLERY.slots.forEach((slot) => {
    let z = slot.z + amount;
    let wrapsFwd = 0;
    let wrapsBack = 0;
    if (z >= depth) {
      wrapsFwd = Math.floor(z / depth);
      z -= depth * wrapsFwd;
    } else if (z < 0) {
      wrapsBack = Math.ceil(-z / depth);
      z += depth * wrapsBack;
    }
    if (wrapsFwd) slot.imageIndex = (slot.imageIndex + wrapsFwd * advance) % n;
    if (wrapsBack) slot.imageIndex = ((slot.imageIndex - wrapsBack * advance) % n + n) % n;
    slot.z = z;
  });

  // Light leftover momentum for a short coast
  GALLERY.velocity = Math.max(-260, Math.min(260, GALLERY.velocity + amount * 8));
  GALLERY.autoPlay = false;
  GALLERY.lastInteract = Date.now();
  paintGallery();
}

function bindGalleryEvents() {
  if (GALLERY.bound || !GALLERY.wrap) return;
  GALLERY.bound = true;
  const wrap = GALLERY.wrap;

  // Capture-phase on the wrap so the page never eats the wheel
  const onWheel = (e) => {
    if (!galleryIsActive()) return;
    // Only steal wheel when pointer is over the gallery stage
    if (!wrap.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    applyGalleryScroll(e.deltaY);
  };
  wrap.addEventListener('wheel', onWheel, { passive: false, capture: true });

  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    GALLERY._dragging = true;
    GALLERY._moved = false;
    GALLERY._pressX = e.clientX;
    GALLERY._pressY = e.clientY;
    GALLERY._lastY = e.clientY;
    GALLERY._pressTarget = e.target.closest('.gallery-card');
    GALLERY.autoPlay = false;
    GALLERY.lastInteract = Date.now();
    try { wrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!GALLERY._dragging) return;
    const dx = e.clientX - GALLERY._pressX;
    const dy = e.clientY - GALLERY._pressY;
    if (Math.hypot(dx, dy) > 8) GALLERY._moved = true;
    if (GALLERY._moved) {
      const prevY = GALLERY._lastY ?? e.clientY;
      const frameDy = e.clientY - prevY;
      GALLERY._lastY = e.clientY;
      // Drag down = same as scroll down = toward camera
      applyGalleryScroll(frameDy * 2.4);
    }
  });

  const endPointer = () => {
    const tap = GALLERY._dragging && !GALLERY._moved && GALLERY._pressTarget;
    const id = tap ? GALLERY._pressTarget.dataset.galleryId : null;
    GALLERY._dragging = false;
    GALLERY._pressTarget = null;
    GALLERY._lastY = null;
    if (id) openGalleryPerson(id);
  };
  wrap.addEventListener('pointerup', endPointer);
  wrap.addEventListener('pointercancel', () => {
    GALLERY._dragging = false;
    GALLERY._pressTarget = null;
    GALLERY._lastY = null;
  });

  document.addEventListener('keydown', (e) => {
    if (!galleryIsActive()) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      applyGalleryScroll(90);
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      applyGalleryScroll(-90);
    }
  });
}

function renderBuildersGallery(people) {
  GALLERY.wrap = document.getElementById('builders-gallery-wrap');
  GALLERY.stage = document.getElementById('builders-gallery');
  if (!GALLERY.wrap || !GALLERY.stage) return;

  GALLERY.people = people || [];
  GALLERY.lastInteract = Date.now();
  GALLERY.autoPlay = true;
  GALLERY.velocity = 0;

  if (!GALLERY.people.length) {
    GALLERY.stage.innerHTML = `<div class="gallery-empty">No builders match these filters</div>`;
    GALLERY.slots = [];
    ensureGalleryLoop();
    return;
  }

  const count = Math.min(GALLERY.visible, Math.max(GALLERY.people.length, 10));
  const depth = GALLERY.depth;
  GALLERY.stage.innerHTML = '';
  GALLERY.slots = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'gallery-card';
    const person = GALLERY.people[i % GALLERY.people.length];
    fillGalleryCard(el, person);
    GALLERY.stage.appendChild(el);
    GALLERY.slots.push({
      el,
      z: (depth / count) * i,
      imageIndex: i % GALLERY.people.length,
    });
  }

  bindGalleryEvents();
  paintGallery();
  ensureGalleryLoop();
  if (typeof initStellarFlicker === 'function') initStellarFlicker('scroll');
}

function stopGallery() {
  if (GALLERY.raf) {
    cancelAnimationFrame(GALLERY.raf);
    GALLERY.raf = null;
  }
}
