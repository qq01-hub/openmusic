import { freemem } from 'node:os';

export function assertBuildMemory(availableBytes = freemem()) {
  if (availableBytes < 3 * 1024 ** 3) throw new Error('可用物理内存不足 3 GiB，已停止打包，请关闭其他高内存程序后重试');
}

export function getBuildEnvironment(environment = process.env) {
  const options = environment.NODE_OPTIONS || '';
  let heapLimit = 1536;
  const remaining = options.replace(/--max[-_]old[-_]space[-_]size(?:=|\s+)(?:"(\d+)"|'(\d+)'|(\d+))/gu, (_, doubleQuoted, singleQuoted, unquoted) => {
    const limit = doubleQuoted || singleQuoted || unquoted;
    if (Number(limit) > 0) heapLimit = Math.min(heapLimit, Number(limit));
    return '';
  }).trim();
  const threads = Number.parseInt(environment.UV_THREADPOOL_SIZE, 10);
  return { ...environment,
    NODE_OPTIONS: `${remaining ? `${remaining} ` : ''}--max-old-space-size=${heapLimit}`,
    UV_THREADPOOL_SIZE: String(Number.isInteger(threads) && threads > 0 ? Math.min(2, threads) : 2),
  };
}
