import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import BrandMark from './BrandMark';
import MusicLoading from './MusicLoading';
import { isStartupSplashDismissKey } from '../lib/startupSplash';
import { useSiteSeoConfig } from '../lib/seo';
import { startParticleField } from '../lib/startupParticleField';
import './StartupSplash.css';

gsap.registerPlugin(useGSAP);

export default function StartupSplash({ ready, onEnter }: { ready: boolean; onEnter: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const introRef = useRef<gsap.core.Timeline>();
  const field = useRef({ form: 0, exit: 0, impulse: 0, quiet: false });
  const pointer = useRef({ x: 0, y: 0, active: false });
  const leavingRef = useRef(false);
  const completeRef = useRef(onEnter);
  const [enterRequested, setEnterRequested] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const siteSeo = useSiteSeoConfig();
  completeRef.current = onEnter;

  useEffect(() => {
    if (!canvasRef.current) return;
    return startParticleField(canvasRef.current, pointer.current, field.current);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('root');
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    root?.focus({ preventScroll: true });
    return () => {
      if (appRoot) appRoot.inert = wasInert;
      if (previousFocus?.isConnected && !root?.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const { contextSafe } = useGSAP(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const intro = gsap.timeline();
    introRef.current = intro;
    if (reduced.matches) {
      gsap.set(field.current, { form: 1 });
      intro.to({}, { duration: 0.2 });
    } else {
      intro.from('.om-startup__reveal', { opacity: 0, y: 16, duration: 0.8, stagger: 0.07, ease: 'power3.out' }, 0)
        .to(field.current, { form: 1, duration: 1.25, ease: 'power3.out' }, 0)
        .from('.om-startup__wordmark', { opacity: 0, scale: 0.94, duration: 1.4, ease: 'power2.out' }, 0);
    }
    const visibility = () => { if (document.hidden) intro.pause(); else intro.resume(); };
    const reduceMotion = () => { if (reduced.matches) intro.progress(1); };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    reduced.addEventListener('change', reduceMotion);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener('change', reduceMotion);
    };
  }, { scope: rootRef });

  const dismiss = contextSafe(() => {
    const root = rootRef.current;
    if (!root || leavingRef.current) return;
    leavingRef.current = true;
    introRef.current?.progress(1).pause();
    pointer.current.active = false;
    root.dataset.leaving = 'true';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sources = Array.from(root.querySelectorAll<HTMLElement>('[data-startup-line]'));
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-home-hero-line]'));
    // Batch geometry reads before writes; never measure layout inside a frame loop.
    const matches = sources.map((source, i) => {
      const target = targets[i];
      if (!target || target.textContent?.trim() !== source.textContent?.trim()) return null;
      const from = source.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      if (!from.width || !to.width || to.top < 0 || to.bottom > window.innerHeight) return null;
      return { source, target, from, to };
    }).filter((match) => match !== null);
    const timeline = gsap.timeline({ onComplete: () => completeRef.current(), defaults: { ease: 'power3.inOut' } });
    if (reduced || waiting) {
      timeline.to(root, { opacity: 0, duration: reduced ? 0.15 : 0.4 });
      return;
    }
    timeline.to(field.current, { exit: 1, duration: 1.15 }, 0)
      .to('.om-startup__chrome, .om-startup__wordmark', { opacity: 0, duration: 0.35 }, 0)
      .to('.om-startup__atmosphere', { opacity: 0, duration: 0.8 }, 0.15)
      .to('.om-startup__backdrop', { opacity: 0, duration: 0.9 }, 0.15)
      .fromTo(document.querySelectorAll('[data-home-reveal]'), { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.055 }, 0.45);
    for (const { source, target, from, to } of matches) {
      gsap.set(target, { opacity: 0 });
      gsap.set(source, { transformOrigin: '0 0' });
      timeline.to(source, { x: to.left - from.left, y: to.top - from.top, scaleX: to.width / from.width, scaleY: to.height / from.height, duration: 0.95 }, 0)
        .to(source, { opacity: 0, duration: 0.18 }, 0.85)
        .to(target, { opacity: 1, duration: 0.18 }, 0.85);
    }
    const unmatched = sources.filter((source) => !matches.some((match) => match.source === source));
    if (unmatched.length) timeline.to(unmatched, { opacity: 0, duration: 0.35 }, 0);
  });

  useEffect(() => {
    if (!enterRequested) return;
    if (ready) dismiss();
    else {
      field.current.quiet = true;
      setWaiting(true);
    }
  }, [enterRequested, ready, dismiss]);

  const impulse = contextSafe(() => {
    if (leavingRef.current || waiting || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(field.current, { impulse: 1 }, { impulse: 0, duration: 1.1, ease: 'power2.out', overwrite: 'auto' });
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isStartupSplashDismissKey(event.key) && !event.repeat) { event.preventDefault(); setEnterRequested(true); }
      if (event.key === 'Tab') { event.preventDefault(); enterRef.current?.focus({ preventScroll: true }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div ref={rootRef} className="om-startup" data-waiting={waiting || undefined} role="dialog" aria-modal="true" aria-label="OpenMusic 音乐开场" tabIndex={-1}
      onPointerMove={(event) => { if (!leavingRef.current) Object.assign(pointer.current, { x: event.clientX, y: event.clientY, active: true }); }}
      onPointerDown={(event) => { Object.assign(pointer.current, { x: event.clientX, y: event.clientY, active: true }); impulse(); }}
      onPointerUp={(event) => { if (event.pointerType !== 'mouse') pointer.current.active = false; }}
      onPointerCancel={() => { pointer.current.active = false; }} onPointerLeave={() => { pointer.current.active = false; }}>
      <div className="om-startup__backdrop" aria-hidden="true" />
      <div className="om-startup__atmosphere" aria-hidden="true"><div className="om-startup__halo" /><div className="om-startup__grain" /></div>
      <div className="om-startup__wordmark" aria-hidden="true">Open<span>Music</span></div>
      <canvas ref={canvasRef} className="om-startup__canvas" aria-hidden="true" />
      <button ref={enterRef} type="button" className="om-startup__enter-surface" aria-label="进入 OpenMusic 音乐大厅" aria-describedby="om-startup-hint" onClick={() => setEnterRequested(true)} />
      <header className="om-startup__header om-startup__chrome om-startup__reveal">
        <div className="om-startup__brand"><BrandMark className="h-9 w-9" /><span>OpenMusic<small>音乐，让我们相遇</small></span></div>
        <span className="om-startup__edition">A SHARED FREQUENCY.</span>
      </header>
      <div className="om-startup__annotation om-startup__chrome om-startup__reveal" aria-hidden="true"><span>01 / RESONANCE</span><i /><span>每一次共鸣，都有回响</span></div>
      <main className="om-startup__copy">
        <p className="om-startup__eyebrow om-startup__chrome om-startup__reveal"><span />让此刻，彼此同频</p>
        <h1 className="om-startup__headline"><span data-startup-line>{siteSeo.heroHeadline}</span><span data-startup-line className="om-startup__accent">{siteSeo.heroSubline}</span></h1>
      </main>
      <footer className="om-startup__footer om-startup__chrome om-startup__reveal">
        <span className="om-startup__interaction"><span className="om-startup__mouse-hint">移动光标，拨动共鸣</span><span className="om-startup__touch-hint">音乐，让我们相遇</span></span>
        <div className="om-startup__invitation"><span className="om-startup__equalizer" aria-hidden="true"><i /><i /><i /><i /><i /></span><span id="om-startup-hint">轻触画面，开启同频</span><small>CLICK TO FEEL CONNECTED</small></div>
        <span className="om-startup__signature">YOUR MUSIC. OUR MOMENT.</span>
      </footer>
      {waiting && <div className="om-startup__waiting"><MusicLoading label="正在准备音乐大厅" /></div>}
    </div>, document.body,
  );
}
