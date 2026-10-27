import { useEffect } from 'react';
import { useVisualizerAssetStore } from './upstream/src/stores/useVisualizerAssetStore';
import { getCustomCappellaEmojiPack } from './upstream/src/services/cappellaEmojiPack';
import { getCustomCappellaAvatar } from './upstream/src/services/cappellaAvatarPack';
import { getMonetBackgroundImage } from './upstream/src/services/monetBackgroundImage';
import { getMonetPortraitImage } from './upstream/src/services/monetPortraitImage';

export function useFoliaAssets() {
  const assets = useVisualizerAssetStore();
  useEffect(() => {
    let disposed = false;
    const restore = async () => {
      const restored = await Promise.allSettled([getCustomCappellaEmojiPack(), getCustomCappellaAvatar(), getMonetBackgroundImage(), getMonetPortraitImage()]);
      if (disposed) return;
      const value = (index: number, fallback: unknown) => { const result = restored[index]; return result.status === 'fulfilled' ? result.value : fallback; };
      useVisualizerAssetStore.setState({
        storedCappellaEmojiPack: value(0, []) as typeof assets.storedCappellaEmojiPack,
        storedCappellaAvatarPack: value(1, []) as typeof assets.storedCappellaAvatarPack,
        storedMonetBackgroundImage: value(2, null) as typeof assets.storedMonetBackgroundImage,
        storedMonetPortraitImage: value(3, null) as typeof assets.storedMonetPortraitImage,
        isLoadingCappellaCustomEmojiPack: false, isLoadingCappellaCustomAvatarPack: false,
        isLoadingMonetBackgroundImage: false, isLoadingMonetPortraitImage: false,
      });
    };
    void restore();
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    const urls: string[] = [];
    const image = (stored: { id: string; name: string; blob: Blob } | null) => {
      if (!stored?.blob) return null;
      const url = URL.createObjectURL(stored.blob);
      urls.push(url);
      return { id: stored.id, name: stored.name, url };
    };
    useVisualizerAssetStore.setState({
      cappellaCustomEmojiImages: assets.storedCappellaEmojiPack.map(image).filter((value): value is NonNullable<typeof value> => value !== null),
      cappellaCustomAvatarImages: assets.storedCappellaAvatarPack.map(image).filter((value): value is NonNullable<typeof value> => value !== null),
      monetBackgroundImage: image(assets.storedMonetBackgroundImage),
      monetPortraitImage: image(assets.storedMonetPortraitImage),
    });
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [assets.storedCappellaEmojiPack, assets.storedCappellaAvatarPack, assets.storedMonetBackgroundImage, assets.storedMonetPortraitImage]);
  return assets;
}
