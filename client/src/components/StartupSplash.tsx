import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MusicLoading from './MusicLoading';
import {
  createAuroraSpectrumBars,
  isStartupSplashDismissKey,
  sampleAuroraWaveTarget,
  type AuroraSpectrumBar,
} from '../lib/startupSplash';
import { useSiteSeoConfig } from '../lib/seo';
import './StartupSplash.css';

const WORDMARK_CHARS = Array.from('OpenMusic');
const BEAT_SEC = 60 / 72;

function colorAt(u: number, alpha: number): string {
  const r = Math.round(255 - u * 63);
  const g = Math.round(77 + Math.sin(u * Math.PI) * 48 + u * 55);
  const b = Math.round(85 + u * 167);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

export default function StartupSplash({ ready, onEnter }: { ready: boolean; onEnter: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wordRef = useRef<HTMLHeadingElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const leavingRef = useRef(false);
  const completeRef = useRef(onEnter);
  const stateRef = useRef({
    t: 0,
    gain: 0,
    exit: 0,
    mx: 0,
    my: 0,
    tx: 0,
    ty: 0,
    W: 0,
    H: 0,
    dpr: 1,
    mobile: false,
    quiet: false,
  });
  const [enterRequested, setEnterRequested] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const siteSeo = useSiteSeoConfig();
  completeRef.current = onEnter;

  // 拆字渐变切片对齐：确保 OpenMusic 跨字符共享同一条连续高定渐变
  useEffect(() => {
    const word = wordRef.current;
    if (!word) return;
    const fitWordGradient = () => {
      const ww = word.scrollWidth;
      if (!ww) return;
      const children = Array.from(word.children) as HTMLElement[];
      for (const span of children) {
        span.style.backgroundSize = ww + 'px 100%';
        span.style.backgroundPosition = -span.offsetLeft + 'px 0';
      }
    };
    fitWordGradient();
    window.addEventListener('resize', fitWordGradient);
    return () => window.removeEventListener('resize', fitWordGradient);
  }, []);

  // K2 极光频谱全分辨率 Retina 2D 矢量渲染循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const S = stateRef.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let bars: AuroraSpectrumBar[] = [];
    let rafId = 0;
    let lastNow = performance.now();

    const resize = () => {
      S.W = window.innerWidth;
      S.H = window.innerHeight;
      S.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      S.mobile = S.W < 700;
      canvas.width = Math.round(S.W * S.dpr);
      canvas.height = Math.round(S.H * S.dpr);
      bars = createAuroraSpectrumBars(S.mobile ? 46 : 74);
    };
    resize();
    window.addEventListener('resize', resize);

    const drawFrame = (now: number) => {
      const dt = Math.min(now - lastNow, 50) / 1000;
      lastNow = now;
      if (!document.hidden && !S.quiet) {
        if (reduced.matches) {
          S.gain = 1;
          S.t = 2.8;
        } else {
          S.t += dt;
          S.gain = Math.min(1, S.gain + dt / 1.8);
        }
        S.mx += (S.tx - S.mx) * 0.045;
        S.my += (S.ty - S.my) * 0.045;

        const phase = (S.t % BEAT_SEC) / BEAT_SEC;
        const env = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
        const fade = S.gain * (1 - S.exit * 0.999);
        const W = S.W;
        const H = S.H;
        const baseY = H * 0.77 + S.my * 12;
        const spanW = Math.min(W * 0.85, 1140);
        const startX = (W - spanW) / 2 + S.mx * 18;
        const step = spanW / Math.max(1, bars.length - 1);
        const maxH = H * (S.mobile ? 0.165 : 0.185);

        ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#050507';
        ctx.fillRect(0, 0, W, H);

        ctx.globalCompositeOperation = 'lighter';

        // 远景天际极光柔晕
        const g1 = ctx.createRadialGradient(
          W * 0.35 + S.mx * 28,
          baseY - maxH * 0.45,
          0,
          W * 0.35,
          baseY - maxH * 0.45,
          W * 0.44,
        );
        g1.addColorStop(0, 'rgba(255, 77, 85, ' + (0.12 * fade) + ')');
        g1.addColorStop(0.55, 'rgba(251, 113, 133, ' + (0.048 * fade) + ')');
        g1.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, W, H);

        const g2 = ctx.createRadialGradient(
          W * 0.65 - S.mx * 28,
          baseY - maxH * 0.42,
          0,
          W * 0.65,
          baseY - maxH * 0.42,
          W * 0.44,
        );
        g2.addColorStop(0, 'rgba(192, 132, 252, ' + (0.12 * fade) + ')');
        g2.addColorStop(0.55, 'rgba(225, 124, 232, ' + (0.048 * fade) + ')');
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, W, H);

        // 地平基准细线
        const lg = ctx.createLinearGradient(startX, baseY, startX + spanW, baseY);
        lg.addColorStop(0, 'rgba(255, 77, 85, 0)');
        lg.addColorStop(0.18, 'rgba(255, 77, 85, ' + (0.34 * fade) + ')');
        lg.addColorStop(0.5, 'rgba(255, 228, 236, ' + (0.54 * fade) + ')');
        lg.addColorStop(0.82, 'rgba(192, 132, 252, ' + (0.34 * fade) + ')');
        lg.addColorStop(1, 'rgba(192, 132, 252, 0)');
        ctx.strokeStyle = lg;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(startX, baseY);
        ctx.lineTo(startX + spanW, baseY);
        ctx.stroke();

        const barW = Math.max(2.2, step * 0.35);
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i]!;
          const target = sampleAuroraWaveTarget(b.u, b.edge, S.t, env, fade);
          if (reduced.matches) {
            b.val = target;
            b.peak = target;
          } else {
            b.val += (target - b.val) * 0.13;
            if (b.val > b.peak) b.peak = b.val;
            else b.peak = Math.max(b.val, b.peak - 0.002);
          }

          const x = startX + i * step;
          const h = b.val * maxH;
          const ph = b.peak * maxH;

          // 主柱渐变
          const cg = ctx.createLinearGradient(x, baseY - h, x, baseY);
          cg.addColorStop(0, colorAt(b.u, 0.92 * fade));
          cg.addColorStop(0.55, colorAt(b.u, 0.36 * fade));
          cg.addColorStop(1, colorAt(b.u, 0.03 * fade));
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.roundRect(x - barW / 2, baseY - h, barW, Math.max(2, h), barW / 2);
          ctx.fill();

          // 柱顶悬浮亮帽
          ctx.fillStyle = 'rgba(255, 240, 246, ' + (0.82 * fade * (0.3 + 0.7 * b.edge)) + ')';
          ctx.beginPath();
          ctx.arc(x, baseY - ph - 3.5, Math.max(1.1, barW * 0.36), 0, Math.PI * 2);
          ctx.fill();

          // 水面镜像倒影
          const rg = ctx.createLinearGradient(x, baseY, x, baseY + h * 0.4);
          rg.addColorStop(0, colorAt(b.u, 0.22 * fade));
          rg.addColorStop(1, colorAt(b.u, 0));
          ctx.fillStyle = rg;
          ctx.fillRect(x - barW / 2, baseY + 2, barW, h * 0.4);
        }

        // 顶部波浪包络流光线
        ctx.beginPath();
        for (let i = 0; i < bars.length; i++) {
          const x = startX + i * step;
          const y = baseY - bars[i]!.val * maxH;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const px = startX + (i - 1) * step;
            const py = baseY - bars[i - 1]!.val * maxH;
            const cxm = (px + x) / 2;
            ctx.quadraticCurveTo(px, py, cxm, (py + y) / 2);
          }
        }
        ctx.strokeStyle = lg;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (!reduced.matches) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);
    const onVisibility = () => {
      if (!document.hidden && !reduced.matches) {
        lastNow = performance.now();
        window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // 模态焦点管理
  useEffect(() => {
    const root = rootRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('root');
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    root?.focus({ preventScroll: true });
    return () => {
      if (appRoot) appRoot.inert = wasInert;
      if (previousFocus?.isConnected && !root?.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  // 原地柔焦退场：不把文字飞移到首页，直接淡出揭开底层首页
  const dismiss = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const durationMs = reduced ? 150 : waiting ? 380 : 760;
    const start = performance.now();
    const tickExit = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      stateRef.current.exit = p;
      if (p < 1) {
        window.requestAnimationFrame(tickExit);
      } else {
        completeRef.current();
      }
    };
    window.requestAnimationFrame(tickExit);
  }, [waiting]);

  useEffect(() => {
    if (!enterRequested) return;
    if (ready) {
      dismiss();
    } else {
      stateRef.current.quiet = true;
      setWaiting(true);
    }
  }, [enterRequested, ready, dismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isStartupSplashDismissKey(event.key) && !event.repeat) {
        event.preventDefault();
        setEnterRequested(true);
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        enterRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      className="om-startup"
      data-leaving={leaving || undefined}
      data-waiting={waiting || undefined}
      role="dialog"
      aria-modal="true"
      aria-label="OpenMusic 音乐开场"
      tabIndex={-1}
      onPointerMove={(event) => {
        if (leavingRef.current) return;
        stateRef.current.tx = event.clientX / Math.max(1, window.innerWidth) - 0.5;
        stateRef.current.ty = event.clientY / Math.max(1, window.innerHeight) - 0.5;
      }}
      onPointerLeave={() => {
        stateRef.current.tx = 0;
        stateRef.current.ty = 0;
      }}
    >
      <canvas ref={canvasRef} className="om-startup__canvas" aria-hidden="true" />
      <div className="om-startup__vignette" aria-hidden="true" />
      <button
        ref={enterRef}
        type="button"
        className="om-startup__enter-surface"
        aria-label="进入 OpenMusic 音乐大厅"
        aria-describedby="om-startup-hint"
        onClick={() => setEnterRequested(true)}
      />
      <div className="om-startup__center">
        <div className="om-startup__kicker">
          <i className="om-startup__kicker-dot" aria-hidden="true" />
          <span>多人实时同步 · 边听边聊</span>
        </div>
        <h1 ref={wordRef} className="om-startup__word" aria-label="OpenMusic">
          {WORDMARK_CHARS.map((ch, idx) => (
            <span
              key={idx}
              className="om-startup__ch"
              aria-hidden="true"
              style={{ animationDelay: (0.42 + idx * 0.048).toFixed(3) + 's' }}
            >
              {ch}
            </span>
          ))}
        </h1>
        <p className="om-startup__tagline">
          <span className="om-startup__hl-a">{siteSeo.heroHeadline}</span>
          <span className="om-startup__hl-b">{siteSeo.heroSubline}</span>
        </p>
        <div className="om-startup__rule" aria-hidden="true" />
        <p className="om-startup__sub">
          打破距离的限制，创造属于你们的<b>专属音乐时刻</b>
        </p>
        <div id="om-startup-hint" className="om-startup__enter">
          轻触进入房间大厅
        </div>
      </div>
      {waiting && (
        <div className="om-startup__waiting">
          <MusicLoading label="正在准备音乐大厅" />
        </div>
      )}
    </div>,
    document.body,
  );
}
