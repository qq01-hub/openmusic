import { isWeakPlaybackDevice } from './weakPlaybackDevice';

type Pointer = { x: number; y: number; active: boolean };
type Field = { form: number; exit: number; impulse: number; quiet: boolean };
type Particle = { x: number; y: number; z: number; phase: number; sinPhase: number; cosPhase: number; burst: number; sinWave: number; cosWave: number; size: number; color: number; dx: number; dy: number; vx: number; vy: number; note: boolean };
const TAU = Math.PI * 2;
const COLORS = ['#ff4d55', '#ff858d', '#f6b6c7', '#f472b6', '#c084fc', '#fff1ec'];

export function shouldRenderStartupParticle(index: number, note: boolean, stride: number) {
  return note || index % stride === 0;
}

/** A dimensional vinyl sculpture: the record and waveform come from BrandMark. */
export function startParticleField(canvas: HTMLCanvasElement, pointer: Pointer, field: Field) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => undefined;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const weak = isWeakPlaybackDevice();
  let width = 0, height = 0, radius = 0, cx = 0, cy = 0;
  let particles: Particle[] = [];
  let raf = 0, previousTime = 0, time = 0, frameCount = 0, slowFrames = 0;
  let stride = 1;
  let yaw = 0, pitch = 0;
  const circle = Array.from({ length: 97 }, (_, index) => ({ x: Math.cos(index / 96 * TAU), y: Math.sin(index / 96 * TAU) }));
  const projection = { x: 0, y: 0, depth: 0, perspective: 1 };

  // Soft light is rasterized once. No blur, shadow or new gradient per particle/frame.
  const sprites = COLORS.map((color) => {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 32;
    const c = sprite.getContext('2d')!;
    const light = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    light.addColorStop(0, '#fff8f5'); light.addColorStop(.16, color);
    light.addColorStop(.4, color + '65'); light.addColorStop(1, color + '00');
    c.fillStyle = light; c.fillRect(0, 0, 32, 32);
    return sprite;
  });

  function render(now: number) {
    if (!ctx || field.quiet || document.hidden) return;
    const elapsed = now - previousTime;
    // Mobile/weak devices run at 30fps; desktop adapts if the frame budget is exceeded.
    const paced = weak || width < 700 || stride > 1;
    if (!reduced.matches && paced && elapsed < 30) {
      raf = requestAnimationFrame(render);
      return;
    }
    const step = Math.min(elapsed / 16.667 || 1, 2.5);
    previousTime = now;
    if (!reduced.matches) time += Math.min(elapsed / 1000, .04);
    if (++frameCount < 90 && elapsed > (paced ? 48 : 26)) slowFrames++;
    if (frameCount === 90 && slowFrames > 35) stride = 2;
    const t = time;
    const form = reduced.matches ? 1 : field.form;
    const exit = field.exit;
    const active = pointer.active && !reduced.matches && exit === 0;
    const pulseSin = Math.sin(t * 1.3), pulseCos = Math.cos(t * 1.3);
    const twinkleSin = Math.sin(t * 1.6), twinkleCos = Math.cos(t * 1.6);
    const driftSin = Math.sin(t * .12), driftCos = Math.cos(t * .12);
    const waveSin = Math.sin(t), waveCos = Math.cos(t);
    const gather = (1 - form) * radius;
    yaw += (((active ? (pointer.x / width - .5) * .45 : Math.sin(t * .5) * .12)) - yaw) * .06 * step;
    pitch += (((active ? (pointer.y / height - .4) * .25 : 0)) - pitch) * .06 * step;
    const angle = -.32 + yaw;
    const cosY = Math.cos(angle), sinY = Math.sin(angle);
    const cosX = Math.cos(.22 + pitch), sinX = Math.sin(.22 + pitch);
    const roll = -.22;
    const cosR = Math.cos(roll), sinR = Math.sin(roll);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    const project = (x: number, y: number, z: number) => {
      const rx = x * cosY + z * sinY;
      const rz = z * cosY - x * sinY;
      const ry = y * cosX - rz * sinX;
      const depth = y * sinX + rz * cosX;
      const perspective = 3.6 / (3.6 + depth);
      projection.x = cx + (rx * cosR - ry * sinR) * radius * perspective;
      projection.y = cy + (rx * sinR + ry * cosR) * radius * perspective;
      projection.depth = depth;
      projection.perspective = perspective;
      return projection;
    };

    // Engraved grooves and an outer light rim make the form read as a record, not a globe.
    ctx.globalAlpha = form * (1 - exit);
    for (let ring = 0; ring < 13; ring++) {
      const r = .54 + ring * .037;
      ctx.beginPath();
      for (let j = 0; j <= 96; j++) {
        const p = project(circle[j].x * r, circle[j].y * r, -.035);
        if (!j) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = ring === 12 ? '#ff7a85a0' : ring % 3 === 0 ? '#ffc0cd38' : '#ec759b1a';
      ctx.lineWidth = ring === 12 ? 1.2 : .6;
      ctx.stroke();
    }

    // Two offset highlights travel around the record's front/back rims.
    for (let edge = 0; edge < 2; edge++) {
      ctx.beginPath();
      for (let j = 0; j <= 46; j++) {
        const a = j / 46 * Math.PI * .85 + t * .18 + edge * Math.PI;
        const p = project(Math.cos(a) * 1.025, Math.sin(a) * 1.025, edge ? .095 : -.095);
        if (!j) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = edge ? '#c084fc60' : '#ff9dab90'; ctx.lineWidth = 1; ctx.stroke();
    }

    // BrandMark's exact waveform, suspended across the record's label.
    const waveform = [[-.9, 0], [-.61, 0], [-.41, -.4], [-.15, .37], [.13, -.62], [.37, .16], [.55, -.12], [.9, -.12]];
    ctx.beginPath();
    waveform.forEach(([x, y], i) => {
      const p = project(x * .53, y * .53, -.1);
      if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = '#ffc8d84d'; ctx.lineWidth = 1; ctx.stroke();

    // Fine concentric sound waves remain behind the sculpture, never over the headline.
    for (let band = 0; band < 5; band++) {
      ctx.beginPath();
      for (let j = 0; j <= 85; j++) {
        const u = j / 85;
        const envelope = Math.sin(u * Math.PI) ** 3;
        const x = width * (.08 + u * .84);
        const y = cy + radius * .82 + Math.sin(u * 12 + t * .7 + band * .12) * radius * .10 * envelope + band * 5;
        if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = band === 2 ? '#f472b628' : '#ff4d5515'; ctx.lineWidth = .7; ctx.stroke();
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!shouldRenderStartupParticle(i, p.note, stride)) continue;
      const pulse = 1 + (pulseSin * p.cosPhase + pulseCos * p.sinPhase) * .013;
      const projected = project(p.x * pulse, p.y * pulse, p.z);
      let x = projected.x, y = projected.y;
      if (gather > 0) {
        x += (p.cosPhase * driftCos - p.sinPhase * driftSin) * gather * 1.5;
        y += (p.sinPhase * driftCos + p.cosPhase * driftSin) * gather;
      }
      if (exit > 0) {
        const waveX = (i / particles.length) * width * 1.3 - width * .15;
        const waveY = height * .31 + (p.sinWave * waveCos + p.cosWave * waveSin) * radius * .09 + p.sinPhase * 4;
        x += (waveX - x) * exit;
        y += (waveY - y) * exit;
      }
      if (!reduced.matches) {
        if (active) {
          const dx = x + p.dx - pointer.x, dy = y + p.dy - pointer.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const reach = width < 700 ? 65 : 100;
          if (distance < reach) {
            const force = (1 - distance / reach) * .9 * step;
            p.vx += dx / distance * force; p.vy += dy / distance * force;
          }
        }
        p.vx = (p.vx - p.dx * .025 * step) * Math.pow(.86, step);
        p.vy = (p.vy - p.dy * .025 * step) * Math.pow(.86, step);
        p.dx += p.vx * step; p.dy += p.vy * step;
      }
      const burst = field.impulse * p.burst * radius * .15;
      const px = x + p.dx + p.cosPhase * burst;
      const py = y + p.dy + p.sinPhase * burst;
      const twinkle = .75 + (twinkleSin * p.cosPhase + twinkleCos * p.sinPhase) * .25;
      const size = p.size * projected.perspective * (p.note ? 1.2 : 1);
      ctx.globalAlpha = Math.max(0, (.55 + form * .45) * (1 - exit) * twinkle * (1 - projected.depth * .22));
      if (i % 5 === 0 || p.note && i % 3 === 0) {
        const glow = size * 5;
        ctx.drawImage(sprites[p.color], px - glow / 2, py - glow / 2, glow, glow);
      } else {
        ctx.fillStyle = COLORS[p.color];
        ctx.fillRect(px, py, size, size);
      }
    }

    // A touch plucks the visual instrument; it never starts audio or delays entry.
    if (field.impulse > .01 && !reduced.matches) {
      ctx.globalAlpha = field.impulse * .5 * (1 - exit);
      ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 18 + (1 - field.impulse) * radius * 1.5, 0, TAU);
      ctx.strokeStyle = '#ffacbb'; ctx.lineWidth = .8; ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (!reduced.matches && !field.quiet) raf = requestAnimationFrame(render);
  }

  function resize() {
    cancelAnimationFrame(raf);
    width = canvas.clientWidth; height = canvas.clientHeight;
    if (!width || !height) return;
    const narrow = width < 700;
    const dpr = Math.min(window.devicePixelRatio || 1, narrow || weak ? 1.25 : 1.5, Math.sqrt(2_500_000 / (width * height)));
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = width * .5; cy = height * (narrow ? .34 : .39);
    radius = Math.min(width * (narrow ? .43 : .28), height * (narrow ? .205 : .265));
    const count = weak ? 1000 : narrow ? 1500 : Math.min(3200, Math.round(width * height / 300));
    particles = Array.from({ length: count }, (_, i) => {
      const phase = i * 2.399963;
      const ratio = i / count;
      let x: number, y: number, z: number;
      const note = ratio > .66;
      if (!note) {
        // Disc surface plus a rounded, illuminated edge: 3D without a WebGL bundle.
        const distribution = Math.sin(i * 127.1 + 311.7) * 43758.5453;
        const r = .66 + Math.sqrt(distribution - Math.floor(distribution)) * .35;
        const a = phase;
        x = Math.cos(a) * r; y = Math.sin(a) * r;
        z = Math.sin(i * 1.77) * .13 + Math.cos(a * 3) * .018;
      } else {
        // Beamed eighth notes, with volumetric heads and stems.
        const u = (ratio - .66) / .34;
        const side = i % 2;
        const noise = Math.sin(i * 12.9898) * .5 + .5;
        if (u < .53) {
          const r = Math.sqrt(noise);
          x = -.23 + side * .39 + Math.cos(phase) * .135 * r;
          y = .22 - side * .09 + Math.sin(phase) * .09 * r;
        } else if (u < .84) {
          x = -.12 + side * .39 + Math.sin(phase) * .018;
          y = .23 - side * .09 - noise * .57;
        } else {
          x = -.14 + noise * .43;
          y = -.33 - noise * .1 + Math.sin(phase) * .035;
        }
        z = -.18 + Math.cos(phase) * .035;
      }
      return { x, y, z, phase, sinPhase: Math.sin(phase), cosPhase: Math.cos(phase), burst: Math.sin(phase * 3), sinWave: Math.sin(i * .028), cosWave: Math.cos(i * .028), note, size: .8 + ((i * .713) % 1) * (note ? 1.1 : 1.7),
        color: note ? (i % 5 === 0 ? 5 : 2) : x < -.15 ? i % 3 : 1 + i % 4,
        dx: 0, dy: 0, vx: 0, vy: 0 };
    });
    previousTime = performance.now();
    render(previousTime + 34);
  }
  function visibility() { cancelAnimationFrame(raf); previousTime = performance.now(); if (!document.hidden) render(previousTime + 34); }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  reduced.addEventListener('change', resize);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    cancelAnimationFrame(raf); observer.disconnect();
    reduced.removeEventListener('change', resize);
    document.removeEventListener('visibilitychange', visibility);
    sprites.forEach((sprite) => { sprite.width = sprite.height = 0; });
    canvas.width = canvas.height = 0;
  };
}
