import { randomUUID } from 'node:crypto';

const ACTIONS = ['speak', 'perform', 'feed', 'pat', 'sleep', 'wake', 'show_ledger', 'focus_start', 'focus_stop', 'interact', 'prepare_slingshot'];
const INTERACTIONS = ['ponder_button', 'sneak_click', 'surf_progress', 'fish_queue', 'dj_cover', 'treasure_hot', 'perch_chat'];
const failure = (code, error) => ({ success: false, code, error });

export function buildDeskPetTools() {
  return [
    {
      type: 'function', function: {
        name: 'get_desk_pet_state',
        description: '你在听歌房还有一个可互动的桌宠形象，属于发起对话者当前页面；按需查询是否开启、当前形象、状态、可用功能和才艺动作，keyword筛选动作、offset翻页，每页8个；关闭或离线时不可操控，不修改个人设置',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { keyword: { type: 'string', maxLength: 30 }, offset: { type: 'integer', minimum: 0, maximum: 1000 } },
        },
      },
    },
    {
      type: 'function', function: {
        name: 'control_desk_pet',
        description: '调用当前成员桌宠：说话、才艺、投喂、摸头、睡眠/唤醒、听歌账本、25分钟番茄钟、页面互动或弹弓准备；perform先查真实animationId，interact选interaction；text为可选的角色口吻气泡，speak必填；每轮至多4次，尊重个人功能开关，只依据客户端确认描述结果，started表示已启动而非已完成，超时表示未确认；页面互动只是动画，不会真实点击按钮、点歌或修改播放，弹弓仍需用户拖动松手',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ACTIONS },
            animationId: { type: 'string', minLength: 1, maxLength: 80 },
            interaction: { type: 'string', enum: INTERACTIONS },
            text: { type: 'string', minLength: 1, maxLength: 120 },
          },
          required: ['action'],
        },
      },
    },
  ];
}

export function validDeskPetArgs(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  if (name === 'get_desk_pet_state') {
    return Object.keys(args).every(key => ['keyword', 'offset'].includes(key))
      && (args.keyword === undefined || typeof args.keyword === 'string' && args.keyword.length <= 30)
      && (args.offset === undefined || Number.isInteger(args.offset) && args.offset >= 0 && args.offset <= 1000);
  }
  return name === 'control_desk_pet'
    && Object.keys(args).every(key => ['action', 'animationId', 'interaction', 'text'].includes(key))
    && ACTIONS.includes(args.action)
    && (args.text === undefined || typeof args.text === 'string' && Boolean(args.text.trim()) && args.text.length <= 120)
    && (args.action !== 'speak' || Boolean(args.text?.trim()))
    && (args.action === 'perform'
      ? typeof args.animationId === 'string' && Boolean(args.animationId.trim()) && args.animationId.length <= 80
      : args.animationId === undefined)
    && (args.action === 'interact' ? INTERACTIONS.includes(args.interaction) : args.interaction === undefined);
}

// 客户端回执也不可信，只向模型转交桌宠所需的有限字段
export function compactDeskPetResult(result) {
  if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
    return failure('DESK_PET_INVALID_ACK', '桌宠未返回有效确认');
  }
  const out = { success: result.success };
  for (const key of ['code', 'error', 'message']) {
    if (typeof result[key] === 'string') out[key] = result[key].slice(0, 160);
  }
  if (['started', 'shown', 'unchanged'].includes(result.status)) out.status = result.status;
  if (ACTIONS.includes(result.action)) out.action = result.action;
  if (result.success && result.state && typeof result.state === 'object') {
    const state = result.state;
    out.state = {};
    for (const key of ['character', 'label', 'activity']) {
      if (typeof state[key] === 'string') out.state[key] = state[key].slice(0, 60);
    }
    out.state.capabilities = Array.isArray(state.capabilities) ? ACTIONS.filter(item => state.capabilities.includes(item)) : [];
    out.state.interactions = Array.isArray(state.interactions) ? INTERACTIONS.filter(item => state.interactions.includes(item)) : [];
    out.state.actions = Array.isArray(state.actions) ? state.actions.slice(0, 8)
      .filter(item => typeof item?.id === 'string' && typeof item?.label === 'string')
      .map(item => ({ id: item.id.slice(0, 80), label: item.label.slice(0, 60) })) : [];
    out.state.nextOffset = Number.isInteger(state.nextOffset) && state.nextOffset >= 0 && state.nextOffset <= 1000 ? state.nextOffset : null;
    for (const key of ['focusRemainingSeconds', 'songsListenedCount', 'listenSeconds', 'interactionCount', 'energy', 'mood']) {
      if (Number.isFinite(state[key])) out.state[key] = Math.max(0, Math.min(1000000, Math.round(state[key])));
    }
  }
  return out;
}

export function createDeskPetRequester({ socket, roomId, userId, isAvailable }) {
  const controls = new Map();
  let queries = 0;
  return async (name, args) => {
    if (!validDeskPetArgs(name, args)) return failure('INVALID_ARGUMENTS', '桌宠参数无效');
    if (!isAvailable()) return failure('DESK_PET_UNAVAILABLE', '当前连接已离房或房间AI、桌宠已关闭');
    const control = name === 'control_desk_pet';
    const key = JSON.stringify([args.action, args.animationId, args.interaction, args.text]);
    if (control && controls.has(key)) return controls.get(key);
    if (control ? controls.size >= 4 : queries >= 8) return failure('DESK_PET_LIMIT', '本轮桌宠调用次数已达上限');
    if (!control) queries++;
    const requestId = randomUUID();
    const pending = new Promise(resolve => {
      socket.timeout(5000).emit('room_ai_desk_pet', {
        requestId, roomId, userId, expiresAt: Date.now() + 5000,
        command: control ? 'control' : 'get_state', args,
      }, (error, response) => {
        if (error) return resolve(failure('DESK_PET_TIMEOUT', '未收到桌宠确认，可能页面离线或版本不支持，不能确认是否已执行'));
        if (!isAvailable()) return resolve(failure('DESK_PET_UNAVAILABLE', '连接或房间设置已变化，未确认桌宠结果'));
        if (response?.requestId !== requestId) return resolve(failure('DESK_PET_INVALID_ACK', '桌宠确认与请求不匹配'));
        const result = compactDeskPetResult(response);
        if (result.success && (control ? !result.status : !result.state)) {
          return resolve(failure('DESK_PET_INVALID_ACK', '桌宠确认缺少执行状态'));
        }
        resolve(result);
      });
    }).catch(() => failure('DESK_PET_UNAVAILABLE', '当前桌宠连接不可用'));
    if (control) controls.set(key, pending);
    return pending;
  };
}
