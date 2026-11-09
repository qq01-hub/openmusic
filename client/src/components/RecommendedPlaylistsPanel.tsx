import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { PlaylistSearchItem } from '../api/music/playlist';
import {
  CURATED_COUNT,
  CURATED_NETEASE,
  getRecommendedPlaylists,
  getRecommendedPlaylistsFallback,
  peekRecommendedPlaylists,
  PLATFORM_PLAYLIST_LIMIT,
} from '../lib/recommendedPlaylists';

const NETEASE_EXTRA_LIMIT = PLATFORM_PLAYLIST_LIMIT;
const GRID_COLS_CLASS = 'grid grid-cols-4 gap-2';

function playlistKey(playlist: PlaylistSearchItem) {
  return `${playlist.platform}-${playlist.id}`;
}

interface Props {
  onSelectPlaylist: (playlist: PlaylistSearchItem) => Promise<void>;
  compact?: boolean;
  hideHeader?: boolean;
  immersive?: boolean;
}

const PlaylistCover = memo(function PlaylistCover({
  playlist,
  isLoading,
  compact = false,
}: {
  playlist: PlaylistSearchItem;
  isLoading: boolean;
  compact?: boolean;
}) {
  const px = compact ? 80 : 160;
  return (
    <div
      className={`relative overflow-hidden bg-netease-card ${
        compact ? 'aspect-square w-full flex-shrink-0 rounded-xl' : 'aspect-square w-full rounded-2xl'
      }`}
    >
      {playlist.coverImgUrl ? (
        <img
          src={playlist.coverImgUrl}
          alt=""
          width={px}
          height={px}
          loading={compact ? 'lazy' : 'eager'}
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
            const fallback = event.currentTarget.nextElementSibling;
            if (fallback instanceof HTMLElement) fallback.style.display = 'flex';
          }}
        />
      ) : null}
      <div
        className={`h-full w-full items-center justify-center bg-gradient-to-br from-netease-card to-netease-dark text-netease-muted/35 ${playlist.coverImgUrl ? 'hidden' : 'flex'} ${compact ? 'text-sm' : 'text-lg'}`}
      >
        ♪
      </div>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <Loader2 className={`animate-spin text-white ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
        </div>
      )}
    </div>
  );
});

function PlaylistSkeleton({
  compact = false,
  count = 8,
}: {
  compact?: boolean;
  count?: number;
}) {
  const cardClass = compact ? 'aspect-square w-full rounded-xl' : 'aspect-square w-full rounded-2xl';

  if (compact) {
    return (
      <div className="flex min-w-min gap-2.5 pb-1">
        {Array.from({ length: Math.min(8, CURATED_COUNT + NETEASE_EXTRA_LIMIT) }, (_, i) => (
          <div key={i} className="flex w-20 flex-shrink-0 flex-col items-center">
            <div className={`${cardClass} skeleton-shimmer`} />
            <div className="mt-1 h-2 w-full rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={GRID_COLS_CLASS}>
      {Array.from({ length: count }, (_, i) => (
        <div key={`skeleton-${i}`} className="flex flex-col items-center">
          <div className={`${cardClass} skeleton-shimmer`} />
          <div className="mt-1 w-full space-y-1">
            <div className="h-2 w-full rounded skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

const PlaylistCard = memo(function PlaylistCard({
  playlist,
  isLoading,
  disabled,
  compact,
  immersive = false,
  onSelect,
}: {
  playlist: PlaylistSearchItem;
  isLoading: boolean;
  disabled: boolean;
  compact: boolean;
  immersive?: boolean;
  onSelect: (playlist: PlaylistSearchItem) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(playlist)}
      className={`modal-card-grid-item group flex flex-col transition-colors disabled:opacity-60 ${
        compact
          ? 'w-20 flex-shrink-0 items-center text-center'
          : immersive
            ? 'mineradio-glass-card h-full w-full items-center rounded-2xl p-1.5 text-center'
            : 'h-full w-full items-center rounded-2xl p-1 text-center hover:bg-netease-card/60'
      }`}
    >
      <PlaylistCover playlist={playlist} isLoading={isLoading} compact={compact} />
      <p
        className={`line-clamp-2 w-full min-h-[2.5em] font-medium leading-tight text-white/90 ${
          compact ? 'mt-1 text-center text-[10px] text-white/85' : 'mt-1 px-0.5 text-center text-[10px]'
        }`}
      >
        {playlist.name}
      </p>
    </button>
  );
});

export default memo(function RecommendedPlaylistsPanel({
  onSelectPlaylist,
  compact = false,
  hideHeader = false,
  immersive = false,
}: Props) {
  const cached = peekRecommendedPlaylists();
  const [neteasePlaylists, setNeteasePlaylists] = useState(
    () => cached?.neteasePlaylists ?? CURATED_NETEASE,
  );
  const [qqPlaylists, setQqPlaylists] = useState(() => cached?.qqPlaylists ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const onSelectPlaylistRef = useRef(onSelectPlaylist);
  const loadingKeyRef = useRef<string | null>(null);
  onSelectPlaylistRef.current = onSelectPlaylist;
  loadingKeyRef.current = loadingKey;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!peekRecommendedPlaylists()) setLoading(true);
      try {
        const data = await getRecommendedPlaylists();
        if (cancelled) return;
        setNeteasePlaylists(data.neteasePlaylists);
        setQqPlaylists(data.qqPlaylists);
      } catch {
        if (!cancelled && !peekRecommendedPlaylists()) {
          const fallback = getRecommendedPlaylistsFallback();
          setNeteasePlaylists(fallback.neteasePlaylists);
          setQqPlaylists(fallback.qqPlaylists);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = useCallback((playlist: PlaylistSearchItem) => {
    const key = playlistKey(playlist);
    if (loadingKeyRef.current) return;
    loadingKeyRef.current = key;
    setLoadingKey(key);
    void onSelectPlaylistRef.current(playlist).finally(() => {
      loadingKeyRef.current = null;
      setLoadingKey(null);
    });
  }, []);

  const renderPlaylistHorizontalScroll = () => {
    const curated = neteasePlaylists.slice(0, CURATED_COUNT);
    const neteaseExtras = neteasePlaylists.slice(CURATED_COUNT);
    const items: PlaylistSearchItem[] = [...curated];
    for (let i = 0; i < NETEASE_EXTRA_LIMIT; i += 1) {
      if (neteaseExtras[i]) items.push(neteaseExtras[i]);
      if (qqPlaylists[i]) items.push(qqPlaylists[i]);
    }
    const anyLoading = Boolean(loadingKey);

    return (
      <div className="flex min-w-min gap-2.5 pb-1">
        {items.map((playlist) => (
          <PlaylistCard
            key={playlistKey(playlist)}
            playlist={playlist}
            isLoading={loadingKey === playlistKey(playlist)}
            disabled={anyLoading}
            compact
            immersive={immersive}
            onSelect={handleSelect}
          />
        ))}
      </div>
    );
  };

  const renderPlaylistGrid = () => {
    const curated = neteasePlaylists.slice(0, CURATED_COUNT);
    const neteaseExtras = neteasePlaylists.slice(CURATED_COUNT);
    const anyLoading = Boolean(loadingKey);

    const renderCard = (playlist: PlaylistSearchItem) => (
      <PlaylistCard
        key={playlistKey(playlist)}
        playlist={playlist}
        isLoading={loadingKey === playlistKey(playlist)}
        disabled={anyLoading}
        compact={false}
        immersive={immersive}
        onSelect={handleSelect}
      />
    );

    return (
      <div className="space-y-3">
        <div className={GRID_COLS_CLASS}>
          {curated.map(renderCard)}
        </div>
        {loading && neteaseExtras.length === 0 && qqPlaylists.length === 0 && (
          <PlaylistSkeleton count={8} />
        )}
        {neteaseExtras.length > 0 && (
          <div className={GRID_COLS_CLASS}>
            {neteaseExtras.map(renderCard)}
          </div>
        )}
        {qqPlaylists.length > 0 ? (
          <div className={GRID_COLS_CLASS}>
            {qqPlaylists.map(renderCard)}
          </div>
        ) : !loading ? (
          <p className="py-2 text-center text-[10px] text-netease-muted">暂无 QQ 推荐</p>
        ) : null}
      </div>
    );
  };

  if (compact) {
    return (
      <div className="flex flex-shrink-0 flex-col overflow-hidden rounded-3xl border border-netease-border/50 bg-netease-card/30">
        <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-netease-border/50 px-3 py-2">
          <Sparkles className="h-3.5 w-3.5 text-sky-400" />
          <h2 className="text-xs font-medium">热榜歌单</h2>
        </div>
        <div className="overflow-x-auto p-2">
          {loading ? <PlaylistSkeleton compact /> : renderPlaylistHorizontalScroll()}
        </div>
      </div>
    );
  }

  if (hideHeader) {
    return (
      <div className="px-3 py-3 pb-4">
        {renderPlaylistGrid()}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-netease-border/50 px-4 py-1.5 lg:border-t-0">
        <Sparkles className="h-4 w-4 text-sky-400" />
        <h2 className="text-sm font-medium">热榜歌单</h2>
      </div>

      <div className="room-modal-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {renderPlaylistGrid()}
      </div>
    </div>
  );
});
