/* Planet — builders 3D sphere, Fibonacci-distributed PFPs with drag/momentum.
   Same interaction model as the SphereImageGrid React component, ported
   to vanilla DOM so it fits this zero-dep app. Lives in the Planet tab. */

const SPHERE = {
  wrap: null,
  stage: null,
  people: [],
  positions: [],
  rotation: { x: 15, y: 15 },
  velocity: { x: 0, y: 0 },
  dragging: false,
  lastPos: { x: 0, y: 0 },
  hovered: null,
  raf: null,
  size: 560,
  radius: 200,
  dragSensitivity: 0.8,
  momentumDecay: 0.96,
  maxSpeed: 6,
  baseScale: 0.14,
  autoRotate: true,
  autoRotateSpeed: 0.2,
  bound: false,
};

const SPHERE_MATH = {
  deg: (d) => d * (Math.PI / 180),
  norm: (a) => {
    while (a > 180) a -= 360;
    while (a < -180) a += 360;
    return a;
  },
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
};

function sphereContainerSize() {
  const wrap = SPHERE.wrap || document.getElementById('builders-sphere-wrap');
  if (!wrap) return 560;
  const w = wrap.clientWidth || 560;
  return Math.max(280, Math.min(600, Math.floor(w)));
}

function generateSpherePositions(count, radius) {
  const positions = [];
  const golden = (1 + Math.sqrt(5)) / 2;
  const angleInc = (2 * Math.PI) / golden;
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(count, 1);
    let phi = Math.acos(1 - 2 * t) * (180 / Math.PI);
    let theta = ((angleInc * i) * (180 / Math.PI)) % 360;
    const poleBonus = Math.pow(Math.abs(phi - 90) / 90, 0.6) * 35;
    if (phi < 90) phi = Math.max(5, phi - poleBonus);
    else phi = Math.min(175, phi + poleBonus);
    phi = 15 + (phi / 180) * 150;
    // Stable jitter from index (avoid Math.random reshuffle on every filter tweak)
    const j1 = ((i * 17) % 100) / 100 - 0.5;
    const j2 = ((i * 31) % 100) / 100 - 0.5;
    theta = (theta + j1 * 20 + 360) % 360;
    phi = SPHERE_MATH.clamp(phi + j2 * 10, 0, 180);
    positions.push({ theta, phi, radius });
  }
  return positions;
}

function worldPositions() {
  const { positions, rotation, radius, size, baseScale } = SPHERE;
  const baseImageSize = size * baseScale;
  const rotX = SPHERE_MATH.deg(rotation.x);
  const rotY = SPHERE_MATH.deg(rotation.y);

  const out = positions.map((pos, index) => {
    const theta = SPHERE_MATH.deg(pos.theta);
    const phi = SPHERE_MATH.deg(pos.phi);
    let x = pos.radius * Math.sin(phi) * Math.cos(theta);
    let y = pos.radius * Math.cos(phi);
    let z = pos.radius * Math.sin(phi) * Math.sin(theta);

    const x1 = x * Math.cos(rotY) + z * Math.sin(rotY);
    const z1 = -x * Math.sin(rotY) + z * Math.cos(rotY);
    x = x1; z = z1;

    const y2 = y * Math.cos(rotX) - z * Math.sin(rotX);
    const z2 = y * Math.sin(rotX) + z * Math.cos(rotX);
    y = y2; z = z2;

    const fadeStart = -10;
    const fadeEnd = -30;
    const isVisible = z > fadeEnd;
    let fadeOpacity = 1;
    if (z <= fadeStart) fadeOpacity = Math.max(0, (z - fadeEnd) / (fadeStart - fadeEnd));

    const isPole = pos.phi < 30 || pos.phi > 150;
    const dist = Math.sqrt(x * x + y * y);
    const distRatio = Math.min(dist / radius, 1);
    const penalty = isPole ? 0.4 : 0.7;
    const centerScale = Math.max(0.3, 1 - distRatio * penalty);
    const depthScale = (z + radius) / (2 * radius);
    const scale = centerScale * Math.max(0.5, 0.8 + depthScale * 0.3);

    return {
      x, y, z, scale, fadeOpacity, isVisible,
      zIndex: Math.round(1000 + z),
      originalIndex: index,
    };
  });

  // Collision shrink
  for (let i = 0; i < out.length; i++) {
    const pos = out[i];
    if (!pos.isVisible) continue;
    let adjusted = pos.scale;
    const imageSize = baseImageSize * adjusted;
    for (let j = 0; j < out.length; j++) {
      if (i === j) continue;
      const other = out[j];
      if (!other.isVisible) continue;
      const otherSize = baseImageSize * other.scale;
      const dx = pos.x - other.x;
      const dy = pos.y - other.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const minDistance = (imageSize + otherSize) / 2 + 22;
      if (distance < minDistance && distance > 0) {
        const overlap = minDistance - distance;
        const factor = Math.max(0.4, 1 - (overlap / minDistance) * 0.6);
        adjusted = Math.min(adjusted, adjusted * factor);
      }
    }
    out[i] = { ...pos, scale: Math.max(0.25, adjusted) };
  }
  return out;
}

function sphereNodeHtml(p, index) {
  const color = avatarColor(p.name || '?');
  const ini = esc(initials(p.name || '?'));
  const face = p.photoUrl
    ? `<img src="${esc(p.photoUrl)}" alt="${esc(p.name || '')}" draggable="false" loading="${index < 4 ? 'eager' : 'lazy'}" />`
    : `<span class="sphere-fallback" style="background:${color}">${ini}</span>`;
  return `<button type="button" class="sphere-node" data-sphere-id="${esc(p.id)}" data-sphere-i="${index}" aria-label="${esc(p.name || 'Builder')}">${face}</button>`;
}

function paintSphereNodes() {
  if (!SPHERE.stage) return;
  const worlds = worldPositions();
  const baseImageSize = SPHERE.size * SPHERE.baseScale;
  const half = SPHERE.size / 2;
  const nodes = SPHERE.stage.querySelectorAll('.sphere-node');
  nodes.forEach((el) => {
    const i = Number(el.dataset.sphereI);
    const pos = worlds[i];
    if (!pos || !pos.isVisible) {
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
      return;
    }
    const imageSize = baseImageSize * pos.scale;
    const hovered = SPHERE.hovered === i;
    const boost = hovered ? Math.min(1.25, 1.2 / pos.scale) : 1;
    el.style.visibility = 'visible';
    el.style.pointerEvents = 'auto';
    el.style.width = `${imageSize}px`;
    el.style.height = `${imageSize}px`;
    el.style.left = `${half + pos.x}px`;
    el.style.top = `${half + pos.y}px`;
    el.style.opacity = String(pos.fadeOpacity);
    el.style.zIndex = String(pos.zIndex);
    el.style.transform = `translate(-50%, -50%) scale(${boost})`;
  });
}

function tickSphere() {
  const view = document.getElementById('view-planet');
  const active = view && !view.classList.contains('hidden');
  if (!active) {
    SPHERE.raf = null;
    return;
  }

  if (!SPHERE.dragging) {
    let vx = SPHERE.velocity.x * SPHERE.momentumDecay;
    let vy = SPHERE.velocity.y * SPHERE.momentumDecay;
    if (!SPHERE.autoRotate && Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
      vx = 0; vy = 0;
    }
    SPHERE.velocity = { x: vx, y: vy };
    let newY = SPHERE.rotation.y;
    if (SPHERE.autoRotate) newY += SPHERE.autoRotateSpeed;
    newY += SPHERE_MATH.clamp(vy, -SPHERE.maxSpeed, SPHERE.maxSpeed);
    SPHERE.rotation = {
      x: SPHERE_MATH.norm(SPHERE.rotation.x + SPHERE_MATH.clamp(vx, -SPHERE.maxSpeed, SPHERE.maxSpeed)),
      y: SPHERE_MATH.norm(newY),
    };
  }

  paintSphereNodes();
  SPHERE.raf = requestAnimationFrame(tickSphere);
}

function ensureSphereLoop() {
  if (!SPHERE.raf) SPHERE.raf = requestAnimationFrame(tickSphere);
}

function bindSphereEvents() {
  if (SPHERE.bound || !SPHERE.stage) return;
  SPHERE.bound = true;
  const stage = SPHERE.stage;

  const onMove = (clientX, clientY) => {
    if (!SPHERE.dragging) return;
    const dx = clientX - SPHERE.lastPos.x;
    const dy = clientY - SPHERE.lastPos.y;
    const rx = SPHERE_MATH.clamp(-dy * SPHERE.dragSensitivity, -SPHERE.maxSpeed, SPHERE.maxSpeed);
    const ry = SPHERE_MATH.clamp(dx * SPHERE.dragSensitivity, -SPHERE.maxSpeed, SPHERE.maxSpeed);
    SPHERE.rotation = {
      x: SPHERE_MATH.norm(SPHERE.rotation.x + rx),
      y: SPHERE_MATH.norm(SPHERE.rotation.y + ry),
    };
    SPHERE.velocity = { x: rx, y: ry };
    SPHERE.lastPos = { x: clientX, y: clientY };
    paintSphereNodes();
  };

  stage.addEventListener('pointerdown', (e) => {
    SPHERE.dragging = true;
    SPHERE._moved = false;
    SPHERE._pressTarget = e.target.closest('.sphere-node');
    SPHERE.velocity = { x: 0, y: 0 };
    SPHERE.lastPos = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture?.(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!SPHERE.dragging) return;
    const dx = e.clientX - SPHERE.lastPos.x;
    const dy = e.clientY - SPHERE.lastPos.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) SPHERE._moved = true;
    onMove(e.clientX, e.clientY);
  });

  const endDrag = (e) => {
    const wasTap = SPHERE.dragging && !SPHERE._moved && SPHERE._pressTarget;
    SPHERE.dragging = false;
    if (wasTap) {
      const id = SPHERE._pressTarget.dataset.sphereId;
      const person = SPHERE.people.find((p) => p.id === id);
      if (person) openBuilderDetail(person);
    }
    SPHERE._pressTarget = null;
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', () => {
    SPHERE.dragging = false;
    SPHERE._pressTarget = null;
  });

  stage.addEventListener('pointerover', (e) => {
    const node = e.target.closest('.sphere-node');
    SPHERE.hovered = node ? Number(node.dataset.sphereI) : null;
  });
  stage.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget || !stage.contains(e.relatedTarget)) SPHERE.hovered = null;
  });

  window.addEventListener('resize', () => {
    if (document.getElementById('view-planet')?.classList.contains('hidden')) return;
    const next = sphereContainerSize();
    if (next !== SPHERE.size) renderBuildersSphere(SPHERE.people);
  });
}

function renderBuildersSphere(people) {
  SPHERE.wrap = document.getElementById('builders-sphere-wrap');
  SPHERE.stage = document.getElementById('builders-sphere');
  if (!SPHERE.wrap || !SPHERE.stage) return;

  SPHERE.people = people || [];
  SPHERE.size = sphereContainerSize();
  SPHERE.radius = Math.round(SPHERE.size * 0.36);
  SPHERE.positions = generateSpherePositions(SPHERE.people.length, SPHERE.radius);

  SPHERE.stage.style.width = `${SPHERE.size}px`;
  SPHERE.stage.style.height = `${SPHERE.size}px`;

  if (!SPHERE.people.length) {
    SPHERE.stage.innerHTML = `<div class="sphere-empty">No builders match these filters</div>`;
    ensureSphereLoop();
    return;
  }

  SPHERE.stage.innerHTML = SPHERE.people.map(sphereNodeHtml).join('');
  bindSphereEvents();
  paintSphereNodes();
  ensureSphereLoop();
}

function openBuilderDetail(person) {
  const modal = document.getElementById('builder-detail-modal');
  const body = document.getElementById('builder-detail-card');
  if (!modal || !body) return;
  body.innerHTML = personCardHtml(person);
  bindCardActions('#builder-detail-card');
  modal.classList.remove('hidden');
  document.body.classList.add('builder-detail-open');
}

function closeBuilderDetail() {
  const modal = document.getElementById('builder-detail-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const body = document.getElementById('builder-detail-card');
  if (body) body.innerHTML = '';
  document.body.classList.remove('builder-detail-open');
}

function bindBuilderDetailModal() {
  const modal = document.getElementById('builder-detail-modal');
  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = '1';

  // Close via ×, backdrop, or Escape
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-builder-detail]')) {
      e.preventDefault();
      closeBuilderDetail();
      return;
    }
    // Primary card CTAs should dismiss the overlay after they fire
    const cta = e.target.closest(
      '#builder-detail-card [data-connect], #builder-detail-card [data-goto], #builder-detail-card [data-try], #builder-detail-card [data-joinproj], #builder-detail-card [data-editproj]'
    );
    if (cta) {
      // Let the action handler run first, then dismiss
      setTimeout(closeBuilderDetail, 0);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeBuilderDetail();
  });
}
