export const AI_PERSONA_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}[];
export const MAX_CUSTOM_ROOM_AI_PERSONA_LENGTH: number;
export const ROOM_AI_SHARED_CHAT_STYLE: string;
export function isRoomAiPersonaAllowed(value: string): boolean;
