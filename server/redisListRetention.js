import { evalRedisScript } from './redisScripts.js';

const TRIM_TAIL = `
local removed = 0
for index = 1, 200 do
  local raw = redis.call('LINDEX', KEYS[1], -1)
  if not raw then return {removed, 0} end
  local ok, entry = pcall(cjson.decode, raw)
  if ok and type(entry) == 'table' and tonumber(entry.at) and tonumber(entry.at) >= tonumber(ARGV[1]) then return {removed, 0} end
  redis.call('RPOP', KEYS[1])
  removed = removed + 1
end
return {removed, 1}
`;

// 日志按新到旧排列，原子清理尾部，不读回并重建整个列表
export async function trimExpiredListTail(client, key, cutoff) {
  const [removed, more] = await evalRedisScript(client, TRIM_TAIL, { keys: [key], arguments: [String(cutoff)] });
  return { removed: Number(removed), more: more === 1 };
}
