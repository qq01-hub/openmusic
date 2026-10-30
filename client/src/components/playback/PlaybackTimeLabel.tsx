import { memo } from 'react';
import { formatDuration } from '../../api/music';
import type { QueueItem, Song } from '../../types';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackDuration, clampPlaybackTime } from '../../hooks/useTrackDuration';

type TrackLike = Pick<QueueItem, 'duration' | 'id' | 'source' | 'queueId'> | Pick<Song, 'duration' | 'id' | 'source'> | null;

interface Props {
  song: TrackLike;
  className?: string;
  showDuration?: boolean;
  mode?: 'both' | 'elapsed' | 'duration';
}

function PlaybackElapsedTime({
  song,
  className = '',
  showDuration = true,
  mode,
}: Props) {
  const currentTime = useSmoothPlaybackTime();
  const duration = useTrackDuration(song);
  const displayTime = clampPlaybackTime(currentTime, duration);
  const resolvedMode = mode ?? (showDuration ? 'both' : 'elapsed');

  if (resolvedMode === 'elapsed') {
    return <span className={className}>{formatDuration(displayTime)}</span>;
  }
  return (
    <span className={className}>
      {formatDuration(displayTime)}
      {duration > 0 ? ` / ${formatDuration(duration)}` : ''}
    </span>
  );
}

function PlaybackDurationTime({ song, className = '' }: Pick<Props, 'song' | 'className'>) {
  const duration = useTrackDuration(song);
  return <span className={className}>{duration > 0 ? formatDuration(duration) : '--:--'}</span>;
}

const MemoPlaybackElapsedTime = memo(PlaybackElapsedTime);
const MemoPlaybackDurationTime = memo(PlaybackDurationTime);

function PlaybackTimeLabel({ song, className = '', showDuration = true, mode }: Props) {
  const resolvedMode = mode ?? (showDuration ? 'both' : 'elapsed');
  if (resolvedMode === 'duration') {
    return <MemoPlaybackDurationTime song={song} className={className} />;
  }
  return <MemoPlaybackElapsedTime song={song} className={className} mode={resolvedMode} />;
}

export default memo(PlaybackTimeLabel);
