export const DESK_PET_AI_ACTIONS = ['speak', 'perform', 'feed', 'pat', 'sleep', 'wake', 'show_ledger', 'focus_start', 'focus_stop', 'interact', 'prepare_slingshot'] as const;
export const DESK_PET_AI_INTERACTIONS = ['ponder_button', 'sneak_click', 'surf_progress', 'fish_queue', 'dj_cover', 'treasure_hot', 'perch_chat'] as const;
export type DeskPetAiAction = typeof DESK_PET_AI_ACTIONS[number];
export type DeskPetAiInteraction = typeof DESK_PET_AI_INTERACTIONS[number];
export interface DeskPetAiArgs {
  action?: DeskPetAiAction;
  animationId?: string;
  interaction?: DeskPetAiInteraction;
  text?: string;
  keyword?: string;
  offset?: number;
}
export interface DeskPetAiResult {
  success: boolean;
  code?: string;
  error?: string;
  status?: 'started' | 'shown' | 'unchanged';
  action?: DeskPetAiAction;
  state?: {
    character: string;
    label: string;
    activity: string;
    capabilities: DeskPetAiAction[];
    interactions: DeskPetAiInteraction[];
    actions: { id: string; label: string }[];
    nextOffset: number | null;
    focusRemainingSeconds: number;
    songsListenedCount: number;
    listenSeconds: number;
    interactionCount: number;
    energy: number;
    mood: number;
  };
}
type Command = 'get_state' | 'control';
type Handler = (command: Command, args: DeskPetAiArgs) => DeskPetAiResult;
let handler: Handler | null = null;
const completed = new Map<string, { fingerprint: string; expiresAt: number; result: DeskPetAiResult }>();

export function registerDeskPetHandler(next: Handler) {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

function validArgs(command: Command, args: Record<string, unknown>): boolean {
  if (command === 'get_state') return Object.keys(args).every(key => ['keyword', 'offset'].includes(key))
    && (args.keyword === undefined || typeof args.keyword === 'string' && args.keyword.length <= 30)
    && (args.offset === undefined || Number.isInteger(args.offset) && Number(args.offset) >= 0 && Number(args.offset) <= 1000);
  return Object.keys(args).every(key => ['action', 'animationId', 'interaction', 'text'].includes(key))
    && DESK_PET_AI_ACTIONS.some(action => action === args.action)
    && (args.text === undefined || typeof args.text === 'string' && Boolean(args.text.trim()) && args.text.length <= 120)
    && (args.action !== 'speak' || typeof args.text === 'string' && Boolean(args.text.trim()))
    && (args.action === 'perform'
      ? typeof args.animationId === 'string' && Boolean(args.animationId.trim()) && args.animationId.length <= 80
      : args.animationId === undefined)
    && (args.action === 'interact' ? DESK_PET_AI_INTERACTIONS.some(item => item === args.interaction) : args.interaction === undefined);
}

export function executeDeskPetRequest(payload: unknown, scope: { roomId: string; userId: string; enabled: boolean }): DeskPetAiResult & { requestId: string } {
  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const requestId = typeof data.requestId === 'string' && data.requestId.length <= 80 ? data.requestId : '';
  const fail = (code: string, error: string) => ({ requestId, success: false, code, error });
  if (!requestId || !scope.roomId || !scope.userId || data.roomId !== scope.roomId || data.userId !== scope.userId) {
    return fail('DESK_PET_SCOPE_MISMATCH', '桌宠请求不属于当前成员或房间');
  }
  if (!scope.enabled) return fail('DESK_PET_DISABLED', '房间AI或桌宠已关闭');
  if (typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) {
    return fail('DESK_PET_EXPIRED', '桌宠请求已过期');
  }
  if ((data.command !== 'get_state' && data.command !== 'control') || !data.args || typeof data.args !== 'object'
    || Array.isArray(data.args) || !validArgs(data.command, data.args as Record<string, unknown>)) {
    return fail('INVALID_ARGUMENTS', '桌宠参数无效');
  }
  for (const [key, value] of completed) if (value.expiresAt < Date.now()) completed.delete(key);
  const fingerprint = JSON.stringify([data.roomId, data.userId, data.command, data.args]);
  const cached = completed.get(requestId);
  if (cached) return cached.fingerprint === fingerprint ? { ...cached.result, requestId } : fail('DESK_PET_CONFLICT', '桌宠请求编号冲突');
  if (!handler) return fail('DESK_PET_UNAVAILABLE', '桌宠尚未挂载或当前页面不支持');
  // 缓存未过期时不逐出旧编号，防止重复投喂或重复开启番茄钟
  if (completed.size >= 128) return fail('DESK_PET_LIMIT', '桌宠操作过于频繁，请稍后再试');
  let result: DeskPetAiResult;
  try {
    result = handler(data.command, data.args as DeskPetAiArgs);
  } catch {
    result = { success: false, code: 'DESK_PET_FAILED', error: '桌宠暂时未能执行' };
  }
  completed.set(requestId, { fingerprint, expiresAt: Math.min(data.expiresAt, Date.now() + 30000), result });
  return { ...result, requestId };
}
