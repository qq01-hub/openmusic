import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getCoverUrl } from '../../api/music';
import { readLocalPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackDuration, clampPlaybackTime } from '../../hooks/useTrackDuration';
import { useFavorites } from '../../hooks/useFavorites';
import { useSocket } from '../../hooks/useSocket';
import { getClientId } from '../../lib/clientId';
import { resolveDislikeSkipThreshold } from '../../lib/dislikeSkip';
import { roomVisualFxLive } from '../../lib/roomVisualFxLive';
import { useRoomStore } from '../../stores/roomStore';
import type { QueueItem } from '../../types';
import { getCachedGalaxyAudioBands } from './lib/galaxyAudio';
import { releaseGalaxyPointerInteraction } from './lib/galaxyGestureRotation';
import { galaxyOrbitRef, setGalaxyOrbitFocusZone } from './lib/galaxyOrbit';
import {
  applyFloatingSongCardPose,
  createFloatingSongCardMesh,
  disposeFloatingSongCardMesh,
  drawFloatingSongCard,
  getFloatingSongCardSideLayout,
  getShelfSideAnchor,
  hitTestFloatingSongCardAction,
  projectWorldToNdc,
  type FloatingSongCardAction,
  type FloatingSongCardActionId,
  type FloatingSongCardActionRegion,
  type FloatingSongCardItem,
} from './lib/galaxyFloatingSongCard';
import type { RoomVisualFxSettings } from '../../lib/roomVisualPreset';

const CLICK_THRESHOLD = 6;
const SHELF_VISIBLE_RADIUS = 5;
/** 跟拍镜头允许偏离居中卡片的最大槽位 */
const FOCUS_SLOT_LIMIT = 2;
const MAX_SHELF_ITEMS = 24;

type DisplayQueueItem = QueueItem & { isCurrent: boolean };

type CardSlot = ReturnType<typeof createFloatingSongCardMesh>;

/**
 * slot 是卡片相对居中卡片的偏移（applyFloatingSongCardPose 里的 delta），不是队列绝对序号。
 * 用绝对序号会让队列一长就把 lookAt 甩到画面外，镜头来回抽搐。
 */
function makeCardFocusZone(
  mode: 'side' | 'stage',
  slot: number,
  offsets?: Pick<RoomVisualFxSettings, 'shelfOffsetX' | 'shelfOffsetY' | 'shelfOffsetZ'>,
): { theta: number; phi: number; radius: number; lookAt: THREE.Vector3 } {
  const ox = offsets?.shelfOffsetX ?? 0;
  const oy = offsets?.shelfOffsetY ?? 0;
  const oz = offsets?.shelfOffsetZ ?? 0;
  const d = Math.max(-FOCUS_SLOT_LIMIT, Math.min(FOCUS_SLOT_LIMIT, slot));
  const absD = Math.abs(d);
  if (mode === 'stage') {
    return {
      theta: -0.08 + d * 0.08,
      phi: -0.2,
      radius: 4.36 + Math.min(absD, 2) * 0.08,
      lookAt: new THREE.Vector3(d * 0.72 + ox, -1.28 + oy, 0.86 - d * 0.03 + oz),
    };
  }
  const anchor = getShelfSideAnchor(ox, oy, oz);
  return {
    theta: 0.28,
    phi: -0.04 - d * 0.025,
    radius: 4.74 + Math.min(absD, 3) * 0.05,
    lookAt: new THREE.Vector3(anchor.x - 1.4, anchor.y + 0.22 - d * 0.9, anchor.z - absD * 0.08),
  };
}

function isPointerNearShelfSide(
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  fx: RoomVisualFxSettings,
): boolean {
  const layout = getFloatingSongCardSideLayout();
  const anchor = projectWorldToNdc(
    getShelfSideAnchor(fx.shelfOffsetX, fx.shelfOffsetY, fx.shelfOffsetZ),
    camera,
  );
  const narrow = typeof window !== 'undefined' && window.innerWidth < 980;
  const marginX = (narrow ? 0.24 : 0.28) * fx.shelfSize;
  const marginY = (0.34 + layout.sideYStep * 0.18) * fx.shelfSize;
  return Math.abs(pointer.x - anchor.x) < marginX
    && Math.abs(pointer.y - anchor.y) < marginY;
}

function syncVisibleShelfMatrices(meshes: THREE.Mesh[]): void {
  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    mesh.updateMatrixWorld(true);
  }
}

export default function GalaxyFloatingSongCard() {
  const room = useRoomStore((s) => s.room);
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const canControlPlayback = useRoomStore((s) => s.canControlPlayback);
  const memberJumpEnabled = Boolean(room?.memberJumpEnabled);
  const { toggleFavorite, isFavorite } = useFavorites();
  const { removeSong, requestJump, toggleQueueLike, toggleCurrentDislike, banRoomSong } = useSocket();
  const current = room?.current ?? null;
  const duration = useTrackDuration(current);
  const { camera, gl, pointer } = useThree();
  const cardsRef = useRef<CardSlot[]>([]);
  const drawKeyRef = useRef<string[]>([]);
  const hoverRef = useRef<number[]>([]);
  const pulseRef = useRef<number[]>([]);
  const presenceRef = useRef(
    roomVisualFxLive.current.shelfPresence === 'always' ? 1 : 0,
  );
  const shelfMixRef = useRef(roomVisualFxLive.current.shelfMode === 'off' ? 0 : 1);
  const lastShelfModeRef = useRef<'side' | 'stage'>(
    roomVisualFxLive.current.shelfMode === 'stage' ? 'stage' : 'side',
  );
  const raycasterRef = useRef(new THREE.Raycaster());
  const actionRegionsRef = useRef<FloatingSongCardActionRegion[][]>([]);
  const hoveredCardRef = useRef<number>(-1);
  const hoveredActionRef = useRef<FloatingSongCardActionId | null>(null);
  /** 镜头跟拍的进入 / 退出延迟计时（Mineradio focusHover 的 pendingTimer / exitTimer） */
  const focusWantRef = useRef(false);
  const focusSinceRef = useRef(0);
  /** 最近一次悬停卡片相对居中卡片的槽位偏移 */
  const focusSlotRef = useRef(0);
  const pointerDownRef = useRef<{
    x: number;
    y: number;
    cardIndex: number;
    actionId: FloatingSongCardActionId | null;
  } | null>(null);
  const actionBusyRef = useRef<string | null>(null);
  const centerTargetRef = useRef(0);
  const centerSmoothRef = useRef(0);
  const raycastPointerRef = useRef({ x: 0, y: 0 });
  const raycastFrameRef = useRef(0);
  const [actionRevision, setActionRevision] = useState(0);
  const [cardCount, setCardCount] = useState(0);

  const displaySongs = useMemo<DisplayQueueItem[]>(() => {
    if (!room) return [];
    const items = [
      ...(room.current ? [{ ...room.current, isCurrent: true }] : []),
      ...room.queue.slice(0, MAX_SHELF_ITEMS - (room.current ? 1 : 0)).map((song) => ({ ...song, isCurrent: false })),
    ];
    return items.slice(0, MAX_SHELF_ITEMS);
  }, [room?.current, room?.queue]);

  const dislikeThreshold = useMemo(() => resolveDislikeSkipThreshold(room), [room]);

  const displayItems = useMemo(() => {
    const myUserId = mySocketId || getClientId();
    return displaySongs.map((song, index) => {
      const likedByIds = Array.isArray(song.likedByIds) ? song.likedByIds : [];
      const likedByMe = Boolean(myUserId && likedByIds.includes(myUserId));
      const favorite = isFavorite(song);
      const isMine =
        !song.isCurrent &&
        Boolean(myUserId && (song.requestedById === myUserId || (!song.requestedById && song.requestedBy === nickname)));
      const actions: FloatingSongCardAction[] = [
        { id: 'favorite', label: favorite ? '已收藏' : '收藏', active: favorite, tone: 'rose' },
      ];
      if (song.isCurrent) {
        const dislikedByIds = Array.isArray(song.dislikedByIds) ? song.dislikedByIds : [];
        const dislikedByMe = Boolean(myUserId && dislikedByIds.includes(myUserId));
        actions.push({
          id: 'dislike',
          label: dislikedByMe ? '已踩' : '踩歌',
          active: dislikedByMe,
          tone: 'red',
          badge: dislikedByIds.length > 0 ? `${dislikedByIds.length}/${dislikeThreshold}` : undefined,
        });
      }
      if (!song.isCurrent) {
        if (!isMine) {
          actions.push({
            id: 'like',
            label: likedByMe ? '已点赞' : '点赞',
            active: likedByMe,
            tone: 'sky',
            badge: likedByIds.length > 0 ? String(likedByIds.length) : undefined,
          });
        }
        if (canControlPlayback || (isMine && memberJumpEnabled)) {
          actions.push({ id: 'jump', label: '插队', tone: 'amber' });
        }
        if (canControlPlayback || isMine) {
          actions.push({ id: 'remove', label: '删除', tone: 'red' });
        }
        if (canControlPlayback) {
          actions.push({ id: 'ban', label: '禁播', tone: 'amber' });
        }
      }

      const coverUrl = getCoverUrl(song, 'medium');
      const tag = song.isCurrent ? '正在播放' : index === 1 ? '下一首' : `队列 ${index}`;
      const meta = song.isCurrent
        ? `0% · ${song.album || '当前曲目'}`
        : `${song.requestedBy || '匿名'} 点歌`;
      const item: FloatingSongCardItem = {
        title: song.name,
        sub: song.artist || '未知歌手',
        coverUrl,
        tag,
        progress: 0,
        bass: 0,
        meta,
        isCurrent: song.isCurrent,
        actions,
      };
      return { song, item, likedByMe };
    });
  }, [canControlPlayback, dislikeThreshold, displaySongs, isFavorite, memberJumpEnabled, mySocketId, nickname, actionRevision]);

  useEffect(() => {
    const nextCount = displayItems.length;
    while (cardsRef.current.length < nextCount) {
      const built = createFloatingSongCardMesh();
      built.mesh.userData.cardIndex = cardsRef.current.length;
      cardsRef.current.push(built);
      drawKeyRef.current.push('');
      hoverRef.current.push(0);
      pulseRef.current.push(0);
      actionRegionsRef.current.push([]);
    }
    while (cardsRef.current.length > nextCount) {
      const removed = cardsRef.current.pop();
      if (removed) disposeFloatingSongCardMesh(removed.mesh);
      drawKeyRef.current.pop();
      hoverRef.current.pop();
      pulseRef.current.pop();
      actionRegionsRef.current.pop();
    }
    setCardCount(nextCount);
  }, [displayItems.length]);

  useEffect(() => {
    if (displayItems.length === 0) {
      centerTargetRef.current = 0;
      centerSmoothRef.current = 0;
      return;
    }
    const currentIdx = Math.max(0, displayItems.findIndex((entry) => entry.song.isCurrent));
    centerTargetRef.current = Math.min(displayItems.length - 1, currentIdx);
    centerSmoothRef.current = centerTargetRef.current;
  }, [displayItems.length]);

  useEffect(
    () => () => {
      gl.domElement.style.cursor = '';
      for (const card of cardsRef.current) disposeFloatingSongCardMesh(card.mesh);
      cardsRef.current = [];
    },
    [gl],
  );

  const getHitAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
      const objects = cardsRef.current
        .map((card) => card.mesh)
        .filter((mesh) => mesh.visible)
        .sort((a, b) => (b.renderOrder || 0) - (a.renderOrder || 0));
      syncVisibleShelfMatrices(objects);
      raycasterRef.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const hits = raycasterRef.current.intersectObjects(objects, false);
      if (!hits.length) return null;
      // 重叠时优先当前居中卡，避免命中背后卡再放大前推造成抽搐
      const centerRounded = Math.round(centerSmoothRef.current);
      const preferred =
        hits.find((entry) => Number(entry.object.userData.cardIndex ?? -1) === centerRounded)
        || hits[0];
      const cardIndex = Number(preferred.object.userData.cardIndex ?? -1);
      if (cardIndex < 0) return null;
      const uv = preferred.uv;
      const x = (uv?.x ?? 0) * 720;
      const y = (1 - (uv?.y ?? 0)) * 360;
      const actionId = hitTestFloatingSongCardAction(actionRegionsRef.current[cardIndex] || [], x, y);
      return { cardIndex, x, y, actionId };
    },
    [camera, gl],
  );

  const runCardAction = useCallback(
    async (cardIndex: number, actionId: FloatingSongCardActionId | null) => {
      if (cardIndex < 0 || !actionId) return;
      const entry = displayItems[cardIndex];
      if (!entry) return;
      const busyKey = `${entry.song.queueId}:${actionId}`;
      if (actionBusyRef.current === busyKey) return;
      actionBusyRef.current = busyKey;
      pulseRef.current[cardIndex] = 1;
      try {
        if (actionId === 'favorite') {
          await toggleFavorite(entry.song);
        } else if (actionId === 'dislike' && entry.song.isCurrent) {
          await toggleCurrentDislike();
        } else if (actionId === 'like' && !entry.song.isCurrent) {
          await toggleQueueLike(entry.song.queueId);
        } else if (actionId === 'jump' && !entry.song.isCurrent) {
          await requestJump(entry.song.queueId);
        } else if (actionId === 'remove' && !entry.song.isCurrent) {
          await removeSong(entry.song.queueId);
        } else if (actionId === 'ban' && !entry.song.isCurrent) {
          await banRoomSong(entry.song);
        }
      } finally {
        actionBusyRef.current = null;
        setActionRevision((v) => v + 1);
      }
    },
    [banRoomSong, displayItems, removeSong, requestJump, toggleCurrentDislike, toggleFavorite, toggleQueueLike],
  );

  const isShelfWheelZone = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const fx = roomVisualFxLive.current;
    if (fx.shelfMode === 'stage') {
      const ny01 = (clientY - rect.top) / Math.max(1, rect.height);
      return ny01 > 0.6;
    }
    return isPointerNearShelfSide(new THREE.Vector2(nx, ny), camera, fx);
  }, [camera, gl]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerLeave = () => {
      hoveredCardRef.current = -1;
      hoveredActionRef.current = null;
      pointerDownRef.current = null;
      releaseGalaxyPointerInteraction();
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      const hit = getHitAtClientPoint(e.clientX, e.clientY);
      if (!hit) return;
      releaseGalaxyPointerInteraction();
      pointerDownRef.current = {
        x: e.clientX,
        y: e.clientY,
        cardIndex: hit.cardIndex,
        actionId: hit.actionId,
      };
      // 仅当前居中选中曲给按下放大反馈，背后卡放大前推会与前景抢命中
      if (hit.cardIndex === Math.round(centerSmoothRef.current)) {
        pulseRef.current[hit.cardIndex] = 1;
      }
      e.stopPropagation();
    };

    const onPointerUpCapture = (e: PointerEvent) => {
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      releaseGalaxyPointerInteraction();
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > CLICK_THRESHOLD) return;
      const hit = getHitAtClientPoint(e.clientX, e.clientY);
      if (!hit || hit.cardIndex !== down.cardIndex) return;
      void runCardAction(hit.cardIndex, hit.actionId ?? down.actionId);
    };

    const onWheelCapture = (e: WheelEvent) => {
      if (roomVisualFxLive.current.shelfMode === 'off' || displayItems.length <= 1) return;
      const hit = getHitAtClientPoint(e.clientX, e.clientY);
      const inShelfArea = !!hit || isShelfWheelZone(e.clientX, e.clientY) || e.shiftKey;
      if (!inShelfArea) return;
      e.preventDefault();
      e.stopPropagation();
      const direction = e.deltaY > 0 ? 1 : -1;
      const prev = Math.round(centerTargetRef.current);
      centerTargetRef.current = Math.max(
        0,
        Math.min(displayItems.length - 1, centerTargetRef.current + direction),
      );
      const next = Math.round(centerTargetRef.current);
      if (next !== prev) pulseRef.current[next] = 0.55;
    };

    canvas.addEventListener('pointerleave', onPointerLeave, true);
    canvas.addEventListener('pointerdown', onPointerDownCapture, true);
    canvas.addEventListener('pointerup', onPointerUpCapture, true);
    canvas.addEventListener('wheel', onWheelCapture, { passive: false, capture: true });
    return () => {
      canvas.removeEventListener('pointerleave', onPointerLeave, true);
      canvas.removeEventListener('pointerdown', onPointerDownCapture, true);
      canvas.removeEventListener('pointerup', onPointerUpCapture, true);
      canvas.removeEventListener('wheel', onWheelCapture, true);
    };
  }, [displayItems.length, getHitAtClientPoint, gl, isShelfWheelZone, runCardAction]);

  useFrame((state, deltaTime) => {
    const count = displayItems.length;
    for (let i = 0; i < count; i += 1) {
      pulseRef.current[i] = (pulseRef.current[i] || 0) * 0.9;
      if ((pulseRef.current[i] || 0) < 0.01) pulseRef.current[i] = 0;
    }

    if (!current || count === 0) {
      for (const card of cardsRef.current) card.mesh.visible = false;
      return;
    }

    centerSmoothRef.current += (centerTargetRef.current - centerSmoothRef.current) * 0.16;
    if (Math.abs(centerSmoothRef.current - centerTargetRef.current) < 0.001) {
      centerSmoothRef.current = centerTargetRef.current;
    }

    const fx = roomVisualFxLive.current;
    const shelfTarget = fx.shelfMode === 'off' ? 0 : 1;
    if (fx.shelfMode !== 'off') lastShelfModeRef.current = fx.shelfMode;
    const summonDuration = shelfTarget > shelfMixRef.current
      ? fx.shelfSummonOpenDuration
      : fx.shelfSummonCloseDuration;
    shelfMixRef.current += (shelfTarget - shelfMixRef.current)
      * Math.min(1, deltaTime / Math.max(0.016, summonDuration));
    if (shelfTarget === 0 && shelfMixRef.current < 0.006) {
      shelfMixRef.current = 0;
      for (const card of cardsRef.current) card.mesh.visible = false;
      return;
    }

    const warmVisible = fx.shelfPresence === 'always' || presenceRef.current > 0.04;
    const bands = getCachedGalaxyAudioBands();
    // 进度只参与画布绘制，避免驱动整组卡片和交互监听重建
    const displayTime = clampPlaybackTime(readLocalPlaybackTime(current), duration);
    const progress = duration > 0 ? displayTime / duration : 0;
    const accent =
      fx.shelfAccentColor || (fx.visualTintMode === 'custom' ? fx.visualTintColor : fx.visualTintColor || '#00f5d4');
    const centerIndex = centerSmoothRef.current;
    const centerRounded = Math.round(centerIndex);
    const shelfMode = fx.shelfMode === 'off' ? lastShelfModeRef.current : fx.shelfMode;

    raycastFrameRef.current += 1;
    const pointerMoved =
      Math.abs(pointer.x - raycastPointerRef.current.x) > 0.003
      || Math.abs(pointer.y - raycastPointerRef.current.y) > 0.003;
    if (pointerMoved) {
      raycastPointerRef.current.x = pointer.x;
      raycastPointerRef.current.y = pointer.y;
    }
    const shouldRaycast = warmVisible && (pointerMoved || raycastFrameRef.current % 3 === 0);

    let hoveredIndex = hoveredCardRef.current;
    let hoveredAction: FloatingSongCardActionId | null = hoveredActionRef.current;
    if (shouldRaycast) {
      raycasterRef.current.setFromCamera(pointer, camera);
      const visibleMeshes = cardsRef.current
        .map((card) => card.mesh)
        .filter((mesh) => mesh.visible)
        .sort((a, b) => (b.renderOrder || 0) - (a.renderOrder || 0));
      syncVisibleShelfMatrices(visibleMeshes);
      const intersections = raycasterRef.current.intersectObjects(visibleMeshes, false);
      // 重叠时优先居中卡，避免背后卡 hover 放大后再被前景抢走
      const preferredHit =
        intersections.find(
          (entry) => Number(entry.object.userData.cardIndex ?? -1) === centerRounded,
        )
        || intersections[0];
      const hoveredMesh = preferredHit?.object as THREE.Mesh | undefined;
      hoveredIndex = hoveredMesh ? Number(hoveredMesh.userData.cardIndex ?? -1) : -1;
      hoveredAction = null;
      if (hoveredIndex >= 0 && preferredHit?.uv) {
        const uv = preferredHit.uv;
        hoveredAction = hitTestFloatingSongCardAction(
          actionRegionsRef.current[hoveredIndex] || [],
          uv.x * 720,
          (1 - uv.y) * 360,
        );
      }
      hoveredCardRef.current = hoveredIndex;
      hoveredActionRef.current = hoveredAction;
    }

    const nearShelfSide = shelfMode === 'side' && isPointerNearShelfSide(pointer, camera, fx);
    const hoveringCenter = hoveredIndex >= 0 && hoveredIndex === centerRounded;
    const sidePresenceTarget =
      fx.shelfPresence === 'always'
        ? 1
        : nearShelfSide || hoveredIndex >= 0
          ? 1
          : 0;
    const stagePresenceTarget =
      fx.shelfPresence === 'always'
        ? 1
        : Math.abs(pointer.x) < 0.42 && pointer.y < 0.4
          ? 1
          : hoveredIndex >= 0
            ? 1
            : 0;
    const presenceTarget = shelfMode === 'stage' ? stagePresenceTarget : sidePresenceTarget;
    presenceRef.current += (presenceTarget - presenceRef.current) * 0.08;

    const dynamicCamera = fx.shelfCameraMode === 'dynamic';
    const orbit = galaxyOrbitRef.current;
    const shelfFocusEngaged = orbit.focusZone.active && orbit.focusZone.type === 'cardHover';
    const pointerInShelfZone = shelfMode === 'stage'
      ? Math.abs(pointer.x) < 0.42 && pointer.y < 0.4
      : nearShelfSide;
    if (hoveringCenter) focusSlotRef.current = hoveredIndex - centerIndex;
    // 跟拍一旦生效就只看指针还在不在歌单架区域：镜头推近本身会让卡片滑离指针，
    // 若这时判定为「没悬停」就会进入 跟拍→丢失→回位→再跟拍 的抽搐循环
    // 仅当前居中曲触发跟拍；按钮悬停/按下仍算在卡上，不能因此退出放大
    const focusCard =
      dynamicCamera &&
      (
        hoveringCenter
        || (shelfFocusEngaged && pointerInShelfZone && pointerDownRef.current === null)
      );
    // Mineradio setFocusZone：进入要悬停 260ms 才跟拍，离开也拖 120ms，
    // 否则鼠标扫过歌单架镜头就整个扑上去
    const nowMs = state.clock.elapsedTime * 1000;
    if (focusCard !== focusWantRef.current) {
      focusWantRef.current = focusCard;
      focusSinceRef.current = nowMs;
    }
    const focusSettled = nowMs - focusSinceRef.current >= (focusCard ? 260 : 120);
    if (focusCard && focusSettled) {
      const hoverZone = makeCardFocusZone(shelfMode, focusSlotRef.current, fx);
      setGalaxyOrbitFocusZone(orbit, 'cardHover', {
        ...hoverZone,
        speed: fx.shelfCameraEnterSpeed,
      });
    } else if (!focusCard && focusSettled && shelfFocusEngaged) {
      setGalaxyOrbitFocusZone(orbit, 'none', { speed: fx.shelfCameraExitSpeed });
    }

    gl.domElement.style.cursor = hoveredIndex >= 0 ? 'pointer' : '';

    for (let i = 0; i < count; i += 1) {
      const entry = displayItems[i];
      const built = cardsRef.current[i];
      if (!built || !entry) continue;
      const mesh = built.mesh;
      mesh.userData.cardIndex = i;

      const isHovered = hoveredIndex === i;
      const isCenter = Math.abs(i - centerIndex) < 0.5;
      // 只有当前居中选中曲才 hover 放大；背后卡放大前推会抢命中导致抽搐
      // 按住卡上按钮时也保持放大，避免按钮区重绘/短暂丢命中时缩回去
      const pressKeepsHover =
        pointerDownRef.current !== null
        && pointerDownRef.current.cardIndex === i
        && isCenter;
      const targetHover = (isHovered && isCenter) || pressKeepsHover ? 1 : 0;
      hoverRef.current[i] = (hoverRef.current[i] || 0) + (targetHover - (hoverRef.current[i] || 0)) * 0.14;

      const staggerDelay = Math.min(0.72, i * 0.055 * fx.shelfSummonStagger);
      const reveal = Math.max(0, Math.min(1, (shelfMixRef.current - staggerDelay) / Math.max(0.001, 1 - staggerDelay)));
      const easedReveal = reveal * reveal * (3 - 2 * reveal);
      const pose = applyFloatingSongCardPose(mesh, state.clock.elapsedTime, hoverRef.current[i], {
        mode: shelfMode,
        cardIndex: i,
        centerSmooth: centerIndex,
        active: isCenter ? 1 : 0,
        pulse: pulseRef.current[i] || 0,
        scale: fx.shelfSize,
        offsetX: fx.shelfOffsetX,
        offsetY: fx.shelfOffsetY,
        offsetZ: fx.shelfOffsetZ,
        angleY: fx.shelfAngleY,
        breathWeight: Math.max(0.35, presenceRef.current),
        reveal: easedReveal,
        entry: (1 - easedReveal) * fx.shelfSummonSlide,
        pointerX: pointer.x,
        pointerY: pointer.y,
        parallax: fx.shelfSummonParallax,
        summonScale: fx.shelfSummonScale,
      });

      if (!pose.visible) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;

      const foreground = (isHovered && isCenter) || (isCenter && fx.shelfPresence !== 'always');
      mesh.renderOrder = (foreground ? 300 : 30)
        + Math.round((SHELF_VISIBLE_RADIUS + 1 - Math.min(pose.absD, SHELF_VISIBLE_RADIUS + 1)) * 4);
      mesh.updateMatrixWorld(true);

      const item: FloatingSongCardItem = {
        ...entry.item,
        progress: entry.song.isCurrent ? progress : 0,
        meta: entry.song.isCurrent
          ? `${Math.round(progress * 100)}% · ${entry.song.album || '当前曲目'}`
          : entry.item.meta,
        bass: entry.song.isCurrent ? bands.bass : 0,
        isShelfCenter: isCenter,
      };

      const dofBlur = Math.max(0, Math.min(1, (pose.absD - 0.45) / 3.2));
      const drawKey = [
        entry.song.queueId,
        i,
        centerRounded,
        item.title,
        item.sub,
        item.coverUrl,
        item.tag,
        item.meta,
        Math.round(item.progress * 100),
        Math.round(item.bass * 20),
        accent,
        isHovered ? hoveredActionRef.current || '' : '',
        isCenter ? '1' : '0',
        Math.round(dofBlur * 10),
        item.actions.map((action) => `${action.id}:${action.active ? 1 : 0}:${action.badge || ''}`).join(','),
      ].join('|');

      const redraw = () => {
        actionRegionsRef.current[i] = drawFloatingSongCard(
          built.ctx,
          built.canvas,
          item,
          accent,
          state.clock.elapsedTime,
          fx.shelfBgOpacity,
          isHovered ? hoveredActionRef.current : null,
          redraw,
          dofBlur,
        );
        built.texture.needsUpdate = true;
      };

      if (drawKey !== drawKeyRef.current[i]) {
        drawKeyRef.current[i] = drawKey;
        redraw();
      } else if (isHovered && ((pulseRef.current[i] || 0) > 0.01 || hoveredActionRef.current)) {
        redraw();
      }

      const stackOpacity = pose.absD < 0.5 ? 1 : Math.max(0.22, 1 - pose.absD * 0.3);
      const passiveAlways = fx.shelfPresence === 'always';
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setScalar(passiveAlways ? (isCenter ? 1 : 0.96) : 1);
      const passiveDim = passiveAlways && !isCenter ? 0.92 : 1;
      mat.opacity = Math.min(
        1,
        (presenceRef.current + (pulseRef.current[i] || 0) * 0.1) * fx.shelfOpacity * stackOpacity * passiveDim * easedReveal,
      );
    }
  });

  return (
    <group>
      {Array.from({ length: cardCount }, (_, index) => (
        <primitive key={index} object={cardsRef.current[index]?.mesh} />
      ))}
    </group>
  );
}
