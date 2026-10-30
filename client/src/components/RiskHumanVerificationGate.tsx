import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithTimeout } from '../api/http';
import HumanVerification from './HumanVerification';
import { clearHumanCheckPending, markHumanCheckPending } from '../lib/humanCheckState';

type Challenge = { pending: boolean; challengeId: string; siteKey: string; passes: number; dailyLimit: number };
export default function RiskHumanVerificationGate() {
  const [state, setState] = useState<Challenge | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [widgetRevision, setWidgetRevision] = useState(0);
  const mounted = useRef(false);
  const dialog = useRef<HTMLElement>(null);
  const requiredLoad = useRef(false);
  const needsResume = useRef(false);
  const identityRevision = useRef(0);
  const inFlight = useRef(false);
  const submitting = useRef(false);
  const load = useCallback(async (required = false) => {
    requiredLoad.current ||= required;
    needsResume.current ||= required;
    if (inFlight.current) return;
    inFlight.current = true;
    const revision = identityRevision.current;
    try {
      const response = await fetchWithTimeout('/api/auth/human-challenge', { cache: 'no-store' });
      if (response.status === 401) { if (mounted.current && revision === identityRevision.current) setState(null); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '验证状态暂不可用');
      if (mounted.current && revision === identityRevision.current) {
        requiredLoad.current = false; setState(data as Challenge); setError('');
        needsResume.current ||= Boolean(data.pending);
        if (!data.pending) {
          clearHumanCheckPending();
        }
        if (!data.pending && needsResume.current) {
          needsResume.current = false;
          window.dispatchEvent(new Event('openmusic:human-check-passed'));
        }
      }
    } catch (reason) {
      if (mounted.current && revision === identityRevision.current && requiredLoad.current) {
        setState(previous => previous || { pending: true, challengeId: '', siteKey: '', passes: 0, dailyLimit: 2 });
        setError(reason instanceof Error ? reason.message : '验证状态暂不可用，请重试');
      }
    } finally { inFlight.current = false; if (mounted.current && revision !== identityRevision.current) void load(); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const required = () => { markHumanCheckPending(); if (!dialog.current) void load(true); };
    const changed = () => { identityRevision.current++; clearHumanCheckPending(); requiredLoad.current = false; needsResume.current = false; submitting.current = false; setState(null); setToken(''); setBusy(false); setError(''); void load(); };
    const focused = () => { if (needsResume.current && !submitting.current) void load(true); };
    window.addEventListener('openmusic:human-check-required', required);
    window.addEventListener('openmusic:account-session-changed', changed);
    window.addEventListener('focus', focused);
    void load();
    return () => {
      mounted.current = false;
      identityRevision.current++;
      window.removeEventListener('openmusic:human-check-required', required);
      window.removeEventListener('openmusic:account-session-changed', changed);
      window.removeEventListener('focus', focused);
    };
  }, [load]);
  useEffect(() => { if (state?.pending) dialog.current?.querySelector<HTMLElement>('h2')?.focus(); }, [state?.pending]);
  const submit = async () => {
    if (!token || !state?.challengeId || submitting.current) return;
    const revision = identityRevision.current;
    const isCurrent = () => mounted.current && revision === identityRevision.current;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const response = await fetchWithTimeout('/api/auth/human-challenge', { method: 'POST', body: JSON.stringify({ turnstileToken: token, challengeId: state.challengeId }), headers: { 'Content-Type': 'application/json' } });
      const data = await response.json();
      if (!isCurrent()) return;
      if (!response.ok) {
        if (['HUMAN_CHECK_CHANGED', 'HUMAN_CHECK_FAILED', 'HUMAN_CHECK_DISABLED'].includes(data.code)) void load(true);
        throw new Error(data.error || '验证未通过，请重试');
      }
      if (isCurrent()) { needsResume.current = false; clearHumanCheckPending(); setState(null); window.dispatchEvent(new Event('openmusic:human-check-passed')); }
    } catch (reason) { if (isCurrent()) setError(reason instanceof Error ? reason.message : '验证暂不可用'); }
    finally { if (isCurrent()) { submitting.current = false; setBusy(false); setToken(''); setWidgetRevision(value => value + 1); } }
  };
  if (!state?.pending) return null;
  return <div className="fixed inset-0 z-[250] flex items-center justify-center overflow-y-auto bg-black/80 p-5 backdrop-blur-sm">
    <section ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), iframe, [tabindex="0"]') || []);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement?.tagName === 'H2')) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} role="dialog" aria-modal="true" aria-labelledby="risk-human-title" className="w-full max-w-md space-y-5 rounded-2xl border border-white/15 bg-netease-dark p-6 text-white shadow-2xl">
      <h2 id="risk-human-title" className="text-xl font-semibold" tabIndex={-1}>请确认是你在访问</h2>
      <p className="text-sm leading-6 text-white/65">检测到异常访问，请先完成验证，未通过前无法继续获取资源</p>
      <p className="text-xs leading-5 text-white/50">每天最多两轮，通过后进入冷却，当天两轮都通过后不再重复验证，不影响原有配额或账户封禁</p>
      {state.siteKey && <HumanVerification key={widgetRevision} siteKey={state.siteKey} action="risk_challenge" cdata={state.challengeId} onToken={setToken} />}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={!token || busy} onClick={() => { void submit(); }} className="min-h-11 rounded-lg bg-netease-red px-5 text-sm font-medium disabled:opacity-40">{busy ? '正在验证…' : '验证并继续'}</button><button type="button" disabled={busy} onClick={() => { void load(true); }} className="min-h-11 rounded-lg border border-white/20 px-4 text-sm">刷新验证状态</button></div>
      <p className="text-xs text-white/45">通过后请重新执行刚才的操作，系统不会自动重放点歌或其他修改请求</p>
    </section>
  </div>;
}
