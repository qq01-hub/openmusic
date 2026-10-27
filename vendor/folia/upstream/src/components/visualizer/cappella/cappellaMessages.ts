import { type CappellaEmojiImage, type CappellaTuning, type Line } from '../../../types';
import { getLineRenderEndTime, getLineRenderHints } from '../../../utils/lyrics/renderHints';
import { createCappellaAgentSenderResolver, type CappellaMessageSender } from './cappellaMessageSenders';
import type { CappellaIntensityConfig, CappellaMessage } from './cappellaTypes';
import { AVATAR_GRID_SIZE, INTERLUDE_TEXT, LEFT_AVATAR_INDICES, RIGHT_AVATAR_INDEX, SHORT_LINE_CHAR_LIMIT } from './cappellaConstants';

// src/components/visualizer/cappella/cappellaMessages.ts
// 把歌词行编排成确定性的聊天消息流：发送者、左右侧、表情回复，同一首歌每次都一样。

const countCompactChars = (text: string) => Array.from(text.replace(/\s/g, '')).length;

const hashString = (input: string) => {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const seededUnit = (...parts: Array<string | number>) => hashString(parts.join('|')) / 0xffffffff;

const pickStableEmoImage = (imagePool: CappellaEmojiImage[], ...seedParts: Array<string | number>) => {
    if (imagePool.length === 0) {
        return null;
    }

    const index = Math.floor(seededUnit(...seedParts) * imagePool.length) % imagePool.length;
    return imagePool[index] ?? imagePool[0];
};

const getEffectiveRenderEndTime = (line: Line, nextLine?: Line) =>
    Math.min(getLineRenderEndTime(line), nextLine?.startTime ?? Number.POSITIVE_INFINITY);

// Assigns stable chat senders and reaction emojis so the conversation stays deterministic per song.
export const buildCappellaMessages = (
    lines: Line[],
    titleText: string,
    config: CappellaIntensityConfig,
    tuning: CappellaTuning,
    emoImagePool: CappellaEmojiImage[],
    forcePreviewEmo: boolean,
): CappellaMessage[] => {
    const messages: CappellaMessage[] = [{
        id: 'title',
        kind: 'title',
        text: titleText,
        side: 'right',
        avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1,
    }];

    const showEmoMessages = tuning.showEmoMessages && emoImagePool.length > 0;

    if (lines.length === 0) {
        const fallbackEmo = showEmoMessages
            ? pickStableEmoImage(emoImagePool, 'no-lyrics', titleText, config.sequencing.forceRightEveryLines)
            : null;
        if (fallbackEmo && showEmoMessages) {
            messages.push({
                id: 'emo-no-lyrics',
                kind: 'emo',
                line: {
                    words: [],
                    startTime: 0,
                    endTime: 0,
                    fullText: INTERLUDE_TEXT,
                },
                lineIndex: 0,
                side: 'right',
                avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1,
                emoImageUrl: fallbackEmo.url,
                activationStartTime: 0,
                activationEndTime: 999999,
            });
        }

        return messages;
    }

    let sideSequenceCursor = 0;
    let nextLeftAvatarCursor = 0;
    let lastLyricSender: CappellaMessageSender | null = null;
    let lyricMessagesSinceRandomEmo = Number.POSITIVE_INFINITY;
    let randomEmoCount = 0;
    const randomEmoCap = Math.floor(lines.length * config.sequencing.maxRandomEmoRatio);
    const agentSenderResolver = createCappellaAgentSenderResolver(lines, {
        rightAvatarIndex: RIGHT_AVATAR_INDEX,
        leftAvatarCount: LEFT_AVATAR_INDICES.length,
    });

    lines.forEach((line, lineIndex) => {
        const nextLine = lines[lineIndex + 1];
        const isShortLine = countCompactChars(line.fullText) <= SHORT_LINE_CHAR_LIMIT;
        const agentSender = agentSenderResolver?.resolve(line) ?? null;
        const shouldForceRight = !agentSender && (lineIndex + 1) % config.sequencing.forceRightEveryLines === 0;
        const shouldCarrySender = Boolean(!agentSender
            && isShortLine
            && lastLyricSender
            && seededUnit('carry', line.startTime, lineIndex) <= config.sequencing.shortLineCarryChance);
        const baseSide = config.sequencing.sideSequence[sideSequenceCursor % config.sequencing.sideSequence.length];
        const shouldFlipSide = !shouldForceRight
            && seededUnit('flip', line.startTime, lineIndex) < config.sequencing.sideFlipChance;
        const resolvedSide = shouldFlipSide
            ? (baseSide === 'left' ? 'right' : 'left')
            : baseSide;
        let sender: CappellaMessageSender;
        if (agentSender) {
            sender = agentSender;
        } else if (shouldForceRight) {
            sender = {
                side: 'right' as const,
                avatarIndex: RIGHT_AVATAR_INDEX,
            };
        } else if (shouldCarrySender && lastLyricSender) {
            sender = lastLyricSender;
        } else {
            sender = {
                side: resolvedSide,
                avatarIndex: resolvedSide === 'left'
                    ? nextLeftAvatarCursor
                    : RIGHT_AVATAR_INDEX,
            };
        }

        const isInterlude = line.fullText === INTERLUDE_TEXT;
        const emoImage = isInterlude && showEmoMessages
            ? pickStableEmoImage(emoImagePool, 'interlude', line.startTime, lineIndex)
            : null;
        const effectiveRenderEndTime = getEffectiveRenderEndTime(line, nextLine);
        if (isInterlude && emoImage && showEmoMessages) {
            messages.push({
                id: `emo-${line.startTime}-${lineIndex}`,
                kind: 'emo',
                line,
                lineIndex,
                side: sender.side,
                avatarIndex: sender.avatarIndex,
                emoImageUrl: emoImage.url,
                activationStartTime: line.startTime,
                activationEndTime: Math.max(line.startTime + 0.12, effectiveRenderEndTime),
            });
        } else {
            messages.push({
                id: `line-${line.startTime}-${lineIndex}`,
                kind: 'lyric',
                line,
                lineIndex,
                side: sender.side,
                avatarIndex: sender.avatarIndex,
            });
        }
        lyricMessagesSinceRandomEmo += 1;

        const renderHints = getLineRenderHints(line);
        const canAppendRandomEmo = !isInterlude
            && showEmoMessages
            && config.sequencing.randomEmoChance > 0
            && randomEmoCount < randomEmoCap
            && lyricMessagesSinceRandomEmo >= config.sequencing.minLinesBetweenRandomEmos
            && renderHints?.timingClass === 'normal';

        if (canAppendRandomEmo) {
            const score = seededUnit('random-emo', line.startTime, line.endTime, lineIndex, config.sequencing.randomEmoChance);
            if (score < config.sequencing.randomEmoChance) {
                const reactionImage = pickStableEmoImage(emoImagePool, 'reaction', line.startTime, line.endTime, lineIndex, sender.side);
                if (reactionImage) {
                    messages.push({
                        id: `emo-reaction-${line.startTime}-${lineIndex}`,
                        kind: 'emo',
                        line,
                        lineIndex,
                        side: sender.side,
                        avatarIndex: sender.avatarIndex,
                        emoImageUrl: reactionImage.url,
                        activationStartTime: line.endTime,
                        activationEndTime: Math.max(line.endTime + 0.08, effectiveRenderEndTime),
                    });
                    randomEmoCount += 1;
                    lyricMessagesSinceRandomEmo = 0;
                }
            }
        }

        if (agentSender) {
            lastLyricSender = sender;
        } else if (shouldForceRight) {
            sideSequenceCursor = 0;
            lastLyricSender = null;
        } else if (!shouldCarrySender) {
            if (sender.side === 'left') {
                nextLeftAvatarCursor += 1;
            }
            sideSequenceCursor += 1;
            lastLyricSender = sender;
        } else {
            lastLyricSender = sender;
        }
    });

    if (
        forcePreviewEmo
        && showEmoMessages
        && !messages.some(message => message.kind === 'emo')
    ) {
        const previewLine = lines[0] ?? {
            words: [],
            startTime: 0,
            endTime: 0,
            fullText: INTERLUDE_TEXT,
        };
        const previewEmo = pickStableEmoImage(emoImagePool, 'preview-emo', titleText, lines.length);
        if (previewEmo) {
            messages.splice(1, 0, {
                id: 'emo-preview',
                kind: 'emo',
                line: previewLine,
                lineIndex: -1,
                side: 'right',
                avatarIndex: RIGHT_AVATAR_INDEX,
                emoImageUrl: previewEmo.url,
                activationStartTime: 0,
                activationEndTime: Number.POSITIVE_INFINITY,
            });
        }
    }

    return messages;
};
