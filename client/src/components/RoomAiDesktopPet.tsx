import './RoomAiDesktopPet.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatStore } from '../stores/chatStore';
import { useRoomStore } from '../stores/roomStore';
import { useDeskPetStore } from '../stores/deskPetStore';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useTrackLyrics } from '../hooks/useTrackLyrics';
import { readLocalPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import { getActiveLyricLine } from '../lib/lyricLookup';
import { sampleLyricReaction, type LyricReactionMemory } from '../lib/deskPetLyrics';
import { AI_BOT_USER_ID } from '../lib/chatAi';
import Tooltip from './Tooltip';
import OriginalPetActionPicker from './OriginalPetActionPicker';
import DeskPetAppearance from './DeskPetAppearance';
import {
  pickMusicLedgerAction,
  pickOriginalAutomaticAction,
  type DeskPetCharacterId,
} from '../lib/deskPetCharacters';
import { UPSTREAM_ANIM } from '../lib/deskPetUpstream';
import { estimateReleaseVelocity, landingSquash, pullAngle, slingshotPower, slingshotVelocity,
  springStep, throwStep, throwSubsteps, trimTrail } from '../lib/deskPetPhysics';

interface Props {
  botName: string;
  deskPetEnabled: boolean;
  aiEnabled: boolean;
  onQuickWake: (botName: string) => void;
  onOpenPetSettings?: () => void;
}

type PetState =
  | 'original_action'
  | 'idle'
  | 'roam'
  | 'sleep'
  | 'work'
  | 'eat'
  | 'happy'
  | 'dizzy'
  | 'angry_bounced'
  | 'peek_div'
  | 'ponder_button'
  | 'sneak_click'
  | 'surf_progress'
  | 'fish_queue'
  | 'dj_cover'
  | 'treasure_hot'
  | 'perch_chat'
  | 'drag'
  | 'slingshot_aim'
  | 'physics';

interface ParticleFx {
  id: number;
  kind: 'heart' | 'food' | 'note' | 'spark';
  char: string;
  x: number;
  y: number;
}

interface RippleFx {
  id: number;
  x: number;
  y: number;
  label: string;
}

const PET_W = 116;
const PET_H = 132;
const ONE_SHOT_STATES = new Set<PetState>(['original_action', 'eat', 'happy']);

const MUSIC_FOODS = [
  { icon: '🎵', name: '金色八分音符', line: '啊呜一口吞下金色音符～满嘴都是好听的旋律，音浪 +18 ♪' },
  { icon: '🍙', name: '海苔旋律饭团', line: '嚼嚼嚼～是加了高音海苔的大饭团，肚皮圆滚滚啦 🍙' },
  { icon: '🍰', name: '草莓节拍小蛋糕', line: '哇！草莓味的鼓点在舌尖跳动，甜度超标啦 🍰✨' },
  { icon: '🧋', name: '黑胶珍珠奶茶', line: '吨吨吨～Q弹的黑胶小珍珠吸上来咯，嗓子润好随时准备报幕 🧋' },
  { icon: '🍪', name: '留声机曲奇', line: '咔嚓咔嚓～脆生生的复古黑胶曲奇，香迷糊啦 🍪' },
  { icon: '🍤', name: '重低音黄金炸虾', line: '嗷呜！酥脆重低音炸虾下肚，尾巴充满摇摆能量 🍤' },
];

const GENERAL_MUSIC_LINES = [
  '啵～耳机分你一半，今天想听什么神仙歌曲呀 🎧',
  '摇摇大肥鱼尾巴～房间里的音乐氛围感拉满啦 ✨',
  '咕噜咕噜～听到抓耳的前奏，本鱼的呆毛都会跟着打拍子哦 ♪',
  '摸摸大肥鱼，点歌不踩雷，首首都是心头好～🐟',
  '哼哼～本鱼可是专业音乐伴听小女仆，随时待命为您打 Call 🎉',
  'Shift + 拖拽本鱼可以拉开弹弓弹射哦，温柔一点别把鱼摇晕啦～',
  '悄悄告诉你，右键点我可以投喂音符点心、点播才艺或者看听歌账本哦 🍙',
];

const PAT_LINES = [
  '呼噜呼噜～被摸头啦，呆毛开心地晃了三圈 ✨',
  '喵呜…不对，啵呜～再摸本鱼就要贴着你一起听歌啦 💕',
  '最喜欢你摸摸头啦，送你一串好运高音泡泡 🫧',
  '嘿嘿，发型都要被揉乱啦，陪你听一整晚好歌～',
];

export default function RoomAiDesktopPet({
  botName,
  deskPetEnabled,
  aiEnabled,
  onQuickWake,
  onOpenPetSettings,
}: Props) {
  // 手机端/窄屏不渲染桌宠，节省屏幕空间
  const isMobileViewport = useMediaQuery('(max-width: 1023px)');

  const currentSong = useRoomStore((s) => s.room?.current ?? null);
  const queueLength = useRoomStore((s) => s.room?.queue?.length ?? 0);
  const userCount = useRoomStore((s) => s.room?.userCount ?? 1);
  const isPlaying = useRoomStore((s) => Boolean(s.room?.isPlaying && s.room?.current));
  const aiProcessing = useChatStore((s) => s.aiProcessing);
  const messages = useChatStore((s) => s.messages);

  // 个人桌宠偏好设置（仅对当前成员自己生效）
  const petEnabled = useDeskPetStore((s) => s.enabled);
  const character = useDeskPetStore((s) => s.character);
  const idleEnabled = useDeskPetStore((s) => s.idleEnabled);
  const roamEnabled = useDeskPetStore((s) => s.roamEnabled);
  const playEnabled = useDeskPetStore((s) => s.playEnabled);
  const workEnabled = useDeskPetStore((s) => s.workEnabled);
  const dialogEnabled = useDeskPetStore((s) => s.dialogEnabled);
  const physicsEnabled = useDeskPetStore((s) => s.physicsEnabled);
  const uiInteractEnabled = useDeskPetStore((s) => s.uiInteractEnabled);
  const sizeScale = useDeskPetStore((s) => s.sizeScale);
  const updatePref = useDeskPetStore((s) => s.updatePref);
  const lyricInteractionEnabled = !isMobileViewport && deskPetEnabled && petEnabled && dialogEnabled;
  const lyrics = useTrackLyrics(lyricInteractionEnabled ? currentSong : null);
  const lyricReactionRef = useRef<LyricReactionMemory>({
    songKey: '', seen: new Set(), nextAt: Date.now() + 15000,
  });

  const [petState, setPetState] = useState<PetState>('idle');
  const [originalAction, setOriginalAction] = useState('');
  const [playKey, setPlayKey] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { x: 200, y: 200 };
    }
    const queueEl = document.querySelector<HTMLElement>('[data-guide="room-queue"]');
    if (queueEl) {
      const rect = queueEl.getBoundingClientRect();
      if (rect.width > PET_W && rect.height > PET_H) {
        return {
          x: Math.round(rect.right - PET_W - 14),
          y: Math.round(rect.bottom - PET_H - 12),
        };
      }
    }
    return {
      x: Math.max(40, window.innerWidth - 190),
      y: Math.max(80, window.innerHeight - 250),
    };
  });
  const [facingLeft, setFacingLeft] = useState(false);
  const [tiltDeg, setTiltDeg] = useState(0);
  const [squash, setSquash] = useState<{ sx: number; sy: number }>({ sx: 1, sy: 1 });
  const [peekSide, setPeekSide] = useState<'left' | 'right' | 'top' | null>(null);

  // 气泡、双进度条（音浪能量 + 心情指数）、听歌账本、番茄钟
  const [bubble, setBubble] = useState<{ text: string; aiOnly: boolean } | null>(null);
  const [showBubbleBars, setShowBubbleBars] = useState(false);
  const [showMusicLedger, setShowMusicLedger] = useState(false);
  const [rhythmEnergy, setRhythmEnergy] = useState(86);
  const [moodScore, setMoodScore] = useState(92);
  const [songsListenedCount, setSongsListenedCount] = useState(0);
  const [sessionListenSeconds, setSessionListenSeconds] = useState(0);
  const [interactionCount, setInteractionCount] = useState(0);
  const [pomodoroEndAt, setPomodoroEndAt] = useState<number | null>(null);
  const [pomodoroRemainingText, setPomodoroRemainingText] = useState('');

  // 菜单与特效
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showActSubmenu, setShowActSubmenu] = useState(false);
  const [particles, setParticles] = useState<ParticleFx[]>([]);
  const [ripples, setRipples] = useState<RippleFx[]>([]);
  const [slingshotPull, setSlingshotPull] = useState<{ curX: number; curY: number } | null>(null);

  // Refs
  const posRef = useRef(pos);
  posRef.current = pos;
  const velRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const stateRef = useRef<PetState>(petState);
  stateRef.current = petState;
  const dragTargetRef = useRef<{ x: number; y: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const lastInteractRef = useRef(Date.now());
  const lastAutoActionRef = useRef(Date.now());
  const remainingAutoActionsRef = useRef(new Set<string>());
  const autoDozeRef = useRef(false);
  const roamTargetRef = useRef<{ x: number; y: number; speed: number; onArrive?: () => void } | null>(null);
  const dragSamplesRef = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragMovedRef = useRef(false);
  const isSlingshotDragRef = useRef(false);
  const bubbleTimerRef = useRef<number | null>(null);
  const stateTimerRef = useRef<number | null>(null);
  const squashTimerRef = useRef<number | null>(null);
  const lastSongKeyRef = useRef('');
  const clickTimestampsRef = useRef<number[]>([]);

  const isAiThinking = aiEnabled && aiProcessing.some((item) => item.status === 'queued' || item.status === 'processing');
  const baseStateRef = useRef<PetState>('idle');
  baseStateRef.current = (isAiThinking && workEnabled) || pomodoroEndAt ? 'work' : 'idle';
  const finishOneShot = useCallback(() => {
    setPetState((current) => ONE_SHOT_STATES.has(current) ? baseStateRef.current : current);
  }, []);
  const playOriginalAction = useCallback((name: string) => {
    if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
    roamTargetRef.current = null;
    lastInteractRef.current = Date.now();
    autoDozeRef.current = false;
    setPeekSide(null);
    setTiltDeg(0);
    setOriginalAction(name);
    setPlayKey((serial) => serial + 1);
    setPetState('original_action');
    setMenuPos(null);
    setShowActSubmenu(false);
  }, []);
  useEffect(() => { remainingAutoActionsRef.current.clear(); }, [character]);
  useEffect(() => {
    if (roamEnabled || stateRef.current !== 'roam') return;
    roamTargetRef.current = null;
    setTiltDeg(0);
    setPetState(baseStateRef.current);
  }, [roamEnabled]);
  const activeThinkingStep = useMemo(() => {
    const active = aiProcessing.find((item) => item.status === 'queued' || item.status === 'processing');
    if (!active) return '';
    if (active.stepText) {
      return active.stepText;
    }
    if (active.thoughtSteps && active.thoughtSteps.length > 0) {
      return active.thoughtSteps[active.thoughtSteps.length - 1];
    }
    return `${botName}正在认真思考与搜歌…`;
  }, [aiProcessing, botName]);

  const clampViewportPos = useCallback((x: number, y: number) => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    const bottomBar = typeof document !== 'undefined' ? document.getElementById('bottom-bar') : null;
    const bottomReserve = bottomBar ? Math.max(76, h - bottomBar.getBoundingClientRect().top + 6) : 84;
    return {
      x: Math.min(Math.max(12 + PET_W * (sizeScale - 1) / 2, x),
        Math.max(12, w - PET_W - 12 - PET_W * (sizeScale - 1) / 2)),
      y: Math.min(Math.max(52 + PET_H * Math.max(0, sizeScale - 1), y), Math.max(52, h - PET_H - bottomReserve)),
    };
  }, [sizeScale]);

  const hasAlignedQueuePosRef = useRef(false);
  const hasUserMovedRef = useRef(false);

  // 初始化位置放到播放队列 div ([data-guide="room-queue"]) 内部的右下角
  useEffect(() => {
    if (
      isMobileViewport ||
      !deskPetEnabled ||
      !petEnabled ||
      hasAlignedQueuePosRef.current ||
      hasUserMovedRef.current
    ) {
      return;
    }
    let rafId = 0;
    let attempts = 0;
    const alignToQueueBottomRight = () => {
      if (hasAlignedQueuePosRef.current || hasUserMovedRef.current) return;
      const queueEl = document.querySelector<HTMLElement>('[data-guide="room-queue"]');
      if (queueEl) {
        const rect = queueEl.getBoundingClientRect();
        if (rect.width > PET_W && rect.height > PET_H) {
          hasAlignedQueuePosRef.current = true;
          setPos(
            clampViewportPos(
              Math.round(rect.right - PET_W - 14),
              Math.round(rect.bottom - PET_H - 12),
            ),
          );
          return;
        }
      }
      attempts += 1;
      if (attempts < 30) {
        rafId = window.requestAnimationFrame(alignToQueueBottomRight);
      }
    };
    alignToQueueBottomRight();
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [clampViewportPos, deskPetEnabled, isMobileViewport, petEnabled]);

  const triggerSquash = useCallback((sx: number, sy: number, durationMs = 260) => {
    if (squashTimerRef.current) window.clearTimeout(squashTimerRef.current);
    setSquash({ sx, sy });
    squashTimerRef.current = window.setTimeout(() => {
      setSquash({ sx: 1, sy: 1 });
      squashTimerRef.current = null;
    }, durationMs);
  }, []);

  const spawnParticle = useCallback((kind: ParticleFx['kind'], char: string, offsetX = 0, offsetY = 0) => {
    const id = Date.now() + Math.random();
    setParticles((prev) => [
      ...prev.slice(-10),
      {
        id,
        kind,
        char,
        x: 52 + offsetX + (Math.random() * 28 - 14),
        y: 28 + offsetY + (Math.random() * 16 - 8),
      },
    ]);
    window.setTimeout(() => {
      setParticles((prev) => prev.filter((item) => item.id !== id));
    }, 1150);
  }, []);

  const spawnButtonRipple = useCallback((x: number, y: number, label: string) => {
    const id = Date.now() + Math.random();
    setRipples((prev) => [...prev.slice(-4), { id, x, y, label }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((item) => item.id !== id));
    }, 950);
  }, []);

  const say = useCallback(
    (
      text: string,
      durationMs = 4800,
      options?: { withBars?: boolean; withLedger?: boolean; force?: boolean; aiOnly?: boolean },
    ) => {
      if (!dialogEnabled && !options?.force) return;
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      setBubble({ text, aiOnly: Boolean(options?.aiOnly) });
      setShowBubbleBars(Boolean(options?.withBars));
      setShowMusicLedger(Boolean(options?.withLedger));
      bubbleTimerRef.current = window.setTimeout(() => {
        setBubble(null);
        setShowBubbleBars(false);
        setShowMusicLedger(false);
        bubbleTimerRef.current = null;
      }, durationMs);
    },
    [dialogEnabled],
  );

  // 生成结合当前房间音乐状态的智能台词
  const pickMusicLine = useCallback(() => {
    if (currentSong) {
      const songTitle = (currentSong.name || '这首歌').slice(0, 16);
      const artist = (currentSong.artist || '歌手').slice(0, 12);
      const requester = typeof currentSong.requestedBy === 'string' ? currentSong.requestedBy.trim() : '';
      const dynamicLines = [
        `🎧 正在循环《${songTitle}》，${artist}的演绎真的超有感觉，尾巴都跟着打拍子啦 ♪`,
        requester
          ? `✨ 偷偷夸夸 ${requester} 点的这首《${songTitle}》，审美太在线啦，本鱼疯狂打 Call！`
          : `🎵《${songTitle}》的旋律好治愈呀，待在房间里跟 ${userCount} 位伙伴一起听歌最开心啦～`,
        queueLength > 0
          ? `🎶 队列里还有 ${queueLength} 首好歌排着队呢，今天也是耳朵享福的一天～`
          : aiEnabled
            ? `🫧 队列快听完啦，要不要点我 @${botName} 帮大家搜几首同风格的神曲呀？`
            : '🫧 队列快听完啦，去搜索里为大家添几首喜欢的歌吧～',
        `🐟 咕噜咕噜～听着《${songTitle}》，本鱼的音浪能量已经充到 ${Math.round(rhythmEnergy)}% 啦！`,
      ];
      if (Math.random() < 0.65) {
        return dynamicLines[Math.floor(Math.random() * dynamicLines.length)];
      }
    }
    return GENERAL_MUSIC_LINES[Math.floor(Math.random() * GENERAL_MUSIC_LINES.length)];
  }, [aiEnabled, botName, currentSong, queueLength, rhythmEnergy, userCount]);

  // 喂食音符点心
  const handleFeedMusicSnack = useCallback(() => {
    const food = MUSIC_FOODS[Math.floor(Math.random() * MUSIC_FOODS.length)];
    if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
    setPeekSide(null);
    setTiltDeg(0);
    setPetState('eat');
    setPlayKey((serial) => serial + 1);
    lastInteractRef.current = Date.now();
    setRhythmEnergy((v) => Math.min(100, v + 18));
    setMoodScore((v) => Math.min(100, v + 10));
    setInteractionCount((c) => c + 1);
    spawnParticle('food', food.icon, 0, -18);
    window.setTimeout(() => spawnParticle('heart', '💖', 12, -8), 320);
    triggerSquash(1.18, 0.84, 320);
    say(food.line, 5200, { withBars: true, force: true });
  }, [say, spawnParticle, triggerSquash]);

  // 摸摸头夸夸
  const handlePatPet = useCallback(() => {
    if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
    setPeekSide(null);
    setTiltDeg(0);
    playOriginalAction(UPSTREAM_ANIM.clicks[Math.floor(Math.random() * UPSTREAM_ANIM.clicks.length)]);
    setMoodScore((v) => Math.min(100, v + 12));
    setInteractionCount((c) => c + 1);
    spawnParticle('heart', '💗', -8, -10);
    spawnParticle('note', '♪', 14, -14);
    triggerSquash(1.15, 0.86, 260);
    const line = PAT_LINES[Math.floor(Math.random() * PAT_LINES.length)];
    say(line, 4600, { withBars: true, force: true });
  }, [playOriginalAction, say, spawnParticle, triggerSquash]);

  // 扫描房间内可交互的真实前端 DOM 组件
  const findRoomUiTargets = useCallback(() => {
    if (typeof document === 'undefined') {
      return {
        panels: [] as Array<{ el: HTMLElement; name: string }>,
        buttons: [] as Array<{ el: HTMLElement; name: string; rect: DOMRect }>,
      };
    }
    const panelSelectors: Array<{ sel: string; name: string }> = [
      { sel: '[data-guide="room-queue"]', name: '播放队列' },
      { sel: '[data-guide="room-chat"]', name: '聊天室' },
      { sel: '[data-guide="room-search"]', name: '点歌搜索栏' },
      { sel: '#bottom-bar', name: '底栏播放器' },
    ];
    const panels: Array<{ el: HTMLElement; name: string }> = [];
    for (const item of panelSelectors) {
      const el = document.querySelector<HTMLElement>(item.sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 120 && rect.height > 48) {
          panels.push({ el, name: item.name });
        }
      }
    }

    const rawButtons = Array.from(document.querySelectorAll<HTMLElement>('button'));
    const buttons: Array<{ el: HTMLElement; name: string; rect: DOMRect }> = [];
    for (const btn of rawButtons) {
      if (btn.closest('[data-desk-pet-root="true"]')) continue;
      const rect = btn.getBoundingClientRect();
      if (
        rect.width < 24 ||
        rect.width > 220 ||
        rect.height < 22 ||
        rect.height > 72 ||
        rect.top < 46 ||
        rect.bottom > window.innerHeight - 20 ||
        rect.left < 16 ||
        rect.right > window.innerWidth - 16
      ) {
        continue;
      }
      const rawName = (
        btn.getAttribute('aria-label') ||
        btn.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 12);
      buttons.push({
        el: btn,
        name: rawName || '神秘按钮',
        rect,
      });
    }
    return { panels, buttons };
  }, []);

  // 动作1：躲在某个房间 div 后面冒个头（Peek）
  const triggerPeekDivAction = useCallback(() => {
    const { panels } = findRoomUiTargets();
    const w = window.innerWidth;
    const h = window.innerHeight;
    let targetX = w - PET_W - 6;
    let targetY = Math.round(h * 0.48);
    let side: 'left' | 'right' | 'top' = 'right';
    let panelName = '房间面板';

    if (panels.length > 0) {
      const chosen = panels[Math.floor(Math.random() * panels.length)];
      const rect = chosen.el.getBoundingClientRect();
      panelName = chosen.name;
      if (rect.left > PET_W + 24 && Math.random() < 0.55) {
        targetX = Math.max(8, rect.left - PET_W * 0.58);
        targetY = Math.min(h - PET_H - 96, Math.max(70, rect.top + Math.min(140, rect.height * 0.32)));
        side = 'left';
      } else if (rect.right < w - 30) {
        targetX = Math.min(w - PET_W * 0.55, rect.right - PET_W * 0.42);
        targetY = Math.min(h - PET_H - 96, Math.max(70, rect.top + Math.min(140, rect.height * 0.32)));
        side = 'right';
      } else {
        targetX = Math.min(w - PET_W - 20, Math.max(20, rect.left + rect.width * 0.65));
        targetY = Math.max(54, rect.top - PET_H * 0.52);
        side = 'top';
      }
    }

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    roamTargetRef.current = {
      x: targetX,
      y: targetY,
      speed: 220,
      onArrive: () => {
        setPetState('peek_div');
        setPeekSide(side);
        setFacingLeft(side === 'right');
        const peekLines = [
          `👀 偷偷躲在「${panelName}」后面探个小脑袋听歌，没人发现本鱼吧～`,
          `🫣 从「${panelName}」边边冒个头！暗中观察今天谁点的歌最好听～`,
          `🐟 嘿嘿，把尾巴藏在「${panelName}」后面，只露呆毛打节拍 ♪`,
        ];
        say(peekLines[Math.floor(Math.random() * peekLines.length)], 5400);
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => {
          setPeekSide(null);
          setTiltDeg(0);
          setPetState('idle');
        }, 5500);
      },
    };
  }, [findRoomUiTargets, say]);

  // 动作2：在某个房间按钮旁边歪头思考（Ponder Button）
  const triggerPonderButtonAction = useCallback(() => {
    const { buttons } = findRoomUiTargets();
    if (buttons.length === 0) return;
    const chosen = buttons[Math.floor(Math.random() * buttons.length)];
    const { rect, name } = chosen;
    const placeOnLeft = rect.left > PET_W + 30;
    const rawX = placeOnLeft ? rect.left - PET_W + 8 : rect.right - 8;
    const rawY = rect.top + rect.height / 2 - PET_H * 0.65;
    const dest = clampViewportPos(rawX, rawY);

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    roamTargetRef.current = {
      x: dest.x,
      y: dest.y,
      speed: 210,
      onArrive: () => {
        setPetState('ponder_button');
        setFacingLeft(!placeOnLeft);
        spawnParticle('note', '🤔', 0, -14);
        const ponderLines = [
          `🤔 蹲在「${name}」按钮旁边托腮思考…按下去会蹦出超好听的隐藏神曲吗？`,
          `💡 盯——这个「${name}」按钮长得好精致呀，本鱼帮大家守着它～`,
          `🧐 正在认真研究「${name}」的构造…唔，闻起来有音乐魔法的味道 ♪`,
        ];
        say(ponderLines[Math.floor(Math.random() * ponderLines.length)], 5200);
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => {
          setPetState('idle');
        }, 5000);
      },
    };
  }, [clampViewportPos, findRoomUiTargets, say, spawnParticle]);

  // 动作3：偷偷点击某个按钮，不触发实际效果，反而被按钮弹飞并傲娇生气！（Sneak Click & Bounce）
  const triggerSneakClickButtonAction = useCallback(() => {
    const { buttons } = findRoomUiTargets();
    if (buttons.length === 0) return;
    const chosen = buttons[Math.floor(Math.random() * buttons.length)];
    const { rect, name } = chosen;
    const approachLeft = rect.left > window.innerWidth / 2;
    const dest = clampViewportPos(
      approachLeft ? rect.left - PET_W * 0.72 : rect.right - PET_W * 0.28,
      rect.top + rect.height / 2 - PET_H * 0.62,
    );

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    say(`🐾 嘿嘿，趁没人注意，本鱼悄悄去戳一下「${name}」按钮…`, 2600);

    roamTargetRef.current = {
      x: dest.x,
      y: dest.y,
      speed: 240,
      onArrive: () => {
        setPetState('sneak_click');
        setFacingLeft(!approachLeft);
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => {
          // 在按钮中心渲染虚拟结界波纹（绝不触发按钮真实 click）
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          spawnButtonRipple(cx, cy, name);
          spawnParticle('spark', '💥', 0, -6);
          spawnParticle('spark', '💢', 14, -18);
          triggerSquash(0.76, 1.28, 280);

          // 被按钮反向弹飞！
          const bounceDir = approachLeft ? -1 : 1;
          velRef.current = {
            vx: bounceDir * (340 + Math.random() * 140),
            vy: -(460 + Math.random() * 140),
          };
          setPetState('physics');

          const angryLines = [
            `哇啊！！既然不让我碰「${name}」，生气～！😤💢`,
            `好痛好痛！「${name}」按钮居然有防鱼结界，把本鱼弹飞啦＞＜💢`,
            `呜哇——！被「${name}」弹开三米远，本鱼只是手痒想戳一下嘛，哼～！😤`,
          ];
          say(angryLines[Math.floor(Math.random() * angryLines.length)], 5600, { force: true });
        }, 620);
      },
    };
  }, [clampViewportPos, findRoomUiTargets, say, spawnButtonRipple, spawnParticle, triggerSquash]);

  // 动作4：在底栏播放进度条上踩着音浪冲浪滑行（Surf Progress Bar）
  const triggerSurfProgressAction = useCallback(() => {
    const bottomBar = document.getElementById('bottom-bar');
    const w = window.innerWidth;
    const h = window.innerHeight;
    const barTop = bottomBar ? bottomBar.getBoundingClientRect().top : h - 76;
    const surfY = Math.max(60, barTop - PET_H + 8);
    const startX = Math.max(24, Math.round(w * 0.14));
    const endX = Math.min(w - PET_W - 24, Math.round(w * 0.78));

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    roamTargetRef.current = {
      x: startX,
      y: surfY,
      speed: 250,
      onArrive: () => {
        setPetState('surf_progress');
        setFacingLeft(false);
        spawnParticle('note', '🌊', -12, 16);
        spawnParticle('note', '♪', 14, -10);
        const songTitle = (currentSong?.name || '这首歌').slice(0, 14);
        say(
          isPlaying
            ? `🏄‍♀️ 芜湖～踩着《${songTitle}》的播放进度条冲浪咯！这段副歌的浪头最高啦 🌊♪`
            : '🏄‍♀️ 踩着底栏进度条滑板巡航～快点播一首嗨歌掀起音浪吧！',
          5600,
        );
        roamTargetRef.current = {
          x: endX,
          y: surfY,
          speed: 155,
          onArrive: () => {
            triggerSquash(1.2, 0.82, 240);
            spawnParticle('spark', '✨', 0, -12);
            setPetState('idle');
          },
        };
      },
    };
  }, [currentSong?.name, isPlaying, say, spawnParticle, triggerSquash]);

  // 动作5：坐在播放队列面板顶部甩竿垂钓待播好歌（Fish in Queue）
  const triggerFishQueueAction = useCallback(() => {
    const queueEl = document.querySelector<HTMLElement>('[data-guide="room-queue"]');
    const rect = queueEl?.getBoundingClientRect();
    const dest = rect
      ? clampViewportPos(rect.left + rect.width * 0.55 - PET_W / 2, rect.top - PET_H * 0.65)
      : clampViewportPos(window.innerWidth * 0.52, window.innerHeight * 0.28);

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    roamTargetRef.current = {
      x: dest.x,
      y: dest.y,
      speed: 220,
      onArrive: () => {
        setPetState('fish_queue');
        setFacingLeft(false);
        say(
          queueLength > 0
            ? `🎣 坐在播放队列顶上甩竿钓鱼…底下有 ${queueLength} 首待播好歌在吐泡泡呢～`
            : '🎣 坐在播放队列边甩出小鱼竿…咦，池子里空空的，快来点几首歌让本鱼钓嘛～',
          5600,
        );
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => {
          spawnParticle('note', '🎵', 16, -12);
          spawnParticle('spark', '🌟', -8, -16);
          triggerSquash(1.18, 0.84, 240);
          say('🎣 嘿咻！提竿成功，从队列里钓上来一颗闪闪发光的金色高音谱号 ♪', 3800);
          setPetState('idle');
        }, 4800);
      },
    };
  }, [clampViewportPos, queueLength, say, spawnParticle, triggerSquash]);

  // 动作6：跑到左下角专辑封面旁戴墨镜搓碟打碟（DJ Scratch Cover）
  const triggerDjCoverAction = useCallback(() => {
    const bottomBar = document.getElementById('bottom-bar');
    const rect = bottomBar?.getBoundingClientRect();
    const dest = rect
      ? clampViewportPos(rect.left + 58, rect.top - PET_H + 6)
      : clampViewportPos(48, window.innerHeight - PET_H - 80);

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    roamTargetRef.current = {
      x: dest.x,
      y: dest.y,
      speed: 230,
      onArrive: () => {
        setPetState('dj_cover');
        setFacingLeft(true);
        spawnParticle('note', '🎧', 0, -14);
        const songTitle = (currentSong?.name || '本场主打歌').slice(0, 14);
        say(
          `🕶️ 哟哟 Check it out！DJ 大肥鱼正在专辑封面旁为《${songTitle}》搓碟混音，动次打次～💿✨`,
          5400,
        );
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => {
          setPetState('idle');
        }, 5200);
      },
    };
  }, [clampViewportPos, currentSong?.name, say, spawnParticle]);

  // 动作7：在热榜或搜索区举着放大镜寻宝（Treasure Hunt Hotlist）
  const triggerTreasureHotAction = useCallback(() => {
    const hotEl =
      document.querySelector<HTMLElement>('[data-guide="room-hot"]') ||
      document.querySelector<HTMLElement>('[data-guide="room-search"]');
    const rect = hotEl?.getBoundingClientRect();
    const dest = rect
      ? clampViewportPos(rect.left + Math.min(140, rect.width * 0.45), rect.top + Math.min(120, rect.height * 0.35))
      : clampViewportPos(90, window.innerHeight * 0.36);

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    roamTargetRef.current = {
      x: dest.x,
      y: dest.y,
      speed: 215,
      onArrive: () => {
        setPetState('treasure_hot');
        setFacingLeft(false);
        spawnParticle('spark', '🔍', 10, -12);
        say('🔍 滴——大肥鱼宝藏歌单雷达开启！让我用放大镜找找这里藏着哪首神仙曲目～✨', 5200);
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => {
          setPetState('idle');
        }, 5000);
      },
    };
  }, [clampViewportPos, say, spawnParticle]);

  // 动作8：趴在聊天室输入框上沿擦灰尘催大家聊天点歌（Perch Chat Input）
  const triggerPerchChatAction = useCallback(() => {
    const chatEl = document.querySelector<HTMLElement>('[data-guide="room-chat"]');
    const rect = chatEl?.getBoundingClientRect();
    const dest = rect
      ? clampViewportPos(rect.left + rect.width * 0.5 - PET_W / 2, rect.bottom - PET_H - 54)
      : clampViewportPos(window.innerWidth - PET_W - 80, window.innerHeight - PET_H - 130);

    setPeekSide(null);
    setTiltDeg(0);
    setPetState('roam');
    roamTargetRef.current = {
      x: dest.x,
      y: dest.y,
      speed: 220,
      onArrive: () => {
        setPetState('perch_chat');
        spawnParticle('spark', '✨', -10, -10);
        const lines = [
          aiEnabled
            ? `🧹 趴在聊天框边边帮大家把输入框擦得亮晶晶～快来聊聊天或 @${botName} 点歌嘛 💬`
            : '🧹 趴在聊天框边边帮大家把输入框擦得亮晶晶～快来聊聊喜欢的音乐嘛 💬',
          '🫧 在聊天输入框上面托腮打滚～有人夸夸本鱼今天的新发型吗 ♪',
          '💌 守护聊天室输入框中！发一句好听的歌词，说不定有惊喜共鸣哦～',
        ];
        say(lines[Math.floor(Math.random() * lines.length)], 5400);
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => {
          setPetState('idle');
        }, 5200);
      },
    };
  }, [aiEnabled, botName, clampViewportPos, say, spawnParticle]);

  // 监听 AI 最新回复：同步弹出迷你气泡
  const latestBotMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.userId === AI_BOT_USER_ID && msg.text) return msg;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!aiEnabled) {
      setBubble((current) => current?.aiOnly ? null : current);
      return;
    }
    if (!latestBotMessage?.text || !dialogEnabled) return;
    const clean = latestBotMessage.text.replace(/\[qqface:[^\]]+\]/gi, '').trim().slice(0, 44);
    if (!clean) return;
    if (!['drag', 'slingshot_aim', 'physics', 'sleep'].includes(stateRef.current)
      && !ONE_SHOT_STATES.has(stateRef.current)) {
      if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
      roamTargetRef.current = null;
      setPetState('happy');
      setPlayKey((serial) => serial + 1);
    }
    say(clean.length >= 44 ? `${clean}…` : clean, 5500, { aiOnly: true });
  }, [aiEnabled, dialogEnabled, latestBotMessage?.id, latestBotMessage?.text, say]);

  // 监听切歌：自动报幕 + 计入听歌账本
  useEffect(() => {
    const nextKey = currentSong ? `${currentSong.source}:${currentSong.id}` : '';
    if (!nextKey || nextKey === lastSongKeyRef.current) return;
    const isFirstMount = !lastSongKeyRef.current;
    lastSongKeyRef.current = nextKey;
    if (isFirstMount) return;
    setSongsListenedCount((c) => c + 1);
    setRhythmEnergy((v) => Math.min(100, v + 8));
    if (dialogEnabled) {
      if (!['drag', 'slingshot_aim', 'physics', 'sleep'].includes(stateRef.current)
        && !ONE_SHOT_STATES.has(stateRef.current)) {
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        roamTargetRef.current = null;
        setPetState('happy');
        setPlayKey((serial) => serial + 1);
      }
      const requesterText = typeof currentSong?.requestedBy === 'string' && currentSong.requestedBy.trim()
        ? `（由 ${currentSong.requestedBy.trim()} 点播）`
        : '';
      say(
        `🎵 切歌咯～正在播放《${(currentSong?.name || '').slice(0, 16)}》${requesterText}，摇起小鱼尾巴 ♪`,
        4600,
      );
    }
  }, [currentSong, dialogEnabled, say]);

  // 低频读取现有歌词时间轴，不让播放进度持续重绘整个桌宠
  useEffect(() => {
    if (!lyricInteractionEnabled || !isPlaying || !currentSong || !lyrics.length) return;
    const timer = window.setInterval(() => {
      if (document.hidden || isAiThinking || pomodoroEndAt || menuPos
        || bubbleTimerRef.current || Date.now() - lastInteractRef.current < 8000
        || !['idle', 'roam'].includes(stateRef.current)) return;
      const time = readLocalPlaybackTime(currentSong);
      const line = getActiveLyricLine(lyrics, time);
      // 长间奏或歌词结束后不拿上一句继续互动
      if (!line || time - line.time > 12) return;
      const reaction = sampleLyricReaction(
        lyricReactionRef.current,
        `${currentSong.source}:${currentSong.id}:${currentSong.queueId ?? ''}`,
        line.text, Date.now(),
      );
      if (!reaction) return;
      if (playEnabled) playOriginalAction(reaction.action);
      say(reaction.text, 6500);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [currentSong, isAiThinking, isPlaying, lyricInteractionEnabled, lyrics, menuPos,
    playEnabled, playOriginalAction, pomodoroEndAt, say]);

  // 监听 AI 思考/工作状态联动
  useEffect(() => {
    const working = (isAiThinking && workEnabled) || Boolean(pomodoroEndAt);
    if (working && !['drag', 'slingshot_aim', 'physics', 'sleep'].includes(stateRef.current)
      && !ONE_SHOT_STATES.has(stateRef.current)) {
      if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
      roamTargetRef.current = null;
      setPeekSide(null);
      setPetState('work');
    } else if (!working && stateRef.current === 'work') {
      setPetState('idle');
    }
  }, [isAiThinking, workEnabled, pomodoroEndAt]);

  // 听歌时长累计 & 番茄钟倒计时 & 放歌音符飘动 & 能量微循环
  useEffect(() => {
    if (!deskPetEnabled || !petEnabled || isMobileViewport) return;
    let tickCount = 0;
    const timer = window.setInterval(() => {
      tickCount += 1;
      if (isPlaying) {
        setSessionListenSeconds((s) => s + 1);
        setRhythmEnergy((v) => Math.min(100, v + 0.15));
        if (tickCount % 6 === 0 && (stateRef.current === 'idle' || stateRef.current === 'work')) {
          const notes = ['♪', '🎵', '🎶'];
          spawnParticle('note', notes[tickCount % notes.length], (tickCount % 2 === 0 ? 1 : -1) * 14, -12);
        }
      } else {
        setRhythmEnergy((v) => Math.max(25, v - 0.08));
      }
      if (pomodoroEndAt) {
        const diff = Math.max(0, pomodoroEndAt - Date.now());
        if (diff <= 0) {
          setPomodoroEndAt(null);
          setPomodoroRemainingText('');
          spawnParticle('heart', '🍅', 0, -16);
          playOriginalAction('工作状态-雀跃庆祝');
          say('🍅 叮咚！25 分钟专注听歌番茄钟完成啦，本鱼给你鼓鼓掌，起来伸个懒腰吧～✨', 6500, {
            withBars: true,
            force: true,
          });
        } else {
          const mins = Math.floor(diff / 60000);
          const secs = Math.floor((diff % 60000) / 1000);
          setPomodoroRemainingText(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
          // 对齐原版 enterPomoGap：专注期间每隔 45 秒在原版工作动作池中自然轮换
          if (tickCount % 45 === 0 && stateRef.current === 'work') {
            setPlayKey((serial) => serial + 1);
          }
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deskPetEnabled, isMobileViewport, isPlaying, petEnabled, playOriginalAction, pomodoroEndAt, say, spawnParticle]);

  // 核心动画循环：走动漫游 (roam) + 物理引擎抛投/弹射/重力反弹 (physics)
  useEffect(() => {
    if (!deskPetEnabled || !petEnabled || isMobileViewport) return;
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      const curState = stateRef.current;

      if (curState === 'drag' && physicsEnabled && dragTargetRef.current) {
        const target = dragTargetRef.current;
        const vx = springStep(velRef.current.vx, posRef.current.x, target.x, dt);
        const vy = springStep(velRef.current.vy, posRef.current.y, target.y, dt);
        velRef.current = { vx, vy };
        setPos(clampViewportPos(posRef.current.x + vx * dt, posRef.current.y + vy * dt));
      } else if (curState === 'physics') {
        const min = clampViewportPos(-Infinity, -Infinity);
        const max = clampViewportPos(Infinity, Infinity);
        const bounds = { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
        let next = { ...posRef.current, ...velRef.current };
        const count = throwSubsteps(next.vx, next.vy, dt);
        let rest = false;
        for (let index = 0; index < count; index++) {
          const step = throwStep(next, dt / count, bounds);
          next = step;
          if (step.hit) {
            const sy = landingSquash(step.hit.speed);
            triggerSquash(1 / Math.sqrt(sy), sy, 220);
          }
          if (step.atRest) { rest = true; break; }
        }
        velRef.current = { vx: next.vx, vy: next.vy };
        if (Math.abs(next.vx) > 8) setFacingLeft(next.vx < 0);
        setTiltDeg(rest ? 0 : Math.max(-28, Math.min(28, next.vx * 0.032)));
        setPos({ x: next.x, y: next.y });
        if (rest) setPetState(baseStateRef.current);
      } else if ((curState === 'roam' || curState === 'surf_progress') && roamTargetRef.current) {
        const target = roamTargetRef.current;
        const dx = target.x - posRef.current.x;
        const dy = target.y - posRef.current.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= 6) {
          const finalPos = { x: target.x, y: target.y };
          setPos(finalPos);
          setTiltDeg(0);
          const cb = target.onArrive;
          roamTargetRef.current = null;
          if (cb) cb();
          else setPetState('idle');
        } else {
          const stepDist = Math.min(dist, target.speed * dt);
          const nx = posRef.current.x + (dx / dist) * stepDist;
          const ny =
            posRef.current.y +
            (dy / dist) * stepDist +
            Math.sin(now / 150) * 0.45;
          setFacingLeft(dx < 0);
          setTiltDeg(dx < 0 ? -5 : 5);
          setPos({ x: nx, y: ny });
        }
      }

      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [clampViewportPos, deskPetEnabled, isMobileViewport, petEnabled, physicsEnabled, triggerSquash]);

  // AI 自主行为调度器：根据用户个人开关自动在 待机 / 走动漫游 / 玩耍 / 组件互动 / 音乐碎碎念 之间切换
  useEffect(() => {
    if (!deskPetEnabled || !petEnabled || isMobileViewport) return;
    const timer = window.setInterval(() => {
      const cur = stateRef.current;
      if (cur !== 'idle') return;
      if (isAiThinking && workEnabled) return;

      // 源码以交互空闲时长决定小憩，不随机把角色切入睡眠
      if (idleEnabled && !pomodoroEndAt && Date.now() - lastInteractRef.current > 100000) {
        autoDozeRef.current = true;
        setPetState('sleep');
        return;
      }
      if (pomodoroEndAt || Date.now() - lastAutoActionRef.current < 40000) return;
      const actions: Array<() => void> = [];

      if (roamEnabled) {
        actions.push(() => {
          const w = window.innerWidth;
          const h = window.innerHeight;
          const dest = clampViewportPos(
            40 + Math.random() * Math.max(120, w - PET_W - 80),
            72 + Math.random() * Math.max(120, h - PET_H - 180),
          );
          setPeekSide(null);
          setPetState('roam');
          roamTargetRef.current = { x: dest.x, y: dest.y, speed: 135 };
        });
      }

      if (playEnabled) {
        actions.push(() => playOriginalAction(pickOriginalAutomaticAction(character, {
          isPlaying, remainingActions: remainingAutoActionsRef.current,
        })));
      }

      if (uiInteractEnabled) {
        actions.push(() => {
          const uiPool = [
            triggerPeekDivAction,
            triggerPonderButtonAction,
            triggerSneakClickButtonAction,
            triggerSurfProgressAction,
            triggerFishQueueAction,
            triggerDjCoverAction,
            triggerTreasureHotAction,
            triggerPerchChatAction,
          ];
          const chosenUi = uiPool[Math.floor(Math.random() * uiPool.length)];
          chosenUi();
        });
      }

      if (dialogEnabled) {
        actions.push(() => {
          say(pickMusicLine(), 4800);
        });
      }

      if (actions.length > 0) {
        lastAutoActionRef.current = Date.now();
        const fn = actions[Math.floor(Math.random() * actions.length)];
        fn();
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [
    clampViewportPos,
    deskPetEnabled,
    dialogEnabled,
    idleEnabled,
    isAiThinking,
    isMobileViewport,
    isPlaying,
    petEnabled,
    pickMusicLine,
    playEnabled,
    roamEnabled,
    say,
    triggerDjCoverAction,
    triggerFishQueueAction,
    triggerPeekDivAction,
    triggerPerchChatAction,
    character,
    playOriginalAction,
    pomodoroEndAt,
    triggerPonderButtonAction,
    triggerSneakClickButtonAction,
    triggerSurfProgressAction,
    triggerTreasureHotAction,
    uiInteractEnabled,
    workEnabled,
  ]);

  // 鼠标靠近只负责唤醒桌宠，不改变桌宠位置，避免触碰时产生轻微移位
  useEffect(() => {
    if (!deskPetEnabled || !petEnabled || isMobileViewport || !idleEnabled) return;
    let rafId = 0;
    const onMouseMove = (e: MouseEvent) => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const cx = posRef.current.x + PET_W / 2;
        const cy = posRef.current.y + PET_H / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < PET_W / 2) {
          lastInteractRef.current = Date.now();
          if (autoDozeRef.current) {
            autoDozeRef.current = false;
            setPetState(baseStateRef.current);
          }
        }
      });
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [deskPetEnabled, idleEnabled, isMobileViewport, petEnabled]);

  // 窗口尺寸变化时保持在视口内
  useEffect(() => {
    const onResize = () => {
      setPos((prev) => clampViewportPos(prev.x, prev.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampViewportPos]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragTargetRef.current = null;
      if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
      if (squashTimerRef.current) window.clearTimeout(squashTimerRef.current);
    };
  }, [deskPetEnabled, petEnabled, isMobileViewport]);

  // 菜单展开、筛选或视口变化后，按实际尺寸保持在窗口内
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menuPos || !menu) return;
    const fitMenu = () => {
      const rect = menu.getBoundingClientRect();
      setMenuPos((previous) => {
        if (!previous) return previous;
        const x = Math.max(12, Math.min(previous.x, window.innerWidth - rect.width - 12));
        const y = Math.max(12, Math.min(previous.y, window.innerHeight - rect.height - 12));
        return x === previous.x && y === previous.y ? previous : { x, y };
      });
    };
    fitMenu();
    const observer = new ResizeObserver(fitMenu);
    observer.observe(menu);
    window.addEventListener('resize', fitMenu);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fitMenu);
    };
  }, [menuPos, showActSubmenu, character, isMobileViewport, petEnabled, deskPetEnabled]);

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!menuPos) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-desk-pet-menu="true"]')) return;
      setMenuPos(null);
      setShowActSubmenu(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [menuPos]);

  // 鼠标拖拽 / 抛投 / Shift 蓄力弹弓弹射
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragCleanupRef.current?.();
    if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
    setMenuPos(null);
    setShowActSubmenu(false);
    setPeekSide(null);
    roamTargetRef.current = null;

    lastInteractRef.current = Date.now();
    autoDozeRef.current = false;
    velRef.current = { vx: 0, vy: 0 };
    const useSlingshot = physicsEnabled && (e.shiftKey || stateRef.current === 'slingshot_aim');
    isSlingshotDragRef.current = useSlingshot;
    dragMovedRef.current = false;
    dragOffsetRef.current = {
      dx: e.clientX - posRef.current.x,
      dy: e.clientY - posRef.current.y,
    };
    dragSamplesRef.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    const pointerId = e.pointerId;
    const startPointer = { x: e.clientX, y: e.clientY };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const distMoved = Math.hypot(
        moveEvent.clientX - startPointer.x,
        moveEvent.clientY - startPointer.y,
      );
      if (distMoved > 5) {
        dragMovedRef.current = true;
        hasUserMovedRef.current = true;
      }
      if (!dragMovedRef.current) return;

      if (isSlingshotDragRef.current) {
        setPetState('slingshot_aim');
        setSlingshotPull({ curX: moveEvent.clientX, curY: moveEvent.clientY });
        const pullDx = posRef.current.x + PET_W / 2 - moveEvent.clientX;
        setFacingLeft(pullDx < 0);
      } else {
        setPetState('drag');
        const nextPos = clampViewportPos(
          moveEvent.clientX - dragOffsetRef.current.dx,
          moveEvent.clientY - dragOffsetRef.current.dy,
        );
        if (physicsEnabled) dragTargetRef.current = nextPos;
        else setPos(nextPos);
        const now = performance.now();
        dragSamplesRef.current.push({ x: moveEvent.clientX, y: moveEvent.clientY, t: now });
        dragSamplesRef.current = trimTrail(dragSamplesRef.current, now);
      }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      dragTargetRef.current = null;

      if (isSlingshotDragRef.current && dragMovedRef.current) {
        const anchorX = posRef.current.x + PET_W / 2;
        const anchorY = posRef.current.y + PET_H / 2;
        const pullDx = anchorX - upEvent.clientX;
        const pullDy = anchorY - upEvent.clientY;
        setSlingshotPull(null);
        velRef.current = slingshotVelocity(
          pullAngle(-pullDx, -pullDy), slingshotPower(Math.hypot(pullDx, pullDy), PET_W * sizeScale),
        );
        triggerSquash(0.75, 1.28, 220);
        spawnParticle('spark', '🚀', 0, 0);
        setPetState('physics');
        say('咻——！！本鱼发射升空啦，快接住我～！🚀✨', 4200, { force: true });
        return;
      }

      setSlingshotPull(null);

      if (dragMovedRef.current) {
        if (physicsEnabled) {
          const velocity = estimateReleaseVelocity(dragSamplesRef.current, performance.now());
          if (!velocity) { setPetState(baseStateRef.current); return; }
          const { vx, vy } = velocity;
          velRef.current = velocity;
          setPetState('physics');
          if (Math.hypot(vx, vy) > 480) {
            say('哇啊啊～飞起来咯！慢点甩，鱼尾巴要转成螺旋桨啦 🌀', 3800);
          }
        } else {
          setPetState('idle');
        }
        return;
      }

      // 单击 / 连续戳击互动
      const now = Date.now();
      clickTimestampsRef.current = [...clickTimestampsRef.current.filter((t) => now - t < 1600), now];
      setInteractionCount((c) => c + 1);
      triggerSquash(1.16, 0.85, 220);

      if (clickTimestampsRef.current.length >= 4) {
        clickTimestampsRef.current = [];
        setPetState('dizzy');
        spawnParticle('spark', '💫', 0, -14);
        say('呜哇＠_＠ 别连戳本鱼肚皮啦，满眼都是旋转的八分音符～', 4200, { force: true });
        if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = window.setTimeout(() => setPetState('idle'), 2600);
        return;
      }

      spawnParticle('heart', '💖', 0, -8);
      setMoodScore((v) => Math.min(100, v + 4));
      playOriginalAction(UPSTREAM_ANIM.clicks[Math.floor(Math.random() * UPSTREAM_ANIM.clicks.length)]);
      say(pickMusicLine(), 4600, { withBars: true, force: true });
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
      dragTargetRef.current = null;
      setSlingshotPull(null);
      setPetState(baseStateRef.current);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  };

  if (isMobileViewport || !deskPetEnabled) {
    return null;
  }

  // 收起后把召唤胶囊放在底栏右下角，避开聊天发送区域
  if (!petEnabled) {
    return createPortal(
      <div
        data-desk-pet-root="true"
        data-desk-pet-collapsed="true"
        className="pointer-events-auto fixed bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] right-3 z-[46]"
      >
        <Tooltip side="left" content={`召唤我的桌宠「${botName}」`}>
          <button
            type="button"
            onClick={() => updatePref('enabled', true)}
            className="flex h-8 items-center gap-1.5 rounded-full border border-[#7896ff]/40 bg-white/95 px-3 text-xs font-semibold text-[#1e2a52] shadow-[0_6px_18px_rgba(18,32,86,0.26)] transition-transform hover:scale-105"
          >
            <span className="max-w-[5.5rem] truncate">{botName}</span>
          </button>
        </Tooltip>
      </div>,
      document.body,
    );
  }

  const bubbleFlipBelow = pos.y < 135;
  const displayBubbleText = isAiThinking && workEnabled
    ? activeThinkingStep
    : bubble?.aiOnly && !aiEnabled ? '' : bubble?.text || '';
  const listenMins = Math.floor(sessionListenSeconds / 60);

  // 计算躲在 div 后探头时的旋转与位移
  const peekTransform =
    petState === 'peek_div'
      ? peekSide === 'left'
        ? 'translateX(18px) rotate(26deg)'
        : peekSide === 'right'
          ? 'translateX(-18px) rotate(-26deg)'
          : 'translateY(14px) rotate(12deg)'
      : `rotate(${tiltDeg}deg)`;

  return createPortal(
    <div
      data-desk-pet-root="true"
      className="room-desk-pet pointer-events-none fixed inset-0 z-[46] overflow-hidden select-none"
    >
      {/* 偷偷戳按钮触发的结界水波纹特效 */}
      {ripples.map((r) => (
        <div
          key={r.id}
          style={{ left: r.x, top: r.y }}
          className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2 z-[47]"
        >
          <span className="block h-14 w-14 animate-ping rounded-full border-2 border-[#4d6bfe] bg-[#4d6bfe]/20" />
          <span className="mt-1 block whitespace-nowrap rounded-full bg-[#1e2a52]/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            ⚡ 结界弹开！
          </span>
        </div>
      ))}

      {/* 弹弓蓄力瞄准虚线 */}
      {slingshotPull && (
        <svg className="pointer-events-none fixed inset-0 h-full w-full z-[45]">
          <line
            x1={pos.x + PET_W / 2}
            y1={pos.y + PET_H / 2}
            x2={slingshotPull.curX}
            y2={slingshotPull.curY}
            stroke="#4d6bfe"
            strokeWidth="3"
            strokeDasharray="6 5"
          />
          <circle cx={slingshotPull.curX} cy={slingshotPull.curY} r="6" fill="#ff6f9c" />
        </svg>
      )}

      {/* 桌宠主体容器 */}
      <div
        style={{
          transform: `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0) scale(${sizeScale})`,
          transformOrigin: 'center bottom',
          width: PET_W,
          height: PET_H,
        }}
        className="pointer-events-auto absolute top-0 left-0"
      >
        {/* dafeiyu-pet 同款纯白圆角对话气泡 (#bubble) */}
        {displayBubbleText && (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.97)',
              color: '#1e2a52',
              boxShadow: '0 8px 22px rgba(18, 32, 86, 0.3), 0 0 0 1px rgba(120, 150, 255, 0.22)',
            }}
            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-20 w-max max-w-[238px] rounded-[16px] px-[14px] py-[10px] text-[14px] leading-[1.5] transition-all duration-200 ${
              bubbleFlipBelow ? 'top-[134px]' : 'bottom-[134px]'
            }`}
          >
            <div className="break-words text-center">{displayBubbleText}</div>

            {/* dafeiyu-pet 同款双进度条 (#bubble-bars)：音浪能量 & 心情指数 */}
            {showBubbleBars && (
              <div className="mt-1.5 flex flex-col gap-1 border-t border-dashed border-[#1e2a52]/15 pt-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#5a6690]">
                  <span className="shrink-0 whitespace-nowrap text-left">🎵 音浪</span>
                  <div className="h-[5px] min-w-[72px] flex-1 overflow-hidden rounded-full bg-[#dce3ff]">
                    <div
                      style={{
                        width: `${Math.round(rhythmEnergy)}%`,
                        background: 'linear-gradient(90deg, #ffb347, #ff8a3d)',
                      }}
                      className="h-full rounded-full transition-all duration-300"
                    />
                  </div>
                  <span className="w-7 shrink-0 text-right tabular-nums">{Math.round(rhythmEnergy)}%</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#5a6690]">
                  <span className="shrink-0 whitespace-nowrap text-left">💖 心情</span>
                  <div className="h-[5px] min-w-[72px] flex-1 overflow-hidden rounded-full bg-[#dce3ff]">
                    <div
                      style={{
                        width: `${Math.round(moodScore)}%`,
                        background: 'linear-gradient(90deg, #ff9ec7, #ff6f9c)',
                      }}
                      className="h-full rounded-full transition-all duration-300"
                    />
                  </div>
                  <span className="w-7 shrink-0 text-right tabular-nums">{Math.round(moodScore)}%</span>
                </div>
              </div>
            )}

            {/* dafeiyu-pet 同款账本明细 (#bubble-usage)：本场听歌账本 */}
            {showMusicLedger && (
              <div className="mt-1.5 border-t border-dashed border-[#1e2a52]/16 pt-1.5 text-left text-[11px] font-medium leading-[1.55] text-[#475280]">
                <div>
                  本场陪伴 <b className="font-bold text-[#1e2a52]">{listenMins} 分钟</b> · 已听{' '}
                  <b className="font-bold text-[#d4551c]">{songsListenedCount} 首</b>
                </div>
                <div>
                  当前队列 <b className="font-bold text-[#1e2a52]">{queueLength} 首</b> · 在线{' '}
                  <b className="font-bold text-[#1e2a52]">{userCount} 人</b>
                </div>
                <div>
                  互动摸摸 <b className="font-bold text-[#d4551c]">{interactionCount} 次</b> · 音浪{' '}
                  <b className="font-bold text-[#1e2a52]">{Math.round(rhythmEnergy)}%</b>
                </div>
              </div>
            )}

            {/* 气泡小三角尾巴 (.bubble-tail) */}
            <div
              style={
                bubbleFlipBelow
                  ? { borderBottomColor: 'rgba(255, 255, 255, 0.97)' }
                  : { borderTopColor: 'rgba(255, 255, 255, 0.97)' }
              }
              className={`absolute left-1/2 -translate-x-1/2 h-0 w-0 border-[6px] border-transparent ${
                bubbleFlipBelow ? '-top-[11px]' : '-bottom-[11px]'
              }`}
            />
          </div>
        )}

        {/* dafeiyu-pet 同款蓝紫胶囊徽章 (#chip)：番茄钟或 AI 工作状态 */}
        {(pomodoroRemainingText || (isAiThinking && workEnabled)) && (
          <div
            style={{
              background: 'rgba(77, 107, 254, 0.94)',
              boxShadow: '0 4px 12px rgba(30, 50, 140, 0.35)',
            }}
            className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded-full px-[13px] py-[5px] text-[13px] tabular-nums text-white"
          >
            {pomodoroRemainingText ? `🍅 ${pomodoroRemainingText}` : `⚡ ${botName}工作中`}
          </div>
        )}

        {/* dafeiyu-pet 同款睡眠 Zzz 蓝色发光飘字 (#zzz) */}
        {petState === 'sleep' && (
          <div className="pointer-events-none absolute top-2 right-2 z-10">
            <span
              style={{ textShadow: '0 2px 6px rgba(30, 60, 150, 0.45)' }}
              className="inline-block animate-bounce text-sm font-extrabold text-[#b8d4ff]"
            >
              Zzz
            </span>
          </div>
        )}

        {/* 粒子特效层 (#fx)：喂食食物掉落、飘心、音符 */}
        <div className="pointer-events-none absolute inset-0 z-20 overflow-visible">
          {particles.map((p) => (
            <span
              key={p.id}
              style={{ left: p.x, top: p.y }}
              className="absolute -translate-x-1/2 -translate-y-1/2 animate-bounce text-lg drop-shadow"
            >
              {p.char}
            </span>
          ))}
        </div>

        {/* 桌宠多层动画骨架：#lean -> #flip -> #tilt -> #squash */}
        <div
          onPointerDown={handlePointerDown}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (aiEnabled) {
              onQuickWake(botName);
              say(`🎤 已在输入框召唤 @${botName}，快告诉我你想听什么歌吧～`, 4000, { force: true, aiOnly: true });
            } else {
              handlePatPet();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuPos({ x: Math.max(12, e.clientX), y: Math.max(12, e.clientY) });
            setShowActSubmenu(false);
          }}
          className="relative flex h-full w-full cursor-grab items-center justify-center transition-transform duration-150 active:cursor-grabbing"
        >
          <div
            style={{
              transform: 'none',
            }}
            className="h-full w-full transition-transform duration-200"
          >
            <div
              style={{
                transform: peekTransform,
              }}
              className="h-full w-full transition-transform duration-200"
            >
              <div
                style={{
                  transform: `scale(${squash.sx}, ${squash.sy})`,
                  transformOrigin: '50% 88%',
                }}
                className="h-full w-full transition-transform duration-150"
              >
                <RoomPetAnimation originalAction={originalAction} playKey={playKey} onComplete={finishOneShot} character={character} facingLeft={facingLeft} state={petState} thinking={isAiThinking && workEnabled} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* dafeiyu-pet 同款纯白圆角右键菜单 (#menu) */}
      {menuPos && (
        <div
          ref={menuRef}
          data-desk-pet-menu="true"
          style={{
            left: menuPos.x,
            top: menuPos.y,
            background: '#fff',
            color: '#1e2a52',
            boxShadow: '0 10px 28px rgba(18, 32, 86, 0.32), 0 0 0 1px rgba(120, 150, 255, 0.26)',
          }}
          className="pointer-events-auto fixed z-[55] flex max-h-[calc(100dvh-24px)] w-[320px] min-w-[216px] max-w-[min(360px,90vw)] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-[12px] p-1.5 text-[14px] [&>button]:shrink-0 [&>div]:shrink-0"
        >
          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              say(pickMusicLine(), 5000, { withBars: true, force: true });
            }}
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span>💬</span>
            <span>音乐碎碎念</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              handleFeedMusicSnack();
            }}
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span>🍙</span>
            <span>投喂音符点心</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              handlePatPet();
            }}
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span>🤍</span>
            <span>摸摸头夸夸</span>
          </button>

          {/* 🎬 点播动作二级面板 */}
          <button
            type="button"
            onClick={() => setShowActSubmenu((v) => !v)}
            className="flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span className="flex items-center gap-2">
              <span>🎬</span>
              <span>点播动作与互动</span>
            </span>
            <span className="text-xs">{showActSubmenu ? '▾' : '▸'}</span>
          </button>

          {showActSubmenu && (
            <div className="my-0.5 grid grid-cols-2 gap-1 rounded-[9px] bg-[#4d6bfe]/[0.06] p-1.5 text-[13px] whitespace-nowrap">
              <div className="col-span-2">
                <OriginalPetActionPicker character={character} onPlay={playOriginalAction} />
                <div className="mt-2 border-t border-[#1e2a52]/10 pt-2 text-[13px] text-[#475280]">音乐房间互动</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerPeekDivAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🫣 躲面板探头
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerPonderButtonAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🤔 按钮旁思考
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerSneakClickButtonAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                😤 偷戳按钮弹开
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerSurfProgressAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🏄 进度条冲浪
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerFishQueueAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🎣 队列钓音符
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerDjCoverAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🕶️ 封面搓碟DJ
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerTreasureHotAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🔍 热榜寻宝歌
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  triggerPerchChatAction();
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🧹 擦亮聊天框
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  setPetState('slingshot_aim');
                  say('🚀 已进入弹弓准备！直接按住本鱼往后拉再松手就能发射啦～', 4500, { force: true });
                }}
                className="rounded-[6px] px-2 py-1 text-left hover:bg-[#4d6bfe]/16 hover:text-[#2f4fe0]"
              >
                🚀 蓄力弹射
              </button>
            </div>
          )}

          <div className="my-0.5 h-px bg-[#1e2a52]/10" />

          <button
            type="button"
            onClick={() => {
              if (stateTimerRef.current) window.clearTimeout(stateTimerRef.current);
              roamTargetRef.current = null;
              autoDozeRef.current = false;
              lastInteractRef.current = Date.now();
              setPeekSide(null);
              setTiltDeg(0);
              const nextSleeping = petState !== 'sleep';
              setPetState(nextSleeping ? 'sleep' : baseStateRef.current);
              setMenuPos(null);
              say(
                nextSleeping
                  ? '😴 呼噜呼噜…本鱼先伴着音乐眯一小会儿，有好歌记得叫醒我哦～'
                  : '☀️ 啵！满血醒来啦，继续陪大家一起嗨听全场 ♪',
                4200,
                { force: true },
              );
            }}
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span>{petState === 'sleep' ? '☀️' : '😴'}</span>
            <span>{petState === 'sleep' ? '叫醒它' : '让它睡一会儿'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              playOriginalAction(
                pickMusicLedgerAction({
                  isPlaying,
                  queueLength,
                  songsListenedCount,
                }),
              );
              say(`📊 ${botName}的本场伴听手账来啦～`, 6200, {
                withBars: true,
                withLedger: true,
                force: true,
              });
            }}
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span>📊</span>
            <span>本场听歌账本</span>
          </button>

          {!pomodoroEndAt ? (
            <button
              type="button"
              onClick={() => {
                setMenuPos(null);
                setPomodoroEndAt(Date.now() + 25 * 60 * 1000);
                setPomodoroRemainingText('25:00');
                say('🍅 25 分钟专注听歌番茄钟开启！本鱼陪你安心听歌专注做事～', 4500, { force: true });
              }}
              className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
            >
              <span>🍅</span>
              <span>专注听歌番茄钟 (25m)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMenuPos(null);
                setPomodoroEndAt(null);
                setPomodoroRemainingText('');
                say('⏹ 已结束本次专注听歌番茄钟，休息一下听首轻松的歌吧～', 4000, { force: true });
              }}
              className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[#d4551c] transition-colors hover:bg-[#4d6bfe]/12"
            >
              <span>⏹</span>
              <span>结束番茄钟 ({pomodoroRemainingText})</span>
            </button>
          )}

          {aiEnabled && (
            <button
              type="button"
              onClick={() => {
                setMenuPos(null);
                onQuickWake(botName);
              }}
              className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
            >
              <span>🎤</span>
              <span>@{botName} 帮我点歌</span>
            </button>
          )}

          <div className="my-0.5 h-px bg-[#1e2a52]/10" />

          <button
            type="button"
            role="switch"
            aria-checked={roamEnabled}
            aria-label="走动漫游"
            onClick={() => {
              updatePref('roamEnabled', !roamEnabled);
              setMenuPos(null);
            }}
            className="flex items-center justify-between gap-3 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span className="flex items-center gap-2"><span>👣</span><span>走动漫游</span></span>
            <span className="text-xs">{roamEnabled ? '已开启' : '已关闭'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              if (onOpenPetSettings) {
                onOpenPetSettings();
              } else {
                window.dispatchEvent(new CustomEvent('openmusic:open-room-settings', { detail: { tab: 'chat', section: 'desk-pet' } }));
              }
            }}
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#2f4fe0]"
          >
            <span>⚙️</span>
            <span>我的桌宠设置</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMenuPos(null);
              updatePref('enabled', false);
            }}
            className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[#475280] transition-colors hover:bg-[#4d6bfe]/12 hover:text-[#1e2a52]"
          >
            <span>🙈</span>
            <span>收起我的桌宠</span>
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}


// 使用上游原始 VP9-alpha 动画，保留透明画布比例，避免把角色拉伸或改画
function RoomPetAnimation({ character, facingLeft, state, thinking, originalAction, playKey, onComplete }: {
  character: DeskPetCharacterId; facingLeft: boolean; state: PetState; thinking: boolean;
  originalAction: string; playKey: number; onComplete: () => void;
}) {
  const animation = state === 'original_action' ? originalAction
    : state === 'drag' || state === 'slingshot_aim' || state === 'physics' ? 'drag'
    : state === 'sleep' ? 'sleep'
    : state === 'angry_bounced' || state === 'dizzy' ? 'angry'
    : state === 'eat' ? 'eat'
    : state === 'fish_queue' ? 'bubble'
    : state === 'dj_cover' ? 'dance'
    : state === 'perch_chat' ? 'clean'
    : state === 'ponder_button' ? 'think'
    : state === 'work' ? 'work'
    : state === 'happy' ? 'happy'
    : state === 'roam' || state === 'surf_progress' ? 'roam'
    : state === 'peek_div' || state === 'treasure_hot' || state === 'sneak_click' ? 'ponder'
    : thinking ? 'think' : 'idle';
  return <DeskPetAppearance character={character} animation={animation} facingLeft={facingLeft}
    loop={!ONE_SHOT_STATES.has(state)} playKey={playKey} onComplete={onComplete} />;
}
