import { memo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Play, Pause, SkipForward, Loader2, Flag } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { useSocket } from '../hooks/useSocket';
import { canPauseInRoom, canSeekInRoom } from '../lib/roomPermissions';
import { getTrackKey } from '../api/music';
import { getSourceShortLabel } from '../lib/sourceLabels';

import SongCover from './SongCover';
import PlaybackQualityTag from './PlaybackQualityTag';

import ProgressBar from './ProgressBar';
import PlaybackProgressBar from './playback/PlaybackProgressBar';
import PlaybackTimeLabel from './playback/PlaybackTimeLabel';
import MiniPlayerLyricTicker from './playback/MiniPlayerLyricTicker';
import VolumeControl from './VolumeControl';
import FavoriteButton from './FavoriteButton';
import Tooltip from './Tooltip';
import TruncateTip from './TruncateTip';
import ErrorReportModal from './ErrorReportModal';
import PlayModeButton from './PlayModeButton';
import { updateMediaSessionPlaybackState } from '../lib/mediaSession';
import { isMobileDevice } from '../lib/audioUnlock';
import DesktopLyricsPiP from './DesktopLyricsPiP';

interface Props {
  onExpand: () => void;
  transparentBar?: boolean;
  barClassName?: string;
  variant?: 'default' | 'immersive';
}



export default memo(function MiniPlayer({
  onExpand,
  transparentBar = true,
  barClassName,
  variant = 'default',
}: Props) {

  const { current, isPlaying, fmLoading, fmError, skipRequests, hasRoom, canSeek, canPause } = useRoomStore(useShallow((s) => {
    const r = s.room;
    return {
      current: r?.current ?? null,
      isPlaying: r?.isPlaying ?? false,
      fmLoading: Boolean(r?.randomLoading && !r?.current),
      fmError: !r?.current ? r?.randomError || '' : '',
      skipRequests: r?.skipRequests,
      hasRoom: Boolean(r),
      canSeek: canSeekInRoom(r, s.canControlPlayback),
      canPause: canPauseInRoom(r, s.canControlPlayback),
    };
  }));

  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const trackLoading = useAudioStore((s) => s.trackLoading);
  const setTrackLoading = useAudioStore((s) => s.setTrackLoading);
  const seekPlayback = useAudioStore((s) => s.seekPlayback);
  const localPlayback = useAudioStore((s) => s.localPlayback);
  const actualMediaByTrack = useAudioStore((s) => s.actualMediaByTrack);
  const { togglePlay, skipSong, requestSkip } = useSocket();

  const [skipError, setSkipError] = useState('');
  const [skipMsg, setSkipMsg] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const hasPendingSkip = skipRequests?.some((r) => r.requestedBy === mySocketId) ?? false;
  const isMobile = isMobileDevice();
  const showDesktopLyrics = !isMobile;
  const actualMedia = current ? actualMediaByTrack[getTrackKey(current)] : undefined;
  const qualityLabel = actualMedia?.qualityLabel ?? null;
  const displaySource = actualMedia?.source ?? current?.source ?? 'netease';


  const handlePlayPause = () => {
    if (!hasRoom) return;
    const next = !isPlaying;
    if (!next) {
      localPlayback?.(false);
    }
    updateMediaSessionPlaybackState(next ? 'playing' : 'paused');
    togglePlay(next);
    if (next) localPlayback?.(true);
  };

  const handleSeek = (time: number) => seekPlayback?.(time);

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
      setSkipMsg('已提交切歌申请');
      setTimeout(() => setSkipMsg(''), 3000);
    } else {
      setSkipError(res.error || '申请失败');
    }
  };



  if (!current && !fmLoading && !fmError) return null;

  if (variant === 'immersive') {
    if (fmLoading || fmError) {
      return (
        <div id="bottom-bar" data-guide="room-player" className="mineradio-bottom-bar visible room-immersive-bottom mx-auto">
          <div className="mineradio-progress-row">
            <div className="mineradio-progress-bar">
              <div className="mineradio-progress-fill" style={{ width: '0%' }} />
            </div>
            <div className="mineradio-time-display">0:00 / 0:00</div>
          </div>
          <div className="mineradio-controls">
            <div className="control-cluster actions">
              <div className="control-track">
                <div className="control-cover cover-empty" aria-hidden />
                <div className="control-meta">
                  <div className="control-title">私人漫游</div>
                  <div className="control-artist" role="status">{fmError || '正在加载…'}</div>
                </div>
              </div>
            <div className="mineradio-ctrl-btn mineradio-ctrl-btn-placeholder" aria-hidden />
            </div>
            <div className="control-cluster transport">
              <button type="button" className="mineradio-play-btn" disabled aria-label="播放控制">
                {fmLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
              </button>
            </div>
            <div className="control-cluster modes">
            <div className="mineradio-ctrl-btn mineradio-ctrl-btn-placeholder" aria-hidden />
            </div>
          </div>
        </div>
      );
    }

    if (!current) return null;

    return (
      <div id="bottom-bar" data-guide="room-player" className="mineradio-bottom-bar visible room-immersive-bottom mx-auto">
        {(skipError || skipMsg) && (
          <p className={`mb-1 text-center text-[10px] ${skipMsg ? 'text-amber-300' : 'text-red-300'}`}>
            {skipMsg || skipError}
          </p>
        )}
        <div className="mineradio-progress-row">
          <PlaybackProgressBar
            song={current}
            onSeek={handleSeek}
            disabled={!canSeek}
            variant="mineradio"
          />
          <PlaybackTimeLabel
            song={current}
            className="mineradio-time-display"
          />
        </div>
        <div className="mineradio-controls">
          <div className="control-cluster actions">
            <button type="button" className="control-track text-left" onClick={onExpand}>
          <SongCover
            song={current}
            size="tiny"
            eager
            className="control-cover hidden bg-netease-card sm:block"
          />
              <div className="control-meta">
                <div className="control-title">
                  <TruncateTip
                    text={current.name}
                    as="span"
                    className="block min-w-0 truncate"
                  />
                </div>
                <div className="control-artist truncate">
                  <span className="text-white/70">{current.artist}</span>
                  <span>
                    {' · '}
                    {getSourceShortLabel(displaySource)}
                  </span>
                </div>
              </div>
            </button>
            <FavoriteButton
              song={current}
              className="mineradio-ctrl-btn text-white/65 hover:text-rose-300"
              iconClassName="h-4 w-4"
            />
          </div>

          <div className="control-cluster transport">
            <Tooltip content={canPause ? '暂停/播放' : isPlaying ? '房主正在播放' : '房主已暂停'}>
              <button
                type="button"
                onClick={canPause ? handlePlayPause : undefined}
                disabled={trackLoading || !canPause}
                className="mineradio-play-btn"
                aria-label="播放控制"
              >
                {trackLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="ml-0.5 h-5 w-5" />
                )}
              </button>
            </Tooltip>

            {canControlPlayback ? (
              <Tooltip content="切歌">
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={trackLoading}
                  className="mineradio-ctrl-btn"
                  aria-label="切歌"
                >
                  {trackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SkipForward className="h-4 w-4" />}
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={hasPendingSkip ? '已申请切歌' : '申请切歌'}>
                <button
                  type="button"
                  onClick={handleRequestSkip}
                  disabled={hasPendingSkip}
                  className="mineradio-ctrl-btn"
                  aria-label="申请切歌"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
              </Tooltip>
            )}

            <PlayModeButton className="mineradio-ctrl-btn h-10 w-10" iconClassName="h-4 w-4" />
          </div>

          <div className="control-cluster modes">
            <VolumeControl
              compact
              className="flex-shrink-0"
              buttonClassName="mineradio-ctrl-btn"
              iconClassName="h-4 w-4"
            />
            {showDesktopLyrics && <DesktopLyricsPiP song={current} />}
            <Tooltip content="上报错误/提交意见">
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="mineradio-ctrl-btn"
                aria-label="上报错误/提交意见"
              >
                <Flag className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>

        <ErrorReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
      </div>
    );
  }

  const playerBarClass = barClassName
    ? `room-player-bar fixed bottom-0 left-0 right-0 z-40 border-t pb-[env(safe-area-inset-bottom,0px)] ${barClassName}`
    : transparentBar
      ? 'room-player-bar fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-black/25 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)]'
      : 'room-player-bar fixed bottom-0 left-0 right-0 z-40 glass border-t border-netease-border/50 pb-[env(safe-area-inset-bottom,0px)]';

  if (fmLoading || fmError) {
    return (
      <div className={playerBarClass} data-guide="room-player">
        <div className="py-1.5 -my-1.5">
          <ProgressBar
            progress={0}
            duration={0}
            onSeek={() => {}}
            disabled
            className="h-0.5"
            trackClassName="bg-netease-border"
            fillClassName="bg-netease-red"
          />
        </div>

        <div className="max-w-5xl mx-auto flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5">
          <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0 max-w-[38%] sm:max-w-[32%] min-w-0">
            <div className="flex h-10 w-10 sm:h-11 sm:w-11 flex-shrink-0 items-center justify-center rounded-lg bg-netease-card">
              {fmLoading ? <Loader2 className="h-4 w-4 animate-spin text-netease-red" /> : <Play className="h-4 w-4 text-netease-muted" />}
            </div>
            <div className="min-w-0 hidden sm:block">
              <p className="truncate text-sm font-medium text-netease-muted">私人漫游</p>
              <p className="truncate text-[11px] text-netease-muted/80 sm:text-xs">{fmError ? '暂未获取到歌曲' : '正在加载…'}</p>
            </div>
          </div>

          <div className="min-w-0 flex-1 px-1 text-center sm:px-2">
            <p role="status" className="text-xs font-medium leading-tight text-netease-muted sm:text-sm">{fmError || '正在加载私人漫游…'}</p>
            <p className="mt-0.5 truncate text-[10px] leading-tight text-netease-muted/70 sm:text-xs">{'\u00A0'}</p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
            <span className="hidden text-[10px] text-transparent sm:block">0:00</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10" aria-hidden>
              <Play className="ml-0.5 h-4 w-4 text-white/30" />
            </div>
            <div className="flex h-8 w-8 items-center justify-center" aria-hidden>
              <SkipForward className="h-4 w-4 text-white/20" />
            </div>
            <div className="h-8 w-8 flex-shrink-0" aria-hidden />
            <div className="h-8 w-8 flex-shrink-0" aria-hidden />
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;

  return (

    <div className={playerBarClass} data-guide="room-player" id="bottom-bar">

      {(skipError || skipMsg) && (

        <p className={`text-center text-[10px] py-0.5 ${skipMsg ? 'text-amber-400' : 'text-netease-red'}`}>
          {skipMsg || skipError}
        </p>

      )}

      <div className="py-1.5 -my-1.5">
        <PlaybackProgressBar
          song={current}
          onSeek={handleSeek}
          disabled={!canSeek}
          className="h-0.5"
          trackClassName="bg-netease-border"
          fillClassName="bg-netease-red"
        />
      </div>



      <div className="relative w-full">

        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">

        <button onClick={onExpand} className="flex min-w-0 flex-1 items-center gap-2 text-left sm:max-w-[32%] sm:flex-shrink-0 sm:gap-2.5">

          <SongCover
            song={current}
            size="tiny"
            eager
            className="hidden w-10 h-10 sm:block sm:w-11 sm:h-11 rounded-lg object-cover bg-netease-card flex-shrink-0"
          />

          <div className="min-w-0 block">

            <div className="flex min-w-0 items-center gap-1.5">
              <TruncateTip
                text={current.name}
                as="p"
                className="min-w-0 truncate text-sm font-medium"
              />
              <PlaybackQualityTag label={qualityLabel} source={displaySource} />
            </div>

            <p className="truncate text-[11px] text-netease-muted sm:text-xs">
              <span className="text-white/70">{current.artist}</span>
              <span>
                {' · '}
                {getSourceShortLabel(displaySource)}
                {current.requestedBy ? ` · ${current.requestedBy}点的歌` : ''}
              </span>
            </p>

          </div>

        </button>

        <MiniPlayerLyricTicker song={current} />

        <div className="ml-auto flex flex-shrink-0 items-center gap-1 sm:gap-2">

        <PlaybackTimeLabel
          song={current}
          className="text-[10px] text-netease-muted hidden sm:block"
        />



        <Tooltip content={canPause ? '暂停/播放' : (isPlaying ? '房主正在播放' : '房主已暂停')}>
          <button
            onClick={canPause ? handlePlayPause : undefined}
            disabled={trackLoading || !canPause}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-all disabled:opacity-70 ${canPause ? 'bg-white text-black hover:scale-105' : 'bg-white/10 text-white/70 cursor-not-allowed'}`}
            aria-label="播放控制"
          >
            {trackLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
        </Tooltip>

        {canControlPlayback ? (
          <Tooltip content="切歌">
            <button
              onClick={handleSkip}
              disabled={trackLoading}
              className="w-8 h-8 flex items-center justify-center text-netease-muted hover:text-white transition-colors disabled:opacity-50"
              aria-label="切歌"
            >
              {trackLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <SkipForward className="w-4 h-4" />
              )}
            </button>
          </Tooltip>
        ) : (
          <Tooltip content={hasPendingSkip ? '已申请切歌' : '申请切歌'}>
            <button
              onClick={handleRequestSkip}
              disabled={hasPendingSkip}
              className="w-8 h-8 flex items-center justify-center text-netease-muted hover:text-white transition-colors disabled:opacity-40"
              aria-label="申请切歌"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        <PlayModeButton className="h-10 w-10" iconClassName="h-4 w-4" />

        <VolumeControl compact className="flex-shrink-0" />
            <FavoriteButton song={current} className="w-8 h-8 text-netease-muted hover:text-rose-300" />
        {showDesktopLyrics && <DesktopLyricsPiP song={current} />}
        <Tooltip content="上报错误/提交意见">
          <button
            type="button"
            data-guide="room-report"
            onClick={() => setReportOpen(true)}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center text-netease-muted transition-colors hover:text-white"
            aria-label="上报错误/提交意见"
          >
            <Flag className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        </div>

        </div>

      </div>

      <ErrorReportModal open={reportOpen} onClose={() => setReportOpen(false)} />

    </div>

  );

});
