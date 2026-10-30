import { useEffect, useState } from 'react';
import {
  getTrackCrossSourceFrom,
  isTrackCrossSource,
  isTrackSourceError,
  subscribeSourceErrors,
} from '../lib/songPreloadCache';
import type { MusicSource, QueueItem } from '../types';

/** 订阅源错误/跨源标记变化，用于队列列表重渲染 */
export function useSourceErrorRevision() {
  const [revision, bump] = useState(0);
  useEffect(() => subscribeSourceErrors(() => bump((v) => v + 1)), []);
  return revision;
}

export function useTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'> | null | undefined): boolean {
  useSourceErrorRevision();
  if (!song) return false;
  return isTrackSourceError(song);
}

export function useTrackCrossSource(song: Pick<QueueItem, 'queueId' | 'id' | 'source'> | null | undefined): boolean {
  useSourceErrorRevision();
  if (!song) return false;
  return isTrackCrossSource(song);
}

export function useTrackCrossSourceFrom(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source'> | null | undefined,
): MusicSource | undefined {
  useSourceErrorRevision();
  if (!song) return undefined;
  return getTrackCrossSourceFrom(song);
}
