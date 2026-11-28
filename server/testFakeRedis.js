// 仅供 *.test.js 使用的内存版假 Redis（实现字符串/集合/列表/multi 子集）。
// 内存版假 Redis：实现 chat 存储与 admin 审计用到的 multi/del/rPush/lPush/lTrim/lRange/lLen/expire 子集
export function createFakeRedis() {
  const strings = new Map();
  const lists = new Map();
  const sets = new Map();
  const apply = (name, args) => client[name](...args);
  const client = {
    strings, lists, sets,
    async get(key) { return strings.get(key) ?? null; },
    async set(key, value) { strings.set(key, String(value)); return 'OK'; },
    async del(...keys) {
      let n = 0;
      for (const key of keys.flat()) {
        if (strings.delete(key) || lists.delete(key) || sets.delete(key)) n += 1;
      }
      return n;
    },
    async mGet(keys) { return keys.map((key) => strings.get(key) ?? null); },
    async sAdd(key, ...members) {
      const set = sets.get(key) || new Set();
      members.flat().forEach((m) => set.add(String(m)));
      sets.set(key, set);
      return members.length;
    },
    async sRem(key, ...members) {
      const set = sets.get(key);
      if (!set) return 0;
      let n = 0;
      members.flat().forEach((m) => { if (set.delete(String(m))) n += 1; });
      return n;
    },
    async sMembers(key) { return [...(sets.get(key) || [])]; },
    async *sScanIterator(key) { yield [...(sets.get(key) || [])]; },
    async rPush(key, values) {
      const list = lists.get(key) || [];
      list.push(...(Array.isArray(values) ? values : [values]).map(String));
      lists.set(key, list);
      return list.length;
    },
    async lTrim(key, start, stop) {
      const list = lists.get(key);
      if (!list) return 'OK';
      const len = list.length;
      const from = start < 0 ? Math.max(0, len + start) : start;
      const to = stop < 0 ? len + stop : stop;
      lists.set(key, list.slice(from, to + 1));
      return 'OK';
    },
    async lRange(key, start, stop) {
      const list = lists.get(key) || [];
      const len = list.length;
      const from = start < 0 ? Math.max(0, len + start) : start;
      const to = stop < 0 ? len + stop : stop;
      return list.slice(from, to + 1);
    },
    async lPush(key, ...values) {
      const list = lists.get(key) || [];
      for (const value of values.flat()) list.unshift(String(value));
      lists.set(key, list);
      return list.length;
    },
    async lLen(key) { return (lists.get(key) || []).length; },
    async expire() { return 1; },
    multi() {
      const ops = [];
      const transaction = {};
      for (const name of ['set', 'del', 'sAdd', 'sRem', 'rPush', 'lTrim', 'lPush', 'expire']) {
        transaction[name] = (...args) => { ops.push([name, args]); return transaction; };
      }
      transaction.exec = async () => {
        const results = [];
        for (const [name, args] of ops) results.push(await apply(name, args));
        return results;
      };
      return transaction;
    },
  };
  return client;
}

