/**
 * Build a fair playback order by rotating through requesters.
 * Songs within each requester remain in request-time order unless pickSong is provided.
 */
export function buildUserRoundRobinOrder(songs, options = {}) {
  const input = Array.isArray(songs) ? songs : [];
  const pickSong = typeof options.pickSong === "function"
    ? options.pickSong
    : (userSongs) => userSongs[0];
  const groups = new Map();
  const order = [];

  input.forEach((song, index) => {
    const userId = String(song?.requestedById || "").trim() || `anonymous-${index}`;
    if (!groups.has(userId)) {
      groups.set(userId, []);
      order.push(userId);
    }
    groups.get(userId).push(song);
  });

  const requestedOrder = Array.isArray(options.userOrder)
    ? options.userOrder.map((id) => String(id || "").trim()).filter((id) => groups.has(id))
    : [];
  const userOrder = [...new Set([...requestedOrder, ...order.filter((id) => !requestedOrder.includes(id))])];
  const result = [];
  while (userOrder.some((userId) => groups.get(userId)?.length)) {
    for (const userId of userOrder) {
      const userSongs = groups.get(userId);
      if (!userSongs?.length) continue;
      const selected = pickSong(userSongs, userId);
      const index = userSongs.indexOf(selected);
      result.push(userSongs.splice(index >= 0 ? index : 0, 1)[0]);
    }
  }
  return result;
}

/**
 * Pick the next requester in a fair rotation. By default, queued songs from
 * members who left are deferred while another requester remains online.
 * Likes prioritize songs within the selected requester without changing turns.
 */
export function selectNextUserRoundRobinSong(songs, options = {}) {
  const queue = Array.isArray(songs) ? songs : [];
  const requesterOrder = Array.isArray(options.requesterOrder) ? options.requesterOrder : [];
  const queuedUserIds = [];
  const seen = new Set();
  for (const item of queue) {
    const userId = String(item?.requestedById || '').trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    queuedUserIds.push(userId);
  }
  if (!queuedUserIds.length) return null;

  const allOrder = [...requesterOrder, ...queuedUserIds.filter((userId) => !requesterOrder.includes(userId))];
  const online = options.onlineUserIds instanceof Set ? options.onlineUserIds : new Set();
  const onlineUserIds = queuedUserIds.filter((userId) => online.has(userId));
  const eligibleUserIds = options.deferOfflineRequesters !== false && onlineUserIds.length
    ? onlineUserIds
    : queuedUserIds;
  const previousIndex = allOrder.indexOf(options.lastRequesterId);
  const rotatedAll = previousIndex >= 0 && allOrder.length > 1
    ? [...allOrder.slice(previousIndex + 1), ...allOrder.slice(0, previousIndex + 1)]
    : allOrder;
  const userOrder = rotatedAll.filter((userId) => eligibleUserIds.includes(userId));
  return buildUserRoundRobinOrder(
    queue.filter((item) => eligibleUserIds.includes(item.requestedById)),
    {
      userOrder,
      pickSong: options.queueLikeSortEnabled === false ? undefined : (userSongs) => userSongs.reduce((best, song) => {
        const likes = Array.isArray(song.likedByIds) ? song.likedByIds.length : 0;
        const bestLikes = Array.isArray(best.likedByIds) ? best.likedByIds.length : 0;
        return likes > bestLikes ? song : best;
      }),
    },
  )[0] || null;
}
