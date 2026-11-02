import { UPSTREAM_ACTIONS, UPSTREAM_ANIM, UPSTREAM_CHARACTER_PREVIEWS, UPSTREAM_CHARS, UPSTREAM_NO_MIRROR, UPSTREAM_SPRITE, UPSTREAM_SPRITE_MAP, UPSTREAM_VIDEO_NAMES, UPSTREAM_WHISPERS } from './deskPetUpstream';

export type DeskPetCharacterId = keyof typeof UPSTREAM_CHARS;
export type DeskPetAnimation = 'idle' | 'roam' | 'drag' | 'happy' | 'angry' | 'eat' | 'sleep'
  | 'think' | 'work' | 'wave' | 'dance' | 'cube' | 'bubble' | 'ponder' | 'clean';

interface OriginalCharacter {
  label: string;
  kind: 'video' | 'pose' | 'sprite';
  dir?: string;
  idle?: readonly string[];
  map?: Readonly<Record<string, string>>;
  fallback?: readonly string[];
  actions?: readonly (readonly string[])[];
}
export const PET_ANIMATION_POOLS: Readonly<Record<DeskPetAnimation, readonly string[]>> = {
  idle: UPSTREAM_ANIM.idle, roam: UPSTREAM_ANIM.move, drag: UPSTREAM_ANIM.drag,
  happy: UPSTREAM_ANIM.happy, angry: [UPSTREAM_ANIM.clicks[2]], eat: UPSTREAM_ANIM.feed,
  sleep: UPSTREAM_ANIM.sleep, think: [UPSTREAM_ANIM.work[1]], work: UPSTREAM_ANIM.work,
  wave: [UPSTREAM_ANIM.clicks[4]], dance: ['轻快摇摆舞'], cube: ['原地专心玩魔方'],
  bubble: ['鲸鱼吐泡泡特效'], ponder: ['东张西望'], clean: [UPSTREAM_WHISPERS[0]],
};

export const DESK_PET_CHARACTERS = (Object.keys(UPSTREAM_CHARS) as DeskPetCharacterId[]).map((id) => {
  const original: OriginalCharacter = UPSTREAM_CHARS[id];
  return {
    id, label: original.label.replace(/v(\d)/, ' v$1'), kind: original.kind,
    previewSrc: UPSTREAM_CHARACTER_PREVIEWS[id].src,
    description: UPSTREAM_CHARACTER_PREVIEWS[id].description,
    directory: original.dir?.replace('../assets/', '/desk-pet/').replace(/\/$/, '') ?? '/desk-pet/anims',
    original,
  };
});

export function normalizeDeskPetCharacter(value: unknown): DeskPetCharacterId {
  return DESK_PET_CHARACTERS.find((character) => character.id === value)?.id ?? 'v1';
}
export function getDeskPetCharacter(value: unknown) {
  return DESK_PET_CHARACTERS.find((character) => character.id === value) ?? DESK_PET_CHARACTERS[0];
}
export function getDeskPetActions(character: DeskPetCharacterId): ReadonlyArray<readonly string[]> {
  const config = getDeskPetCharacter(character);
  const actions = [...(config.original.actions ?? [])];
  const listed = new Set(actions.map(([key]) => key));
  const extra = config.kind === 'sprite' ? Object.keys(UPSTREAM_SPRITE.sequences) : config.original.idle ?? [];
  for (const key of extra) {
    if (!listed.has(key)) actions.push([key, key === 'sleep' ? '闭眼休息' : '待机']);
  }
  return actions;
}
function pick(pool: readonly string[], random: () => number) {
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))];
}
export function resolveDeskPetAction(character: DeskPetCharacterId, animation: string, options: {
  random?: () => number; baseIdle?: boolean; facingLeft?: boolean;
} = {}) {
  const config = getDeskPetCharacter(character);
  const random = options.random ?? Math.random;
  const pool = PET_ANIMATION_POOLS[animation as DeskPetAnimation];
  const name = pool ? pick(pool, random) : animation;
  const source = config.original;
  if (config.kind === 'pose') {
    const explicit = name.startsWith('__pose:') ? name.slice(7) : '';
    const allowed = getDeskPetActions(character).some(([pose]) => pose === explicit);
    const pose = allowed ? explicit : options.baseIdle && animation === 'idle' && source.idle?.length
      ? pick(source.idle, random) : source.map?.[name] ?? pick(source.fallback ?? source.idle ?? [], random);
    return { name, kind: config.kind, pose, src: `${config.directory}/${pose}.webp`, sprite: 'idle', mirror: false };
  }
  if (config.kind === 'sprite') {
    const explicit = name.startsWith('__sprite:') ? name.slice(9) : '';
    const allowed = getDeskPetActions(character).some(([key]) => key === explicit);
    const mapped = (UPSTREAM_SPRITE_MAP as Readonly<Record<string, string>>)[name] ?? 'waiting';
    const sprite = allowed ? explicit : mapped === 'run' ? options.facingLeft ? 'runLeft' : 'runRight' : mapped;
    return { name, kind: config.kind, pose: '', src: `${config.directory}/spritesheet.webp`, sprite, mirror: false };
  }
  const safeName = (UPSTREAM_VIDEO_NAMES as readonly string[]).includes(name) ? name : UPSTREAM_ANIM.idle[0];
  // 发布路径仅用 ASCII，避免服务器解压工具误读中文文件名
  const fileName = Array.from(safeName, char => char.codePointAt(0)!.toString(16)).join('-');
  // 左转奔跑素材原本朝左，镜像时需与默认朝右的其他视频反向判断
  const nativeFacingLeft = safeName === '原地左转奔跑';
  return { name: safeName, kind: config.kind, pose: '', src: `/desk-pet/anims/anim-${fileName}.webm`, sprite: 'idle',
    mirror: !(UPSTREAM_NO_MIRROR as readonly string[]).includes(safeName)
      && Boolean(options.facingLeft) !== nativeFacingLeft };
}

export function getDeskPetPose(character: DeskPetCharacterId, animation: DeskPetAnimation): string {
  return resolveDeskPetAction(character, animation, { random: () => 0 }).src;
}

export const MUSIC_PERFORMANCE_VIDEOS = [
  '悠闲哼歌',
  '轻快摇摆舞',
  '可爱宅舞',
  '优雅女仆舞',
  '小提琴演奏',
  '吹笛子',
] as const;

const actionPool = (id: string): readonly string[] =>
  UPSTREAM_ACTIONS.find(group => group.id === id)?.pool ?? [];
const moneyVideos = UPSTREAM_VIDEO_NAMES.filter(name => name.startsWith('余额-'));

export const DESK_PET_VIDEO_GROUPS: ReadonlyArray<{ name: string; list: readonly string[] }> = [
  { name: '🎵 听歌律动', list: MUSIC_PERFORMANCE_VIDEOS },
  { name: '基础状态', list: [
    ...UPSTREAM_ANIM.idle, ...UPSTREAM_ANIM.move, ...UPSTREAM_ANIM.drag,
    ...UPSTREAM_ANIM.sleep, ...UPSTREAM_ANIM.sad, ...UPSTREAM_ANIM.happy,
  ] },
  { name: '吃什么', list: [...UPSTREAM_ANIM.feed, ...actionPool('eat')] },
  { name: '点击回应', list: UPSTREAM_ANIM.clicks },
  { name: '小动作', list: actionPool('small') },
  { name: '玩耍', list: actionPool('play') },
  { name: '时节', list: actionPool('season') },
  { name: '工作与账本', list: [
    ...UPSTREAM_ANIM.work, ...UPSTREAM_ANIM.sad, ...UPSTREAM_ANIM.happy, ...moneyVideos,
  ] },
  { name: '文字碎碎念', list: [...actionPool('text'), ...UPSTREAM_WHISPERS] },
];

// 状态动作在待机、漫游、拖拽和睡眠时触发，其余视频完整加入自动表演
const contextualVideos = new Set<string>([
  ...UPSTREAM_ANIM.idle, ...UPSTREAM_ANIM.move, ...UPSTREAM_ANIM.drag, ...UPSTREAM_ANIM.sleep,
]);
const automaticVideos = UPSTREAM_VIDEO_NAMES.filter(name => !contextualVideos.has(name));
const originalPrograms = new Set<string>([...UPSTREAM_ACTIONS.flatMap(group => group.pool), ...UPSTREAM_WHISPERS]);
const automaticGroups = [
  ...UPSTREAM_ACTIONS,
  { weight: 25, pool: UPSTREAM_WHISPERS },
  { weight: 14, pool: automaticVideos.filter(name => !originalPrograms.has(name)) },
];

// 保留原版节目权重与听歌偏好，视频表演每轮全部覆盖后再重复
export function pickOriginalAutomaticAction(
  character: DeskPetCharacterId,
  optionsOrRandom: { isPlaying?: boolean; random?: () => number; remainingActions?: Set<string> } | (() => number) = {},
): string {
  const random = typeof optionsOrRandom === 'function' ? optionsOrRandom : (optionsOrRandom.random ?? Math.random);
  const isPlaying = typeof optionsOrRandom === 'object' && Boolean(optionsOrRandom.isPlaying);

  if (character !== 'v1') {
    const config = getDeskPetCharacter(character);
    const prefix = config.kind === 'sprite' ? '__sprite:' : '__pose:';
    const remaining = typeof optionsOrRandom === 'object' && optionsOrRandom.remainingActions
      ? optionsOrRandom.remainingActions : new Set<string>();
    if (!remaining.size) getDeskPetActions(character).forEach(([key]) => remaining.add(`${prefix}${key}`));
    const musicKeys = config.kind === 'sprite' ? ['jumping', 'waving'] : ['dancing', 'guitar', 'cheer', 'superhappy'];
    const music = musicKeys.map(key => `${prefix}${key}`).filter(key => remaining.has(key));
    const name = pick(isPlaying && music.length && random() < 0.45 ? music : [...remaining], random);
    remaining.delete(name);
    return name;
  }
  {
    const remaining = typeof optionsOrRandom === 'object' && optionsOrRandom.remainingActions
      ? optionsOrRandom.remainingActions : new Set<string>();
    if (!remaining.size) automaticVideos.forEach(name => remaining.add(name));
    const available = (pool: readonly string[]) => pool.filter(name => remaining.has(name));
    const music = available(MUSIC_PERFORMANCE_VIDEOS);
    const whispers = available(UPSTREAM_WHISPERS);
    const groups = automaticGroups.map(group => ({ ...group, pool: available(group.pool) }))
      .filter(group => group.pool.length);
    let pool: readonly string[];
    if (isPlaying && music.length && random() < 0.45) pool = music;
    else if (whispers.length && random() < 0.25) pool = whispers;
    else {
      let weight = random() * groups.reduce((sum, group) => sum + group.weight, 0);
      pool = groups[groups.length - 1].pool;
      for (const group of groups) {
        weight -= group.weight;
        if (weight <= 0) { pool = group.pool; break; }
      }
    }
    const name = pick(pool, random);
    remaining.delete(name);
    return name;
  }
}

// 复刻原版 BALANCE_TIERS 六档余额动画，映射为在线听歌房间的队列热度与伴听账本档位动画
export function pickMusicLedgerAction(params: {
  isPlaying: boolean;
  queueLength: number;
  songsListenedCount: number;
}): string {
  const { isPlaying, queueLength, songsListenedCount } = params;
  if (queueLength >= 5 || songsListenedCount >= 5) return '余额-钱袋满溢';
  if (isPlaying && queueLength >= 2) return '余额-钱袋如常';
  if (isPlaying && queueLength === 1) return '余额-金袋叮当';
  if (isPlaying && queueLength === 0) return '余额-数金皱眉';
  if (!isPlaying && (queueLength > 0 || songsListenedCount > 0)) return '余额-袋空如洗';
  return '余额-分文不剩';
}
