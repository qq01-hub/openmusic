import type { MusicSource } from '../types';

/** iOS Safari 播放失败时按当前音质从高到低逐档重试 */
export function buildPlaybackQualityFallbackChain(
  requestedQuality: string | undefined,
  availableQualities: string[],
  ios: boolean,
  attemptedQualities?: ReadonlySet<string>,
): string[] {
  if (!requestedQuality) return [];
  if (!ios) return attemptedQualities?.has(requestedQuality) ? [] : [requestedQuality];
  const index = availableQualities.indexOf(requestedQuality);
  const chain = index < 0
    ? [requestedQuality, ...availableQualities.slice().reverse()]
    : availableQualities.slice(0, index + 1).reverse();
  return chain.filter((quality) => !attemptedQualities?.has(quality));
}

let lastFallback: { requested: string; attempted: string; index: number } | null = null;

export function recordPlaybackQualityFallback(requested: string, attempted: string, index: number): void {
  lastFallback = { requested, attempted, index };
}

export function getLastPlaybackQualityFallback(): { requested: string; attempted: string; index: number } | null {
  return lastFallback;
}
const unsupportedFormatQualities = new Map<MusicSource, Set<string>>();
const MEMORY_KEY = 'openmusic:ios-playable-quality:v1';
const playableQualities = readQualityMemory();
const qualityRevisions = new Map<MusicSource, number>();

function readQualityMemory(): Map<MusicSource, { requested: string; playable: string }> {
  const result = new Map<MusicSource, { requested: string; playable: string }>();
  try {
    const stored = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}');
    for (const source of ['netease', 'tencent', 'kugou', 'qishui'] as const) {
      const value = stored?.[source];
      if (typeof value?.requested === 'string' && typeof value?.playable === 'string'
        && /^[a-z0-9_]{1,32}$/.test(value.requested) && /^[a-z0-9_]{1,32}$/.test(value.playable)) {
        result.set(source, { requested: value.requested, playable: value.playable });
      }
    }
  } catch {
    // 存储不可用时仍在本次页面会话中记忆
  }
  return result;
}

function persistQualityMemory(): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(Object.fromEntries(playableQualities)));
  } catch {
    // 存储不可用时不影响播放
  }
}

export function getIosQualityRevision(source: MusicSource): number {
  return qualityRevisions.get(source) || 0;
}

export function getIosQualityMemory(source: MusicSource): Readonly<{ requested: string; playable: string }> | null {
  return playableQualities.get(source) || null;
}

/** 用户改音质后作废旧请求，防止仍在播放的上一档重新写回降级记忆 */
export function resetIosQualityMemory(source: MusicSource): void {
  qualityRevisions.set(source, getIosQualityRevision(source) + 1);
  playableQualities.delete(source);
  unsupportedFormatQualities.delete(source);
  persistQualityMemory();
}

export function rememberPlayableIosQuality(
  source: MusicSource,
  requested: string,
  playable: string,
  revision: number,
): void {
  if (revision !== getIosQualityRevision(source)) return;
  playableQualities.set(source, { requested, playable });
  persistQualityMemory();
}

/** iOS 对不支持的音频封装会直接返回 MEDIA_ERR_SRC_NOT_SUPPORTED，后续曲目无需重复试错。 */
export function rememberUnsupportedIosQuality(
  source: MusicSource,
  quality: string | undefined,
  contentType: string | undefined,
): void {
  if (!quality || typeof document === 'undefined') return;
  const type = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (!/^(?:audio\/x-ogg|audio\/ogg|application\/ogg)$/u.test(type)) return;
  const audio = document.createElement('audio');
  if (audio.canPlayType(type) || audio.canPlayType('audio/ogg')) return;
  const values = unsupportedFormatQualities.get(source) || new Set<string>();
  values.add(quality);
  unsupportedFormatQualities.set(source, values);
}

export function isUnsupportedIosQuality(source: MusicSource, quality: string | undefined): boolean {
  return Boolean(quality && unsupportedFormatQualities.get(source)?.has(quality));
}

export function getFirstSupportedIosQuality(
  source: MusicSource,
  requestedQuality: string | undefined,
  availableQualities: readonly string[],
): string | undefined {
  if (!requestedQuality) return requestedQuality;
  const memory = playableQualities.get(source);
  const remembered = memory?.requested === requestedQuality ? memory.playable : requestedQuality;
  const start = availableQualities.indexOf(remembered);
  const candidates = start >= 0
    ? availableQualities.slice(0, start + 1).reverse()
    : [requestedQuality, ...availableQualities.slice().reverse()];
  return candidates.find((quality) => !isUnsupportedIosQuality(source, quality)) || requestedQuality;
}
