import { memo, useCallback } from 'react';
import { Plus, Loader2, Play, Pause, UserRound } from 'lucide-react';
import type { SearchResult } from '../types';
import { songKey } from '../api/music';
import SongCover from './SongCover';
import SongRowBadges from './SongRowBadges';
import FavoriteButton from './FavoriteButton';
import Tooltip from './Tooltip';
import TruncateTip from './TruncateTip';
import { immersiveGlassListRow } from '../lib/immersiveGlass';
import { useSongPreviewState } from '../hooks/useSongPreviewState';
import { stopSongPreview, toggleSongPreview } from '../lib/songPreviewPlayer';

interface Props {
  song: SearchResult;
  addingId: string | null;
  alwaysShowActions: boolean;
  inQueue: boolean;
  played: boolean;
  favorited: boolean;
  glassRow?: boolean;
  onAdd: (song: SearchResult) => void;
  onArtistClick?: (artist: string) => void;
}

function SongResultRow({
  song,
  addingId,
  alwaysShowActions,
  inQueue,
  played,
  favorited,
  glassRow = false,
  onAdd,
  onArtistClick,
}: Props) {
  const key = songKey(song);
  const artistLine = `${song.artist}${song.album ? ` · ${song.album}` : ''}`;
  const preview = useSongPreviewState();
  const isThisPreview = preview.key === key;
  const previewLoading = isThisPreview && preview.status === 'loading';
  const previewPlaying = isThisPreview && preview.status === 'playing';

  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void toggleSongPreview(song);
  }, [song]);

  const handleAdd = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (preview.key === key) stopSongPreview({ resumeRoom: true });
    onAdd(song);
  }, [key, onAdd, preview.key, song]);

  return (
    <div
      className={`group flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-colors sm:gap-3 sm:p-3 [content-visibility:auto] [contain-intrinsic-size:auto_72px] ${
        glassRow ? immersiveGlassListRow : 'hover:bg-netease-card/80 active:bg-netease-card/80'
      }`}
      onDoubleClick={() => handleAdd()}
    >
      <SongCover
        song={song}
        className="h-12 w-12 flex-shrink-0 rounded-lg bg-netease-card object-cover"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <TruncateTip text={song.name} as="p" className="truncate text-sm font-medium" />
        <TruncateTip text={artistLine} as="p" className="truncate text-xs text-netease-muted" />
        {isThisPreview && preview.status === 'error' && preview.error && (
          <p className="truncate text-[10px] text-amber-400/90">{preview.error}</p>
        )}
      </div>
      <SongRowBadges song={song} status={{ inQueue, played }} />
      <FavoriteButton
        song={song}
        favorited={favorited}
        showOnHover={!alwaysShowActions}
        className="h-7 w-7 text-netease-muted hover:text-rose-300"
        iconClassName="h-3.5 w-3.5"
      />
      {onArtistClick && (
        <Tooltip content={`查找 ${song.artist} 的其他歌曲`}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onArtistClick(song.artist);
            }}
            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/5 text-netease-muted transition-all hover:bg-white/10 hover:text-white ${alwaysShowActions ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
            aria-label={`查找 ${song.artist} 的其他歌曲`}
          >
            <UserRound className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}
      <Tooltip content={previewPlaying ? '暂停试听' : '试听'}>
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewLoading}
          className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-50 ${
            previewPlaying || previewLoading
              ? 'bg-sky-500/20 text-sky-300'
              : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
          } ${alwaysShowActions ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
          aria-label={previewPlaying ? '暂停试听' : '试听'}
        >
          {previewLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : previewPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
      </Tooltip>
      <button
        type="button"
        onClick={handleAdd}
        disabled={addingId === key}
        aria-label="点歌"
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-netease-red/10 text-netease-red transition-all hover:bg-netease-red hover:text-white disabled:opacity-50 sm:h-auto sm:w-auto sm:gap-1 sm:px-2.5 sm:py-1 sm:text-xs sm:font-medium ${alwaysShowActions ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}
      >
        {addingId === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        <span className="hidden sm:inline">点歌</span>
      </button>
    </div>
  );
}

export default memo(SongResultRow, (prev, next) => (
  prev.addingId === next.addingId
  && prev.alwaysShowActions === next.alwaysShowActions
  && prev.inQueue === next.inQueue
  && prev.played === next.played
  && prev.favorited === next.favorited
  && prev.glassRow === next.glassRow
  && prev.onAdd === next.onAdd
  && prev.onArtistClick === next.onArtistClick
  && songKey(prev.song) === songKey(next.song)
  && prev.song.name === next.song.name
  && prev.song.artist === next.song.artist
  && prev.song.album === next.song.album
  && prev.song.pic === next.song.pic
));
