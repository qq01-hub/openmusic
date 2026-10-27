// Host-neutral contract: no Electron, renderer, or application types are imported.
export type QishuiOperation = 'login_status' | 'logout' | 'login_qr_key' | 'login_qr_create'
    | 'login_qr_check' | 'login_qr_cancel' | 'search' | 'search_playlists' | 'song_detail'
    | 'audio' | 'lyrics' | 'user_playlists' | 'playlist_detail' | 'playlist_tracks'
    | 'artist_detail' | 'artist_songs' | 'feed' | 'feed_modes'
    | 'liked_songs' | 'like_song' | 'playlist_add_tracks' | 'playlist_remove_tracks'
    | 'recent_played' | 'check_tracks' | 'dislike_song';
export type QishuiJsonValue = string | number | boolean | null | QishuiJsonValue[] | { [key: string]: QishuiJsonValue };
export type QishuiParams = Record<string, QishuiJsonValue | undefined>;
export type QishuiErrorCode = 'unsupported' | 'invalid-response' | 'auth-required' | 'unavailable' | 'network' | 'not-playable';
export type QishuiLoginStage = 'access-code' | 'ticket' | 'account';
export type QishuiBridgeResult<T = unknown> = { ok: true; data: T } | {
    ok: false;
    error: { code: QishuiErrorCode; message: string; upstreamCode?: string; stage?: QishuiLoginStage };
};
export interface QishuiUser {
    id: string;
    nickname: string;
    avatar?: unknown;
    isVip: boolean;
}
export interface QishuiSession {
    version?: 1;
    deviceId: string;
    userId: string;
    user: QishuiUser;
    ticket: string;
    guardKey: string;
    guardCert: string;
    guardTsSign: string;
    accessCode: string;
    openId: string;
    expiresAt: number;
}
/** Methods are synchronous. Increment revision on every set/clear, including account switches. */
export interface QishuiSessionStore {
    readonly deviceId: string;
    readonly revision: number;
    get(): QishuiSession | null;
    set(session: QishuiSession): void;
    clear(): void;
}
/** The plaintext source `audio` returns. `clipStartMs` marks where a preview clip starts in the song. */
export interface QishuiAudioSource {
    url: string;
    quality: 'standard' | 'high' | 'lossless' | 'hires';
    fetchedAt: number;
    expiresAt?: number;
    preview: boolean;
    clipStartMs?: number;
}
/** One track's playability answer from `check_tracks`; riskResult 0 means playable. */
export interface QishuiTrackCheck {
    id: string;
    riskResult: number;
    status: number;
}
export interface QishuiApiOptions {
    deviceId: string;
    sessions: QishuiSessionStore;
    fetch?: typeof globalThis.fetch;
    log?: (message: string) => void;
    /** Diagnostics such as refused media hosts; defaults to `log`. Messages carry host names, never URLs or credentials. */
    warn?: (message: string) => void;
}
export interface QishuiApi {
    request<T = unknown>(operation: QishuiOperation, params?: QishuiParams): Promise<QishuiBridgeResult<T>>;
}
export const QISHUI_OPERATIONS: readonly QishuiOperation[];
export function createQishuiApi(options: QishuiApiOptions): QishuiApi;
export function createQishuiDeviceId(): string;
export function isQishuiDeviceId(value: unknown): value is string;
export function isAccountId(value: unknown): value is string;
