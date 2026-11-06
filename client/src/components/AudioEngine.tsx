import { memo, useEffect } from 'react';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { usePrefetchTrackDuration } from '../hooks/usePrefetchTrackDuration';
import { useAudioStore } from '../stores/audioStore';
import { applyAllAudioVolume } from '../lib/audioVolume';
import AudioUnlockOverlay from './AudioUnlockOverlay';

interface Props {
  tvMode?: boolean;
}

export default memo(function AudioEngine({ tvMode = false }: Props) {
  const volume = useAudioStore((s) => s.volume);
  useAudioPlayer({ tvMode });
  usePrefetchTrackDuration();

  useEffect(() => {
    applyAllAudioVolume(volume);
  }, [volume]);

  return <AudioUnlockOverlay tvMode={tvMode} />;
});
