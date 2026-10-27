import type { SonnetTuning, Theme } from '../../../types';
import { destroySonnetContainerChildren } from './sonnetPixiResources';

// src/components/visualizer/sonnet/sonnetFrameOverlay.ts
// 场景之上的画框层：左上 / 右下的非对称角标、十字、菱形与 ✦。随 outerFrameMode 与仅文字模式开关。
type PixiModule = typeof import('pixi.js');

/** Redraws the overlay container's frame marks for the given viewport, freeing the previous ones. */
export const drawSonnetFrameOverlay = (
    pixi: PixiModule,
    container: import('pixi.js').Container,
    width: number,
    height: number,
    tuning: SonnetTuning,
    theme: Theme,
) => {
    destroySonnetContainerChildren(container);
    if (tuning.showOnlyText || tuning.outerFrameMode === 'none') return;
    const g = new pixi.Graphics();

    const paddingX = Math.max(30, width * 0.05);
    const paddingY = Math.max(30, height * 0.05);

    const primary = pixi.Color.shared.setValue(theme.primaryColor).toNumber();
    const alpha = 0.5;

    // Asymmetrical, partial perimeter (Not enclosing the whole screen)
    // 1. Top-Left cluster
    g.rect(paddingX, paddingY, 30, 4).fill({ color: primary, alpha: 0.8 }); // Thick bar
    g.moveTo(paddingX, paddingY + 16).lineTo(paddingX, paddingY + 120).stroke({ color: primary, width: 1, alpha }); // Dropping line

    // 2. Bottom-Right cluster
    g.rect(width - paddingX - 4, height - paddingY - 16, 4, 16).fill({ color: primary, alpha: 0.8 }); // Thick vertical bar
    g.moveTo(width - paddingX - 160, height - paddingY).lineTo(width - paddingX - 20, height - paddingY).stroke({ color: primary, width: 1, alpha }); // Horizontal line
    g.moveTo(width - paddingX, height - paddingY - 180).lineTo(width - paddingX, height - paddingY - 30).stroke({ color: primary, width: 1, alpha }); // Rising line

    // 3. Floating accents
    const drawCross = (cx: number, cy: number, size: number) => {
        g.moveTo(cx - size, cy).lineTo(cx + size, cy).stroke({ color: primary, width: 1, alpha: 0.8 });
        g.moveTo(cx, cy - size).lineTo(cx, cy + size).stroke({ color: primary, width: 1, alpha: 0.8 });
    };
    // Top-Right cross
    drawCross(width - paddingX, paddingY + 20, 6);

    // Bottom-Left diamond
    g.moveTo(paddingX, height - paddingY - 4).lineTo(paddingX + 4, height - paddingY).lineTo(paddingX, height - paddingY + 4).lineTo(paddingX - 4, height - paddingY).fill({ color: primary, alpha: 0.7 });

    // Typographic star ✦
    const starStyle = new pixi.TextStyle({
        fontFamily: 'sans-serif',
        fontSize: 12,
        fill: primary,
    });
    const starText = new pixi.Text({ text: '✦', style: starStyle });
    starText.alpha = 0.6;
    starText.position.set(width - paddingX - 10, height - paddingY);
    starText.anchor.set(1, 0.5);

    container.addChild(g, starText);
};
