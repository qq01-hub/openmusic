import { useMemo } from 'react';
import type { SearchResult } from '../types';
import { useRoomStore } from '../stores/roomStore';
import { useSongHistoryStore } from '../stores/songHistoryStore';
import { getRoomSongStatus } from '../lib/roomSongStatus';
import SourceBadge from './SourceBadge';

const BADGE_CLASS =
  'inline-flex h-[18px] flex-shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-medium leading-none tracking-tight whitespace-nowrap select-none';

interface Props {
  song: Pick<SearchResult, 'source' | 'id'>;
  /** 列表场景由父级批量计算，避免每行订阅房间状态 */
  status?: { inQueue: boolean; played: boolean };
}

function SongRowBadgesContent({
  song,
  inQueue,
  played,
}: {
  song: Pick<SearchResult, 'source' | 'id'>;
  inQueue: boolean;
  played: boolean;
}) {
  return (
    <div className="flex flex-shrink-0 flex-row items-center gap-1.5">
      {inQueue && (
        <span className={`${BADGE_CLASS} bg-netease-red/[0.12] text-netease-red ring-1 ring-inset ring-netease-red/20`}>
          已点歌
        </span>
      )}
      {played && (
        <span className={`${BADGE_CLASS} bg-white/[0.045] text-white/45 ring-1 ring-inset ring-white/[0.07]`}>
          已播放
        </span>
      )}
      <SourceBadge
        source={song.source}
        variant="muted"
        className="hidden sm:inline-flex"
      />
    </div>
  );
}

function SongRowBadgesConnected({ song }: Pick<Props, 'song'>) {
  const room = useRoomStore((s) => s.room);
  const historySongs = useSongHistoryStore((s) => s.songs);
  const historyRoomId = useSongHistoryStore((s) => s.roomId);
  const historyLoaded = useSongHistoryStore((s) => s.loaded);

  const { inQueue, played } = useMemo(
    () => getRoomSongStatus(room, song),
    [room, song.id, song.source, historySongs, historyRoomId, historyLoaded],
  );

  return <SongRowBadgesContent song={song} inQueue={inQueue} played={played} />;
}

/** 已点歌 / 已播放 / 平台标签 — 同一行、同一高度 */
export default function SongRowBadges({ song, status }: Props) {
  if (status) {
    return <SongRowBadgesContent song={song} inQueue={status.inQueue} played={status.played} />;
  }
  return <SongRowBadgesConnected song={song} />;
}
