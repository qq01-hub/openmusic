/** 与 audio.src 同步绑定的 queueId，避免内存缓存与真实音源脱节 */

export function bindAudioQueueId(audio: HTMLAudioElement, queueId: string): void {
  audio.dataset.openmusicQueueId = queueId;
}

export function clearAudioQueueBinding(audio: HTMLAudioElement): void {
  delete audio.dataset.openmusicQueueId;
}

export function getAudioBoundQueueId(audio: HTMLAudioElement): string | null {
  return audio.dataset.openmusicQueueId || null;
}

export function isAudioBoundToQueue(audio: HTMLAudioElement, queueId: string): boolean {
  return Boolean(audio.currentSrc || audio.src) && getAudioBoundQueueId(audio) === queueId;
}

/** load gate：仅当 audio 已绑定当前 queueId 时跳过加载 */
export function shouldSkipTrackLoad(audio: HTMLAudioElement, queueId: string): boolean {
  return isAudioBoundToQueue(audio, queueId);
}

/** sync gate：绑定一致且 metadata 已就绪 */
export function canSyncAudioForQueue(audio: HTMLAudioElement, queueId: string): boolean {
  return isAudioBoundToQueue(audio, queueId)
    && audio.readyState >= HTMLMediaElement.HAVE_METADATA;
}
