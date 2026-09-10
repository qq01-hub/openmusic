import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchWithTimeout } from '../api/http';

interface MusicSuggestion {
  name: string;
  artist: string;
  source: string;
}

interface RawMusicSuggestion {
  name?: unknown;
  artist?: unknown;
  source?: unknown;
  sources?: unknown;
}

interface SuggestionsResponse {
  suggestions: RawMusicSuggestion[];
  error?: string;
}

const KNOWN_SOURCES = new Set(['netease', 'tencent', 'kugou', 'qishui']);

function normalizeSuggestion(item: RawMusicSuggestion): MusicSuggestion | null {
  const name = String(item?.name || '').trim();
  const artist = String(item?.artist || '').trim();
  const sourceCandidates = [
    item?.source,
    ...(Array.isArray(item?.sources) ? item.sources : []),
  ].map((source) => String(source || '').trim().toLowerCase());
  const source = sourceCandidates.find((candidate) => KNOWN_SOURCES.has(candidate)) || '';
  if (!name || !artist) return null;
  return { name, artist, source };
}

const DEBOUNCE_MS = 300;

export function useMusicSuggestions(keyword: string, enabled: boolean = true) {
  const [suggestions, setSuggestions] = useState<MusicSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  // Abort 无法撤回已抵达的响应；递增编号保证旧响应不能覆盖最新关键词。
  const requestIdRef = useRef(0);

  const fetchSuggestions = useCallback(async (query: string, signal: AbortSignal, requestId: number) => {
    const isLatestRequest = () => !signal.aborted && requestId === requestIdRef.current;
    if (!query) {
      if (isLatestRequest()) setSuggestions([]);
      return;
    }

    try {
      if (isLatestRequest()) setLoading(true);
      const params = new URLSearchParams({ q: query });
      const response = await fetchWithTimeout(`/api/music/suggestions?${params.toString()}`, { signal });

      if (!response.ok) {
        console.error('Failed to fetch suggestions:', response.status);
        if (isLatestRequest()) setSuggestions([]);
        return;
      }

      const data: SuggestionsResponse = await response.json();
      if (isLatestRequest()) {
        setSuggestions(Array.isArray(data.suggestions)
          ? data.suggestions.map(normalizeSuggestion).filter((item): item is MusicSuggestion => Boolean(item))
          : []);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Failed to fetch suggestions:', error);
      if (isLatestRequest()) setSuggestions([]);
    } finally {
      if (isLatestRequest()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const trimmed = keyword.trim();
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (!trimmed) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    debounceTimerRef.current = window.setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      void fetchSuggestions(trimmed, controller.signal, requestId);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [keyword, enabled, fetchSuggestions]);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);
  return { suggestions, loading, clearSuggestions };
}
