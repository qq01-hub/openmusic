import { existsSync, readFileSync } from 'node:fs';

// 开发与部署复用前端实际清单，避免表情名称、编号各维护一份
const sourceManifest = new URL('../client/public/qface/manifest.json', import.meta.url);
const builtManifest = new URL('../client/dist/qface/manifest.json', import.meta.url);
export const QQ_FACE_CATALOG = JSON.parse(readFileSync(
  existsSync(sourceManifest) ? sourceManifest : builtManifest, 'utf8',
)).filter((face) => /^\d{1,4}$/.test(face.id) && face.text?.trim());
const facesById = new Map(QQ_FACE_CATALOG.map((face) => [face.id, face]));
const idsByName = new Map(QQ_FACE_CATALOG.map((face) => [face.text.replace(/^\//, '').toLowerCase(), face.id]));
const slashNamePattern = new RegExp(`(^|\\s)/(${[...idsByName.keys()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|\\s|[，。！？、；：～~!?])`, 'gi');

function tokenizeSlashNames(value) {
  return String(value ?? '')
    .replace(/\uFFFC/g, '')
    .replace(/[\[［【]\s*(?:qqface\s*[:：]\s*([^\]\r\n］】]*)|([0-9０-９]+))\s*[\]］】]/gi,
      (_, face, number) => resolveQqFaceToken(face ?? number) || '')
    .replace(slashNamePattern, (_, space, name) => `${space}[qqface:${idsByName.get(name.toLowerCase())}]`)
    .replace(/[\[［【]\s*(?:q|qq|qqf|qqfa|qqfac|qqface)(?:\s*[:：][^\]\r\n］】]*)?$/gi, '')
    .replace(/[\[［【]\s*[0-9０-９]+\s*$/g, '');
}

export function resolveQqFaceToken(face) {
  const raw = String(face ?? '').trim();
  const value = raw.replace(/^[\[［【]\s*(?:qqface\s*[:：]\s*)?([^\]\r\n］】]+)[\]］】]$/i, '$1')
    .trim().replace(/^\//, '')
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xFF10));
  const id = facesById.has(value) ? value : idsByName.get(value.toLowerCase());
  return id ? `[qqface:${id}]` : null;
}

export function describeQqFaces(ids) {
  return ids.filter((id) => facesById.has(id))
    .map((id) => `${id}=${facesById.get(id).text.replace(/^\//, '')}`).join('、');
}

/** 按需提供目录，避免每轮携带完整表情清单 */
export function queryQqFaces(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !['keyword', 'offset'].includes(key))
    || (args.keyword !== undefined && (typeof args.keyword !== 'string' || args.keyword.length > 30))
    || !Number.isInteger(args.offset ?? 0) || (args.offset ?? 0) < 0 || (args.offset ?? 0) > 5000) {
    return { success: false, code: 'INVALID_ARGUMENTS', error: '表情目录筛选参数无效' };
  }
  const keyword = (args.keyword || '').trim().replace(/^\//, '').toLowerCase();
  const matches = QQ_FACE_CATALOG.filter(face => !keyword || face.id === keyword || face.text.toLowerCase().includes(keyword));
  const offset = args.offset ?? 0;
  const faces = matches.slice(offset, offset + 20).map(({ id, text }) => ({ id, name: text.replace(/^\//, '') }));
  return { success: true, faces, total: matches.length, nextOffset: offset + faces.length < matches.length ? offset + faces.length : null };
}

export function normalizeAiQqFaceText(text, { excludedIds = new Set(), allow = true, maxLength = Infinity } = {}) {
  let kept = false;
  const normalized = tokenizeSlashNames(text).replace(/\[qqface:([^\]]+)\]/gi, (_, face) => {
    const token = resolveQqFaceToken(face);
    const id = token?.slice(8, -1);
    if (!allow || kept || !id || excludedIds.has(id)) return '';
    kept = true;
    return token;
  }).trim();
  if (normalized.length <= maxLength) return normalized;
  // 长度边界落在表情内部时，整段移除，避免发送半截标记
  let end = maxLength;
  for (const match of normalized.matchAll(/\[qqface:\d+\]/g)) {
    if (match.index < end && match.index + match[0].length > end) {
      end = match.index;
      break;
    }
  }
  return normalized.slice(0, end).trimEnd();
}

export function collectRecentBotQqFaceIds(messages, botUserId) {
  const recent = messages.filter((message) => message.userId === botUserId).slice(-3);
  const ids = new Set();
  for (const message of recent) {
    for (const match of tokenizeSlashNames(message.text).matchAll(/\[qqface:([^\]]+)\]/gi)) {
      const token = resolveQqFaceToken(match[1]);
      if (token) ids.add(token.slice(8, -1));
    }
  }
  return ids;
}
