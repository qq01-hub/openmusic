/**
 * 聊天音乐卡片的本机播放器（单例）。
 *
 * 卡片播放只影响当前用户：占用的是一条独立音频元素，不写入任何房间状态，也不广播。
 * 播放期间通过 roomAudioPriority 让房间跟播让路；暂停、播完或切换卡片都会立刻
 * 归还音频，房间按服务端时间轴恢复播放。每张卡片各自记住上次的进度。
 */
import type { Song } from '../types';
import { filterDisplayLyrics, getLyrics, getSongUrlInfo, parseLrc, songKey } from '../api/music';
import { resolveQishuiLocalPlaybackUrl, isQishuiLocalPlaybackUrl } from './qishuiLocalPlayback';
import { configureInlineAudio } from './audioUnlock';
import { findActiveLyricIndex } from './lyricActiveIndex';
import {
  acquireRoomAudio,
  consumeRoomResumeRequest,
  isRoomAudioTakenOver,
  markRoomPausedForLocalPlayback,
  releaseRoomAudio,
  unregisterRoomAudio,
} from './roomAudioPriority';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { getSharedAudio } from './audioElement';
import { getAudioController } from './audioController';
import type { LyricLine } from '../types';

type ChatCardPlaybackStatus = 'idle' | 'loading' | 'playing' | 'error';

type ChatCardSong = Pick<Song, 'id' | 'source' | 'name' | 'artist' | 'duration'>;

export type ChatCardPlaybackState = {
  /** 唯一正在播放的卡片消息 id（加载/播放中，暂停即回到空闲） */
  messageId: string | null;
  /** 卡片标识：同一消息可含多张卡片，需用消息 id + 曲目共同区分 */
  cardKey: string | null;
  trackKey: string | null;
  song: ChatCardSong | null;
  status: ChatCardPlaybackStatus;
  error: string | null;
  /** 播放进度（秒），用于卡片内滚动歌词 */
  positionSec: number;
  /** 实际曲目时长（秒），来自音频元数据；用于进度条与总时长 */
  durationSec: number;
  lyrics: LyricLine[];
};

const EMPTY_STATE: ChatCardPlaybackState = {
  messageId: null,
  cardKey: null,
  trackKey: null,
  song: null,
  status: 'idle',
  error: null,
  positionSec: 0,
  durationSec: 0,
  lyrics: [],
};

let cardAudio: HTMLAudioElement | null = null;
let activeState: ChatCardPlaybackState = { ...EMPTY_STATE };

/** 卡片唯一标识：同一条消息里的多张卡片必须各自独立播放/记忆进度 */
export function chatCardKey(messageId: string, song: Pick<ChatCardSong, 'id' | 'source'>): string {
  return `${messageId}::${songKey(song)}`;
}

/** 每张卡片各自的播放进度（秒），退出后再次点该卡片可接着听 */
const progressByCard = new Map<string, number>();
const MAX_REMEMBERED_CARDS = 20;
let loadToken = 0;
let abortController: AbortController | null = null;
let lyricToken = 0;
let rafId = 0;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((cb) => cb());
}

function publish(next: Partial<ChatCardPlaybackState>) {
  activeState = { ...activeState, ...next };
  notify();
}

function rememberProgress(cardKey: string, positionSec: number) {
  if (!cardKey || !Number.isFinite(positionSec) || positionSec < 0) return;
  progressByCard.delete(cardKey);
  progressByCard.set(cardKey, positionSec);
  while (progressByCard.size > MAX_REMEMBERED_CARDS) {
    const oldest = progressByCard.keys().next().value;
    if (oldest === undefined) break;
    progressByCard.delete(oldest);
  }
}

function stopProgressLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function startProgressLoop() {
  if (rafId) return;
  const tick = () => {
    if (activeState.status !== 'playing' || !cardAudio) {
      rafId = 0;
      return;
    }
    const mediaDuration = Number(cardAudio.duration);
    const nextDuration = Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : activeState.durationSec;
    publish({
      positionSec: Number.isFinite(cardAudio.currentTime) ? cardAudio.currentTime : 0,
      durationSec: nextDuration,
    });
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function applyChatCardVolume(volume: number): void {
  if (!cardAudio) return;
  cardAudio.volume = Math.min(1, Math.max(0, volume));
}

export function getChatCardPlaybackState(): ChatCardPlaybackState {
  return activeState;
}

export function subscribeChatCardPlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getOrCreateCardAudio(): HTMLAudioElement {
  if (cardAudio) return cardAudio;
  cardAudio = new Audio();
  configureInlineAudio(cardAudio);
  cardAudio.preload = 'metadata';
  applyChatCardVolume(useAudioStore.getState().volume);
  cardAudio.addEventListener('ended', () => {
    // 播完自动回到房间播放；下次点同一张卡片从头开始
    const finishedKey = activeState.cardKey;
    if (finishedKey) progressByCard.delete(finishedKey);
    stopChatCardPlayback();
  });
  cardAudio.addEventListener('error', () => {
    if (activeState.status !== 'loading' && activeState.status !== 'playing') return;
    publish({ status: 'error', error: '试听失败，稍后再试' });
    // 播放中出错时 play() 已经 resolve，需在这里归还音频并恢复房间播放
    releaseAudio();
    resumeRoomAfterCard();
  });
  return cardAudio;
}

/** 立即放弃卡片音频，让房间恢复（不主动续播，交给房间同步逻辑） */
function handBackAudio() {
  const shared = getSharedAudio();
  if (!shared.paused) shared.pause();
  getAudioController().enqueue(() => {
    if (!isRoomAudioTakenOver()) return;
    const audio = getSharedAudio();
    if (!audio.paused) audio.pause();
  });
}

function resumeRoomAfterCard() {
  if (isRoomAudioTakenOver()) return;
  if (!consumeRoomResumeRequest()) return;
  const room = useRoomStore.getState().room;
  if (room?.isPlaying) {
    useAudioStore.getState().retryPlayback?.(true);
  }
}

function releaseAudio(): boolean {
  return releaseRoomAudio('chat_card');
}

function takeOverAudio(onInterrupt: () => void) {
  const room = useRoomStore.getState().room;
  if (room?.isPlaying) markRoomPausedForLocalPlayback();
  handBackAudio();
  acquireRoomAudio('chat_card', onInterrupt);
}

/** 停止卡片播放并归还音频（resumeRoom 默认 true：回归房间播放） */
export function stopChatCardPlayback(options: { resumeRoom?: boolean } = {}) {
  const wasActive = activeState.status !== 'idle' || activeState.messageId !== null;
  loadToken += 1;
  lyricToken += 1;
  abortController?.abort();
  abortController = null;
  stopProgressLoop();

  if (cardAudio && activeState.cardKey) {
    rememberProgress(activeState.cardKey, cardAudio.currentTime);
    cardAudio.pause();
  }

  const released = releaseAudio();
  unregisterRoomAudio('chat_card');
  activeState = { ...EMPTY_STATE };

  if (options.resumeRoom !== false) resumeRoomAfterCard();
  if (wasActive) notify();
  else if (released) notify();
}

async function loadCardLyrics(song: ChatCardSong, cardKey: string, token: number) {
  try {
    const lrc = await getLyrics({
      id: song.id,
      source: song.source,
      name: song.name,
      artist: song.artist,
    });
    if (token !== lyricToken || activeState.cardKey !== cardKey) return;
    publish({ lyrics: filterDisplayLyrics(parseLrc(lrc)) });
  } catch {
    if (token !== lyricToken || activeState.cardKey !== cardKey) return;
    publish({ lyrics: [] });
  }
}

/** 等音频元数据就绪（用于恢复进度；超时或报错不阻塞播放） */
function waitForCardMetadata(audio: HTMLAudioElement, timeoutMs = 4000): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener('loadedmetadata', finish);
      audio.removeEventListener('error', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener('loadedmetadata', finish, { once: true });
    audio.addEventListener('error', finish, { once: true });
  });
}

/**
 * 播放卡片。同一张卡片再次点击表示暂停（并立刻回到房间播放）；
 * 点击另一张卡片会先停掉上一张，再播放新的。
 */
export async function toggleChatCardPlayback(song: ChatCardSong, messageId: string): Promise<void> {
  const key = songKey(song);
  const cardKey = chatCardKey(messageId, song);

  // 同一张卡片正在播放 → 暂停并回到房间播放
  if (activeState.cardKey === cardKey) {
    if (activeState.status === 'loading') return;
    if (activeState.status === 'playing') {
      stopChatCardPlayback();
      return;
    }
  }

  // 另一张卡片正在播放 → 先停掉它（并记录进度），保证卡片单例播放
  if (activeState.cardKey && activeState.cardKey !== cardKey) {
    stopChatCardPlayback({ resumeRoom: false });
  }

  const audio = getOrCreateCardAudio();
  const startAt = progressByCard.get(cardKey) || 0;
  const token = ++loadToken;
  abortController?.abort();
  const abort = new AbortController();
  abortController = abort;

  activeState = {
    messageId,
    cardKey,
    trackKey: key,
    song,
    status: 'loading',
    error: null,
    positionSec: startAt,
    durationSec: Number(song.duration) > 0 ? Number(song.duration) / 1000 : 0,
    lyrics: [],
  };
  notify();
  takeOverAudio(() => {
    // 被其它本机播放（如搜索结果试听）接管：停止卡片播放
    if (cardAudio && !cardAudio.paused) cardAudio.pause();
    stopProgressLoop();
    if (activeState.status === 'playing' || activeState.status === 'loading') {
      loadToken += 1;
      lyricToken += 1;
      abortController?.abort();
      abortController = null;
      activeState = { ...EMPTY_STATE };
      notify();
    }
  });

  void loadCardLyrics(song, cardKey, ++lyricToken);

  const stillCurrent = () => token === loadToken && activeState.cardKey === cardKey;

  try {
    const resolved = await getSongUrlInfo({ id: song.id, source: song.source, duration: song.duration });
    if (!stillCurrent()) return;
    let url = resolved.url;
    if (!url) throw new Error('empty url');
    if (song.source === 'qishui' && isQishuiLocalPlaybackUrl(url)) {
      const local = await resolveQishuiLocalPlaybackUrl(url, abort.signal);
      if (local.status === 'aborted' || !stillCurrent()) return;
      if (local.status !== 'ok') throw new Error('汽水本地解密失败');
      url = local.url;
    }

    audio.src = url;
    applyChatCardVolume(useAudioStore.getState().volume);
    if (startAt > 0) {
      // 元数据就绪后才能准确 seek，否则浏览器会忽略
      await waitForCardMetadata(audio);
      if (!stillCurrent()) return;
      try {
        audio.currentTime = startAt;
      } catch {
        // 无法 seek 时从头播放
      }
    }
    await audio.play();
    if (!stillCurrent()) return;
    const mediaDuration = Number(audio.duration);
    publish({
      status: 'playing',
      error: null,
      positionSec: audio.currentTime || 0,
      durationSec: Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : activeState.durationSec,
    });
    startProgressLoop();
  } catch (err) {
    if (token !== loadToken) return;
    if (err instanceof Error && err.name === 'AbortError') return;
    publish({ status: 'error', error: '试听失败，稍后再试' });
    releaseAudio();
    resumeRoomAfterCard();
  }
}

/** 离开房间/重置会话时清理，避免把音频占用带到下一个房间 */
export function resetChatCardPlayback(): void {
  stopChatCardPlayback({ resumeRoom: false });
  progressByCard.clear();
}

/** 拖动进度条定位（仅当前正在播放的卡片有效） */
export function seekChatCardPlayback(positionSec: number): void {
  if (!cardAudio || !activeState.cardKey) return;
  const duration = Number.isFinite(cardAudio.duration) && cardAudio.duration > 0
    ? cardAudio.duration
    : activeState.durationSec;
  if (!(duration > 0)) return;
  const next = Math.min(Math.max(positionSec, 0), duration);
  try {
    cardAudio.currentTime = next;
  } catch {
    return;
  }
  rememberProgress(activeState.cardKey, next);
  publish({ positionSec: next });
}

/** 解析卡片当前应该高亮的歌词文本 */
export function resolveChatCardActiveLyric(state: ChatCardPlaybackState): string | null {
  if (!state.lyrics.length) return null;
  const index = findActiveLyricIndex(state.lyrics, state.positionSec);
  if (index < 0) {
    const first = state.lyrics[0];
    return first && first.time > 0 ? null : (first?.text || null);
  }
  return state.lyrics[index]?.text || null;
}