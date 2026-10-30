import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { songKey } from '../api/music';
import { useRoomStore } from '../stores/roomStore';
import { useSongHistoryStore } from '../stores/songHistoryStore';
import { getSongKeyIndex } from '../lib/songKeyIndex';

const EMPTY_SET = new Set<string>();

/** 队列 / 已播放键集合；仅在队列或历史变化时更新，不受播放进度影响 */
export function useRoomSongKeySets() {
  const roomId = useRoomStore((s) => s.room?.id ?? '');
  const queuedKeys = useRoomStore(useShallow((s) => getSongKeyIndex(s.room?.queue)));
  const currentKey = useRoomStore((s) => s.room?.current ? songKey(s.room.current) : '');
  const roomHistoryKeys = useRoomStore(useShallow((s) => getSongKeyIndex(s.room?.songHistory)));
  const clientHistoryKeys = useSongHistoryStore(useShallow((s) => getSongKeyIndex(
    s.loaded && s.roomId === roomId ? s.songs : undefined,
  )));
  const queueKeys = useMemo(() => {
    if (!currentKey || queuedKeys.has(currentKey)) return queuedKeys;
    return new Set([...queuedKeys, currentKey]);
  }, [queuedKeys, currentKey]);
  const historyKeys = clientHistoryKeys.size ? clientHistoryKeys : roomHistoryKeys;

  return useMemo(() => {
    if (!historyKeys.size) return { queueKeys, playedKeys: EMPTY_SET };
    const playedKeys = new Set<string>();
    for (const key of historyKeys) {
      if (!queueKeys.has(key)) playedKeys.add(key);
    }

    return { queueKeys, playedKeys };
  }, [queueKeys, historyKeys]);
}
