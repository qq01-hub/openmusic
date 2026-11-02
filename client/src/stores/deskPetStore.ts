import { create } from 'zustand';
import { normalizeDeskPetCharacter, type DeskPetCharacterId } from '../lib/deskPetCharacters';

const STORAGE_KEY = 'openmusic:desk-pet-prefs:v2';
const LEGACY_HIDDEN_KEY = 'openmusic:room-ai-pet-hidden:v1';

export interface DeskPetPreferences {
  /** 个人形象：仅使用上游内置角色素材 */
  character: DeskPetCharacterId;
  /** 个人总开关：是否在自己屏幕上显示桌宠 */
  enabled: boolean;
  /** 待机与音乐律动：呼吸、眨眼、视线跟随、随歌摇摆与打瞌睡 */
  idleEnabled: boolean;
  /** 走动漫游：在房间页面内自主游走巡视 */
  roamEnabled: boolean;
  /** 玩耍模式：打 call 应援、玩魔方、吹泡泡、吃旋律点心等小节目 */
  playEnabled: boolean;
  /** 工作与专注陪伴：AI 思考/搜歌工作状态联动、听歌账本与专注番茄钟 */
  workEnabled: boolean;
  /** 对话与音乐气泡：切歌报幕、音乐碎碎念、AI 回复气泡联动 */
  dialogEnabled: boolean;
  /** 物理引擎与弹射：重力掉落、拖拽甩出抛物线、蓄力弹弓弹射、边缘反弹与 Q 弹挤压 */
  physicsEnabled: boolean;
  /** 房间组件调皮互动：躲在队列/聊天框/播放器后探头、按钮旁歪头思考、偷戳按钮被弹飞生气 */
  uiInteractEnabled: boolean;
  /** 体型缩放：0.8 / 1 / 1.2 */
  sizeScale: number;
}

export const DEFAULT_DESK_PET_PREFS: DeskPetPreferences = {
  character: 'v1',
  enabled: false,
  idleEnabled: true,
  roamEnabled: true,
  playEnabled: true,
  workEnabled: true,
  dialogEnabled: true,
  physicsEnabled: true,
  uiInteractEnabled: true,
  sizeScale: 1,
};

function readDeskPetPrefs(): DeskPetPreferences {
  if (typeof window === 'undefined') return { ...DEFAULT_DESK_PET_PREFS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DESK_PET_PREFS };
    const parsed = JSON.parse(raw) as Partial<DeskPetPreferences>;
    const rawScale = Number(parsed.sizeScale);
    const sizeScale = Number.isFinite(rawScale) ? Math.min(1.35, Math.max(0.7, rawScale)) : 1;
    return {
      character: normalizeDeskPetCharacter(parsed.character),
      enabled: parsed.enabled === true,
      idleEnabled: parsed.idleEnabled !== false,
      roamEnabled: parsed.roamEnabled !== false,
      playEnabled: parsed.playEnabled !== false,
      workEnabled: parsed.workEnabled !== false,
      dialogEnabled: parsed.dialogEnabled !== false,
      physicsEnabled: parsed.physicsEnabled !== false,
      uiInteractEnabled: parsed.uiInteractEnabled !== false,
      sizeScale,
    };
  } catch {
    return { ...DEFAULT_DESK_PET_PREFS };
  }
}

function writeDeskPetPrefs(prefs: DeskPetPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    if (prefs.enabled) {
      window.localStorage.removeItem(LEGACY_HIDDEN_KEY);
    } else {
      window.localStorage.setItem(LEGACY_HIDDEN_KEY, '1');
    }
  } catch {
    // ignore storage errors
  }
}

interface DeskPetStore extends DeskPetPreferences {
  updatePref: <K extends keyof DeskPetPreferences>(key: K, value: DeskPetPreferences[K]) => void;
  setPrefs: (partial: Partial<DeskPetPreferences>) => void;
  resetPrefs: () => void;
}

export const useDeskPetStore = create<DeskPetStore>((set, get) => ({
  ...readDeskPetPrefs(),
  updatePref: (key, value) => {
    const current = get();
    const next: DeskPetPreferences = {
      character: current.character,
      enabled: current.enabled,
      idleEnabled: current.idleEnabled,
      roamEnabled: current.roamEnabled,
      playEnabled: current.playEnabled,
      workEnabled: current.workEnabled,
      dialogEnabled: current.dialogEnabled,
      physicsEnabled: current.physicsEnabled,
      uiInteractEnabled: current.uiInteractEnabled,
      sizeScale: current.sizeScale,
      [key]: key === 'character' ? normalizeDeskPetCharacter(value) : value,
    };
    writeDeskPetPrefs(next);
    set({ [key]: next[key] } as Pick<DeskPetPreferences, typeof key>);
  },
  setPrefs: (partial) => {
    const current = get();
    const next: DeskPetPreferences = {
      character: normalizeDeskPetCharacter(partial.character ?? current.character),
      enabled: partial.enabled ?? current.enabled,
      idleEnabled: partial.idleEnabled ?? current.idleEnabled,
      roamEnabled: partial.roamEnabled ?? current.roamEnabled,
      playEnabled: partial.playEnabled ?? current.playEnabled,
      workEnabled: partial.workEnabled ?? current.workEnabled,
      dialogEnabled: partial.dialogEnabled ?? current.dialogEnabled,
      physicsEnabled: partial.physicsEnabled ?? current.physicsEnabled,
      uiInteractEnabled: partial.uiInteractEnabled ?? current.uiInteractEnabled,
      sizeScale: partial.sizeScale !== undefined
        ? Math.min(1.35, Math.max(0.7, Number(partial.sizeScale) || 1))
        : current.sizeScale,
    };
    writeDeskPetPrefs(next);
    set(next);
  },
  resetPrefs: () => {
    const next = { ...DEFAULT_DESK_PET_PREFS };
    writeDeskPetPrefs(next);
    set(next);
  },
}));
