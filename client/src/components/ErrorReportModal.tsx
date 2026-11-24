import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from './Modal';
import { fetchWithTimeout } from '../api/http';
import { collectErrorReportBundle, type ErrorReportType } from '../lib/debugTools';

interface Props {
  open: boolean;
  onClose: () => void;
}

const REPORT_TYPES: { value: ErrorReportType; label: string; hint: string; placeholder: string }[] = [
  {
    value: 'error',
    label: '上报错误',
    hint: '描述你遇到的问题；提交时会连续采集 5 份调试快照（约 2 秒）及歌曲 URL，便于管理员排查。',
    placeholder: '例如：切歌后没声音 / 歌词不同步 / 某首歌无法播放…',
  },
  {
    value: 'feedback',
    label: '提交意见',
    hint: '描述你的功能建议或使用体验；仅提交文字与基础上下文，不会附带调试日志。',
    placeholder: '例如：希望增加某某功能 / 界面可以怎么改进…',
  },
];

export default function ErrorReportModal({ open, onClose }: Props) {
  const [reportType, setReportType] = useState<ErrorReportType>('error');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okHint, setOkHint] = useState('');
  const closeTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearCloseTimer();
    };
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!open) clearCloseTimer();
  }, [clearCloseTimer, open]);

  const typeConfig = REPORT_TYPES.find((item) => item.value === reportType) ?? REPORT_TYPES[0];

  const close = () => {
    if (busy) return;
    clearCloseTimer();
    setError('');
    setOkHint('');
    setReportType('error');
    onClose();
  };

  const submit = async () => {
    const text = description.trim();
    if (!text || busy) return;
    clearCloseTimer();
    setBusy(true);
    setError('');
    setOkHint('');
    try {
      const bundle = await collectErrorReportBundle(text, reportType);
      const res = await fetchWithTimeout('/api/error-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      }, 20_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `提交失败（${res.status}）`);
      }
      if (!mountedRef.current) return;
      setOkHint('已提交，感谢反馈');
      setDescription('');
      window.dispatchEvent(
        new CustomEvent('openmusic:visual-toast', {
          detail: {
            message: reportType === 'feedback' ? '意见已提交' : '错误上报已提交',
            type: 'success',
          },
        }),
      );
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        if (!mountedRef.current) return;
        setOkHint('');
        setReportType('error');
        onClose();
      }, 800);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} panelClassName="relative w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-5 shadow-2xl">
      <h3 className="text-base font-semibold text-white">上报错误 / 提交意见</h3>
      <div className="mt-3 flex gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
        {REPORT_TYPES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setReportType(item.value)}
            disabled={busy}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
              reportType === item.value
                ? 'bg-netease-red text-white shadow-sm'
                : 'text-white/55 hover:bg-white/5 hover:text-white/85'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-white/50">{typeConfig.hint}</p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={5}
        placeholder={typeConfig.placeholder}
        className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30"
        disabled={busy}
      />
      <div className="mt-1 flex justify-between text-[11px] text-white/40">
        <span>最多 500 字</span>
        <span>{description.trim().length}/500</span>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {okHint && <p className="mt-2 text-xs text-emerald-400">{okHint}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !description.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy && reportType === 'error' ? '采集中…' : '提交'}
        </button>
      </div>
    </Modal>
  );
}
