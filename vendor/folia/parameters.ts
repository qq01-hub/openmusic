import type { Theme } from './upstream/src/types';
import { parseColorChannels } from './upstream/src/components/visualizer/colorMix';

export const DEFAULT_FOLIA_THEME: Theme = {
  name: 'OpenMusic', backgroundColor: '#12141c', primaryColor: '#f4f2ea', accentColor: '#b7caff',
  secondaryColor: '#c9c2d6', fontStyle: 'sans', fontWeight: 600, animationIntensity: 'normal',
};

export function normalizeFoliaTheme(value: unknown, fallback: Theme = DEFAULT_FOLIA_THEME): Theme {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const theme = { ...fallback };
  for (const key of ['backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'] as const) {
    const color = typeof input[key] === 'string' ? parseColorChannels(input[key]) : null;
    if (color) theme[key] = '#' + [color.r, color.g, color.b].map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('');
  }
  if (['sans', 'serif', 'mono'].includes(String(input.fontStyle))) theme.fontStyle = input.fontStyle as Theme['fontStyle'];
  if (['calm', 'normal', 'chaotic'].includes(String(input.animationIntensity))) theme.animationIntensity = input.animationIntensity as Theme['animationIntensity'];
  if (typeof input.fontWeight === 'number' && Number.isFinite(input.fontWeight)) theme.fontWeight = Math.max(300, Math.min(900, Math.round(input.fontWeight / 100) * 100));
  return theme;
}
