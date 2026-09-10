export interface ElectronLyricsPayload {
  title: string;
  artist: string;
  source: string;
  pic?: string;
  activeText: string;
  translation?: string;
  nextText?: string;
}

export interface ElectronLyricsAPI {
  openLyrics: () => Promise<void>;
  closeLyrics: () => Promise<void>;
  updateLyrics: (payload: ElectronLyricsPayload) => void;
  onLyricsClosed?: (listener: () => void) => () => void;
}

export function isElectronRenderer(value: unknown = typeof window !== 'undefined' ? window : undefined): boolean {
  if (!value || typeof value !== 'object') return false;
  const api = (value as { electronAPI?: Partial<ElectronLyricsAPI> }).electronAPI;
  return typeof api?.openLyrics === 'function'
    && typeof api?.closeLyrics === 'function'
    && typeof api?.updateLyrics === 'function';
}

function isSafeLyricsImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createElectronLyricsPayload(payload: ElectronLyricsPayload): ElectronLyricsPayload {
  return {
    title: String(payload.title || '').slice(0, 160),
    artist: String(payload.artist || '').slice(0, 160),
    source: String(payload.source || '').slice(0, 32),
    ...(payload.pic && isSafeLyricsImageUrl(payload.pic) ? { pic: String(payload.pic).slice(0, 2048) } : {}),
    activeText: String(payload.activeText || '').slice(0, 500),
    ...(payload.translation ? { translation: String(payload.translation).slice(0, 500) } : {}),
    ...(payload.nextText ? { nextText: String(payload.nextText).slice(0, 500) } : {}),
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronLyricsAPI;
  }
}
