import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithTimeout } from '../api/http';
import { ensureSessionBootstrap } from '../lib/sessionBootstrap';
import {
  subscribePermanentDecision,
  type PermanentDecisionNoticePayload,
} from '../hooks/useSocket';
import PermanentDecisionPopup from './PermanentDecisionPopup';
import { setGuidePauseReason } from '../lib/guidePause';

function enqueueUnique(
  queue: PermanentDecisionNoticePayload[],
  notice: PermanentDecisionNoticePayload,
): PermanentDecisionNoticePayload[] {
  if (!notice?.id) return queue;
  if (queue.some((item) => item.id === notice.id)) return queue;
  return [...queue, notice];
}

async function ackNotice(id: string) {
  try {
    await fetchWithTimeout(
      `/api/permanent-decisions/${encodeURIComponent(id)}/ack`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      8000,
    );
  } catch {
    // 下次仍会再弹
  }
}

/** 常驻申请审核结果弹窗：在线即时推送，离线下次进站/进房补推 */
export default function PermanentDecisionGate() {
  const [queue, setQueue] = useState<PermanentDecisionNoticePayload[]>([]);
  const current = queue[0] || null;
  const seenIdsRef = useRef(new Set<string>());

  const pushNotice = useCallback((notice: PermanentDecisionNoticePayload) => {
    if (!notice?.id || seenIdsRef.current.has(notice.id)) return;
    setQueue((prev) => enqueueUnique(prev, notice));
  }, []);

  const dismiss = useCallback(() => {
    const id = current?.id;
    if (!id) return;
    seenIdsRef.current.add(id);
    setQueue((prev) => prev.filter((item) => item.id !== id));
    void ackNotice(id);
  }, [current?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const clientId = await ensureSessionBootstrap();
        if (cancelled || !clientId) return;
        const res = await fetchWithTimeout('/api/permanent-decisions/pending', {}, 8000);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { notices?: PermanentDecisionNoticePayload[] };
        for (const notice of data.notices || []) {
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

  useEffect(() => subscribePermanentDecision(pushNotice), [pushNotice]);

  useEffect(() => {
    const open = Boolean(current);
    setGuidePauseReason('permanent-decision', open);
    return () => setGuidePauseReason('permanent-decision', false);
  }, [current]);

  return (
    <PermanentDecisionPopup
      open={Boolean(current)}
      notice={current}
      onClose={dismiss}
    />
  );
}
