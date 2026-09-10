import { memo, useState, useEffect, useRef, type KeyboardEvent } from 'react';
import { useMusicSuggestions } from '../hooks/useMusicSuggestions';
import { Loader2, Search } from 'lucide-react';
import { getMusicSuggestionSourceLabel } from '../lib/suggestionLabels';
import { buildSuggestionSearchText, preserveSearchFocusOnSuggestionPointerDown } from '../lib/suggestionInteraction';
import { shouldRequestMusicSuggestions } from '../lib/suggestionFocus';

interface MusicSuggestion {
  name: string;
  artist: string;
  source: string; // 单个优先平台
}

export type SelectedMusicSuggestion = Pick<MusicSuggestion, 'name' | 'artist'>;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSearch: (keyword?: string, suggestion?: SelectedMusicSuggestion) => void;
  placeholder?: string;
  searching?: boolean;
  suggestionsEnabled?: boolean;
  className?: string;
}

let nextOwnerId = 1;
let activeOwnerId: number | null = null;
const ownerListeners = new Set<() => void>();

function claimSuggestionOwner(ownerId: number) {
  if (activeOwnerId === ownerId) return;
  activeOwnerId = ownerId;
  ownerListeners.forEach((listener) => listener());
}

function SearchInputWithSuggestions({
  value,
  onChange,
  onSearch,
  placeholder = '搜索歌曲、歌手...',
  searching = false,
  suggestionsEnabled = true,
  className = '',
}: Props) {
  const [inputFocused, setInputFocused] = useState(false);
  const { suggestions, loading } = useMusicSuggestions(
    value,
    shouldRequestMusicSuggestions({ enabled: suggestionsEnabled, focused: inputFocused, searching }),
  );
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ownerIdRef = useRef<number | null>(null);
  if (ownerIdRef.current === null) ownerIdRef.current = nextOwnerId++;
  const ownerId = ownerIdRef.current;
  const [isActiveOwner, setIsActiveOwner] = useState(() => activeOwnerId === ownerId);

  useEffect(() => {
    const listener = () => setIsActiveOwner(activeOwnerId === ownerId);
    ownerListeners.add(listener);
    return () => {
      ownerListeners.delete(listener);
      if (activeOwnerId === ownerId) activeOwnerId = null;
    };
  }, [ownerId]);

  // 点击外部关闭建议框；点击当前输入框时抢占联想层所有权
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      } else {
        claimSuggestionOwner(ownerId);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ownerId]);

  // 输入时显示建议
  useEffect(() => {
    if (inputFocused && value.trim() && suggestions.length > 0) {
      setShowSuggestions(true);
      setSelectedIndex(-1);
    } else {
      setShowSuggestions(false);
    }
  }, [inputFocused, value, suggestions]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        onSearch(value.trim());
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          const selected = suggestions[selectedIndex];
          const nextValue = buildSuggestionSearchText(selected);
          onChange(nextValue);
          setShowSuggestions(false);
          onSearch(nextValue, selected);
        } else {
          onSearch(value.trim());
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  const handleSuggestionClick = (suggestion: MusicSuggestion) => {
    claimSuggestionOwner(ownerId);
    const nextValue = buildSuggestionSearchText(suggestion);
    onChange(nextValue);
    setShowSuggestions(false);
    inputRef.current?.focus();
    onSearch(nextValue, suggestion);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          claimSuggestionOwner(ownerId);
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setInputFocused(true);
          claimSuggestionOwner(ownerId);
          if (inputFocused && value.trim() && suggestions.length > 0) {
            setShowSuggestions(true);
          }
        }}
        onBlur={() => {
          setInputFocused(false);
          setShowSuggestions(false);
        }}
        placeholder={placeholder}
        className={className}
      />

      {/* 搜索建议下拉框 */}
      {isActiveOwner && showSuggestions && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border border-netease-border bg-netease-card shadow-2xl">
          {loading && (
            <div className="flex items-center justify-center gap-2 px-4 py-3 text-xs text-netease-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          )}
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.name}-${suggestion.artist}-${index}`}
              type="button"
              onPointerDown={preserveSearchFocusOnSuggestionPointerDown}
              onClick={() => handleSuggestionClick(suggestion)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-netease-red/15 text-white'
                  : 'hover:bg-white/5 text-white/90'
              }`}
            >
              <Search className="h-4 w-4 flex-shrink-0 text-netease-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{suggestion.name}</p>
                <p className="truncate text-xs text-netease-muted">{suggestion.artist}</p>
              </div>
              {getMusicSuggestionSourceLabel(suggestion.source) && (
                <span className="rounded px-1.5 py-0.5 text-[10px] text-netease-muted">
                  {getMusicSuggestionSourceLabel(suggestion.source)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(SearchInputWithSuggestions);
