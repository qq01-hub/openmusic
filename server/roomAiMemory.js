/**
 * AI 辅助模块内存与并发护栏（基础设施上限，非业务行为写死）。
 */


/** 房间活跃度 / 用户状态等 Map 的最大条目（超出删最旧） */
export function trimMapByUpdatedAt(map, maxEntries, getUpdatedAt = (v) => v?.updatedAt || 0) {
  if (!map || map.size <= maxEntries) return;
  const entries = [...map.entries()].sort((a, b) => (getUpdatedAt(a[1]) || 0) - (getUpdatedAt(b[1]) || 0));
  const drop = entries.length - maxEntries;
  for (let i = 0; i < drop; i += 1) {
    map.delete(entries[i][0]);
  }
}
