import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Radio, Search } from 'lucide-react';
import type { DjRadioItem } from '../api/music/djRadio';
import { useVirtualListWindow } from '../hooks/useVirtualListWindow';
import {
  getDjRadiosByMode,
  peekDjRadiosByMode,
  searchDjRadiosCached,
} from '../lib/djRadios';

const GRID_COLUMNS = 4;
const GRID_ROW_ESTIMATE_PX = 164;

interface Props {
  onSelectRadio: (radio: DjRadioItem) => Promise<void>;
  hideHeader?: boolean;
  immersive?: boolean;
}

const RadioCover = memo(function RadioCover({
  radio,
  isLoading,
}: {
  radio: DjRadioItem;
  isLoading: boolean;
}) {
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-netease-card">
      {radio.coverImgUrl ? (
        <img
          src={radio.coverImgUrl}
          alt=""
          width={160}
          height={160}
          loading="eager"
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
        className={`h-full w-full items-center justify-center bg-gradient-to-br from-rose-900/40 to-netease-dark text-netease-muted/35 ${radio.coverImgUrl ? 'hidden' : 'flex'} text-lg`}
      >
        ♪
      </div>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        </div>
      )}
    </div>
  );
});

const RadioCard = memo(function RadioCard({
  radio,
  isLoading,
  disabled,
  immersive,
  onSelect,
}: {
  radio: DjRadioItem;
  isLoading: boolean;
  disabled: boolean;
  immersive: boolean;
  onSelect: (radio: DjRadioItem) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(radio)}
      className={`modal-card-grid-item group flex h-full w-full flex-col items-center text-center transition-colors disabled:opacity-60 ${
        immersive
          ? 'mineradio-glass-card rounded-2xl p-1.5'
          : 'rounded-2xl p-1 hover:bg-netease-card/60'
      }`}
    >
      <RadioCover radio={radio} isLoading={isLoading} />
      <p className="mt-1 line-clamp-2 min-h-[2.5em] w-full px-0.5 text-center text-[10px] font-medium leading-tight text-white/90">
        {radio.name}
      </p>
      {(radio.creatorName || radio.trackCount > 0) && (
        <p className="line-clamp-1 w-full text-[9px] text-white/40">
          {radio.creatorName || `${radio.trackCount} 期`}
        </p>
      )}
    </button>
  );
});

function RadioSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col items-center">
          <div className="aspect-square w-full rounded-2xl skeleton-shimmer" />
          <div className="mt-1 h-2 w-full rounded skeleton-shimmer" />
        </div>
      ))}
    </div>
  );
}

export default memo(function DjRadioPanel({
  onSelectRadio,
  hideHeader = false,
  immersive = false,
}: Props) {
  const cachedHot = peekDjRadiosByMode('hot');
  const cachedRecommend = peekDjRadiosByMode('recommend');
  const [tab, setTab] = useState<'hot' | 'recommend'>('hot');
  const [hot, setHot] = useState<DjRadioItem[]>(() => cachedHot ?? []);
  const [recommend, setRecommend] = useState<DjRadioItem[]>(() => cachedRecommend ?? []);
  const [hotLoading, setHotLoading] = useState(() => !cachedHot);
  const [recommendLoading, setRecommendLoading] = useState(() => !cachedRecommend);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<DjRadioItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const onSelectRadioRef = useRef(onSelectRadio);
  const loadingKeyRef = useRef<string | null>(null);
  onSelectRadioRef.current = onSelectRadio;
  loadingKeyRef.current = loadingKey;

  useEffect(() => {
    let cancelled = false;
    if (!peekDjRadiosByMode('hot')) setHotLoading(true);
    void getDjRadiosByMode('hot')
      .then((data) => {
        if (cancelled) return;
        setHot(data);
        setError('');
      })
      .catch((err) => {
        if (!cancelled && !peekDjRadiosByMode('hot')) {
          setError(err instanceof Error ? err.message : '电台加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setHotLoading(false);
      });

    if (!peekDjRadiosByMode('recommend')) setRecommendLoading(true);
    void getDjRadiosByMode('recommend')
      .then((data) => {
        if (cancelled) return;
        setRecommend(data);
      })
      .catch(() => {
        // 推荐电台失败不覆盖热门电台状态
      })
      .finally(() => {
        if (!cancelled) setRecommendLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback((radio: DjRadioItem) => {
    if (loadingKeyRef.current) return;
    loadingKeyRef.current = radio.id;
    setLoadingKey(radio.id);
    void onSelectRadioRef.current(radio).finally(() => {
      loadingKeyRef.current = null;
      setLoadingKey(null);
    });
  }, []);

  const handleSearch = async () => {
    const keyword = searchInput.trim();
    if (!keyword) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const list = await searchDjRadiosCached(keyword);
      setSearchResults(list);
      if (list.length === 0) setError('没有找到相关电台');
    } catch (err) {
      setSearchResults([]);
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const list = searchResults ?? (tab === 'hot' ? hot : recommend);
  const loading = searchResults === null && (tab === 'hot' ? hotLoading && hot.length === 0 : recommendLoading && recommend.length === 0);
  const rowCount = Math.ceil(list.length / GRID_COLUMNS);
  const { startIndex, endIndex, topSpacerPx, bottomSpacerPx } = useVirtualListWindow(scrollBodyRef, {
    count: loading || searching ? 0 : rowCount,
    itemSize: GRID_ROW_ESTIMATE_PX,
    overscan: 3,
    minVirtualCount: 6,
    defaultViewportHeight: 540,
    resetKey: searchResults ? `search:${searchResults.length}` : tab,
  });
  const visibleList = useMemo(() => {
    if (startIndex === 0 && endIndex >= rowCount) return list;
    return list.slice(startIndex * GRID_COLUMNS, endIndex * GRID_COLUMNS);
  }, [endIndex, list, rowCount, startIndex]);
  const anyLoading = Boolean(loadingKey);

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden ${hideHeader ? 'h-full flex-1' : 'h-full'}`}>
      {!hideHeader && (
        <div className="mb-2 flex items-center gap-2 px-1">
          <Radio className="h-4 w-4 text-rose-400" />
          <h2 className="text-sm font-medium">音乐电台</h2>
        </div>
      )}

      <div className="flex-shrink-0 space-y-2 px-3 pb-2 pt-1">
        <div className="flex gap-1.5">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch();
            }}
            placeholder="搜索电台…"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none placeholder:text-white/35 focus:border-white/25"
          />
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={searching}
            className="inline-flex items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/85 transition-colors hover:bg-white/15 disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            搜索
          </button>
        </div>

        {searchResults === null && (
          <div className="flex gap-1">
            {([
              ['hot', '热门'],
              ['recommend', '推荐'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
                  tab === key
                    ? 'bg-white/15 text-white'
                    : 'text-white/50 hover:bg-white/8 hover:text-white/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {searchResults !== null && (
          <button
            type="button"
            onClick={() => {
              setSearchResults(null);
              setSearchInput('');
              setError('');
            }}
            className="text-[11px] text-white/45 hover:text-white/75"
          >
            ← 返回热门/推荐
          </button>
        )}
      </div>

      <div ref={scrollBodyRef} className="room-modal-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {loading || searching ? (
          <RadioSkeleton />
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-xs text-white/45">
            {error || '暂无电台'}
          </p>
        ) : (
          <>
            {error && list.length > 0 && (
              <p className="mb-2 text-center text-[11px] text-amber-300/80">{error}</p>
            )}
            <div
              className="grid grid-cols-4 gap-2"
              style={topSpacerPx > 0 || bottomSpacerPx > 0
                ? { paddingTop: topSpacerPx, paddingBottom: bottomSpacerPx }
                : undefined}
            >
              {visibleList.map((radio) => (
                <RadioCard
                  key={radio.id}
                  radio={radio}
                  isLoading={loadingKey === radio.id}
                  disabled={anyLoading}
                  immersive={immersive}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
