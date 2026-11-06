import { useEffect, useState } from 'react';
import { Loader2, Radio, Search } from 'lucide-react';
import type { DjRadioItem } from '../api/music/djRadio';
import { getDjRadios, peekDjRadios, searchDjRadiosCached } from '../lib/djRadios';

interface Props {
  onSelectRadio: (radio: DjRadioItem) => Promise<void>;
  hideHeader?: boolean;
  immersive?: boolean;
}

function RadioCover({
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
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
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
}

function RadioCard({
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
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`group flex h-full w-full flex-col items-center text-center transition-colors disabled:opacity-60 ${
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
}

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

export default function DjRadioPanel({
  onSelectRadio,
  hideHeader = false,
  immersive = false,
}: Props) {
  const cached = peekDjRadios();
  const [tab, setTab] = useState<'hot' | 'recommend'>('hot');
  const [hot, setHot] = useState<DjRadioItem[]>(() => cached?.hot ?? []);
  const [recommend, setRecommend] = useState<DjRadioItem[]>(() => cached?.recommend ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<DjRadioItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!peekDjRadios()) setLoading(true);
      try {
        const data = await getDjRadios();
        if (cancelled) return;
        setHot(data.hot);
        setRecommend(data.recommend);
        setError('');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '电台加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (radio: DjRadioItem) => {
    if (loadingKey) return;
    setLoadingKey(radio.id);
    try {
      await onSelectRadio(radio);
    } finally {
      setLoadingKey(null);
    }
  };

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

      <div className="room-modal-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
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
            <div className="grid grid-cols-4 gap-2">
              {list.map((radio) => (
                <RadioCard
                  key={radio.id}
                  radio={radio}
                  isLoading={loadingKey === radio.id}
                  disabled={Boolean(loadingKey)}
                  immersive={immersive}
                  onSelect={() => void handleSelect(radio)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
