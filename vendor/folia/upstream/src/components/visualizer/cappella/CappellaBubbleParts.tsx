import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { type Line, type Theme } from '../../../types';
import type { CappellaIntensityConfig, CappellaMessage, ChatSide } from './cappellaTypes';
import { DEFAULT_CHAR_FADE_MS, LEFT_AVATAR_INDICES, RIGHT_AVATAR_INDEX } from './cappellaConstants';
import { getCharacterRevealPlan } from './cappellaReveal';
import { formatTimestamp, getAvatarPosition } from './cappellaMessageLayout';

// src/components/visualizer/cappella/CappellaBubbleParts.tsx
// 气泡内的小组件：头像、文字、时间戳、尺寸动画外框、逐字出现的正文与气泡 glow。

export const CappellaAvatar: React.FC<{
    avatarUrl?: string | null;
    avatarIndex: number;
    theme: Theme;
    side: ChatSide;
    useAvatarGridCrop: boolean;
}> = ({ avatarUrl, avatarIndex, theme, side, useAvatarGridCrop }) => {
    const shouldUseAvatarGridCrop = useAvatarGridCrop || !avatarUrl;
    const resolvedIndex = shouldUseAvatarGridCrop
        ? (side === 'right' ? RIGHT_AVATAR_INDEX : LEFT_AVATAR_INDICES[avatarIndex % LEFT_AVATAR_INDICES.length])
        : avatarIndex;
    const avatarPosition = getAvatarPosition(resolvedIndex);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="h-10 w-10 shrink-0 overflow-hidden rounded-full border shadow-lg"
            style={{
                borderColor: 'rgba(255,255,255,0.24)',
                backgroundColor: theme.secondaryColor,
                backgroundImage: avatarUrl
                    ? `url("${avatarUrl}")`
                    : `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
                backgroundClip: 'padding-box',
                backgroundPosition: shouldUseAvatarGridCrop ? avatarPosition.backgroundPosition : 'center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: shouldUseAvatarGridCrop ? avatarPosition.backgroundSize : 'cover',
            }}
        />
    );
};

export const CappellaText: React.FC<{
    message: CappellaMessage;
}> = ({ message }) => {
    if (message.kind === 'title') {
        return <>{message.text}</>;
    }

    if (message.kind === 'emo') {
        return null;
    }

    return <>{message.line.fullText}</>;
};

export const CappellaTimestamp: React.FC<{
    line: Line;
    color: string;
    isVisible: boolean;
    style?: React.CSSProperties;
}> = ({ line, color, isVisible, style }) => {
    if (!isVisible) {
        return null;
    }

    return (
        <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 0.62, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="pointer-events-none absolute text-[11px] font-medium tabular-nums"
            style={{ color, ...style }}
        >
            {formatTimestamp(line.endTime)}
        </motion.span>
    );
};

export const AnimatedBubbleFrame: React.FC<{
    children: React.ReactNode;
    className: string;
    floatingAdornment?: React.ReactNode;
    targetSize?: { width: number; height: number; };
    style: React.CSSProperties;
}> = ({ children, className, floatingAdornment, targetSize, style }) => {
    return (
        <motion.div
            className="relative shrink-0"
            animate={{
                ...(targetSize ? {
                    width: targetSize.width,
                    height: targetSize.height,
                } : {}),
            }}
            transition={{
                scale: {
                    type: 'spring',
                    stiffness: 340,
                    damping: 28,
                    mass: 0.72,
                },
                ...(targetSize ? {
                    width: { duration: 0.2, ease: 'easeOut' as const },
                    height: { duration: 0.2, ease: 'easeOut' as const },
                } : {}),
            }}
            style={{
                width: targetSize ? targetSize.width : 'fit-content',
                height: targetSize ? targetSize.height : 'auto',
            }}
        >
            <div
                className={className}
                style={{
                    ...style,
                    height: targetSize ? '100%' : 'auto',
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                }}
            >
                {children}
            </div>
            {floatingAdornment}
        </motion.div>
    );
};

export const ActiveCappellaText: React.FC<{
    line: Line;
    visibleCharacterCount: number;
}> = ({ line, visibleCharacterCount }) => {
    const revealPlan = useMemo(() => getCharacterRevealPlan(line), [line]);
    const visibleCharacters = revealPlan.characters.slice(0, Math.max(0, visibleCharacterCount));
    const visibleFadeDurations = revealPlan.fadeDurationsMs.slice(0, Math.max(0, visibleCharacterCount));

    return (
        // 保持普通 inline 文本流，使 DOM 的字形塑形和换行规则与 pretext 的连续文本量度一致。
        <span>
            {visibleCharacters.map((character, index) => (
                <span
                    key={`${index}-${character}`}
                    style={{
                        animationName: 'cappella-char-fade',
                        animationDuration: `${visibleFadeDurations[index] ?? DEFAULT_CHAR_FADE_MS}ms`,
                        animationTimingFunction: 'ease-out',
                    }}
                >
                    {character}
                </span>
            ))}
        </span>
    );
};

export const CappellaBubbleGlow: React.FC<{
    isActive: boolean;
    isRight: boolean;
    motionConfig: CappellaIntensityConfig['motion'];
}> = ({ isActive, isRight, motionConfig }) => {
    if (!isActive) {
        return null;
    }

    const glowAlpha = isRight ? motionConfig.glowRightAlpha : motionConfig.glowLeftAlpha;
    const glowColor = `rgba(255,255,255,${glowAlpha})`;

    return (
        <div
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{
                width: '200%',
                opacity: motionConfig.glowOpacity,
                // Duplicate one broad sweep in each half so translateX(0) and translateX(-50%) match exactly.
                background: `linear-gradient(105deg, transparent 0%, ${glowColor} 23%, transparent 34%, transparent 50%, transparent 50%, ${glowColor} 73%, transparent 84%, transparent 100%)`,
                animation: `cappella-bubble-glow-pan ${motionConfig.glowDuration}s linear infinite`,
                willChange: 'transform',
            }}
        />
    );
};
