import type { PaperShaderElement } from '@paper-design/shaders';

// src/utils/paperShaderUniforms.ts
// paper-shaders 的 uniform 写入：shader 自己在跑帧循环时只写值、不当场重画，避免每帧画两遍全屏。

export type PaperShaderMount = NonNullable<PaperShaderElement['paperShaderMount']>;
export type PaperShaderUniforms = Parameters<PaperShaderMount['setUniforms']>[0];

/**
 * Pushes uniforms to a shader without drawing it. `setUniforms` renders the whole shader on the
 * spot and re-arms the shader's own frame loop, which then draws it again on the next frame - two
 * full passes for one update. While the shader animates (speed not 0), its loop picks the new
 * values up on its next draw; a stopped shader has no loop, so it still gets the immediate draw.
 * `setUniformValues` is the mount's own uniform writer, private only in its typings; if a future
 * version drops it, this falls back to `setUniforms`.
 */
export const updatePaperShaderUniforms = (
    mount: PaperShaderMount,
    uniforms: PaperShaderUniforms,
    animating: boolean,
) => {
    const writer = (mount as unknown as { setUniformValues?: (values: PaperShaderUniforms) => void }).setUniformValues;
    if (animating && typeof writer === 'function') {
        writer(uniforms);
        return;
    }
    mount.setUniforms(uniforms);
};
