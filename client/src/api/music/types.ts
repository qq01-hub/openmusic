import type { LyricLine, MusicSource, SearchResult, Song } from '../../types';

export interface MusicProviderMeta {
  id: MusicSource;
  name: string;
  shortName: string;
  color: string;
  supportsSearch: boolean;
  supportsIdLookup: boolean;
  description?: string;
}

export interface MusicSearchOptions {
  allPages?: boolean;
  signal?: AbortSignal;
}

export interface MusicProvider extends MusicProviderMeta {
  search(keyword: string, options?: MusicSearchOptions): Promise<SearchResult[]>;
  getSongById(id: string): Promise<SearchResult | null>;
  getSongUrl(song: Pick<Song, 'id' | 'source' | 'url' | 'duration'>, quality?: string): Promise<SongUrlResult>;
  getLyrics(song: Pick<Song, 'id' | 'source' | 'lrc'>): Promise<string>;
  getCoverUrl(song: Pick<Song, 'id' | 'source' | 'pic'>): string;
}

export interface SongUrlResult {
  url: string;
  /** 上游返回的实际音质中文名，如「无损」「超清母带」 */
  qualityLabel?: string;
  loudness?: { gain?: number; peak?: number; lra?: number };
  /** Meting 返回的曲目时长，单位毫秒 */
  duration?: number;
}

export type { LyricLine, SearchResult, Song };
