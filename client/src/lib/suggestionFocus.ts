export interface MusicSuggestionRequestState {
  enabled: boolean;
  focused: boolean;
  searching: boolean;
}

export function shouldRequestMusicSuggestions({
  enabled,
  focused,
  searching,
}: MusicSuggestionRequestState): boolean {
  return enabled && focused && !searching;
}
