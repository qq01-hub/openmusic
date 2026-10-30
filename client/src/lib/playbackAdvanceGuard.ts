export interface PlaybackAdvanceGuard {
  claim(queueId: string): boolean;
  reset(): void;
}

export function createPlaybackAdvanceGuard(): PlaybackAdvanceGuard {
  let claimedQueueId: string | null = null;

  return {
    claim(queueId: string): boolean {
      if (!queueId || claimedQueueId === queueId) return false;
      claimedQueueId = queueId;
      return true;
    },
    reset(): void {
      claimedQueueId = null;
    },
  };
}
