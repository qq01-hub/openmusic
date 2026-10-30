export interface NativePlayerState {
  trackId: string;
  title: string;
  artist: string;
  playing: boolean;
  position: number;
  duration: number;
  canPause: boolean;
  canSkip: boolean;
  canSeek: boolean;
}

export interface PlayerMessage {
  seq: number;
  state: NativePlayerState | null;
}

export type PlayerAction = 'play' | 'pause' | 'next' | 'seek' | 'stopLocal';

export function decodePlayerMessage(raw: string, token: string, lastSeq: number): PlayerMessage | undefined {
  if (!token || typeof raw !== 'string' || raw.length > 4096) return undefined;
  try {
    const envelope = JSON.parse(raw);
    if (!envelope || envelope.v !== 1 || envelope.token !== token ||
      !Number.isSafeInteger(envelope.seq) || envelope.seq <= lastSeq) return undefined;
    if (envelope.state === null) return { seq: envelope.seq, state: null };
    const state = envelope.state;
    if (!state || typeof state !== 'object') return undefined;
    for (const key of ['trackId', 'title', 'artist']) {
      if (typeof state[key] !== 'string' || state[key].length > 256 || /[\u0000-\u001f]/.test(state[key])) return undefined;
    }
    if (!state.trackId || !state.title) return undefined;
    for (const key of ['playing', 'canPause', 'canSkip', 'canSeek']) {
      if (typeof state[key] !== 'boolean') return undefined;
    }
    if (typeof state.duration !== 'number' || !Number.isFinite(state.duration) || state.duration < 0 || state.duration > 86400 ||
      typeof state.position !== 'number' || !Number.isFinite(state.position) || state.position < 0 || state.position > 86400) return undefined;
    // 只复制允许的字段，封面 URL、账户信息和凭据不进入原生服务
    return { seq: envelope.seq, state: {
      trackId: state.trackId, title: state.title, artist: state.artist,
      playing: state.playing, position: state.duration > 0 ? Math.min(state.position, state.duration) : state.position,
      duration: state.duration, canPause: state.canPause, canSkip: state.canSkip, canSeek: state.canSeek
    } };
  } catch {
    return undefined;
  }
}

export function canDispatch(state: NativePlayerState | null, action: string, time?: number): boolean {
  if (!state) return false;
  if (action === 'stopLocal') return true;
  if (action === 'play' || action === 'pause') return state.canPause;
  if (action === 'next') return state.canSkip;
  if (action === 'seek') return state.canSeek && typeof time === 'number' && Number.isFinite(time) &&
    time >= 0 && state.duration > 0 && time <= state.duration;
  return false;
}
