import { createHash } from 'node:crypto';

// 只缓存脚本文本的摘要，不缓存任何业务结果，条数与总字节数均有界
const hashes = new Map();
let bytes = 0;
const MAX_BYTES = 1024 * 1024;
export async function evalRedisScript(client, script, options) {
  if (typeof client.evalSha !== 'function') return client.eval(script, options);
  let sha = hashes.get(script);
  if (!sha) {
    sha = createHash('sha1').update(script).digest('hex');
    const size = Buffer.byteLength(script);
    if (size <= MAX_BYTES) {
      while (hashes.size >= 128 || bytes + size > MAX_BYTES) {
        const oldest = hashes.keys().next().value;
        bytes -= Buffer.byteLength(oldest);
        hashes.delete(oldest);
      }
      hashes.set(script, sha); bytes += size;
    }
  }
  try { return await client.evalSha(sha, options); }
  catch (error) {
    // 断线、超时和权限错误不得重放可能已经生效的非幂等写入
    if (!/^NOSCRIPT\b/u.test(String(error?.message || ''))) throw error;
    return client.eval(script, options);
  }
}
