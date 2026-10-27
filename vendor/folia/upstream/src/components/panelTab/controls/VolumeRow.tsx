import React, { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PanelIconButton } from '../shell/PanelIconButton';
import { PanelSlider } from './PanelSlider';

// src/components/panelTab/controls/VolumeRow.tsx
// 单行音量：静音、滑杆、百分比。拖动时只预听，松手才把音量记下来。

interface VolumeRowProps {
    volume: number;
    isMuted: boolean;
    onVolumePreview: (val: number) => void;
    onVolumeChange: (val: number) => void;
    onToggleMute: () => void;
}

const VolumeRow: React.FC<VolumeRowProps> = ({
    volume,
    isMuted,
    onVolumePreview,
    onVolumeChange,
    onToggleMute,
}) => {
    const { t } = useTranslation();
    const [sliderVolume, setSliderVolume] = useState(isMuted ? 0 : volume);
    const isDraggingRef = useRef(false);
    const pendingVolumeRef = useRef(sliderVolume);

    useEffect(() => {
        if (!isDraggingRef.current) {
            const nextVolume = isMuted ? 0 : volume;
            setSliderVolume(nextVolume);
            pendingVolumeRef.current = nextVolume;
        }
    }, [volume, isMuted]);

    const handleSliderInput = (nextVolume: number) => {
        isDraggingRef.current = true;
        pendingVolumeRef.current = nextVolume;
        setSliderVolume(nextVolume);
        onVolumePreview(nextVolume);
    };

    const commitVolumeChange = () => {
        if (!isDraggingRef.current) {
            return;
        }
        isDraggingRef.current = false;
        onVolumeChange(pendingVolumeRef.current);
    };

    // 拖到一半这一页就没了（面板关掉、换了标签页）：把正在试听的音量记下来，不然下次调音量会跳回去。
    const onVolumeChangeRef = useRef(onVolumeChange);
    useEffect(() => {
        onVolumeChangeRef.current = onVolumeChange;
    }, [onVolumeChange]);
    useEffect(() => () => {
        if (isDraggingRef.current) {
            onVolumeChangeRef.current(pendingVolumeRef.current);
        }
    }, []);

    const percent = `${Math.round(sliderVolume * 100)}%`;

    return (
        <div className="flex h-10 items-center gap-2">
            <PanelIconButton
                label={t('ui.volume')}
                onClick={(event) => {
                    event.stopPropagation();
                    onToggleMute();
                }}
            >
                {isMuted || sliderVolume === 0 ? <VolumeX size={17} /> : sliderVolume < 0.5 ? <Volume1 size={17} /> : <Volume2 size={17} />}
            </PanelIconButton>

            <PanelSlider
                value={sliderVolume}
                onPreview={handleSliderInput}
                onCommit={commitVolumeChange}
                label={t('ui.volume')}
                valueText={percent}
            />

            <span className="w-[38px] shrink-0 text-right text-xs tabular-nums text-[color:var(--st-t2)]">
                {percent}
            </span>
        </div>
    );
};

export default VolumeRow;
