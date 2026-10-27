import type { EventEmitter } from 'node:events';

// index.d.cts — host-neutral public contract; never depends on Electron or Folia types.

export type BodianOperation = 'search' | 'song_detail' | 'audio' | 'lyrics' | 'login_qr_key'
  | 'login_qr_create' | 'login_qr_check' | 'login_qr_cancel' | 'login_status' | 'logout'
  | 'user_playlists' | 'user_albums' | 'liked_songs' | 'playlist_detail' | 'playlist_tracks'
  | 'album_detail' | 'album_tracks' | 'artist_detail' | 'artist_songs' | 'artist_albums'
  | 'recommendations' | 'home_module' | 'ai_playlist_detail' | 'personal_fm' | 'like_song'
  | 'playlist_tracks_add' | 'playlist_tracks_del';
export type BodianParams = Record<string, string | number | boolean | undefined>;
export type BodianErrorCode = 'unsupported' | 'invalid-response' | 'auth-required' | 'unavailable' | 'network' | 'not-playable' | 'region-restricted';
export type BodianResult<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: BodianErrorCode; message: string } };
export interface BodianUser { id: string; nickname: string; avatarUrl: string }
export interface BodianSession { uid: string; token: string; user: BodianUser }
/** All methods are synchronous. Increment revision on every set/clear, including account switches. */
export interface BodianSessionStore {
  readonly revision: number;
  get(): BodianSession | null;
  set(session: BodianSession): void;
  clear(): void;
}
export interface BodianLyricsPayload { mainText: string; wordByWordText: string | null }
export interface BodianResponse extends EventEmitter {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
}
export interface BodianRequest extends EventEmitter {
  setHeader(name: string, value: string): void;
  end(body?: string): void;
  destroy?(): void;
  abort?(): void;
}
/** Request must implement destroy() or abort(). The library attaches headers and submits the body. */
export type BodianRequestFactory = (
  options: { url: string; method: string },
  onResponse: (response: BodianResponse) => void,
) => BodianRequest;
export interface BodianOptions {
  deviceId: string;
  sessions?: BodianSessionStore;
  requestFactory?: BodianRequestFactory;
  now?: () => number;
}
export interface BodianApi {
  request(operation: 'lyrics', params: BodianParams): Promise<BodianResult<BodianLyricsPayload>>;
  request<T = unknown>(operation: BodianOperation, params?: BodianParams): Promise<BodianResult<T>>;
}
export const BODIAN_OPERATIONS: readonly BodianOperation[];
export class BodianError extends Error {
  constructor(code: BodianErrorCode, message: string, upstreamCode?: number | string);
  readonly code: BodianErrorCode;
  readonly upstreamCode?: number | string;
}
export function createBodianApi(options: BodianOptions): BodianApi;
