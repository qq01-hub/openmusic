export function wechatLoginRetryDelay(error: unknown, failures: number): number | null {
  if (failures >= 3 || !(error instanceof Error)) return null;
  const failure = error as Error & { status?: number; code?: string };
  if (['WECHAT_OFFICIAL_RESPONSE_INVALID', 'WECHAT_OFFICIAL_INIT_UNAVAILABLE'].includes(failure.code || '')) return null;
  const transient = failure.code === 'WECHAT_LOGIN_BUSY' || failure.status === 408 || failure.status === 429
    || (failure.status !== undefined && failure.status >= 500)
    || failure.name === 'AbortError' || failure instanceof TypeError;
  return transient ? 1000 * 2 ** failures : null;
}
