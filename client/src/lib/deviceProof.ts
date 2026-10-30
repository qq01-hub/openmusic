import { isAccountSessionRevisionEvent } from './accountSessionSignal';

type DeviceKeys = { privateKey: CryptoKey; publicKey: CryptoKey };
let keyPromise: Promise<DeviceKeys> | undefined;
let contextPromise: Promise<string> | undefined;
let sessionId = '';
let sessionRevision = 0;
let clockOffset = 0;
const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function setDeviceSession(id: string, serverTime?: number) {
  const next = /^[A-Za-z0-9_-]{24}$/.test(id) ? id : '';
  if (next !== sessionId) sessionRevision++;
  sessionId = next;
  if (Number.isFinite(serverTime)) clockOffset = Number(serverTime) - Date.now();
}

async function deviceKeys(): Promise<DeviceKeys> {
  if (!keyPromise) keyPromise = (async () => {
    if (!window.isSecureContext || !crypto.subtle || !window.indexedDB) throw new Error('此环境不支持安全设备验证，请使用 HTTPS 和新版浏览器');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('openmusic-device-proof', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法读取设备密钥，请检查浏览器存储权限'));
      request.onblocked = () => reject(new Error('设备存储正在更新，请关闭其他本站页面后重试'));
    });
    try {
      const keyId = `primary:${window.location.origin}`;
      const read = (id: string) => new Promise<DeviceKeys | undefined>((resolve, reject) => {
        const request = db.transaction('keys').objectStore('keys').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const existing = await read(keyId);
      if (existing) return existing;
      const generated = await read('primary') || await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      // 事务内再次读取，多个标签同时首登也只落一把密钥
      return await new Promise<DeviceKeys>((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite');
        const store = tx.objectStore('keys');
        const request = store.get(keyId);
        let selected = generated;
        request.onsuccess = () => {
          if (request.result) selected = request.result;
          else {
            // 复用升级前的本站密钥，不因增加命名空间更换已有私钥
            const legacy = store.get('primary');
            legacy.onsuccess = () => {
              selected = legacy.result || generated;
              store.add(selected, keyId);
            };
          }
        };
        tx.oncomplete = () => resolve(selected);
        tx.onabort = () => reject(new Error('设备密钥保存失败，请检查浏览器存储权限'));
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  })().catch(error => { keyPromise = undefined; throw error; });
  return keyPromise;
}

export async function assertDeviceSession(expected?: string | null): Promise<void> {
  if (!expected) throw Object.assign(new Error('安全验证已升级，请重新登录一次'), { code: 'ACCOUNT_DEVICE_PROOF_REQUIRED', status: 401 });
  const keys = await deviceKeys();
  const key = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const normalized = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y };
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(normalized))));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw Object.assign(new Error('本机设备密钥已变化，请重新登录'), { code: 'ACCOUNT_DEVICE_PROOF_REQUIRED', status: 401 });
}

async function currentSession(): Promise<string> {
  if (sessionId) return sessionId;
  if (!contextPromise) contextPromise = (async () => {
    const revision = sessionRevision;
    const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || '请重新登录以验证设备'), { code: data.code, status: response.status });
    if (revision !== sessionRevision) throw new Error('账户已变化，请重新操作');
    setDeviceSession(data.session?.sessionId || data.deviceSessionId || '', data.session?.serverTime);
    if (!sessionId) throw Object.assign(new Error('请先登录账户'), { code: 'ACCOUNT_AUTH_REQUIRED', status: 401 });
    return sessionId;
  })().finally(() => { contextPromise = undefined; });
  return contextPromise;
}

export async function createDeviceProof(method: string, path: string, body = '', login = false): Promise<string> {
  const keys = await deviceKeys();
  const sid = login ? 'login' : await currentSession();
  const ts = Date.now() + clockOffset;
  const nonce = base64(crypto.getRandomValues(new Uint8Array(24)));
  const digest = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(body))));
  const message = ['openmusic-device-v1', sid, method.toUpperCase(), path, digest, ts, nonce].join('\n');
  const sig = base64(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(message))));
  const key = await crypto.subtle.exportKey('jwk', keys.publicKey);
  return base64(encoder.encode(JSON.stringify({ v: 1, sid, ts, nonce, sig, key })));
}

if (typeof window !== 'undefined') {
  window.addEventListener('openmusic:account-session-changed', () => { sessionRevision++; sessionId = ''; });
  window.addEventListener('storage', event => {
    if (isAccountSessionRevisionEvent(event)) { sessionRevision++; sessionId = ''; }
  });
}

