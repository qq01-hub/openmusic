import { type Line } from '../../../types';

// src/components/visualizer/cappella/cappellaTypes.ts
// Cappella 聊天流的消息类型（标题 / 歌词 / 表情）、强度配置与气泡测量结果。

export type ChatSide = 'left' | 'right';

interface CappellaLineMessage {
    id: string;
    kind: 'lyric';
    line: Line;
    lineIndex: number;
    side: ChatSide;
    avatarIndex: number;
}

interface CappellaEmoMessage {
    id: string;
    kind: 'emo';
    line: Line;
    lineIndex: number;
    side: ChatSide;
    avatarIndex: number;
    /** 表情图片的 resolved URL */
    emoImageUrl: string;
    activationStartTime: number;
    activationEndTime: number;
}

interface CappellaTitleMessage {
    id: string;
    kind: 'title';
    text: string;
    side: ChatSide;
    avatarIndex: number;
}

export type CappellaMessage = CappellaTitleMessage | CappellaLineMessage | CappellaEmoMessage;

/** 带有 line/lineIndex 的消息（lyric 和 emo），用于类型窄化 */
export type CappellaTimedMessage = CappellaLineMessage | CappellaEmoMessage;

export const isTimedMessage = (m: CappellaMessage): m is CappellaTimedMessage =>
    m.kind === 'lyric' || m.kind === 'emo';

// Disabled for now: AI semantic word coloring reduced bubble-text readability in cappella.
// const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);
export interface BubbleSize {
    width: number;
    height: number;
}

export interface CappellaIntensityConfig {
    sequencing: {
        forceRightEveryLines: number;
        shortLineCarryChance: number;
        sideSequence: ChatSide[];
        sideFlipChance: number;
        randomEmoChance: number;
        minLinesBetweenRandomEmos: number;
        maxRandomEmoRatio: number;
    };
    motion: {
        rowEnterY: number;
        rowEnterScale: number;
        rowEnterDuration: number;
        rowExitY: number;
        rowExitScale: number;
        rowExitDuration: number;
        avatarSpring: { stiffness: number; damping: number; mass: number; };
        activeScale: number;
        passedScale: number;
        passedOpacity: number;
        activeFontMultiplier: number;
        inactiveFontMultiplier: number;
        activePaddingX: number;
        activePaddingY: number;
        inactivePaddingX: number;
        inactivePaddingY: number;
        activeMinHeight: number;
        inactiveMinHeight: number;
        glowOpacity: number;
        glowDuration: number;
        glowRightAlpha: number;
        glowLeftAlpha: number;
        activeShadowAlpha: number;
        emoActiveSize: number;
        emoInactiveSize: number;
        emoEnterScale: number;
        emoSizeTransitionDuration: number;
    };
}

export interface PreparedBubbleMetrics {
    /** fullText 按 grapheme 拆出的显示字符，sizes 的下标与它的数量对应 */
    characters: string[];
    /** sizes[n] 表示显示前 n 个字符时气泡应该拥有的 width/height */
    sizes: BubbleSize[];
    /** 每个字符真实开始显示的时间，用来驱动文字 reveal */
    revealTimes: number[];
    /** revealTimes 整体提前一段时间，用来驱动气泡提前横向扩展 */
    bubbleTargetTimes: number[];
    /** 歌词最后一个字符完成淡入的时间，用来控制时间戳出现时机 */
    timestampReadyTime: number;
}

export interface CharacterRevealPlan {
    characters: string[];
    fadeDurationsMs: number[];
}
