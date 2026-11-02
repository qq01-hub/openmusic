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
  return String(value ?? '').replace(slashNamePattern,
    (_, space, name) => `${space}[qqface:${idsByName.get(name.toLowerCase())}]`);
}

export function resolveQqFaceToken(face) {
  const raw = String(face ?? '').trim();
  const value = raw.replace(/^\[qqface:([^\]]+)\]$/i, '$1').replace(/^\//, '');
  const id = facesById.has(value) ? value : idsByName.get(value.toLowerCase());
  return id ? `[qqface:${id}]` : null;
}

export function describeQqFaces(ids) {
  return ids.filter((id) => facesById.has(id))
    .map((id) => `${id}=${facesById.get(id).text.replace(/^\//, '')}`).join('、');
}

export function normalizeAiQqFaceText(text, { excludedIds = new Set(), allow = true } = {}) {
  let kept = false;
  return tokenizeSlashNames(text).replace(/\[qqface:([^\]]+)\]/gi, (_, face) => {
    const token = resolveQqFaceToken(face);
    const id = token?.slice(8, -1);
    if (!allow || kept || !id || excludedIds.has(id)) return '';
    kept = true;
    return token;
  }).trim();
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
