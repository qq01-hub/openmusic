export interface DisplayedPlaybackTimeInput {
  audioBound: boolean;
  audioCurrentTime: number | null;
  audioPaused: boolean;
  audioSeeking: boolean;
  audioReadyState: number;
  trackLoading: boolean;
  roomTakenOver: boolean;
  needsAudioUnlock: boolean;
  stateTime: number | null;
  statePlaying: boolean;
  songSource?: string;
}

const TRACK_START_ZERO_GUARD_SEC = 6;
const AUDIO_HAVE_CURRENT_DATA = 2;

/**
 * 播放时间展示仲裁：
 * 1. 全音源实际播放中（含中途网络缓冲）优先以本机 audio.currentTime 为准，消除切歌缓冲导致的整首抢跑
 * 2. 新曲刚切正在缓冲加载（< 6s 且本机在曲首）保持本机 0 秒起点，避免先抢跑再回跳
 * 3. 试听占用、待解锁、暂停、拖动寻址或刚进房播至中途尚未对齐时使用房间时钟，避免进度闪跳
 */
export function selectDisplayedPlaybackTime(input: DisplayedPlaybackTimeInput): number | null {
  const {
    audioBound,
    audioCurrentTime,
    audioPaused,
    audioSeeking,
    audioReadyState,
    trackLoading,
    roomTakenOver,
    needsAudioUnlock,
    stateTime,
    statePlaying,
    songSource,
  } = input;

  if (audioBound && audioCurrentTime !== null && !roomTakenOver) {
    if (
      statePlaying
      && !audioPaused
      && !audioSeeking
      && (audioReadyState >= AUDIO_HAVE_CURRENT_DATA || audioCurrentTime > 0)
    ) {
      return audioCurrentTime;
    }

    if (
      statePlaying
      && !needsAudioUnlock
      && !audioSeeking
      && (trackLoading || audioReadyState < AUDIO_HAVE_CURRENT_DATA)
      && audioCurrentTime < 1
      && (stateTime === null || stateTime < TRACK_START_ZERO_GUARD_SEC)
    ) {
      return audioCurrentTime;
    }

    if (
      (songSource === 'kugou' || songSource === 'qishui')
      && !needsAudioUnlock
      && !audioSeeking
      && statePlaying
      && audioCurrentTime > 0
    ) {
      return audioCurrentTime;
    }
  }

  if (stateTime !== null) return stateTime;
  return audioCurrentTime;
}
