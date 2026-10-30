let pending = false;

export function isHumanCheckPending(): boolean {
  return pending;
}

export function markHumanCheckPending(): void {
  pending = true;
}

export function clearHumanCheckPending(): void {
  pending = false;
}
