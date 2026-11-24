import { useEffect, useRef } from 'react';
import {
  galaxyHandGestureLive,
  onGalaxyGestureModeChange,
} from './lib/galaxyHandGesture';
import {
  galaxyHandGestureStartup,
  isGalaxyHandGestureStarting,
  subscribeGalaxyHandGestureStartup,
} from './lib/galaxyHandGestureStartup';
import { drawHandSkeleton } from './lib/drawHandSkeleton';
import { patchRoomVisualFx, roomVisualFxLive } from '../../lib/roomVisualFxLive';
import { isHostPageHidden, subscribeHostVisibility } from '../../hooks/useVisualRenderPolicy';

/** Mineradio #gesture-hud + #hand-canvas — 仅 HUD 绘制；启停由 roomVisualFxLive 统一调度 */
export default function GestureHudOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const unsubFail = onGalaxyGestureModeChange((mode, failed) => {
      if (failed && roomVisualFxLive.current.cameraInteraction === 'gesture') {
        patchRoomVisualFx({ cameraInteraction: 'off' });
      }
      if (mode === 'off' && failed) {
        window.dispatchEvent(
          new CustomEvent('openmusic:visual-toast', {
            detail: { message: '手势启动失败（需要摄像头权限或网络）', type: 'error' },
          }),
        );
      }
    });
    return unsubFail;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const clearHudAndCanvas = () => {
      const hudEl = document.getElementById('gesture-hud');
      if (hudEl) hudEl.classList.remove('show');
      canvas.classList.remove('show');
      if (canvas.width > 0 && canvas.height > 0) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };

    const stopLoop = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };

    const scheduleDraw = () => {
      if (rafRef.current) return;
      if (isHostPageHidden()) return;
      if (!galaxyHandGestureLive.active && !isGalaxyHandGestureStarting()) return;
      rafRef.current = requestAnimationFrame(draw);
    };

    const draw = () => {
      rafRef.current = 0;
      if (isHostPageHidden()) return;
      const live = galaxyHandGestureLive;
      const starting = isGalaxyHandGestureStarting();
      const hud = live.hud;
      const hudEl = document.getElementById('gesture-hud');
      const fillEl = document.getElementById('gesture-fill');
      const labelEl = document.getElementById('gesture-label');
      const confirmEl = document.getElementById('gesture-confirm');

      if (!live.active && !starting) {
        clearHudAndCanvas();
        return;
      }

      if (starting) {
        const startup = galaxyHandGestureStartup;
        if (hudEl) hudEl.classList.add('show');
        if (labelEl) labelEl.textContent = startup.label || '正在开启手势…';
        if (confirmEl) confirmEl.textContent = '首次开启需下载模型并授权摄像头';
        if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(100, startup.progress * 100))}%`;
        canvas.classList.remove('show');
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      if (hudEl) hudEl.classList.toggle('show', hud.visible);
      if (labelEl) labelEl.textContent = hud.label;
      if (confirmEl) confirmEl.textContent = hud.detail;
      if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(100, hud.progress * 100))}%`;
      canvas.classList.add('show');

      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);

      if (live.skeleton) {
        const { landmarks, isPinch, isFist, openness } = live.skeleton;
        drawHandSkeleton(ctx, landmarks, W, H, {
          isPinch,
          isFist,
          openness,
          time: performance.now() / 1000,
        });
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    const syncRunning = () => {
      if (isHostPageHidden()) {
        stopLoop();
        return;
      }
      if (galaxyHandGestureLive.active || isGalaxyHandGestureStarting()) {
        scheduleDraw();
      } else {
        stopLoop();
        clearHudAndCanvas();
      }
    };

    const unsubStartup = subscribeGalaxyHandGestureStartup(syncRunning);
    const unsubMode = onGalaxyGestureModeChange(syncRunning);
    const unsubVisibility = subscribeHostVisibility(syncRunning);
    syncRunning();

    return () => {
      window.removeEventListener('resize', resize);
      stopLoop();
      unsubStartup();
      unsubMode();
      unsubVisibility();
    };
  }, []);
  return (
    <>
      <div id="gesture-hud" className="gesture-hud" aria-live="polite">
        <div className="gesture-hud-row">
          <b id="gesture-label">待命</b>
          <span id="gesture-confirm">把手放进视野</span>
        </div>
        <div className="gesture-progress">
          <div id="gesture-fill" className="gesture-fill" />
        </div>
      </div>
      <canvas ref={canvasRef} id="hand-canvas" aria-hidden />
    </>
  );
}
