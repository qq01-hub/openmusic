import { getClientId } from './clientId';
import { ensureImageFile, sniffImageMime } from './imageMime';

const DB_NAME = 'openmusic-user-stickers';
const DB_VERSION = 1;
const STORE = 'blobs';
const MANIFEST_PREFIX = 'openmusic:user-stickers:';

export interface UserSticker {
  id: string;
  name: string;
  mimeType: string;
  importedAt: number;
}

export interface UserStickerImportResult {
  imported: number;
  skipped: number;
  stickerId?: string;
}

interface Manifest {
  version: number;
  stickers: UserSticker[];
}

const subscribers = new Set<(stickers: UserSticker[]) => void>();

function manifestKey() {
  return `${MANIFEST_PREFIX}${getClientId()}`;
}

function notify() {
  const list = listUserStickersSync();
  subscribers.forEach((cb) => cb(list));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function readManifest(): Manifest {
  try {
    const raw = localStorage.getItem(manifestKey());
    if (!raw) return { version: 1, stickers: [] };
    const data = JSON.parse(raw) as Manifest;
    if (!Array.isArray(data.stickers)) return { version: 1, stickers: [] };
    return data;
  } catch {
    return { version: 1, stickers: [] };
  }
}

function writeManifest(manifest: Manifest) {
  try {
    localStorage.setItem(manifestKey(), JSON.stringify(manifest));
  } catch {
    // ignore storage errors
  }
}

export function sanitizeStickerId(id: string) {
  return String(id || '').replace(/[^\w\-]/g, '_').slice(0, 80) || `sticker_${Date.now()}`;
}

export function localStickerImageKey(stickerId: string) {
  return `local-sticker:${sanitizeStickerId(stickerId)}`;
}

export function isLocalStickerImageKey(imageKey?: string | null) {
  return String(imageKey || '').startsWith('local-sticker:');
}

export const MAX_STICKER_BYTES = 5 * 1024 * 1024;

export function formatStickerSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function stickerIdFromFile(file: File) {
  const safeName = file.name.replace(/[^\w.\-]/g, '_').slice(0, 40) || 'image';
  return sanitizeStickerId(`file_${safeName}_${file.size}_${file.lastModified}`);
}

function stickerNameFromFile(file: File, fallbackId: string) {
  const base = file.name.replace(/\.[^.]+$/i, '').trim();
  return (base || fallbackId).slice(0, 24);
}

function stickerIdFromUrl(url: string) {
  try {
    const parsed = new URL(url, 'https://szfilehelper.weixin.qq.com');
    const md5 = parsed.searchParams.get('m');
    if (md5 && /^[a-f0-9]{32}$/i.test(md5)) {
      return sanitizeStickerId(`md5_${md5.toLowerCase()}`);
    }
    const msgId = parsed.searchParams.get('MsgID');
    if (msgId) return sanitizeStickerId(msgId);
  } catch {
    /* ignore */
  }
  return sanitizeStickerId(`wx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
}

export async function isLikelyImageBlob(blob: Blob): Promise<boolean> {
  if (!blob.size) return false;
  const type = blob.type.toLowerCase();
  if (type.startsWith('image/')) return true;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return sniffImageMime(head) !== null;
}

function normalizeImageBlob(blob: Blob, mimeHint?: string): Blob | null {
  const type = blob.type.toLowerCase();
  if (type.startsWith('image/')) return blob;
  if (mimeHint?.startsWith('image/')) return new Blob([blob], { type: mimeHint });
  return null;
}

async function ensureImageBlob(blob: Blob, mimeHint?: string): Promise<Blob | null> {
  if (!(await isLikelyImageBlob(blob))) return null;
  const normalized = normalizeImageBlob(blob, mimeHint);
  if (normalized) return normalized;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const sniffed = sniffImageMime(head);
  return sniffed ? new Blob([blob], { type: sniffed }) : null;
}

function parseDataUrl(dataUrl: string): { mime: string; blob: Blob } | null {
  if (!dataUrl.startsWith('data:') || !dataUrl.includes(',')) return null;
  const [header, body] = dataUrl.split(',', 2);
  const mime = header.slice(5).split(';')[0] || 'image/gif';
  try {
    if (header.includes(';base64')) {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { mime, blob: new Blob([bytes], { type: mime }) };
    }
    return { mime, blob: new Blob([decodeURIComponent(body)], { type: mime }) };
  } catch {
    return null;
  }
}

async function putBlob(id: string, blob: Blob) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function getBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function deleteBlob(id: string) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function listUserStickersSync(): UserSticker[] {
  return readManifest().stickers
    .slice()
    .sort((a, b) => b.importedAt - a.importedAt);
}

export function subscribeUserStickers(callback: (stickers: UserSticker[]) => void) {
  callback(listUserStickersSync());
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export async function getStickerBlobUrl(stickerId: string): Promise<string | null> {
  const blob = await getBlob(stickerId);
  if (!blob || !(await isLikelyImageBlob(blob))) return null;
  return URL.createObjectURL(blob);
}

export async function getStickerDataUrlForSend(stickerId: string): Promise<string | null> {
  const blob = await getBlob(stickerId);
  if (!blob) return null;
  const typed = await ensureImageFile(blob, stickerId);
  if (!typed) return null;
  if (typed.size > MAX_STICKER_BYTES) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(typed);
  });
}

export async function describeStickerSendIssue(stickerId: string): Promise<string | null> {
  const blob = await getBlob(stickerId);
  if (!blob) return '表情不存在，请删除后重新采集';
  const typed = await ensureImageFile(blob, stickerId);
  if (!typed) return '表情数据无效或格式不支持，请删除后重新采集';
  if (typed.size > MAX_STICKER_BYTES) {
    return `表情过大（当前 ${formatStickerSize(typed.size)}，限制 ${formatStickerSize(MAX_STICKER_BYTES)}），无法发送`;
  }
  return null;
}

export interface UserStickerBatchImportResult {
  imported: number;
  skipped: number;
  rejected: number;
}

async function importStickerBlob(
  id: string,
  imageBlob: Blob,
  name: string,
  options?: { notify?: boolean },
): Promise<UserStickerImportResult> {
  const ensured = await ensureImageBlob(imageBlob);
  if (!ensured) return { imported: 0, skipped: 0 };
  if (ensured.size > MAX_STICKER_BYTES) return { imported: 0, skipped: 0 };

  const manifest = readManifest();
  if (manifest.stickers.some((s) => s.id === id)) {
    return { imported: 0, skipped: 1, stickerId: id };
  }

  const sniffed = new Uint8Array(await ensured.slice(0, 12).arrayBuffer());
  const mimeType = sniffImageMime(sniffed) || ensured.type || 'image/gif';

  await putBlob(id, ensured);
  manifest.stickers.unshift({
    id,
    name: name.slice(0, 24) || id.slice(0, 12),
    mimeType,
    importedAt: Date.now(),
  });
  writeManifest(manifest);
  if (options?.notify !== false) notify();
  return { imported: 1, skipped: 0, stickerId: id };
}

export async function importUserStickerFromFile(file: File): Promise<UserStickerImportResult> {
  const id = stickerIdFromFile(file);
  const name = stickerNameFromFile(file, id);
  return importStickerBlob(id, file, name);
}

export async function importUserStickerFiles(files: File[]): Promise<UserStickerBatchImportResult> {
  let imported = 0;
  let skipped = 0;
  let rejected = 0;

  for (const file of files) {
    if (!file.size) {
      rejected += 1;
      continue;
    }
    const id = stickerIdFromFile(file);
    const result = await importStickerBlob(
      id,
      file,
      stickerNameFromFile(file, id),
      { notify: false },
    );
    imported += result.imported;
    skipped += result.skipped;
    if (result.imported === 0 && result.skipped === 0) rejected += 1;
  }

  if (imported > 0 || skipped > 0) notify();
  return { imported, skipped, rejected };
}

async function hashBlobId(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 20);
}

/** 把聊天消息里的表情包（dataURL 或 http 链接）收藏到自己的表情列表 */
export async function importUserStickerFromChatImage(
  imageUrl: string,
  imageKey?: string | null,
): Promise<UserStickerImportResult> {
  let blob: Blob | null = null;
  if (imageUrl.startsWith('data:')) {
    blob = parseDataUrl(imageUrl)?.blob ?? null;
  } else {
    try {
      const res = await fetch(imageUrl);
      if (res.ok) blob = await res.blob();
    } catch {
      blob = null;
    }
  }
  if (!blob || !blob.size || blob.size > MAX_STICKER_BYTES) {
    return { imported: 0, skipped: 0 };
  }

  let id: string;
  if (isLocalStickerImageKey(imageKey)) {
    // 对方也是从本地表情发出的，沿用原始 id 以便去重
    id = sanitizeStickerId(String(imageKey).slice('local-sticker:'.length));
  } else {
    try {
      id = sanitizeStickerId(`chat_${await hashBlobId(blob)}`);
    } catch {
      id = sanitizeStickerId(`chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }
  }
  return importStickerBlob(id, blob, id.slice(0, 12));
}

export async function importWechatFileHelperSticker(
  src: string,
  dataUrl: string,
): Promise<UserStickerImportResult> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { imported: 0, skipped: 0 };

  const id = stickerIdFromUrl(src);
  return importStickerBlob(id, parsed.blob, id.slice(0, 12));
}

export async function pruneInvalidUserStickers(): Promise<number> {
  const manifest = readManifest();
  const valid: UserSticker[] = [];
  let removed = 0;

  for (const sticker of manifest.stickers) {
    const blob = await getBlob(sticker.id);
    if (!blob || !(await isLikelyImageBlob(blob))) {
      if (blob) await deleteBlob(sticker.id);
      removed += 1;
      continue;
    }
    valid.push(sticker);
  }

  if (removed > 0) {
    writeManifest({ ...manifest, stickers: valid });
    notify();
  }
  return removed;
}

export async function deleteUserSticker(stickerId: string) {
  const manifest = readManifest();
  manifest.stickers = manifest.stickers.filter((s) => s.id !== stickerId);
  writeManifest(manifest);
  await deleteBlob(stickerId);
  notify();
}
