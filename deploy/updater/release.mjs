import https from 'node:https';
import dns from 'node:dns';
import { isIP } from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { updateError } from './core.mjs';

export const REPOSITORY = 'qq01-hub/openmusic';
const MAX_ARCHIVE = 300 * 1024 * 1024;
const HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function assertPublic(address) {
  const v4 = address.replace(/^::ffff:/i, '');
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b))) {
      throw updateError('UPDATE_DOWNLOAD_DENIED', '发布下载地址解析到非公网地址');
    }
  } else if (!/^2[0-9a-f]{3}:/i.test(address)) {
    throw updateError('UPDATE_DOWNLOAD_DENIED', '发布下载地址解析到非公网地址');
  }
}
export function validateDownloadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !HOSTS.has(url.hostname)) {
    throw updateError('UPDATE_DOWNLOAD_DENIED', '仅允许从官方发布地址下载');
  }
  return url;
}
function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    try {
      if (!addresses.length) throw new Error('empty DNS');
      addresses.forEach(item => assertPublic(item.address));
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    } catch (cause) { callback(cause); }
  });
}
export async function releaseStream(value, redirects = 0, signal = AbortSignal.timeout(180_000)) {
  const url = validateDownloadUrl(value);
  if (redirects > 5) throw updateError('UPDATE_DOWNLOAD_FAILED', '发布下载重定向过多', 502);
  const response = await new Promise((resolve, reject) => {
    const request = https.get(url, {
      lookup: publicLookup, signal,
      headers: { 'User-Agent': 'OpenMusic-Updater', Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity' },
    }, resolve);
    request.on('error', reject);
    request.setTimeout(30_000, () => request.destroy(new Error('timeout')));
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    return releaseStream(new URL(response.headers.location, url).href, redirects + 1, signal);
  }
  if (response.statusCode !== 200) {
    response.resume();
    throw updateError('UPDATE_DOWNLOAD_FAILED', `发布服务返回 HTTP ${response.statusCode}，请稍后重试`, 502);
  }
  return response;
}
export function selectRelease(data) {
  if (!data || data.draft !== false || data.prerelease !== false || !Number.isSafeInteger(data.id)
    || !/^v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(data.tag_name || '')) {
    throw updateError('UPDATE_RELEASE_INVALID', '未找到可用的正式发布版本', 502);
  }
  const asset = data.assets?.find(item => item.name === 'openmusic-build.zip');
  const expected = `https://github.com/${REPOSITORY}/releases/download/${data.tag_name}/openmusic-build.zip`;
  if (!asset || asset.browser_download_url !== expected || !/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')
    || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ARCHIVE) {
    throw updateError('UPDATE_RELEASE_INVALID', '发布 ZIP 缺失、过大或缺少 SHA256 校验信息', 502);
  }
  return {
    id: data.id, tag: data.tag_name, name: String(data.name || data.tag_name).slice(0, 120),
    notes: String(data.body || '').slice(0, 6000), publishedAt: data.published_at || '',
    url: `https://github.com/${REPOSITORY}/releases/tag/${data.tag_name}`,
    downloadUrl: expected, size: asset.size, sha256: asset.digest.slice(7),
  };
}
export async function checkRelease() {
  const response = await releaseStream(`https://api.github.com/repos/${REPOSITORY}/releases/latest`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) { response.destroy(); throw updateError('UPDATE_RELEASE_INVALID', '发布信息过大', 502); }
    chunks.push(chunk);
  }
  return selectRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
export async function downloadRelease(release, destination) {
  const response = await releaseStream(release.downloadUrl);
  const hash = createHash('sha256');
  let size = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > release.size || size > MAX_ARCHIVE) return callback(updateError('UPDATE_ARCHIVE_SIZE', '升级包超出大小限制'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(response, limit, fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  if (size !== release.size || hash.digest('hex') !== release.sha256) {
    throw updateError('UPDATE_CHECKSUM_FAILED', '升级包完整性校验失败');
  }
}
export function archiveTarget(name, mode = 0) {
  if ((mode & 0o170000) === 0o120000 || name.includes('\\') || name.includes('\0')
    || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.' || part.includes(':'))) {
    throw updateError('UPDATE_ARCHIVE_UNSAFE', '升级包包含不安全路径或符号链接');
  }
  const relative = name.replace(/^openmusic\//, '');
  if (/^server\/(?:[a-zA-Z0-9_-]+\.js|package(?:-lock)?\.json)$/.test(relative)
    || /^client\/dist\/[^/].*/.test(relative)) return relative;
  throw updateError('UPDATE_ARCHIVE_UNSAFE', '升级包尝试覆盖受保护文件');
}
export async function extractRelease(archive, destination) {
  const { default: yauzl } = await import('yauzl');
  const zip = await new Promise((resolve, reject) => yauzl.open(archive, {
    lazyEntries: true, strictFileNames: true, validateEntrySizes: true,
  }, (error, value) => error ? reject(error) : resolve(value)));
  let total = 0;
  let count = 0;
  const seen = new Set();
  await new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', entry => {
      void (async () => {
        if (++count > 40_000 || (entry.generalPurposeBitFlag & 1)) throw new Error('archive limit');
        // 发布包还含文档和部署脚本，只提取升级所需的白名单文件
        const name = entry.fileName.replace(/^openmusic\//, '');
        if (entry.fileName.includes('\\') || entry.fileName.startsWith('/')
          || entry.fileName.split('/').some(part => part === '..' || part === '.' || part.includes(':'))
          || (entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000) {
          throw updateError('UPDATE_ARCHIVE_UNSAFE', '升级包包含不安全路径或符号链接');
        }
        if (name.endsWith('/')) {
          return;
        }
        if (!name.startsWith('server/') && !name.startsWith('client/dist/')) return;
        if (name === 'server/.env.example' || name === 'client/.env.example') return;
        const relative = archiveTarget(entry.fileName, entry.externalFileAttributes >>> 16);
        total += entry.uncompressedSize;
        if (total > 1536 * 1024 * 1024 || entry.uncompressedSize > MAX_ARCHIVE || seen.has(relative.toLowerCase())) {
          throw updateError('UPDATE_ARCHIVE_UNSAFE', '升级包文件重复或解压大小超限');
        }
        seen.add(relative.toLowerCase());
        const target = path.join(destination, ...relative.split('/'));
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value)));
        await pipeline(Readable.from(stream), fs.createWriteStream(target, { flags: 'wx', mode: 0o644 }));
      })().then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });
  for (const required of ['server/index.js', 'server/package.json', 'server/package-lock.json', 'client/dist/index.html']) {
    await fsp.access(path.join(destination, required));
  }
}
