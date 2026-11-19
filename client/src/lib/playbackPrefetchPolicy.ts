export function shouldPrefetchCurrentSong(room: { isPlaying: boolean }): boolean {
  return room.isPlaying;
}
