import {
  configureQFaceImageLoader,
  getQFaceObjectUrl,
  hydrateQFaceImagesFromCache,
  QFaceLoadPriority,
  requestQFaceImages,
  type QFaceImageState,
} from './qfaceImageLoader';

const QFACE_BASE = `${import.meta.env.BASE_URL}qface/`;
const MANIFEST_URL = `${QFACE_BASE}manifest.json`;
const MANIFEST_STORAGE_KEY = 'openmusic:qface-manifest:v1';
/** QQ 表情几乎不变，清单本地缓存 1 年，避免每次进房再拉 */
const MANIFEST_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export interface QFaceItem {
  id: string;
  text: string;
  url: string;
}

interface QFaceManifestEntry {
  id: string;
  text: string;
}

const POPULAR_FACE_IDS = ['0', '1', '2', '4', '5', '9', '13', '14', '21', '23', '27', '63'];

/** 点评表情置顶：赞、踩、爱心、便便、菜刀、笑哭、拜托、略略略 */
export const PINNED_REACTION_FACE_IDS = ['76', '77', '66', '59', '112', '182', '353', '395'] as const;

const PINNED_REACTION_LABELS: Record<string, string> = {
  '76': '/赞',
  '77': '/踩',
  '66': '/爱心',
  '59': '/便便',
  '112': '/菜刀',
  '182': '/笑哭',
  '353': '/拜托',
  '395': '/略略略',
};

const POPULAR_LABELS: Record<string, string> = {
  '0': '/惊讶',
  '1': '/撇嘴',
  '2': '/色',
  '4': '/得意',
  '5': '/流泪',
  '9': '/大哭',
  '13': '/呲牙',
  '14': '/微笑',
  '21': '/偷笑',
  '23': '/酷',
  '27': '/奋斗',
  '63': '/玫瑰',
};

const QQ_FACE_TOKEN_RE = /\[qqface:([^\]]+)\]/g;

const faceSubscribers = new Set<(faces: QFaceItem[]) => void>();

let fullFacesCache: QFaceItem[] | null = null;
let pendingFaces: Promise<QFaceItem[]> | null = null;

function faceUrl(id: string): string {
  return `${QFACE_BASE}${encodeURIComponent(id)}.apng`;
}

configureQFaceImageLoader(faceUrl);

function buildPopularFaces(): QFaceItem[] {
  return POPULAR_FACE_IDS.map((id) => ({
    id,
    text: POPULAR_LABELS[id] || `/表情${id}`,
    url: faceUrl(id),
  }));
}

function toFaceItems(entries: QFaceManifestEntry[]): QFaceItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    url: faceUrl(entry.id),
  }));
}

function readStoredManifest(): QFaceItem[] | null {
  try {
    const raw = localStorage.getItem(MANIFEST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      expiresAt?: number;
      entries?: QFaceManifestEntry[];
    };
    if (!parsed?.entries?.length || Date.now() > Number(parsed.expiresAt || 0)) return null;
    const faces = toFaceItems(parsed.entries.filter((entry) => entry?.id && entry?.text));
    if (faces.length <= POPULAR_FACE_IDS.length) return null;
    return faces;
  } catch {
    return null;
  }
}

function writeStoredManifest(entries: QFaceManifestEntry[]): void {
  try {
    localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify({
      expiresAt: Date.now() + MANIFEST_TTL_MS,
      entries,
    }));
  } catch {
    // quota / private mode
  }
}

// 模块加载时同步灌入本地清单，进房首帧即可当「已加载」
fullFacesCache = readStoredManifest();

function getDisplayFaces(): QFaceItem[] {
  return fullFacesCache || buildPopularFaces();
}

function notifyFaceSubscribers(): void {
  const faces = getDisplayFaces();
  faceSubscribers.forEach((callback) => callback(faces));
}

function warmupManifestFaces(): void {
  const ids = [...new Set([...POPULAR_FACE_IDS, ...PINNED_REACTION_FACE_IDS])];
  // 先从持久化缓存灌入 blob URL（刷新后无网络），再按需解码
  void hydrateQFaceImagesFromCache(ids).then(() => {
    requestQFaceImages(ids, QFaceLoadPriority.MANIFEST);
  });
}

async function fetchLocalManifest(): Promise<QFaceItem[]> {
  // 1 年有效期内直接用本地缓存，不再打网络
  const stored = fullFacesCache || readStoredManifest();
  if (stored) {
    fullFacesCache = stored;
    return stored;
  }

  const res = await fetch(MANIFEST_URL, { cache: 'force-cache' });
  if (!res.ok) throw new Error('本地表情 manifest 不存在');
  const data = (await res.json()) as QFaceManifestEntry[];
  const entries = data.filter((entry) => entry?.id && entry?.text);
  const faces = toFaceItems(entries);
  if (faces.length <= POPULAR_FACE_IDS.length) throw new Error('本地表情 manifest 不完整');
  writeStoredManifest(entries);
  return faces;
}

async function loadLocalFaces(): Promise<QFaceItem[]> {
  const faces = await fetchLocalManifest();
  fullFacesCache = faces;
  notifyFaceSubscribers();
  warmupManifestFaces();
  return faces;
}

export { QFaceLoadPriority, type QFaceImageState };
export {
  acquireQFaceDisplayImage,
  getQFaceImageState,
  getQFaceObjectUrl,
  hydrateQFaceImagesFromCache,
  isQFaceImageDecoded,
  markQFaceImageRendered,
  releaseQFaceDisplayImage,
  requestQFaceImage,
  requestQFaceImages,
  subscribeQFaceImageState,
} from './qfaceImageLoader';

export function getQQFaceUrl(id: string): string {
  return getQFaceObjectUrl(id) || faceUrl(id);
}

export function getQQFaceItem(id: string): QFaceItem {
  const cached = fullFacesCache?.find((face) => face.id === id);
  if (cached) return cached;
  return {
    id,
    text: POPULAR_LABELS[id] || `/表情${id}`,
    url: faceUrl(id),
  };
}

/** 仅用于 AI 输出兼容旧数字标记，普通成员输入仍按原协议解析 */
export function normalizeAiQqFaceText(value: string, { allowFaces = true } = {}): string {
  return String(value || '')
    .replace(/\uFFFC/g, '')
    .replace(/[\[［【]\s*(?:qqface\s*[:：]\s*([^\]\r\n］】]*)|([0-9０-９]+))\s*[\]］】]/gi,
      (raw: string, face: string | undefined, number: string | undefined) => {
        const nameOrId = String(face ?? number ?? '').trim()
          .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xFF10));
        const known = fullFacesCache?.find((item) => item.id === nameOrId
          || item.text.replace(/^\//, '').toLowerCase() === nameOrId.replace(/^\//, '').toLowerCase());
        if (known) return allowFaces ? qqFaceToken(known.id) : '';
        if (!allowFaces && face !== undefined) return '';
        // 清单加载前仍可使用服务端已规范化的编号，不额外请求整份清单
        return !fullFacesCache && face !== undefined && /^\d{1,4}$/.test(nameOrId) ? qqFaceToken(nameOrId) : raw;
      })
    .trim();
}

export function extractQQFaceIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(QQ_FACE_TOKEN_RE)) {
    ids.push(match[1]);
  }
  return ids;
}

export function extractQQFaceIdsFromTexts(texts: string[]): string[] {
  const ids = new Set<string>();
  texts.forEach((text) => extractQQFaceIds(text).forEach((id) => ids.add(id)));
  return [...ids];
}

export function qqFaceToken(id: string): string {
  return `[qqface:${id}]`;
}

export function getPopularReactionFaces(): QFaceItem[] {
  return buildPopularFaces();
}

export function getReactionPickerFaces(faces: QFaceItem[]): QFaceItem[] {
  const byId = new Map(faces.map((face) => [face.id, face]));
  const pinned = PINNED_REACTION_FACE_IDS.map(
    (id) => byId.get(id) ?? {
      id,
      text: PINNED_REACTION_LABELS[id] || `/表情${id}`,
      url: faceUrl(id),
    },
  );
  const pinnedSet = new Set<string>(PINNED_REACTION_FACE_IDS);
  const rest = faces.filter((face) => !pinnedSet.has(face.id));
  return [...pinned, ...rest];
}

export function parseQQFaceToken(emoji: string): string | null {
  const match = /^\[qqface:([^\]]+)\]$/.exec(emoji.trim());
  return match ? match[1] : null;
}

export function hasFullQQFaces(): boolean {
  return fullFacesCache !== null;
}

export function getInitialQQFaces(): QFaceItem[] {
  return getDisplayFaces();
}

export function subscribeQQFaces(callback: (faces: QFaceItem[]) => void): () => void {
  faceSubscribers.add(callback);
  callback(getDisplayFaces());
  return () => faceSubscribers.delete(callback);
}

export function parseQQFaceTokens(text: string): Array<string | { type: 'qqface'; id: string }> {
  const parts: Array<string | { type: 'qqface'; id: string }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(QQ_FACE_TOKEN_RE)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({ type: 'qqface', id: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length ? parts : [text];
}

export async function loadQQFaces(): Promise<QFaceItem[]> {
  if (fullFacesCache) return fullFacesCache;
  if (pendingFaces) return pendingFaces;

  pendingFaces = loadLocalFaces()
    .catch(() => {
      warmupManifestFaces();
      return getDisplayFaces();
    })
    .finally(() => {
      pendingFaces = null;
    });

  return pendingFaces;
}

export function ensureQQFacesLoaded(): void {
  if (fullFacesCache) {
    // 清单已缓存：只预热常用图（已解码则立刻返回），不再打 manifest
    warmupManifestFaces();
    return;
  }
  void loadQQFaces();
}
