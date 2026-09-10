import { memo, useState, useEffect, useCallback } from 'react';
import { Flame, Plus, Loader2 } from 'lucide-react';
import type { SearchResult } from '../types';
import { songKey } from '../api/music';
import {
  type HotRankSource,
  getNeteaseHotToplist,
  getPlatformHotSongs,
  peekNeteaseHotToplist,
} from '../api/music/toplist';
import SongCover from './SongCover';
import TruncateTip from './TruncateTip';
import Tooltip from './Tooltip';

interface Props {
  addingId: string | null;
  onAdd: (song: SearchResult) => void;
  compact?: boolean;
  embedded?: boolean;
  compactLimit?: number;
  neteaseEnabled?: boolean;
}

const TOPLIST_LIMIT = 200;
const PLATFORM_LIMIT = 100;
const COMPACT_LIMIT = 30;
const SOURCE_STORAGE_KEY = 'openmusic:hot-rank-source';
type HotRankView = {
  title: string;
  songs: SearchResult[];
  loading: boolean;
  error: string;
};

function readStoredSource(): HotRankSource {
  try {
    const v = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (v === 'platform' || v === 'netease') return v;
  } catch {
    // private mode
  }
  return 'netease';
}

function rankClass(rank: number) {
  if (rank === 1) return 'text-[#ec4141] font-bold';
  if (rank === 2) return 'text-orange-400/90 font-semibold';
  if (rank === 3) return 'text-amber-400/80 font-semibold';
  return 'text-netease-muted/70 font-medium tabular-nums';
}

function ToplistRow({
  song,
  rank,
  isAdding,
  onAdd,
}: {
  song: SearchResult;
  rank: number;
  isAdding: boolean;
  onAdd: () => void;
}) {
  return (
    <Tooltip content="双击点歌">
      <div
        className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/[0.04] [content-visibility:auto] [contain-intrinsic-size:auto_48px]"
        onDoubleClick={() => onAdd()}
      >
      <span className={`w-4 flex-shrink-0 text-center text-[10px] leading-none ${rankClass(rank)}`}>
        {rank}
      </span>
      <SongCover
        song={song}
        size="full"
        className="h-9 w-9 flex-shrink-0 rounded-md object-cover bg-netease-card"
      />
      <div className="min-w-0 flex-1 self-stretch flex flex-col justify-center gap-0.5">
        <TruncateTip
          text={song.name}
          as="p"
          className="min-w-0 truncate text-sm leading-5 text-white/92"
        />
        <TruncateTip
          text={song.artist}
          as="p"
          className="min-w-0 truncate text-[11px] leading-4 text-netease-muted"
        />
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={isAdding}
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-all hover:bg-netease-red/15 hover:text-netease-red disabled:opacity-50 ${
          isAdding
            ? 'text-netease-red opacity-100'
            : 'text-netease-muted opacity-100 sm:opacity-0 sm:group-hover:opacity-100'
        }`}
        aria-label="点歌"
      >
        {isAdding ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
      </button>
      </div>
    </Tooltip>
  );
}

function CompactToplistCard({
  song,
  rank,
  isAdding,
  onAdd,
}: {
  song: SearchResult;
  rank: number;
  isAdding: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={isAdding}
      className="group flex w-[4.25rem] flex-shrink-0 flex-col text-left disabled:opacity-50"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-netease-card">
        <SongCover song={song} size="full" className="h-full w-full object-cover" />
        <span className={`absolute left-0.5 top-0.5 rounded px-1 text-[9px] font-bold leading-4 ${rankClass(rank)} bg-black/50`}>
          {rank}
        </span>
        {isAdding && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-[11px] leading-4 text-white/88">{song.name}</p>
      <p className="mt-0.5 truncate text-[10px] leading-3 text-netease-muted">{song.artist}</p>
    </button>
  );
}

function SourceSwitch({
  source,
  onChange,
  neteaseEnabled,
}: {
  source: HotRankSource;
  onChange: (next: HotRankSource) => void;
  neteaseEnabled: boolean;
}) {
  const btn = (id: HotRankSource, label: string) => (
    <button
      type="button"
      onClick={() => onChange(id)}
      className={`rounded-md px-2 py-0.5 text-[11px] leading-4 transition-colors ${
        source === id
          ? 'bg-white/12 text-white'
          : 'text-netease-muted hover:text-white/80'
      }`}
      aria-pressed={source === id}
    >
      {label}
    </button>
  );

  return (
    <div
      className="flex flex-shrink-0 items-center gap-0.5 rounded-lg bg-black/20 p-0.5"
      role="group"
      aria-label="热榜数据源"
    >
      {neteaseEnabled && btn('netease', '网易热榜')}
      {btn('platform', '平台热榜')}
    </div>
  );
}

export default memo(function HotSongPanel({
  addingId,
  onAdd,
  compact = false,
  embedded = false,
  compactLimit = COMPACT_LIMIT,
  neteaseEnabled = true,
}: Props) {
  const [source, setSource] = useState<HotRankSource>(() => neteaseEnabled ? readStoredSource() : 'platform');
  const cached = source === 'netease' ? peekNeteaseHotToplist(TOPLIST_LIMIT) : null;
  const [views, setViews] = useState<Record<HotRankSource, HotRankView>>(() => ({
    netease: {
      title: cached?.name?.trim() || '网易热榜',
      songs: cached?.songs ?? [],
      loading: !cached,
      error: '',
    },
    platform: {
      title: '平台热榜',
      songs: [],
      loading: false,
      error: '',
    },
  }));
  const currentView = views[source];

  useEffect(() => {
    if (!neteaseEnabled && source === 'netease') setSource('platform');
  }, [neteaseEnabled, source]);

  const handleSourceChange = useCallback((next: HotRankSource) => {
    setSource(next);
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, next);
    } catch {
      // private mode
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async (silent = false) => {
      if (source === 'netease') {
        const hit = peekNeteaseHotToplist(TOPLIST_LIMIT);
        if (hit && !silent) {
          setViews((prev) => ({
            ...prev,
            netease: { title: hit.name?.trim() || '网易热榜', songs: hit.songs, error: '', loading: false },
          }));
          return;
        }
        if (!silent) {
          setViews((prev) => ({
            ...prev,
            netease: { ...prev.netease, loading: true, error: '', title: '网易热榜' },
          }));
        }
        try {
          const data = await getNeteaseHotToplist(TOPLIST_LIMIT);
          if (cancelled) return;
          setViews((prev) => ({
            ...prev,
            netease: { title: data.name?.trim() || '网易热榜', songs: data.songs, error: '', loading: false },
          }));
        } catch (err: unknown) {
          if (cancelled) return;
          if (!silent) {
            setViews((prev) => ({
              ...prev,
              netease: { ...prev.netease, error: err instanceof Error ? err.message : '加载失败', loading: false },
            }));
          }
        } finally {
          // 成功/失败分支已更新对应平台状态。
        }
        return;
      }

      if (!silent) {
        setViews((prev) => ({
          ...prev,
          platform: { ...prev.platform, loading: true, error: '', title: '平台热榜' },
        }));
      }
      try {
        const data = await getPlatformHotSongs(PLATFORM_LIMIT);
        if (cancelled) return;
        // 不展示 count，只复用热榜行布局
        const nextSongs = data.map((song) => ({
            id: song.id,
            source: song.source,
            name: song.name,
            artist: song.artist,
            album: song.album,
            pic: song.pic,
            duration: song.duration,
          }));
        setViews((prev) => ({
          ...prev,
          platform: { title: '平台热榜', songs: nextSongs, error: '', loading: false },
        }));
      } catch (err: unknown) {
        if (cancelled) return;
        if (!silent) {
          setViews((prev) => ({
            ...prev,
            platform: { ...prev.platform, error: err instanceof Error ? err.message : '加载失败', loading: false },
          }));
        }
      } finally {
        // 成功/失败分支已更新对应平台状态。
      }
    };

    void load();

    // 平台热榜定时刷新；网易按日缓存，无需轮询
    let timer: number | undefined;
    if (source === 'platform') {
      timer = window.setInterval(() => {
        if (document.hidden) return;
        void load(true);
      }, 30_000);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [source, neteaseEnabled]);

  const renderBody = (viewSource: HotRankSource) => {
    const view = views[viewSource];
    const displaySongs = compact ? view.songs.slice(0, compactLimit) : view.songs;
    const emptyHint = viewSource === 'platform' ? '暂无平台热榜，播完点歌会出现在这里' : '暂无热榜歌曲';

    if (view.loading && view.songs.length === 0) {
      return compact ? (
        <p className="py-3 text-center text-xs text-netease-muted">加载中...</p>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-netease-muted">
          <Loader2 className="mb-2 h-5 w-5 animate-spin" />
          <p className="text-xs">加载热榜...</p>
        </div>
      );
    }
    if (view.error && view.songs.length === 0) {
      return compact ? (
        <p className="py-3 text-center text-xs text-netease-muted">{view.error}</p>
      ) : (
        <div className="flex flex-col items-center justify-center px-3 py-12 text-netease-muted">
          <Flame className="mb-2 h-6 w-6 opacity-30" />
          <p className="text-center text-xs">{view.error}</p>
        </div>
      );
    }
    if (displaySongs.length === 0) {
      return compact ? (
        <p className="py-3 text-center text-xs text-netease-muted">{emptyHint}</p>
      ) : (
        <div className="flex flex-col items-center justify-center px-3 py-12 text-netease-muted">
          <Flame className="mb-2 h-6 w-6 opacity-30" />
          <p className="text-center text-xs">{emptyHint}</p>
        </div>
      );
    }
    if (compact) {
      return (
        <div className="overflow-x-auto overscroll-x-contain touch-pan-x pb-0.5 [-webkit-overflow-scrolling:touch]">
          <div className="flex w-max gap-2.5">
            {displaySongs.map((song, i) => {
              const key = songKey(song);
              return <CompactToplistCard key={key} song={song} rank={i + 1} isAdding={addingId === key} onAdd={() => onAdd(song)} />;
            })}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {displaySongs.map((song, i) => {
          const key = songKey(song);
          return <ToplistRow key={key} song={song} rank={i + 1} isAdding={addingId === key} onAdd={() => onAdd(song)} />;
        })}
      </div>
    );
  };

  const header = (
    <div className="flex flex-shrink-0 items-center gap-1.5 px-3 py-2">
      <Flame className="h-3.5 w-3.5 flex-shrink-0 text-orange-400/90" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-white">{currentView.title}</h2>
      <SourceSwitch source={source} onChange={handleSourceChange} neteaseEnabled={neteaseEnabled} />
    </div>
  );

  if (compact) {
    return (
      <div className="surface-panel room-main-panel room-main-panel--hot flex-shrink-0 overflow-hidden rounded-2xl">
        {header}
        <div className="room-panel-divider border-t px-2 pb-2 pt-1.5">
          <div style={{ display: source === 'netease' ? undefined : 'none' }}>{renderBody('netease')}</div>
          <div style={{ display: source === 'platform' ? undefined : 'none' }}>{renderBody('platform')}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-col ${
        embedded
          ? 'h-full flex-1'
          : 'surface-panel room-main-panel room-main-panel--hot h-full overflow-hidden rounded-2xl'
      }`}
    >
      <div className="room-panel-divider border-b">{header}</div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1">
        <div style={{ display: source === 'netease' ? undefined : 'none' }}>{renderBody('netease')}</div>
        <div style={{ display: source === 'platform' ? undefined : 'none' }}>{renderBody('platform')}</div>
      </div>
    </div>
  );
});
