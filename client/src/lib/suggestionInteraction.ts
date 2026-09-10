export function buildSuggestionSearchText(suggestion: { name?: string; artist?: string }): string {
  return [suggestion.name, suggestion.artist]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

export function preserveSearchFocusOnSuggestionPointerDown(event: Pick<PointerEvent, 'preventDefault'>): void {
  event.preventDefault();
}
