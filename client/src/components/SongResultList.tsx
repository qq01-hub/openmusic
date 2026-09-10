import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchResult } from '../types';
import { songKey } from '../api/music';
import PageSizeSelect from './PageSizeSelect';
import { RESULT_BODY_HEIGHT } from './SearchSkeleton';
import {
  getStoredSongResultPageSize,
  setStoredSongResultPageSize,
  SONG_RESULT_PAGE_SIZE_OPTIONS,
  type SongResultPageSize,
} from '../lib/songResultPagination';
import PageNumberPagination from './PageNumberPagination';
import SongResultRow from './SongResultRow';
import { immersiveGlassListFooter } from '../lib/immersiveGlass';
import { useRoomSongKeySets } from '../hooks/useRoomSongKeySets';
import { useFavorites } from '../hooks/useFavorites';
import { stopSongPreview } from '../lib/songPreviewPlayer';

interface Props {
  results: SearchResult[];
  addingId: string | null;
  onAdd: (song: SearchResult) => void;
  onArtistClick?: (artist: string) => void;
  keyword?: string;
  alwaysShowActions?: boolean;
  onPageResultsChange?: (songs: SearchResult[]) => void;
  fillHeight?: boolean;
  immersiveGlass?: boolean;
}

function SongResultList({
  results,
  addingId,
  onAdd,
  onArtistClick,
  keyword,
  alwaysShowActions = false,
  onPageResultsChange,
  fillHeight = false,
  immersiveGlass = false,
}: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<SongResultPageSize>(getStoredSongResultPageSize);
  const { queueKeys, playedKeys } = useRoomSongKeySets();
  const { favoriteIds } = useFavorites();
  const onAddRef = useRef(onAdd);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  onAddRef.current = onAdd;

  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const pageResults = useMemo(
    () => results.slice((page - 1) * pageSize, page * pageSize),
    [results, page, pageSize],
  );

  const handleRowAdd = useCallback((song: SearchResult) => {
    onAddRef.current(song);
  }, []);

  useEffect(() => setPage(1), [keyword, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  useEffect(() => {
    onPageResultsChange?.(pageResults);
  }, [pageResults, onPageResultsChange]);

  // 翻页 / 换关键词 / 卸载时停掉试听，避免后台继续播
  useEffect(() => {
    stopSongPreview({ resumeRoom: true });
  }, [page, keyword]);

  useEffect(() => () => {
    stopSongPreview({ resumeRoom: true });
  }, []);

  const handlePageSizeChange = useCallback((next: SongResultPageSize) => {
    setPageSize(next);
    setStoredSongResultPageSize(next);
    setPage(1);
  }, []);

  if (results.length === 0) return null;

  return (
    <div
      className={`flex min-h-0 flex-col ${fillHeight ? 'h-full' : ''}`}
      style={fillHeight ? undefined : { height: RESULT_BODY_HEIGHT }}
    >
      <div ref={scrollBodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        <div className="space-y-2">
          {pageResults.map((song) => {
            const key = songKey(song);
            return (
              <SongResultRow
                key={key}
                song={song}
                addingId={addingId}
                alwaysShowActions={alwaysShowActions}
                inQueue={queueKeys.has(key)}
                played={playedKeys.has(key)}
                favorited={favoriteIds.has(key)}
                glassRow={immersiveGlass}
                onAdd={handleRowAdd}
                onArtistClick={onArtistClick}
              />
            );
          })}
        </div>
      </div>

      <div
        className={`mt-auto flex-shrink-0 space-y-2 overflow-visible pt-3 ${
          immersiveGlass
            ? immersiveGlassListFooter
            : 'border-t border-netease-border/40 bg-netease-bg/90'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PageSizeSelect
            value={pageSize}
            options={SONG_RESULT_PAGE_SIZE_OPTIONS}
            onChange={handlePageSizeChange}
          />
          <span className="text-xs text-netease-muted">
            {page} / {totalPages}
            <span className="ml-1 text-netease-muted/50">共 {results.length} 首</span>
          </span>
        </div>

        <PageNumberPagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          scrollRef={scrollBodyRef}
        />
      </div>
    </div>
  );
}

export default memo(SongResultList, (prev, next) => (
  prev.results === next.results
  && prev.addingId === next.addingId
  && prev.keyword === next.keyword
  && prev.alwaysShowActions === next.alwaysShowActions
  && prev.fillHeight === next.fillHeight
  && prev.immersiveGlass === next.immersiveGlass
  && prev.onPageResultsChange === next.onPageResultsChange
  && prev.onArtistClick === next.onArtistClick
));
