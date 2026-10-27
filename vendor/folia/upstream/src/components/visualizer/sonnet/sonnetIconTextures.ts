import type { SonnetTuning, Theme } from '../../../types';
import { buildSonnetIconDataUrl, buildSonnetIconTextureKey, loadSonnetIconNames } from './sonnetIcons';
import { getSonnetTexturePool } from './sonnetTexturePool';

// src/components/visualizer/sonnet/sonnetIconTextures.ts
// 主题图标纹理：按主题从共享纹理池引用计数地取用，换歌时先取新主题的再放旧的，运行时销毁时全部归还。
type PixiModule = typeof import('pixi.js');

export interface SonnetIconTextures {
    textures: Map<string, import('pixi.js').Texture>;
    urls: Set<string>;
}

/**
 * Acquires the decor icon textures a theme asks for. Kept separate from the live maps so a
 * song handover can warm the incoming theme's icons while the outgoing one is still on
 * screen, and only adopt them once the cover hides the swap.
 */
export const loadSonnetIconTextures = async (
    pixi: PixiModule,
    theme: Theme,
    tuning: SonnetTuning,
): Promise<SonnetIconTextures> => {
    const loaded: SonnetIconTextures = { textures: new Map(), urls: new Set() };
    if (tuning.showOnlyText || !tuning.showBackgroundDecor) return loaded;
    const names = await loadSonnetIconNames(theme.lyricsIcons);
    const resolution = tuning.textureResolution;
    const texturePool = getSonnetTexturePool(pixi);
    await Promise.all(names.map(async (name, index) => {
        const size = 192 + (index % 4) * 32;
        const colors = [
            theme.accentColor,
            theme.secondaryColor,
            theme.primaryColor,
        ];
        const color = colors[index % colors.length];
        const key = buildSonnetIconTextureKey(name, color, 3.5, size, resolution);
        const url = buildSonnetIconDataUrl(name, color, 3.5, size);
        if (!url) return;
        try {
            loaded.textures.set(key, await texturePool.acquire(url));
            loaded.urls.add(url);
        } catch {
            // Invalid theme icons are optional; geometric MG remains available.
        }
    }));
    return loaded;
};

/** Hands the pool back the urls this runtime is holding. Refcounted, so order does not matter. */
export const releaseSonnetIconUrls = (pixi: PixiModule, urls: Set<string>) => {
    const texturePool = getSonnetTexturePool(pixi);
    urls.forEach(url => {
        texturePool.release(url);
    });
    urls.clear();
};
