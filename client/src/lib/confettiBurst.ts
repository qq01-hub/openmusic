/** 贵宾进房欢迎礼花 — 轻量 canvas；聊天区不可用时回退全屏，保证房内全员可见 */

const activeBursts = new WeakMap<HTMLElement, () => void>();

function resolveConfettiHost(container?: HTMLElement | null): {
  host: HTMLElement;
  width: number;
  height: number;
  fullscreen: boolean;
} | null {
  if (typeof document === 'undefined') return null;

  const preferred = container && container.isConnected ? container : null;
  const width = preferred?.clientWidth ?? 0;
  const height = preferred?.clientHeight ?? 0;
  if (preferred && width > 32 && height > 32) {
    return { host: preferred, width, height, fullscreen: false };
  }

  const host = document.body;
  const vw = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
  const vh = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0);
  if (vw <= 0 || vh <= 0) return null;
  return { host, width: vw, height: vh, fullscreen: true };
}

export function fireWelcomeConfetti(container?: HTMLElement | null, durationMs = 2800) {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const resolved = resolveConfettiHost(container);
  if (!resolved || document.hidden) return;

  const { host, width, height, fullscreen } = resolved;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  activeBursts.get(host)?.();

  const dpr = 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.cssText = fullscreen
    ? 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;background:transparent;'
    : 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:20;background:transparent;';
  host.appendChild(canvas);

  const clearCanvas = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  clearCanvas();

  const colors = ['#f6d365', '#fb7185', '#67e8f9', '#c4b5fd', '#6ee7b7', '#fbbf24', '#fda4af', '#fff'];
  const edgePad = 4;

  type ParticleKind = 'circle' | 'rect' | 'ribbon';
  type Side = 'left' | 'right' | 'center';
  const sprites = new Map<string, HTMLCanvasElement>();
  for (const kind of ['circle', 'rect', 'ribbon'] as const) {
    for (const color of colors) {
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = 24;
      const spriteCtx = sprite.getContext('2d');
      if (!spriteCtx) continue;
      spriteCtx.translate(12, 12);
      spriteCtx.scale(2, 2);
      spriteCtx.fillStyle = color;
      spriteCtx.beginPath();
      if (kind === 'circle') {
        spriteCtx.arc(0, 0, 3.6, 0, Math.PI * 2);
      } else {
        const spriteWidth = kind === 'rect' ? 8 : 10.8;
        const spriteHeight = kind === 'rect' ? 4.4 : 2.56;
        if (typeof spriteCtx.roundRect === 'function') {
          spriteCtx.roundRect(-spriteWidth / 2, -spriteHeight / 2, spriteWidth, spriteHeight, kind === 'rect' ? 1 : spriteHeight / 2);
        } else {
          spriteCtx.rect(-spriteWidth / 2, -spriteHeight / 2, spriteWidth, spriteHeight);
        }
      }
      spriteCtx.fill();
      sprites.set(`${kind}:${color}`, sprite);
    }
  }

  /**
   * 两侧 + 底部轻喷：以向上为主、略向室内铺开，速度/重力偏「正常礼花」节奏，
   * 避免冲太快或中间空空。
   */
  const createParticle = (index: number, side: Side) => {
    let originX: number;
    let originY: number;
    let angle: number;

    if (side === 'center') {
      originX = width * (0.35 + Math.random() * 0.3);
      originY = height * (0.9 + Math.random() * 0.06);
      // 近乎正上，轻微左右摆，铺满中路
      angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.55;
    } else if (side === 'left') {
      originX = width * (0.05 + Math.random() * 0.12);
      originY = height * (0.86 + Math.random() * 0.1);
      // 偏右上进入视野，但水平分量不大，少交叉
      angle = -Math.PI / 2 + (0.05 + Math.random() * 0.38);
    } else {
      originX = width * (0.83 + Math.random() * 0.12);
      originY = height * (0.86 + Math.random() * 0.1);
      angle = -Math.PI / 2 - (0.05 + Math.random() * 0.38);
    }

    // 正常礼花初速（约 9–15 px/帧），别冲屏
    const speed = 9 + Math.random() * 6;

    const kindRoll = Math.random();
    const kind: ParticleKind = kindRoll < 0.38 ? 'circle' : kindRoll < 0.78 ? 'rect' : 'ribbon';
    const color = colors[Math.floor(Math.random() * colors.length)];

    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: kind === 'ribbon' ? 4 + Math.random() * 4 : 3.2 + Math.random() * 3.8,
      sprite: sprites.get(`${kind}:${color}`),
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.22,
      // 温和重力：升一会儿再落下，总时长约 2.5–3s
      gravity: 0.28 + Math.random() * 0.12,
      drag: 0.985 + Math.random() * 0.01,
      kind,
      delay: (index % 6) * 35 + Math.random() * 90,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.06 + Math.random() * 0.05,
      wobbleAmp: 0.2 + Math.random() * 0.35,
    };
  };

  // 手机聊天区宽度约 360 → ~86；桌面更密一点
  const count = Math.round(Math.min(108, Math.max(72, width * 0.24)));
  const particles = Array.from({ length: count }, (_, index) => {
    const lane = index % 5;
    const side: Side = lane === 0 || lane === 1 ? 'left' : lane === 2 || lane === 3 ? 'right' : 'center';
    return createParticle(index, side);
  });

  const start = performance.now();
  let previousFrame = start;
  let raf = 0;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    canvas.remove();
    document.removeEventListener('visibilitychange', onVisibility);
    activeBursts.delete(host);
  };
  const onVisibility = () => { if (document.hidden) cleanup(); };
  document.addEventListener('visibilitychange', onVisibility);
  activeBursts.set(host, cleanup);

  const drawParticle = (
    p: (typeof particles)[number],
    alpha: number,
  ) => {
    if (!p.sprite) return;
    ctx.globalAlpha = alpha;
    const cos = p.kind === 'circle' ? 1 : Math.cos(p.rot);
    const sin = p.kind === 'circle' ? 0 : Math.sin(p.rot);
    ctx.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, p.x * dpr, p.y * dpr);
    const spriteSize = p.size * 1.5;
    ctx.drawImage(p.sprite, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize);
  };

  const tick = (now: number) => {
    const elapsed = now - start;
    if (!host.isConnected || document.hidden || elapsed >= durationMs + 500) {
      cleanup();
      return;
    }
    const frameStep = Math.max(0, Math.min(3, (now - previousFrame) / (1000 / 60)));
    previousFrame = now;
    clearCanvas();

    let alive = 0;
    for (const p of particles) {
      const localElapsed = elapsed - p.delay;
      if (localElapsed < 0) {
        alive += 1;
        continue;
      }

      const step = Math.min(frameStep, localElapsed / (1000 / 60));
      p.wobble += p.wobbleSpeed * step;
      p.x += (p.vx + Math.sin(p.wobble) * p.wobbleAmp) * step;
      p.y += p.vy * step;
      p.vy += p.gravity * step;
      p.vx *= Math.pow(p.drag, step);
      p.rot += p.vr * step;

      // 侧壁轻弹一下，避免贴边堆叠
      if (p.x < edgePad) {
        p.x = edgePad;
        p.vx = Math.abs(p.vx) * 0.2;
      } else if (p.x > width - edgePad) {
        p.x = width - edgePad;
        p.vx = -Math.abs(p.vx) * 0.2;
      }

      // 已落到屏外：不再绘制
      if (p.y > height + 28) continue;

      // 升空清晰；接近底部再淡出，中间段保持可见（别显得稀疏）
      const falling = p.vy > 0;
      let alpha = 0.98;
      if (falling && p.y > height * 0.72) {
        const fallProgress = Math.min(1, (p.y - height * 0.72) / (height * 0.35));
        alpha = 0.98 * (1 - fallProgress * 0.9);
      } else if (localElapsed > durationMs * 0.9) {
        alpha = 0.98 * (1 - (localElapsed - durationMs * 0.9) / (durationMs * 0.15));
      }
      if (alpha <= 0.04) continue;

      alive += 1;
      drawParticle(p, alpha);
    }

    if (alive === 0 || elapsed >= durationMs + 500) {
      cleanup();
      return;
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
}
