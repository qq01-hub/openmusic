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
import { useRoomStore } from '../stores/roomStore';

export interface SongResultRemotePagination {
  page: number;
  pageSize: SongResultPageSize;
  totalPages: number;
  total: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: SongResultPageSize) => void;
}

interface Props {
  results: SearchResult[];
  addingId: string | null;
  onAdd: (song: SearchResult) => void;
  onRemove?: (song: SearchResult) => void;
  onAddNext?: (song: SearchResult) => void;
  /** 分享到当前房间聊天（音乐卡片） */
  onShare?: (song: SearchResult) => void;
  onArtistClick?: (artist: string) => void;
  keyword?: string;
  alwaysShowActions?: boolean;
  onPageResultsChange?: (songs: SearchResult[]) => void;
  fillHeight?: boolean;
  immersiveGlass?: boolean;
  /** 传入后由外部负责分页与取数，results 视为当前页 */
  pagination?: SongResultRemotePagination;
}

function SongResultList({
  results,
  addingId,
  onAdd,
  onRemove,
  onAddNext,
  onShare,
  onArtistClick,
  keyword,
  alwaysShowActions = false,
  onPageResultsChange,
  fillHeight = false,
  immersiveGlass = false,
  pagination,
}: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<SongResultPageSize>(getStoredSongResultPageSize);
  const { queueKeys, playedKeys } = useRoomSongKeySets();
  const { favoriteIds } = useFavorites();
  const queue = useRoomStore(s => s.room?.queue);
  const currentKey = useRoomStore(s => s.room?.current ? songKey(s.room.current) : '');
  const myUserId = useRoomStore(s => s.mySocketId);
  const nickname = useRoomStore(s => s.nickname);
  const canControlPlayback = useRoomStore(s => s.canControlPlayback);
  const readOnly = useRoomStore(s => Boolean(s.room?.users.find(user => user.id === s.mySocketId)?.readOnly));
  const cancelableKeys = useMemo(() => new Set((queue || [])
    .filter(song => !readOnly && (canControlPlayback || song.requestedById === myUserId
      || (!song.requestedById && song.requestedBy === nickname)))
    .map(songKey)), [canControlPlayback, myUserId, nickname, queue, readOnly]);
  const onAddRef = useRef(onAdd);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  onAddRef.current = onAdd;

  const currentPage = pagination ? pagination.page : page;
  const effectivePageSize = pagination ? pagination.pageSize : pageSize;
  const totalPages = pagination
    ? Math.max(1, pagination.totalPages)
    : Math.max(1, Math.ceil(results.length / effectivePageSize));
  const totalCount = pagination
    ? (pagination.total > 0 ? pagination.total : results.length)
    : results.length;
  const sortedResults = useMemo(() => {
    const favorites: SearchResult[] = [];
    const others: SearchResult[] = [];
    for (const song of results) {
      (favoriteIds.has(songKey(song)) ? favorites : others).push(song);
    }
    return favorites.length ? [...favorites, ...others] : results;
  }, [favoriteIds, results]);
  const remotePagination = Boolean(pagination);
  const pageResults = useMemo(() => remotePagination
    ? sortedResults
    : sortedResults.slice((page - 1) * pageSize, page * pageSize),
  [page, pageSize, remotePagination, sortedResults]);

  const handleRowAdd = useCallback((song: SearchResult) => {
    onAddRef.current(song);
  }, []);

  useEffect(() => {
    if (!pagination) setPage(1);
  }, [keyword, pageSize, pagination]);
  useEffect(() => {
    if (!pagination && page > totalPages) setPage(totalPages);
  }, [page, totalPages, pagination]);
  useEffect(() => {
    onPageResultsChange?.(pageResults);
  }, [pageResults, onPageResultsChange]);

  // 翻页 / 换关键词 / 卸载时停掉试听，避免后台继续播
  useEffect(() => {
    stopSongPreview({ resumeRoom: true });
  }, [currentPage, keyword]);

  useEffect(() => () => {
    stopSongPreview({ resumeRoom: true });
  }, []);

  const handlePageSizeChange = useCallback((next: SongResultPageSize) => {
    setPageSize(next);
    setStoredSongResultPageSize(next);
    if (pagination) {
      pagination.onPageSizeChange(next);
    } else {
      setPage(1);
    }
  }, [pagination]);

  const handlePageChange = useCallback((next: number) => {
    if (pagination) {
      pagination.onPageChange(next);
    } else {
      setPage(next);
    }
  }, [pagination]);

  if (results.length === 0 && !pagination) return null;

  return (
    <div
      className={`flex min-h-0 flex-col ${fillHeight ? 'h-full' : ''}`}
      style={fillHeight ? undefined : { height: RESULT_BODY_HEIGHT }}
    >
      <div ref={scrollBodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        <div className="space-y-2">
          {pageResults.length === 0 && (
            <p role="status" className="py-8 text-center text-sm text-netease-muted">
              {pagination?.loading ? '正在加载歌曲' : '本页暂无可显示的歌曲，可尝试翻页'}
            </p>
          )}
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
                onRemove={onRemove}
                cancelDisabledReason={queueKeys.has(key) && !cancelableKeys.has(key)
                  ? currentKey === key ? '正在播放的歌曲不能取消' : '只能取消自己点的歌'
                  : undefined}
                onAddNext={onAddNext}
                onShare={onShare}
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
            value={effectivePageSize}
            options={SONG_RESULT_PAGE_SIZE_OPTIONS}
            onChange={handlePageSizeChange}
          />
          <span className="flex items-center gap-1 text-xs text-netease-muted">
            {currentPage} / {totalPages}
            <span className="text-netease-muted/50">共 {totalCount} 首</span>
            {pagination?.loading && <span className="text-netease-muted/70">加载中…</span>}
          </span>
        </div>

        <PageNumberPagination
          page={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          disabled={pagination?.loading}
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
  && prev.onShare === next.onShare
  && prev.onRemove === next.onRemove
  && prev.onAddNext === next.onAddNext
  && prev.onArtistClick === next.onArtistClick
  && prev.pagination?.page === next.pagination?.page
  && prev.pagination?.pageSize === next.pagination?.pageSize
  && prev.pagination?.totalPages === next.pagination?.totalPages
  && prev.pagination?.total === next.pagination?.total
  && prev.pagination?.loading === next.pagination?.loading
  && prev.pagination?.onPageChange === next.pagination?.onPageChange
  && prev.pagination?.onPageSizeChange === next.pagination?.onPageSizeChange
));
