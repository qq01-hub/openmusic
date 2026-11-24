import { useCallback, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';

function removeSkipRequestLocally(requestId: string) {
  const room = useRoomStore.getState().room;
  if (!room) return;
  const next = room.skipRequests.filter((request) => request.id !== requestId);
  if (next.length === room.skipRequests.length) return;
  useRoomStore.getState().setRoom({ ...room, skipRequests: next });
}

export default function JumpRequestBanner() {
  const skipRequests = useRoomStore((s) => s.room?.skipRequests);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const { approveSkip, rejectSkip } = useSocket();
  const pendingIdsRef = useRef(new Set<string>());

  const handleApprove = useCallback(async (requestId: string) => {
    if (pendingIdsRef.current.has(requestId)) return;
    pendingIdsRef.current.add(requestId);
    removeSkipRequestLocally(requestId);
    try {
      await approveSkip(requestId);
    } finally {
      pendingIdsRef.current.delete(requestId);
    }
  }, [approveSkip]);

  const handleReject = useCallback(async (requestId: string) => {
    if (pendingIdsRef.current.has(requestId)) return;
    pendingIdsRef.current.add(requestId);
    removeSkipRequestLocally(requestId);
    try {
      await rejectSkip(requestId);
    } finally {
      pendingIdsRef.current.delete(requestId);
    }
  }, [rejectSkip]);

  if (!canControlPlayback || !skipRequests?.length) return null;

  return (
    <div className="mb-4 space-y-2">
      {skipRequests.map((req) => (
        <div
          key={req.id}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm text-sky-200/90 truncate">
              <span className="font-medium">{req.nickname}</span> 申请切歌
            </p>
            <p className="text-xs text-sky-200/50 truncate">{req.songName}</p>
          </div>
          <button
            type="button"
            onClick={() => { void handleApprove(req.id); }}
            className="p-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
            aria-label="同意"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => { void handleReject(req.id); }}
            className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            aria-label="拒绝"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
