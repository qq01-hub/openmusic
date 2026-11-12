import { memo, useRef, useState } from 'react';

import {
  ChevronDown, Play, Pause, SkipForward, Loader2, Tv, Check, RotateCcw, RotateCw,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { copyToClipboard } from '../lib/copyToClipboard';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';

import { useSocket } from '../hooks/useSocket';

import { getCoverUrl, getTrackKey } from '../api/music';
import { useTrackLyrics } from '../hooks/useTrackLyrics';

import SyncedLyricsPane from './playback/SyncedLyricsPane';
import VinylPlayer from './VinylPlayer';
import SongInfoPanel from './SongInfoPanel';

import PlaybackProgressBar from './playback/PlaybackProgressBar';
import PlaybackTimeLabel from './playback/PlaybackTimeLabel';
import Tooltip from './Tooltip';
import VolumeControl from './VolumeControl';
import FavoriteButton from './FavoriteButton';
import PlayModeButton from './PlayModeButton';
import AmbientCoverLayers from './AmbientCoverLayers';
import { updateMediaSessionPlaybackState } from '../lib/mediaSession';
import { canPauseInRoom, canSeekInRoom } from '../lib/roomPermissions';



interface Props {

  onClose: () => void;

}



export default memo(function PlayerPage({ onClose }: Props) {

  const { roomId } = useParams();
  const [tvCopied, setTvCopied] = useState(false);

  const room = useRoomStore((s) => s.room);

  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const canSeek = canSeekInRoom(room, canControlPlayback);
  const canPause = canPauseInRoom(room, canControlPlayback);
  const trackLoading = useAudioStore((s) => s.trackLoading);
  const setTrackLoading = useAudioStore((s) => s.setTrackLoading);
  const seekPlayback = useAudioStore((s) => s.seekPlayback);
  const localPlayback = useAudioStore((s) => s.localPlayback);
  const actualMediaByTrack = useAudioStore((s) => s.actualMediaByTrack);
  const { togglePlay, skipSong, requestSkip, adjustRoomLyrics } = useSocket();
  const isOwner = useRoomStore(s => s.isOwner);
  const isAdmin = useRoomStore(s => s.isAdmin);
  const canAdjustLyrics = isOwner || isAdmin;
  const lyricAdjustmentPending = useRef(false);
  const [adjustingLyrics, setAdjustingLyrics] = useState(false);
  const [lyricError, setLyricError] = useState('');
  const lyricOffset = room?.lyricOffsetSeconds ?? 0;

  const [skipError, setSkipError] = useState('');
  const [skipMsg, setSkipMsg] = useState('');
  const mySocketId = useRoomStore((s) => s.mySocketId);



  const current = room?.current;
  const actualMedia = current ? actualMediaByTrack[getTrackKey(current)] : undefined;
  const qualityLabel = actualMedia?.qualityLabel ?? null;
  const displaySource = actualMedia?.source ?? current?.source ?? 'netease';
  const lyrics = useTrackLyrics(current);

  const isPlaying = room?.isPlaying ?? false;

  const hasPendingSkip = room?.skipRequests?.some((r) => r.requestedBy === mySocketId) ?? false;



  const handlePlayPause = () => {
    const next = !isPlaying;
    if (!next && room) {
      localPlayback?.(false);
    }
    updateMediaSessionPlaybackState(next ? 'playing' : 'paused');
    togglePlay(next);
    if (next) localPlayback?.(true);
  };



  const handleSeek = (time: number) => seekPlayback?.(time);

  const handleAdjustLyrics = async (delta: number) => {
    if (!current || !canAdjustLyrics || lyricAdjustmentPending.current) return;
    lyricAdjustmentPending.current = true;
    setAdjustingLyrics(true);
    setLyricError('');
    try {
      const result = await adjustRoomLyrics(current, delta);
      if (!result.success) setLyricError(result.error || '歌词微调失败，请重试');
    } catch {
      setLyricError('歌词微调失败，请检查连接后重试');
    } finally {
      lyricAdjustmentPending.current = false;
      setAdjustingLyrics(false);
    }
  };



  const handleSkip = async () => {
    setSkipError('');
    setSkipMsg('');
    setTrackLoading(true);
    const res = await skipSong();
    if (!res.success) {
      setTrackLoading(false);
      setSkipError(res.error || '切歌失败');
    }
  };

  const handleRequestSkip = async () => {
    setSkipError('');
    setSkipMsg('');
    const res = await requestSkip();
    if (res.success) {
      setSkipMsg('已提交切歌申请，等待房主同意');
      setTimeout(() => setSkipMsg(''), 3000);
    } else {
      setSkipError(res.error || '申请失败');
    }
  };



  if (!current) return null;

  const handleCopyTvLink = async () => {
    const id = roomId || room?.id;
    if (!id) return;
    const ok = await copyToClipboard(`${window.location.origin}/tv/${id}`);
    if (ok) {
      setTvCopied(true);
      setTimeout(() => setTvCopied(false), 2000);
    }
  };

  const coverUrl = getCoverUrl(current, 'medium');

  return (

    <div className="fixed inset-0 z-[60] flex flex-col animate-fade-in overflow-hidden isolate">

      <AmbientCoverLayers coverUrl={coverUrl} />

      <header className="relative z-10 flex items-center px-3 py-2 sm:px-4 sm:py-3 2xl:px-8 2xl:py-6 flex-shrink-0 safe-top">

        <button

          onClick={onClose}

          className="w-9 h-9 sm:w-10 sm:h-10 2xl:w-16 2xl:h-16 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"

        >

          <ChevronDown className="w-5 h-5 sm:w-6 sm:h-6 2xl:w-10 2xl:h-10" />

        </button>

        <div className="flex-1" />

        {canAdjustLyrics && (
          <div className="mr-1 flex items-center">
            <Tooltip side="bottom" content={`歌词提前 0.5 秒 · 当前${lyricOffset === 0 ? '未调整' : `${lyricOffset < 0 ? '提前' : '延后'} ${Math.abs(lyricOffset).toFixed(1)} 秒`} · 全房间同步并自动保存`}>
              <button type="button" onClick={() => void handleAdjustLyrics(-0.5)} disabled={adjustingLyrics || !lyrics.length || lyricOffset <= -30}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 sm:h-10 sm:w-10" aria-label="歌词提前 0.5 秒">
                <RotateCcw className="h-5 w-5" aria-hidden="true" />
              </button>
            </Tooltip>
            <span role="status" className="sr-only">{lyricOffset === 0 ? '歌词未调整' : `歌词${lyricOffset < 0 ? '提前' : '延后'} ${Math.abs(lyricOffset).toFixed(1)} 秒`}</span>
            <Tooltip side="bottom" content={`歌词延后 0.5 秒 · 当前${lyricOffset === 0 ? '未调整' : `${lyricOffset < 0 ? '提前' : '延后'} ${Math.abs(lyricOffset).toFixed(1)} 秒`} · 全房间同步并自动保存`}>
              <button type="button" onClick={() => void handleAdjustLyrics(0.5)} disabled={adjustingLyrics || !lyrics.length || lyricOffset >= 30}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 sm:h-10 sm:w-10" aria-label="歌词延后 0.5 秒">
                <RotateCw className="h-5 w-5" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        )}

        <Tooltip side="bottom" content={tvCopied ? '已复制 TV 链接' : 'TV 歌词'}>
          <button
            type="button"
            onClick={handleCopyTvLink}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white sm:h-10 sm:w-10"
            aria-label="TV 歌词"
          >
            {tvCopied ? <Check className="h-5 w-5 text-green-400" /> : <Tv className="h-5 w-5" />}
          </button>
        </Tooltip>

      </header>



      <div className="relative z-10 flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 px-3 sm:px-4 lg:px-12 2xl:px-24 gap-1 sm:gap-4 lg:gap-8 2xl:gap-16">

        <div className="flex-shrink-0 lg:flex-1 flex items-center justify-center py-0 sm:py-2 lg:py-8 2xl:py-16">

          <VinylPlayer coverUrl={coverUrl} isPlaying={isPlaying} size="large" className="scale-[0.92] sm:scale-100 origin-center" />

        </div>



        <div className="flex-1 flex flex-col min-h-0 min-w-0">

          <SongInfoPanel
            name={current.name}
            artist={current.artist}
            source={displaySource}
            requestedBy={current.requestedBy}
            qualityLabel={qualityLabel}
            size="large"
            mobileCentered
          />

          <SyncedLyricsPane
            lines={lyrics}
            onSeek={canSeek ? handleSeek : undefined}
            variant="side"
            size="large"
            scrollable
            mobileCentered
          />

        </div>

      </div>



      <footer className="relative z-10 px-4 pt-2 sm:px-6 sm:pt-3 flex-shrink-0 2xl:px-12 2xl:pt-6 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] 2xl:pb-[max(3rem,env(safe-area-inset-bottom,0px))]">

        <div className="mb-1.5 sm:mb-2 flex justify-between text-xs sm:text-sm 2xl:text-xl text-white/50">
          <PlaybackTimeLabel song={current} mode="elapsed" />
          <PlaybackTimeLabel song={current} mode="duration" />
        </div>

        <div className="mb-2 sm:mb-4 py-1 sm:py-2 -my-1 sm:-my-2 2xl:mb-8">
          <PlaybackProgressBar
            song={current}
            onSeek={handleSeek}
            disabled={!canSeek}
            className="h-1.5 2xl:h-2.5"
            trackClassName="bg-white/20"
            fillClassName="bg-white"
            thumbClassName="w-3 h-3 2xl:w-5 2xl:h-5"
            showThumb
          />
        </div>

        <div className="relative flex items-center justify-center gap-3 sm:gap-10 2xl:gap-16">

          <VolumeControl
            compact
            iconClassName="w-4 h-4 sm:w-5 sm:h-5 2xl:w-7 2xl:h-7"
            sliderClassName="h-20 sm:h-24 2xl:h-32"
            buttonClassName="w-10 h-10 sm:w-12 sm:h-12 2xl:w-20 2xl:h-20 text-white/70 hover:text-white"
          />

          <FavoriteButton
            song={current}
            className="w-10 h-10 sm:w-12 sm:h-12 2xl:w-20 2xl:h-20 text-white/70 hover:text-rose-300"
            iconClassName="w-5 h-5 sm:w-6 sm:h-6 2xl:w-8 2xl:h-8"
          />

          <Tooltip content={canPause ? '暂停/播放' : (isPlaying ? '正在播放' : '已暂停')}>
            <button
              onClick={canPause ? handlePlayPause : undefined}
              disabled={trackLoading || !canPause}
              className={`w-14 h-14 sm:w-16 sm:h-16 2xl:w-24 2xl:h-24 flex items-center justify-center rounded-full transition-all shadow-lg shadow-black/30 disabled:opacity-80 ${canPause ? 'bg-white text-black hover:scale-105' : 'bg-white/10 text-white/70 cursor-not-allowed'}`}
              aria-label="播放控制"
            >
              {trackLoading ? (
                <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 2xl:w-10 2xl:h-10 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-6 h-6 sm:w-7 sm:h-7 2xl:w-10 2xl:h-10" />
              ) : (
                <Play className="w-6 h-6 sm:w-7 sm:h-7 2xl:w-10 2xl:h-10 ml-0.5 2xl:ml-1" />
              )}
            </button>
          </Tooltip>

          {canControlPlayback ? (
            <Tooltip content="切歌">
              <button
                onClick={handleSkip}
                disabled={trackLoading}
                className="w-10 h-10 sm:w-12 sm:h-12 2xl:w-20 2xl:h-20 flex items-center justify-center text-white/70 hover:text-white transition-colors disabled:opacity-50"
                aria-label="切歌"
              >
                {trackLoading ? (
                  <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 2xl:w-8 2xl:h-8 animate-spin" />
                ) : (
                  <SkipForward className="w-5 h-5 sm:w-6 sm:h-6 2xl:w-8 2xl:h-8" />
                )}
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={hasPendingSkip ? '已申请切歌' : '申请切歌'}>
              <button
                onClick={handleRequestSkip}
                disabled={hasPendingSkip}
                className="w-10 h-10 sm:w-12 sm:h-12 2xl:w-20 2xl:h-20 flex items-center justify-center text-white/70 hover:text-white transition-colors disabled:opacity-40"
                aria-label="申请切歌"
              >
                <SkipForward className="w-5 h-5 sm:w-6 sm:h-6 2xl:w-8 2xl:h-8" />
              </button>
            </Tooltip>
          )}

          <PlayModeButton
            className="h-10 w-10 sm:h-12 sm:w-12 2xl:h-20 2xl:w-20"
            iconClassName="h-5 w-5 sm:h-6 sm:w-6 2xl:h-8 2xl:w-8"
          />

        </div>

        {canAdjustLyrics && lyricError && <p role="alert" className="mt-1 text-center text-xs text-red-300">{lyricError}</p>}



        {(skipError || skipMsg) && (

          <p className={`text-center text-xs 2xl:text-base mt-2 2xl:mt-4 ${skipMsg ? 'text-amber-300' : 'text-red-300'}`}>
            {skipMsg || skipError}
          </p>

        )}

      </footer>

    </div>

  );

});

