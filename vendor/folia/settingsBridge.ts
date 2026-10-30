export type FoliaSettingsSection = 'lyrics' | 'background' | 'appearance';
export type FoliaSettingsHost = { content: HTMLElement; portal: HTMLElement; section: FoliaSettingsSection };
export const FOLIA_SETTINGS_ATTACHED_EVENT = 'openmusic:folia-settings-attached';
export const FOLIA_SETTINGS_HOST_EVENT = 'openmusic:folia-settings-host';
export const isFoliaSettingsSection = (value: unknown): value is FoliaSettingsSection => ['lyrics', 'background', 'appearance'].includes(String(value));
