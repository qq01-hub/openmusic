import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithTimeout } from '../api/http';
import { ensureSessionBootstrap } from '../lib/sessionBootstrap';
import {
  subscribeErrorReportSolution,
  type ErrorReportSolutionNoticePayload,
} from '../hooks/useSocket';
import ErrorReportSolutionPopup from './ErrorReportSolutionPopup';
import { setGuidePauseReason } from '../lib/guidePause';

function enqueueUnique(
  queue: ErrorReportSolutionNoticePayload[],
  notice: ErrorReportSolutionNoticePayload,
): ErrorReportSolutionNoticePayload[] {
  if (!notice?.id || !notice.solution?.trim()) return queue;
  if (queue.some((item) => item.id === notice.id)) return queue;
  return [...queue, notice];
}

async function ackSolution(id: string) {
  try {
    await fetchWithTimeout(
      `/api/error-reports/${encodeURIComponent(id)}/ack-solution`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      8000,
    );
  } catch {
    // 确认失败时下次仍会再弹，可接受
  }
}

/**
 * 全局挂载：管理员填写解决方案并标记已处理后，
 * 对应用户若在线会立刻弹窗；离线用户下次进站/进房再弹，确认后不再重复。
 */
export default function ErrorReportSolutionGate() {
  const [queue, setQueue] = useState<ErrorReportSolutionNoticePayload[]>([]);
  const current = queue[0] || null;
  const seenIdsRef = useRef(new Set<string>());

  const pushNotice = useCallback((notice: ErrorReportSolutionNoticePayload) => {
    if (!notice?.id || seenIdsRef.current.has(notice.id)) return;
    setQueue((prev) => enqueueUnique(prev, notice));
  }, []);

  const dismiss = useCallback(() => {
    const id = current?.id;
    if (!id) return;
    seenIdsRef.current.add(id);
    setQueue((prev) => prev.filter((item) => item.id !== id));
    void ackSolution(id);
  }, [current?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const clientId = await ensureSessionBootstrap();
        if (cancelled || !clientId) return;
        const res = await fetchWithTimeout('/api/error-reports/pending-solutions', {}, 8000);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { solutions?: ErrorReportSolutionNoticePayload[] };
        for (const notice of data.solutions || []) {
          if (cancelled) break;
          pushNotice(notice);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushNotice]);

  useEffect(() => subscribeErrorReportSolution(pushNotice), [pushNotice]);

  useEffect(() => {
    const open = Boolean(current);
    setGuidePauseReason('error-report-solution', open);
    return () => setGuidePauseReason('error-report-solution', false);
  }, [current]);

  return (
    <ErrorReportSolutionPopup
      open={Boolean(current)}
      notice={current}
      onClose={dismiss}
    />
  );
}
