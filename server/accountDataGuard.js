// 收藏写入与账户注销共用 Redis 原子检查，阻止已在途的旧请求重新写回数据
export const FAVORITE_OWNER_ACTIVE_LUA = `
local uid = string.match(KEYS[1], '^openmusic:favorites:(.+)$')
  or string.match(KEYS[1], '^openmusic:favorite%-categories:(.+)$')
if uid then
  local owner = redis.call('GET', 'openmusic:account:room-identity:' .. uid)
  if owner then
    local account = redis.call('GET', 'openmusic:account:' .. owner)
    if account and cjson.decode(account).deletedAt then return redis.error_reply('ACCOUNT_DELETED') end
  end
end
`;
