// Socket 包级会话核验的短 TTL 缓存。
//
// 背景：socket.use 中间件对每一个数据包都做一次完整会话核验
// （令牌验签 + Redis GET 会话族 + Redis GET 账户），84 个事件无一例外。
// 同一 socket 的握手头在连接生命周期内不变，会话身份只会因服务端的
// 吊销/过期/风控而变化，因此把「核验通过」的结果按 socket 缓存数秒是安全的：
// - 只缓存 valid 的结果；无效/不可用/需人机验证一律不缓存，逐包复核。
// - 风控 consume 与逐事件分布式限流是按包计数的语义，不经过本缓存，照常执行。
// - 吊销通道（riskChallengeBus 的 session:<sid> 发布）会主动失效对应缓存；
//   即使某条失效路径漏掉，最坏吊销延迟也只等于 TTL（默认 8 秒，上限 10 秒），
//   且连接层另有 30 秒周期的权威复核（sweepMonitoredSocketSessions）兜底。

export const SOCKET_SESSION_CACHE_TTL_MS = 8_000;
const MAX_TTL_MS = 10_000;

export function createSocketSessionVerifier({
  verify,
  ttlMs = SOCKET_SESSION_CACHE_TTL_MS,
  now = () => Date.now(),
  getSessionKey = () => '',
  onHit = () => {},
  onMiss = () => {},
} = {}) {
  if (typeof verify !== 'function') throw new TypeError('createSocketSessionVerifier 需要 verify 函数');
  const ttl = Math.max(0, Math.min(Number(ttlMs) || 0, MAX_TTL_MS));
  // socketId -> { socket, entry: { sessionKey, accountId, account, verifiedAt } }
  const registry = new Map();

  function invalidateSocket(socket) {
    if (socket?.id) registry.delete(socket.id);
    if (socket?.data) delete socket.data.sessionCacheEntry;
  }

  function invalidateWhere(predicate) {
    let removed = 0;
    for (const [socketId, record] of registry) {
      if (!predicate(record)) continue;
      registry.delete(socketId);
      if (record.socket?.data) delete record.socket.data.sessionCacheEntry;
      removed += 1;
    }
    return removed;
  }

  return {
    ttlMs: ttl,
    get size() { return registry.size; },

    async verifySocket(socket, options = {}) {
      const entry = socket?.data?.sessionCacheEntry;
      if (entry && ttl > 0) {
        const sessionKey = getSessionKey(socket);
        const fresh = now() - entry.verifiedAt < ttl;
        const sameSession = !sessionKey || entry.sessionKey === sessionKey;
        const sameAccount = !socket.data.accountId || entry.accountId === socket.data.accountId;
        if (fresh && sameSession && sameAccount) {
          onHit(socket);
          return { valid: true, account: entry.account, cached: true };
        }
        invalidateSocket(socket);
      }
      onMiss(socket);
      const result = await verify(socket, options);
      if (result?.valid && result.account && ttl > 0) {
        const next = {
          sessionKey: getSessionKey(socket),
          accountId: result.account.id,
          account: result.account,
          verifiedAt: now(),
        };
        socket.data.sessionCacheEntry = next;
        registry.set(socket.id, { socket, entry: next });
      }
      return result;
    },

    invalidateSocket,
    invalidateSessionKey(sessionKey) {
      if (!sessionKey) return 0;
      return invalidateWhere((record) => record.entry.sessionKey === sessionKey);
    },
    invalidateAccount(accountId) {
      if (!accountId) return 0;
      return invalidateWhere((record) => record.entry.accountId === accountId);
    },
    invalidateAll() {
      const removed = registry.size;
      for (const record of registry.values()) {
        if (record.socket?.data) delete record.socket.data.sessionCacheEntry;
      }
      registry.clear();
      return removed;
    },
  };
}
