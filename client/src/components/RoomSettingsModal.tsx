import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Crown, Minus, Plus, Search, Sparkles, ShieldCheck, Trash2, X } from 'lucide-react';
import WechatUinBindModal from './WechatUinBindModal';
import { getFmModeOptions, getFmModeLabel, normalizeFmMode, FM_MODE_OFF, DEFAULT_FM_MODE, type FmSource } from '../api/music/fmMode';
import type { BannedSong, ForbiddenWord, RoomUser, RoomMusicAccounts } from '../types';
import type { DislikeSkipMode } from '../lib/dislikeSkip';
import SourceBadge from './SourceBadge';
import ConfirmModal from './ConfirmModal';
import RoomMusicAccountPanel from './RoomMusicAccountPanel';
import { searchPlaylists, type PlaylistChannelFilter, type PlaylistSearchItem } from '../api/music/playlist';
import {
  fetchLinuxdoStatus,
  startLinuxdoBind,
  startLinuxdoRecover,
  unbindLinuxdo,
  type LinuxdoBinding,
} from '../lib/linuxdoAuth';
import {
  fetchWechatUinStatus,
  unbindWechatUin,
  type WechatUinBinding,
} from '../lib/wechatUinAuth';
import {
  fetchGithubStatus,
  startGithubBind,
  startGithubRecover,
  unbindGithub,
  type GithubBinding,
} from '../lib/githubAuth';

const ANNOUNCEMENT_MAX_LENGTH = 2000;
const MIN_STAY_MINUTES_MAX = 24 * 60;
const MAX_PER_USER_MAX = 50;
const DISLIKE_SKIP_THRESHOLD_MAX = 50;
const CLEAR_ON_LEAVE_DELAY_MINUTES_MAX = 24 * 60;
const JOIN_NOTICE_COOLDOWN_MINUTES_MAX = 24 * 60;
const FORBIDDEN_WORD_MAX_LEN = 20;
const COOLDOWN_OPTIONS = [0, 10, 30, 60, 120] as const;
const QUEUE_LIMIT_OPTIONS = [50, 100, 200] as const;

type SettingsTab = 'fm' | 'account' | 'member' | 'room' | 'announcement' | 'chat' | 'songRequest';

/** 房主扫码绑定网易云 / QQ 音乐账号。 */
const MUSIC_ACCOUNT_TAB_ENABLED = true;

export interface SongRequestSettings {
  enabled: boolean;
  queueLikeSortEnabled: boolean;
  memberJumpEnabled: boolean;
  memberSeekEnabled: boolean;
  memberPauseEnabled: boolean;
  systemMediaPlayBound: boolean;
  systemMediaSkipBound: boolean;
  dislikeSkipMode: DislikeSkipMode;
  dislikeSkipThreshold: number;
  dislikeSkipPercent: number;
  clearSongsOnLeaveEnabled: boolean;
  clearSongsOnLeaveDelayMinutes: number;
  deferOfflineRequesterSongs: boolean;
  minStayMinutes: number;
  maxPerUser: number;
  cooldownSec: number;
  queueMaxLength: number;
}

interface Props {
  open: boolean;
  isOwner: boolean;
  canModerate: boolean;
  fmMode: string;
  fmSource: FmSource;
  enabledFmSources?: FmSource[];
  enabledMusicAccountPlatforms?: FmSource[];
  fmModeBeforeOff?: string;
  qishuiProxyEnabled?: boolean;
  qishuiProxyPercent?: number;
  qishuiProxySaving?: boolean;
  initialTab?: SettingsTab;
  playlistRoaming?: { enabled: boolean; dedupeByName: boolean; playlists: Array<{ id: string; source: FmSource; name: string; url?: string; songs: { id: string; name: string; artist: string; source: string }[] }> } | null;
  fmSaving?: boolean;
  announcementEnabled: boolean;
  announcementText: string;
  announcementSaving?: boolean;
  chatHistoryVisibleOnJoin: boolean;
  chatHistorySaving?: boolean;
  chatShowAvatars: boolean;
  chatAvatarsSaving?: boolean;
  hideIpLocation: boolean;
  hideIpLocationSaving?: boolean;
  joinNoticeEnabled: boolean;
  joinNoticeCooldownMinutes: number;
  joinNoticeSaving?: boolean;
  roomAiEnabled: boolean;
  roomAiBotName: string;
  globalAiEnabled: boolean;
  defaultAiBotName: string;
  roomAiSaving?: boolean;
  songRequest: SongRequestSettings;
  songRequestSaving?: boolean;
  bannedSongs?: BannedSong[];
  onUnbanSong?: (name: string) => void | Promise<void>;
  forbiddenWords?: ForbiddenWord[];
  forbiddenWordSaving?: boolean;
  onAddForbiddenWord?: (word: string) => boolean | Promise<boolean>;
  onRemoveForbiddenWord?: (word: string) => void | Promise<void>;
  memberTierCount: number;
  users?: RoomUser[];
  myUserId?: string | null;
  transferSaving?: boolean;
  destroySaving?: boolean;
  roomId?: string;
  ownerAccountId?: string | null;
  anonymousLoginEnabled?: boolean;
  protectedFromDestroy?: boolean;
  permanentApplication?: {
    status: 'pending';
    appliedAt?: number;
    note?: string;
  } | null;
  permanentSaving?: boolean;
  /** 进房已预取：避免打开弹窗后「身份」栏才闪现 */
  identityWechatUinEnabled?: boolean;
  identityWechatUinBound?: WechatUinBinding | null;
  identityLinuxdoEnabled?: boolean;
  identityGithubEnabled?: boolean;
  identityLinuxdoBound?: LinuxdoBinding | null;
  identityGithubBound?: GithubBinding | null;
  musicAccounts?: RoomMusicAccounts;
  sharedMembershipEnabled?: boolean;
  onMusicAccountCreateQr?: (platform: 'netease' | 'tencent' | 'kugou' | 'qishui') => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;
  onMusicAccountCheckQr?: (payload: Record<string, unknown>) => Promise<{ success: boolean; error?: string; data?: Record<string, unknown> }>;
  onMusicAccountBind?: (payload: {
    sessionId: string;
    shared?: boolean;
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  onMusicAccountRefresh?: () => Promise<{ success: boolean; error?: string; data?: RoomMusicAccounts }>;
  onMusicAccountSetShared?: (platform: 'netease' | 'tencent' | 'kugou' | 'qishui', shared: boolean) => Promise<{ success: boolean; error?: string }>;
  onMusicAccountUnbind?: (platform: 'netease' | 'tencent' | 'kugou' | 'qishui') => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
  onSaveFmMode: (mode: string, source?: FmSource) => void;
  onSaveQishuiProxy?: (enabled: boolean, percent: number) => void | Promise<void>;
  onSavePlaylistRoaming?: (payload: { platform?: 'netease' | 'qq' | 'kugou' | 'qishui'; input?: string; clear?: boolean; playlistId?: string; playlistSource?: FmSource; playlistName?: string; dedupeByName?: boolean; playlistEnabled?: boolean }) => Promise<{ success: boolean; error?: string }> | void;
  onOpenMemberModal: () => void;
  onSaveAnnouncement: (options: { enabled: boolean; text: string }) => void;
  onSaveChatHistory: (enabled: boolean) => void;
  onSaveChatShowAvatars: (enabled: boolean) => void;
  onSaveHideIpLocation: (hidden: boolean) => void;
  onSaveJoinNotice: (settings: { enabled: boolean; cooldownMinutes: number }) => void;
  onSaveRoomAi: (settings: { enabled: boolean; botName: string }) => void;
  onSaveSongRequest: (settings: SongRequestSettings) => void;
  onTransferOwner?: (userId: string) => void | Promise<void>;
  onDestroyRoom?: () => void | Promise<void>;
  onApplyPermanent?: (note?: string) => void | Promise<void>;
  onCancelPermanent?: () => void | Promise<void>;
  maxAdmins?: number;
  maxAdminsSaving?: boolean;
  adminSelfManageMemberTierEnabled?: boolean;
  adminSelfManageMemberTierSaving?: boolean;
  onSaveMaxAdmins?: (maxAdmins: number) => void | Promise<void>;
  onSaveAdminSelfManageMemberTier?: (enabled: boolean) => void | Promise<void>;
  playbackRate?: number;
  playbackRateSaving?: boolean;
  onSavePlaybackRate?: (playbackRate: number) => void | Promise<void>;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="mt-0.5 text-xs text-netease-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-netease-red' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

function NumberStepper({
  id,
  value,
  min,
  max,
  disabled,
  suffix,
  onChange,
  commitOnBlur = false,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  suffix?: string;
  onChange: (next: number) => void;
  commitOnBlur?: boolean;
}) {
  const [inputValue, setInputValue] = useState<string | null>(null);

  useEffect(() => {
    if (!disabled) setInputValue(null);
  }, [disabled]);

  const setValue = (next: number) => {
    const clamped = clampInt(next, min, max);
    if (commitOnBlur) setInputValue(clamped === value ? null : String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const currentValue = inputValue === null ? value : clampInt(Number(inputValue || min), min, max);

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-netease-border/60 bg-netease-dark">
        <button
          type="button"
          disabled={disabled || currentValue <= min}
          onPointerDown={(event) => { if (commitOnBlur) event.preventDefault(); }}
          onClick={() => setValue(currentValue - 1)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="减少"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={commitOnBlur ? inputValue ?? value : value}
          disabled={disabled}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            if (commitOnBlur) {
              setInputValue(digits);
              return;
            }
            if (!digits) {
              setValue(min);
              return;
            }
            setValue(Number(digits));
          }}
          onBlur={commitOnBlur ? () => {
            if (inputValue !== null) setValue(Number(inputValue || min));
          } : undefined}
          onKeyDown={commitOnBlur ? (event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          } : undefined}
          className="h-8 w-14 flex-shrink-0 border-x border-netease-border/60 bg-transparent text-center text-sm tabular-nums text-white outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled || currentValue >= max}
          onPointerDown={(event) => { if (commitOnBlur) event.preventDefault(); }}
          onClick={() => setValue(currentValue + 1)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="增加"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {suffix && <span className="text-sm text-netease-muted">{suffix}</span>}
    </div>
  );
}

export default function RoomSettingsModal({
  open,
  isOwner,
  canModerate,
  fmMode,
  fmSource,
  enabledFmSources,
  enabledMusicAccountPlatforms,
  fmModeBeforeOff,
  qishuiProxyEnabled = false,
  qishuiProxyPercent = 100,
  qishuiProxySaving = false,
  initialTab,
  playlistRoaming = null,
  fmSaving = false,
  announcementEnabled,
  announcementText,
  announcementSaving = false,
  chatHistoryVisibleOnJoin,
  chatHistorySaving = false,
  chatShowAvatars,
  chatAvatarsSaving = false,
  hideIpLocation,
  hideIpLocationSaving = false,
  joinNoticeEnabled,
  joinNoticeCooldownMinutes,
  joinNoticeSaving = false,
  roomAiEnabled,
  roomAiBotName,
  globalAiEnabled,
  defaultAiBotName,
  roomAiSaving = false,
  songRequest,
  songRequestSaving = false,
  bannedSongs = [],
  onUnbanSong,
  forbiddenWords = [],
  forbiddenWordSaving = false,
  onAddForbiddenWord,
  onRemoveForbiddenWord,
  memberTierCount,
  users = [],
  myUserId = null,
  transferSaving = false,
  destroySaving = false,
  roomId,
  ownerAccountId,
  anonymousLoginEnabled = false,
  protectedFromDestroy = false,
  permanentApplication = null,
  permanentSaving = false,
  identityWechatUinEnabled = true,
  identityWechatUinBound = null,
  identityLinuxdoEnabled = false,
  identityGithubEnabled = false,
  identityLinuxdoBound = null,
  identityGithubBound = null,
  musicAccounts = { netease: null, tencent: null, kugou: null, qishui: null },
  sharedMembershipEnabled = true,
  onMusicAccountCreateQr,
  onMusicAccountCheckQr,
  onMusicAccountBind,
  onMusicAccountRefresh,
  onMusicAccountSetShared,
  onMusicAccountUnbind,
  onClose,
  onSaveFmMode,
  onSaveQishuiProxy,
  onSavePlaylistRoaming,
  onOpenMemberModal,
  onSaveAnnouncement,
  onSaveChatHistory,
  onSaveChatShowAvatars,
  onSaveHideIpLocation,
  onSaveJoinNotice,
  onSaveRoomAi,
  onSaveSongRequest,
  onTransferOwner,
  onDestroyRoom,
  onApplyPermanent,
  onCancelPermanent,
  maxAdmins = 5,
  maxAdminsSaving = false,
  adminSelfManageMemberTierEnabled = false,
  adminSelfManageMemberTierSaving = false,
  playbackRate = 1,
  playbackRateSaving = false,
  onSaveMaxAdmins,
  onSaveAdminSelfManageMemberTier,
  onSavePlaybackRate,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('announcement');
  const [draftAnnouncementEnabled, setDraftAnnouncementEnabled] = useState(announcementEnabled);
  const [draftAnnouncementText, setDraftAnnouncementText] = useState(announcementText);
  const [draftJoinNoticeEnabled, setDraftJoinNoticeEnabled] = useState(joinNoticeEnabled);
  const [draftJoinNoticeCooldownMinutes, setDraftJoinNoticeCooldownMinutes] = useState(joinNoticeCooldownMinutes);
  const [draftRoomAiEnabled, setDraftRoomAiEnabled] = useState(roomAiEnabled);
  const [draftRoomAiBotName, setDraftRoomAiBotName] = useState(roomAiBotName);
  const [draftForbiddenWord, setDraftForbiddenWord] = useState('');
  const [showDefaultForbiddenWords, setShowDefaultForbiddenWords] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [permanentNote, setPermanentNote] = useState('');
  const [draftMaxAdmins, setDraftMaxAdmins] = useState(maxAdmins);
  const [draftPlaybackRate, setDraftPlaybackRate] = useState(String(playbackRate));
  const [playlistRoamingPlatform, setPlaylistRoamingPlatform] = useState<'netease' | 'qq' | 'kugou' | 'qishui'>('netease');
  const [playlistPlatformOpen, setPlaylistPlatformOpen] = useState(false);
  const playlistPlatformRef = useRef<HTMLDivElement>(null);
  const [playlistRoamingInput, setPlaylistRoamingInput] = useState('');
  const [playlistRoamingSearch, setPlaylistRoamingSearch] = useState('');
  const [playlistRoamingResults, setPlaylistRoamingResults] = useState<PlaylistSearchItem[]>([]);
  const [playlistRoamingSearching, setPlaylistRoamingSearching] = useState(false);
  const [playlistRoamingSaving, setPlaylistRoamingSaving] = useState(false);
  const [playlistRoamingError, setPlaylistRoamingError] = useState('');
  const [roamingView, setRoamingView] = useState<'fm' | 'playlist'>(playlistRoaming?.playlists.length ? 'playlist' : 'fm');
  const [wechatUinEnabled, setWechatUinEnabled] = useState(identityWechatUinEnabled);
  const [wechatUinBound, setWechatUinBound] = useState<WechatUinBinding | null>(identityWechatUinBound);
  const [wechatUinUnbinding, setWechatUinUnbinding] = useState(false);
  const [wechatUinModalMode, setWechatUinModalMode] = useState<'bind' | 'recover' | null>(null);
  const [linuxdoEnabled, setLinuxdoEnabled] = useState(identityLinuxdoEnabled);
  const [linuxdoBound, setLinuxdoBound] = useState<LinuxdoBinding | null>(identityLinuxdoBound);
  const [linuxdoUnbinding, setLinuxdoUnbinding] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(identityGithubEnabled);
  const [githubBound, setGithubBound] = useState<GithubBinding | null>(identityGithubBound);
  const [githubUnbinding, setGithubUnbinding] = useState(false);
  const wasOpenRef = useRef(false);
  const appliedAnnouncementRef = useRef({ enabled: announcementEnabled, text: announcementText });

  const transferCandidates = useMemo(
    () => users.filter((user) => !user.readOnly && user.id !== myUserId),
    [users, myUserId],
  );

  const selectedTransferUser = useMemo(
    () => transferCandidates.find((user) => user.id === transferTargetId) || null,
    [transferCandidates, transferTargetId],
  );

  const customForbiddenWords = useMemo(
    () => forbiddenWords.filter((entry) => !entry.isDefault),
    [forbiddenWords],
  );

  const defaultForbiddenWords = useMemo(
    () => forbiddenWords.filter((entry) => entry.isDefault),
    [forbiddenWords],
  );

  const hasMusicAccountPlatform = (enabledMusicAccountPlatforms?.length ?? 4) > 0;

  const tabs = useMemo(() => {
    const items: { id: SettingsTab; label: string }[] = [];
    if (isOwner) {
      items.push({ id: 'fm', label: '漫游' });
      if (MUSIC_ACCOUNT_TAB_ENABLED && hasMusicAccountPlatform) {
        items.push({ id: 'account', label: '账号' });
      }
      items.push({ id: 'room', label: '房主' });
    }
    if (canModerate) {
      items.push({ id: 'member', label: '贵宾' });
      items.push({ id: 'announcement', label: '公告' });
      items.push({ id: 'chat', label: '聊天' });
      items.push({ id: 'songRequest', label: '点歌' });
    }
    // 非房主仅用于找回身份
    if (!isOwner && (wechatUinEnabled || linuxdoEnabled || githubEnabled)) {
      items.push({ id: 'room', label: '身份' });
    }
    return items;
  }, [isOwner, canModerate, wechatUinEnabled, linuxdoEnabled, githubEnabled, hasMusicAccountPlatform]);

  // 打开弹窗时 tabs 可能刚因预取变为含「身份」；若仍停留在旧首 tab 则不强制跳转
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;

    setDraftAnnouncementEnabled(announcementEnabled);
    setDraftAnnouncementText(announcementText);
    setDraftJoinNoticeEnabled(joinNoticeEnabled);
    setDraftJoinNoticeCooldownMinutes(joinNoticeCooldownMinutes);
    setDraftRoomAiEnabled(roomAiEnabled);
    setDraftRoomAiBotName(roomAiBotName);
    setDraftForbiddenWord('');
    setShowDefaultForbiddenWords(false);
    appliedAnnouncementRef.current = { enabled: announcementEnabled, text: announcementText };
    setTransferTargetId(null);
    setConfirmTransfer(false);
    setConfirmDestroy(false);
    setPermanentNote('');
    setDraftMaxAdmins(maxAdmins);
    const initialTabs: SettingsTab[] = [];
    if (isOwner) {
      initialTabs.push('fm', ...(MUSIC_ACCOUNT_TAB_ENABLED && hasMusicAccountPlatform ? (['account'] as SettingsTab[]) : []), 'room');
    }
    if (canModerate) {
      initialTabs.push('member', 'announcement', 'chat', 'songRequest');
    }
    if (!isOwner && (identityWechatUinEnabled || identityLinuxdoEnabled || identityGithubEnabled)) {
      initialTabs.push('room');
    }
    setActiveTab(initialTabs[0] ?? 'announcement');
  }, [
    open,
    announcementEnabled,
    announcementText,
    joinNoticeEnabled,
    joinNoticeCooldownMinutes,
    roomAiEnabled,
    roomAiBotName,
    isOwner,
    canModerate,
    identityWechatUinEnabled,
    identityLinuxdoEnabled,
    identityGithubEnabled,
    maxAdmins,
    hasMusicAccountPlatform,
  ]);

  useEffect(() => {
    if (!open) return;
    void fetchWechatUinStatus(roomId).then((status) => {
      setWechatUinEnabled(status.enabled);
      setWechatUinBound(status.bound);
    });
  }, [open, roomId]);

  useEffect(() => {
    if (!open) {
      setConfirmTransfer(false);
      setConfirmDestroy(false);
      return;
    }
    if (transferTargetId && !transferCandidates.some((user) => user.id === transferTargetId)) {
      setTransferTargetId(null);
      setConfirmTransfer(false);
    }
  }, [open, transferCandidates, transferTargetId]);

  useEffect(() => {
    if (open) return;
    setWechatUinEnabled(identityWechatUinEnabled);
    setWechatUinBound(identityWechatUinBound);
    setLinuxdoEnabled(identityLinuxdoEnabled);
    setGithubEnabled(identityGithubEnabled);
    setLinuxdoBound(identityLinuxdoBound);
    setGithubBound(identityGithubBound);
  }, [open, roomId, identityWechatUinEnabled, identityWechatUinBound, identityLinuxdoEnabled, identityGithubEnabled, identityLinuxdoBound, identityGithubBound]);

  useEffect(() => {
    if (!open) return;
    // 打开瞬间先用进房预取值，避免「身份」栏后闪
    setWechatUinEnabled(identityWechatUinEnabled);
    setWechatUinBound(identityWechatUinBound);
    setLinuxdoEnabled(identityLinuxdoEnabled);
    setGithubEnabled(identityGithubEnabled);
    setLinuxdoBound(identityLinuxdoBound);
    setGithubBound(identityGithubBound);

    let cancelled = false;
    void fetchLinuxdoStatus(roomId).then((status) => {
      if (cancelled) return;
      setLinuxdoEnabled(status.enabled);
      setLinuxdoBound(status.bound);
    });
    void fetchGithubStatus(roomId).then((status) => {
      if (cancelled) return;
      setGithubEnabled(status.enabled);
      setGithubBound(status.bound);
    });
    return () => {
      cancelled = true;
    };
  }, [open, roomId, identityWechatUinEnabled, identityWechatUinBound, identityLinuxdoEnabled, identityGithubEnabled, identityLinuxdoBound, identityGithubBound]);

  // 打开期间：服务端公告变化时，若用户未编辑（草稿仍等于上次应用值），则跟随服务端
  useEffect(() => {
    if (!open) return;
    const applied = appliedAnnouncementRef.current;
    const serverChanged = applied.enabled !== announcementEnabled
      || applied.text !== announcementText;
    if (!serverChanged) return;

    setDraftAnnouncementEnabled((prev) => {
      if (prev !== applied.enabled) return prev; // 用户已改开关
      return announcementEnabled;
    });
    setDraftAnnouncementText((prev) => {
      if (prev !== applied.text) return prev; // 用户已改文案
      return announcementText;
    });
    appliedAnnouncementRef.current = { enabled: announcementEnabled, text: announcementText };
  }, [open, announcementEnabled, announcementText]);

  // 权限变化导致当前 tab 不可用时，落到第一个可用 tab
  useEffect(() => {
    if (!open || tabs.length === 0) return;
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [open, tabs, activeTab]);

  useEffect(() => {
    if (!open) return;
    // 仅在打开弹窗时决定初始视图；删除最后一个歌单后仍留在指定歌单页，避免内容闪切。
    setRoamingView(playlistRoaming?.playlists.length ? 'playlist' : 'fm');
  }, [open]);

  useEffect(() => {
    if (!playlistPlatformOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!playlistPlatformRef.current?.contains(event.target as Node)) setPlaylistPlatformOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [playlistPlatformOpen]);

  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const currentFm = normalizeFmMode(fmMode);
  const announcementDirty = draftAnnouncementEnabled !== announcementEnabled
    || draftAnnouncementText.trim() !== announcementText.trim();
  const joinNoticeDirty = draftJoinNoticeEnabled !== joinNoticeEnabled
    || draftJoinNoticeCooldownMinutes !== joinNoticeCooldownMinutes;
  const roomAiDirty = draftRoomAiEnabled !== roomAiEnabled
    || draftRoomAiBotName.trim() !== roomAiBotName.trim();
  const saveSongRequest = <Key extends keyof SongRequestSettings>(key: Key, value: SongRequestSettings[Key]) => {
    if (songRequestSaving || songRequest[key] === value) return;
    onSaveSongRequest({ ...songRequest, [key]: value });
  };

  const formatCooldownLabel = (sec: number) => {
    if (sec <= 0) return '不限制';
    return `${sec} 秒`;
  };

  return (
    <>
      {createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative flex h-[min(88vh,640px)] w-full max-w-lg animate-fade-in flex-col rounded-2xl border border-white/10 bg-netease-dark shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">
            {!isOwner && activeTab === 'room' ? '找回身份' : '房间设置'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="grid flex-shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-4 py-2.5" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`min-w-0 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white/10 font-medium text-white'
                    : 'text-netease-muted hover:bg-white/5 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {anonymousLoginEnabled && ownerAccountId && (
          <p className="border-b border-white/8 px-5 py-2 text-xs text-netease-muted">绑定房间归属账号：{ownerAccountId}</p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'fm' && isOwner && (() => {
            const fmTabs = [
              { value: 'netease' as const, label: '网易云' },
              { value: 'tencent' as const, label: 'QQ 音乐' },
              { value: 'kugou' as const, label: '酷狗音乐' },
              { value: 'qishui' as const, label: '汽水音乐' },
            ].filter((item) => !enabledFmSources || enabledFmSources.includes(item.value));
            if (fmTabs.length === 0) return <p className="text-sm text-netease-muted">暂无可用的私人漫游音源</p>;
            const effectiveFmSource = fmTabs.some((item) => item.value === fmSource)
              ? fmSource
              : fmTabs[0].value;
            return (
              <section>
                <div
                  className="mb-4 grid gap-1 rounded-lg border border-white/10 bg-black/20 p-1"
                  style={{ gridTemplateColumns: `repeat(${Math.max(fmTabs.length + 1, 1)}, minmax(0, 1fr))` }}
                  role="tablist"
                  aria-label="选择漫游来源"
                >
                  {fmTabs.map((item) => {
                    const options = getFmModeOptions(item.value);
                    const modeForSource = currentFm === FM_MODE_OFF
                      ? FM_MODE_OFF
                      : (options.some((opt) => opt.value === currentFm) ? currentFm : DEFAULT_FM_MODE);
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="tab"
                        aria-selected={roamingView === 'fm' && effectiveFmSource === item.value}
                        disabled={fmSaving || playlistRoamingSaving}
                        onClick={async () => {
                          setRoamingView('fm');
                          if (playlistRoaming?.playlists.length) {
                            setPlaylistRoamingSaving(true);
                            setPlaylistRoamingError('');
                            const result = await onSavePlaylistRoaming?.({ playlistEnabled: false });
                            setPlaylistRoamingSaving(false);
                            if (result && !result.success) {
                              setPlaylistRoamingError(result.error || '切换失败');
                              return;
                            }
                          }
                          onSaveFmMode(modeForSource, item.value);
                        }}
                        className={`min-h-9 rounded-md px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                          roamingView === 'fm' && effectiveFmSource === item.value ? 'bg-white/10 text-white' : 'text-netease-muted hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={roamingView === 'playlist'}
                    disabled={playlistRoamingSaving}
                    onClick={async () => {
                      setRoamingView('playlist');
                      if (playlistRoaming?.playlists.length && !playlistRoaming.enabled) {
                        setPlaylistRoamingSaving(true);
                        setPlaylistRoamingError('');
                        const result = await onSavePlaylistRoaming?.({ playlistEnabled: true });
                        if (result && !result.success) setPlaylistRoamingError(result.error || '恢复失败');
                        setPlaylistRoamingSaving(false);
                      }
                    }}
                    className={`min-h-9 rounded-md px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                      roamingView === 'playlist' ? 'bg-netease-red/15 text-white' : 'text-netease-muted hover:bg-white/[0.05] hover:text-white'
                    }`}
                  >
                    指定歌单
                  </button>
                </div>
                {roamingView === 'playlist' && <section className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">指定歌单</p>
                      <p className="mt-0.5 text-xs text-netease-muted">队列为空时仅从已指定歌单的合并曲库循环取歌，不再获取 FM 漫游</p>
                    </div>
                  </div>
                <div className="mb-4">
                  <Toggle
                    checked={playlistRoaming?.dedupeByName === true}
                    disabled={playlistRoamingSaving || !playlistRoaming?.playlists.length || !onSavePlaylistRoaming}
                    onChange={async (dedupeByName) => {
                      setPlaylistRoamingSaving(true);
                      setPlaylistRoamingError('');
                      const result = await onSavePlaylistRoaming?.({ dedupeByName });
                      if (result && !result.success) setPlaylistRoamingError(result.error || '去重设置失败');
                      setPlaylistRoamingSaving(false);
                    }}
                    label="按歌名去重"
                    description="开启后同名歌曲优先保留网易云，其次 QQ、汽水、酷狗"
                  />
                </div>
                  <div className="space-y-3">
                      <div className="flex gap-2">
                        <div ref={playlistPlatformRef} className="relative flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setPlaylistPlatformOpen((value) => !value)}
                            aria-expanded={playlistPlatformOpen}
                            aria-haspopup="listbox"
                            className="flex min-w-[4.5rem] items-center justify-between gap-1 rounded-lg px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            aria-label="歌单平台"
                          >
                            <span className="whitespace-nowrap">{{ netease: '网易云', qq: 'QQ', kugou: '酷狗', qishui: '汽水' }[playlistRoamingPlatform]}</span>
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${playlistPlatformOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {playlistPlatformOpen && (
                            <div role="listbox" aria-label="歌单平台" className="absolute left-0 top-full z-50 mt-1 min-w-[6.5rem] rounded-lg border border-white/10 bg-netease-card py-0.5 shadow-lg animate-fade-in">
                              {([
                                ['netease', '网易云'],
                                ['qq', 'QQ'],
                                ['kugou', '酷狗'],
                                ['qishui', '汽水'],
                              ] as const).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  role="option"
                                  aria-selected={playlistRoamingPlatform === value}
                                  onClick={() => {
                                    setPlaylistRoamingPlatform(value);
                                    setPlaylistRoamingResults([]);
                                    setPlaylistPlatformOpen(false);
                                  }}
                                  className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition-colors ${playlistRoamingPlatform === value ? 'bg-netease-red/10 text-netease-red' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}
                                >
                                  <Check className={`h-3.5 w-3.5 flex-shrink-0 ${playlistRoamingPlatform === value ? 'opacity-100' : 'opacity-0'}`} />
                                  <span>{label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <input value={playlistRoamingSearch} onChange={(event) => setPlaylistRoamingSearch(event.target.value)} placeholder="搜索歌单" className="min-w-0 flex-1 rounded-md border border-white/10 bg-netease-dark px-2 py-1.5 text-xs text-white outline-none" />
                        <button type="button" disabled={playlistRoamingSearching || !playlistRoamingSearch.trim()} onClick={async () => {
                          setPlaylistRoamingSearching(true);
                          setPlaylistRoamingError('');
                          try {
                            const result = await searchPlaylists(playlistRoamingSearch, 1, 12, playlistRoamingPlatform as PlaylistChannelFilter);
                            setPlaylistRoamingResults(result.playlists);
                          } catch (error) {
                            setPlaylistRoamingError(error instanceof Error ? error.message : '搜索歌单失败');
                          } finally {
                            setPlaylistRoamingSearching(false);
                          }
                        }} className="rounded-md border border-white/10 px-2 py-1.5 text-netease-muted hover:text-white disabled:opacity-50" aria-label="搜索歌单">
                          <Search className="h-4 w-4" />
                        </button>
                      </div>
                      {playlistRoamingResults.length > 0 && (
                        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-white/10 p-1">
                          {playlistRoamingResults.map((item) => (
                            <button key={item.platform + ':' + item.id} type="button" disabled={playlistRoamingSaving || !onSavePlaylistRoaming} onClick={async () => {
                              setPlaylistRoamingSaving(true);
                              setPlaylistRoamingError('');
                              const result = await onSavePlaylistRoaming?.({ platform: item.platform, input: item.id, playlistName: item.name });
                              if (result?.success) {
                                setPlaylistRoamingResults([]);
                                setPlaylistRoamingSearch('');
                              } else if (result) {
                                setPlaylistRoamingError(result.error || '加载失败');
                              }
                              setPlaylistRoamingSaving(false);
                            }} className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-white/5 disabled:opacity-50">
                              <span className="min-w-0 truncate text-xs text-white">{item.name}</span>
                              <span className="shrink-0 text-[10px] text-netease-muted">{item.trackCount || '?'} 首</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input value={playlistRoamingInput} onChange={(event) => setPlaylistRoamingInput(event.target.value)} placeholder="或粘贴歌单链接或歌单 ID" className="min-w-0 flex-1 rounded-md border border-white/10 bg-netease-dark px-2 py-1.5 text-xs text-white outline-none" />
                        <button type="button" disabled={playlistRoamingSaving || !playlistRoamingInput.trim() || !onSavePlaylistRoaming} onClick={async () => {
                          setPlaylistRoamingSaving(true);
                          setPlaylistRoamingError('');
                          const result = await onSavePlaylistRoaming?.({ platform: playlistRoamingPlatform, input: playlistRoamingInput });
                          if (result?.success) setPlaylistRoamingInput('');
                          else if (result) setPlaylistRoamingError(result.error || '加载失败');
                          setPlaylistRoamingSaving(false);
                        }} className="w-16 shrink-0 rounded-md bg-netease-red px-3 py-1.5 text-center text-xs text-white disabled:opacity-50">{playlistRoamingSaving ? '加载中' : '指定'}</button>
                      </div>
                      {playlistRoamingError && <p className="text-xs text-netease-red">{playlistRoamingError}</p>}
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-white">已加入歌单</p>
                      {playlistRoaming?.playlists.length ? (
                        <button type="button" disabled={playlistRoamingSaving || !onSavePlaylistRoaming} onClick={async () => {
                          setPlaylistRoamingSaving(true);
                          setPlaylistRoamingError('');
                          const result = await onSavePlaylistRoaming?.({ clear: true });
                          if (result && !result.success) setPlaylistRoamingError(result.error || '清除失败');
                          setPlaylistRoamingSaving(false);
                        }} className="min-w-14 rounded px-1.5 py-1 text-center text-xs text-netease-muted hover:bg-white/5 hover:text-white disabled:opacity-50">清除全部</button>
                      ) : null}
                    </div>
                    <div className="h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/10 p-1.5">
                      {playlistRoaming?.playlists.length ? (
                        <div className="space-y-1.5">
                          {playlistRoaming.playlists.map((playlist) => (
                            <div key={playlist.source + ':' + playlist.id} className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <SourceBadge source={playlist.source} className="shrink-0 rounded-full px-1.5 py-0 text-[9px]" />
                                  {playlist.name ? <p className="min-w-0 truncate text-xs font-medium text-white" title={playlist.name}>{playlist.name}</p> : playlist.url ? <a href={playlist.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-xs font-medium text-netease-red underline-offset-2 hover:underline" title="打开导入链接">导入链接</a> : null}
                                </div>
                                <p className="mt-0.5 truncate text-[10px] text-netease-muted">{playlist.songs.length} 首歌曲</p>
                              </div>
                              <button type="button" disabled={playlistRoamingSaving || !onSavePlaylistRoaming} onClick={async () => {
                                setPlaylistRoamingSaving(true);
                                setPlaylistRoamingError('');
                                const result = await onSavePlaylistRoaming?.({ clear: true, playlistId: playlist.id, playlistSource: playlist.source });
                                if (result && !result.success) setPlaylistRoamingError(result.error || '移除失败');
                                setPlaylistRoamingSaving(false);
                              }} className="min-w-9 shrink-0 rounded px-1.5 py-1 text-center text-[10px] text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50">移除</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="m-1 rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-netease-muted">暂未加入歌单</p>
                      )}
                    </div>
                  </div>
                </section>}
                {roamingView === 'fm' && <Toggle
                  checked={currentFm !== FM_MODE_OFF}
                  disabled={fmSaving}
                  onChange={(next) => {
                    const restored = normalizeFmMode(fmModeBeforeOff);
                    onSaveFmMode(next ? (restored === FM_MODE_OFF ? DEFAULT_FM_MODE : restored) : FM_MODE_OFF, effectiveFmSource);
                  }}
                  label="自动漫游"
                  description="队列为空时通过私人漫游自动推荐下一首"
                />}
                {roamingView === 'fm' && <div className={`mt-3 space-y-1.5 ${currentFm === FM_MODE_OFF ? 'opacity-40' : ''}`}>
                  {getFmModeOptions(effectiveFmSource).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={fmSaving || currentFm === FM_MODE_OFF}
                      onClick={() => onSaveFmMode(opt.value, effectiveFmSource)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                        currentFm === opt.value
                          ? 'border-netease-red/25 bg-netease-red/[0.08]'
                          : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06]'
                      }`}
                    >
                      <p className={`text-sm font-medium ${currentFm === opt.value ? 'text-white' : 'text-white/90'}`}>
                        {opt.label}
                        {currentFm === opt.value && (
                          <span className="ml-2 text-[10px] font-normal text-netease-red">当前</span>
                        )}
                      </p>
                      {opt.description && (
                        <p className="mt-0.5 text-xs text-netease-muted">{opt.description}</p>
                      )}
                    </button>
                  ))}
                </div>}
                {roamingView === 'fm' && <p className="mt-2 text-[10px] text-netease-muted">
                  当前：{getFmModeLabel(currentFm)}
                </p>}
              </section>
            );
          })()}

          {MUSIC_ACCOUNT_TAB_ENABLED && hasMusicAccountPlatform && activeTab === 'account' && isOwner && onMusicAccountCreateQr && onMusicAccountCheckQr && onMusicAccountBind && onMusicAccountRefresh && onMusicAccountSetShared && onMusicAccountUnbind && (
            <RoomMusicAccountPanel
              accounts={musicAccounts}
              sharedMembershipEnabled={sharedMembershipEnabled}
              enabledPlatforms={enabledMusicAccountPlatforms}
              onCreateQr={onMusicAccountCreateQr}
              onCheckQr={onMusicAccountCheckQr}
              onBind={onMusicAccountBind}
              onRefresh={onMusicAccountRefresh}
              onSetShared={onMusicAccountSetShared}
              onUnbind={onMusicAccountUnbind}
            />
          )}

          {activeTab === 'room' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2 rounded-2xl border border-netease-red/20 bg-gradient-to-br from-netease-red/[0.12] via-white/[0.03] to-transparent p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl bg-netease-red/15 p-2 text-netease-red">
                    <Crown className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">房主控制台</p>
                    <p className="mt-1 text-xs leading-relaxed text-netease-muted">
                      管理播放体验、成员权限和房间生命周期。常用设置在上方，身份与解散等高影响操作已单独分区。
                    </p>
                  </div>
                </div>
              </div>
              {isOwner && (
                <section className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">播放倍速</span>
                  </div>
                  <p className="mb-3 text-xs text-netease-muted">修改后整个房间同步生效，仅房主可修改。可输入 0.1–3 倍，默认 1 倍</p>
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <input
                      type="number"
                      min="0.1"
                      max="3"
                      step="0.1"
                      inputMode="decimal"
                      value={draftPlaybackRate}
                      disabled={playbackRateSaving}
                      onChange={(event) => setDraftPlaybackRate(event.target.value)}
                      aria-label="播放倍速"
                      className="w-24 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-netease-red/60 disabled:opacity-50"
                    />
                    <span className="text-xs text-netease-muted">倍</span>
                    <button
                      type="button"
                      disabled={playbackRateSaving}
                      onClick={() => {
                        const nextRate = Number(draftPlaybackRate);
                        if (!Number.isFinite(nextRate) || nextRate < 0.1 || nextRate > 3) return;
                        void onSavePlaybackRate?.(nextRate);
                      }}
                      className="rounded-lg border border-netease-red/40 bg-netease-red/[0.12] px-3 py-2 text-xs text-white transition-colors hover:bg-netease-red/[0.2] disabled:opacity-50"
                    >保存</button>
                  </div>
                </section>
              )}

              {isOwner && onSaveQishuiProxy && (
                <section className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <Toggle
                    checked={qishuiProxyEnabled}
                    disabled={qishuiProxySaving}
                    onChange={(enabled) => { void onSaveQishuiProxy(enabled, qishuiProxyPercent); }}
                    label="汽水同源代理"
                    description="按比例让汽水密文先经本站转发，再由浏览器本地解密，降低部分线路直连失败；0% 为直连，100% 为全部歌曲"
                  />
                  {qishuiProxyEnabled && <NumberStepper
                    id="qishui-proxy-percent"
                    value={qishuiProxyPercent}
                    min={0}
                    max={100}
                    disabled={qishuiProxySaving}
                    suffix="% 歌曲走代理"
                    onChange={(percent) => { void onSaveQishuiProxy(true, percent); }}
                    commitOnBlur
                  />}
                </section>
              )}

              {isOwner && (
                <section className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <Toggle
                    checked={hideIpLocation}
                    disabled={hideIpLocationSaving}
                    onChange={onSaveHideIpLocation}
                    label="不展示 IP 归属"
                    description="开启后，房间右上角用户列表不显示成员的 IP 归属地"
                  />
                </section>
              )}

              {isOwner && (
                <section className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <Toggle
                    checked={adminSelfManageMemberTierEnabled}
                    disabled={adminSelfManageMemberTierSaving || !onSaveAdminSelfManageMemberTier}
                    onChange={(enabled) => void onSaveAdminSelfManageMemberTier?.(enabled)}
                    label="允许管理员自助设置贵宾标识"
                    description="开启后，管理员只能修改或移除自己的贵宾标识，不能操作其他用户"
                  />
                </section>
              )}

              {isOwner && (
                <section className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-sky-400" />
                    <h3 className="text-sm font-medium text-white">管理员人数</h3>
                  </div>
                  <p className="mb-3 text-xs text-netease-muted">
                    设置本房间可任命的正式管理员上限，默认 5 人
                  </p>
                  <div className="mt-auto">
                    <NumberStepper
                      value={draftMaxAdmins}
                      min={1}
                      max={20}
                      disabled={maxAdminsSaving}
                      suffix="人"
                      onChange={setDraftMaxAdmins}
                    />
                    {draftMaxAdmins !== maxAdmins && (
                      <button
                        type="button"
                        disabled={maxAdminsSaving || !onSaveMaxAdmins}
                        onClick={() => void onSaveMaxAdmins?.(draftMaxAdmins)}
                        className="mt-3 w-full rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                      >
                        {maxAdminsSaving ? '保存中…' : '保存人数上限'}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {isOwner && (
                <section className="md:col-span-2 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-medium text-white">申请常驻</h3>
                  </div>
                  <p className="mb-3 text-xs text-netease-muted">
                    常驻仅适合长期有多人活跃的房间申请。
                    <span className="text-netease-red">
                      即使不申请常驻，房间缓存也会保留，下次创建房间仍会沿用相同配置；
                    </span>
                    常驻房间超过 2 天无人进入会被强制解散，周六日及节假日不计算在内。审核结果会弹窗通知你。
                  </p>

                  {protectedFromDestroy ? (
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-3">
                      <p className="text-sm font-medium text-emerald-300">当前已是常驻房间</p>
                      <p className="mt-1 text-xs text-white/50">空房也会保留，无需再次申请。</p>
                    </div>
                  ) : permanentApplication?.status === 'pending' ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-3">
                        <p className="text-sm font-medium text-amber-300">审核中</p>
                        <p className="mt-1 text-xs text-white/50">
                          已提交申请，请耐心等待管理员处理。
                          {permanentApplication.appliedAt
                            ? `（${new Date(permanentApplication.appliedAt).toLocaleString()}）`
                            : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={permanentSaving || !onCancelPermanent}
                        onClick={() => void onCancelPermanent?.()}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-sm text-white/80 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                      >
                        {permanentSaving ? '处理中…' : '撤销申请'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-netease-muted">申请说明（可选）</span>
                        <textarea
                          value={permanentNote}
                          onChange={(e) => setPermanentNote(e.target.value.slice(0, 120))}
                          rows={3}
                          placeholder="例如：长期听歌房间，希望保留设置与队列"
                          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={permanentSaving || !onApplyPermanent}
                        onClick={() => void onApplyPermanent?.(permanentNote.trim())}
                        className="w-full rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                      >
                        {permanentSaving ? '提交中…' : '提交常驻申请'}
                      </button>
                    </div>
                  )}
                </section>
              )}

              {isOwner && (
                <section className="md:col-span-2 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-400" />
                    <h3 className="text-sm font-medium text-white">转让房主</h3>
                  </div>
                  <p className="mb-3 text-xs text-netease-muted">
                    将房间创建者身份转让给在线成员。转让后对方成为房主，你将变为管理员（名额未满时）。
                  </p>
                  {transferCandidates.length === 0 ? (
                    <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-netease-muted">
                      当前没有可转让的在线成员
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {transferCandidates.map((user) => {
                        const selected = transferTargetId === user.id;
                        return (
                          <button
                            key={user.id}
                            type="button"
                            disabled={transferSaving}
                            onClick={() => setTransferTargetId(user.id)}
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                              selected
                                ? 'border-amber-400/30 bg-amber-400/[0.08]'
                                : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06]'
                            }`}
                          >
                            <span className={`text-sm font-medium ${selected ? 'text-white' : 'text-white/90'}`}>
                              {user.nickname}
                            </span>
                            {selected && (
                              <span className="text-[10px] text-amber-300">已选择</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      disabled={!selectedTransferUser || transferSaving || !onTransferOwner}
                      onClick={() => setConfirmTransfer(true)}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                    >
                      {transferSaving ? '转让中…' : '转让房主'}
                    </button>
                  </div>
                </section>
              )}

              {anonymousLoginEnabled && (wechatUinEnabled || linuxdoEnabled || githubEnabled) && (
                <section className="md:col-span-2 space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <h3 className="text-sm font-medium text-white">身份绑定</h3>
                  {isOwner ? (
                    <>
                      <p className="text-xs text-netease-muted">
                        绑定后换设备可用同一账号找回房主身份。
                      </p>
                      <div className="space-y-2">
                        {wechatUinEnabled && (
                          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                            <span className="w-16 flex-shrink-0 text-xs text-white/50">微信</span>
                            {wechatUinBound ? (
                              <>
                                <span className="min-w-0 flex-1 truncate text-sm text-white">已绑定</span>
                                <button
                                  type="button"
                                  disabled={wechatUinUnbinding}
                                  onClick={async () => {
                                    setWechatUinUnbinding(true);
                                    const result = await unbindWechatUin(roomId);
                                    setWechatUinUnbinding(false);
                                    if (result.success) setWechatUinBound(null);
                                  }}
                                  className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                >
                                  {wechatUinUnbinding ? '…' : '解绑'}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={!roomId}
                                onClick={() => setWechatUinModalMode('bind')}
                                className="ml-auto flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                              >
                                绑定
                              </button>
                            )}
                          </div>
                        )}
                        {linuxdoEnabled && (
                          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                            <span className="w-16 flex-shrink-0 text-xs text-white/50">Linux.do</span>
                            {linuxdoBound ? (
                              <>
                                <span className="min-w-0 flex-1 truncate text-sm text-white">
                                  {linuxdoBound.username || linuxdoBound.linuxdoId}
                                </span>
                                <button
                                  type="button"
                                  disabled={linuxdoUnbinding}
                                  onClick={async () => {
                                    setLinuxdoUnbinding(true);
                                    const result = await unbindLinuxdo(roomId);
                                    setLinuxdoUnbinding(false);
                                    if (result.success) setLinuxdoBound(null);
                                  }}
                                  className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                >
                                  {linuxdoUnbinding ? '…' : '解绑'}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={!roomId}
                                onClick={() => roomId && startLinuxdoBind(roomId, window.location.pathname)}
                                className="ml-auto flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                              >
                                绑定
                              </button>
                            )}
                          </div>
                        )}
                        {githubEnabled && (
                          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                            <span className="w-16 flex-shrink-0 text-xs text-white/50">GitHub</span>
                            {githubBound ? (
                              <>
                                <span className="min-w-0 flex-1 truncate text-sm text-white">
                                  {githubBound.username || githubBound.githubId}
                                </span>
                                <button
                                  type="button"
                                  disabled={githubUnbinding}
                                  onClick={async () => {
                                    setGithubUnbinding(true);
                                    const result = await unbindGithub(roomId);
                                    setGithubUnbinding(false);
                                    if (result.success) setGithubBound(null);
                                  }}
                                  className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                >
                                  {githubUnbinding ? '…' : '解绑'}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={!roomId}
                                onClick={() => roomId && startGithubBind(roomId, window.location.pathname)}
                                className="ml-auto flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1 text-xs font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                              >
                                绑定
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs leading-relaxed text-netease-muted">
                        换设备或清除 Cookie 后，可用当初绑定的账号找回房主身份。
                      </p>
                      <div className="space-y-2">
                        {wechatUinEnabled && (
                          <button
                            type="button"
                            onClick={() => setWechatUinModalMode('recover')}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.06]"
                          >
                            微信找回
                          </button>
                        )}
                        {linuxdoEnabled && (
                          <button
                            type="button"
                            onClick={() => startLinuxdoRecover(roomId || '', window.location.pathname)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.06]"
                          >
                            Linux.do 找回
                          </button>
                        )}
                        {githubEnabled && (
                          <button
                            type="button"
                            onClick={() => startGithubRecover(roomId || '', window.location.pathname)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-white transition-colors hover:bg-white/[0.06]"
                          >
                            GitHub 找回
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>
              )}

              {isOwner && (
                <section className="md:col-span-2 rounded-2xl border border-red-400/20 bg-red-400/[0.04] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-red-400" />
                    <h3 className="text-sm font-medium text-white">解散房间</h3>
                  </div>
                  <p className="mb-3 text-xs text-netease-muted">
                    立即解散本房间：在线成员会被移出，队列与聊天记录不再保留。此操作不可撤销。
                  </p>
                  {protectedFromDestroy && (
                    <p className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.08] px-3 py-2.5 text-xs text-amber-200/90">
                      当前为常驻房间，解散后将同时取消常驻保护。
                    </p>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={destroySaving || !onDestroyRoom}
                      onClick={() => setConfirmDestroy(true)}
                      className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-400 disabled:opacity-50"
                    >
                      {destroySaving ? '解散中…' : '解散房间'}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === 'member' && canModerate && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-medium text-white">贵宾角标</h3>
              </div>
              <p className="mb-3 text-xs text-netease-muted">
                房主与管理员可为在线用户赋予角标；进房欢迎与点歌边框自动生效
              </p>
              <button
                type="button"
                onClick={onOpenMemberModal}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="text-sm text-white">管理贵宾</span>
                <span className="text-xs text-netease-muted">
                  {memberTierCount > 0 ? `已设置 ${memberTierCount} 人` : '未设置'}
                </span>
              </button>
            </section>
          )}

          {activeTab === 'announcement' && canModerate && (
            <section>
              <div className="space-y-3">
                <Toggle
                  checked={draftAnnouncementEnabled}
                  disabled={announcementSaving}
                  onChange={setDraftAnnouncementEnabled}
                  label="开启公告"
                  description="新进房间的用户将弹窗展示公告"
                />
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="settings-announcement-text" className="text-xs text-netease-muted">
                      公告内容
                    </label>
                    <span className="text-[10px] text-netease-muted">
                      {draftAnnouncementText.length}/{ANNOUNCEMENT_MAX_LENGTH}
                    </span>
                  </div>
                  <textarea
                    id="settings-announcement-text"
                    value={draftAnnouncementText}
                    onChange={(e) => setDraftAnnouncementText(e.target.value.slice(0, ANNOUNCEMENT_MAX_LENGTH))}
                    disabled={announcementSaving}
                    rows={6}
                    placeholder="输入房间公告…"
                    className="w-full resize-none rounded-xl border border-netease-border/60 bg-netease-dark px-3 py-2 text-sm text-white outline-none focus:border-netease-red/50 disabled:opacity-50"
                  />
                </div>
                {announcementDirty && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={announcementSaving}
                      onClick={() => onSaveAnnouncement({
                        enabled: draftAnnouncementEnabled,
                        text: draftAnnouncementText.trim(),
                      })}
                      className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                    >
                      {announcementSaving ? '保存中…' : '保存公告'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'chat' && canModerate && (
            <section>
              <div className="space-y-3">
                <Toggle
                  checked={chatHistoryVisibleOnJoin}
                  disabled={chatHistorySaving}
                  onChange={onSaveChatHistory}
                  label="进房可查看历史消息"
                  description="开启后，成员进入房间可浏览此前聊天记录；关闭则仅能看到进房之后的消息"
                />
                {isOwner && (
                  <Toggle
                    checked={chatShowAvatars}
                    disabled={chatAvatarsSaving}
                    onChange={onSaveChatShowAvatars}
                    label="聊天室显示头像"
                    description="开启后，消息昵称左侧显示用户头像；未设置头像则显示昵称首字"
                  />
                )}
                {isOwner && (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <Toggle
                      checked={draftJoinNoticeEnabled}
                      disabled={joinNoticeSaving}
                      onChange={setDraftJoinNoticeEnabled}
                      label="进房系统提醒"
                      description="成员进入时在聊天室提示“昵称进入房间”"
                    />
                    <div className={draftJoinNoticeEnabled ? '' : 'opacity-50'}>
                      <label htmlFor="settings-join-notice-cooldown" className="text-sm font-medium text-white">
                        重复提醒间隔
                      </label>
                      <p className="mt-0.5 text-xs text-netease-muted">
                        同一用户在此时间内重新进入不会重复提醒，0 表示每次都提醒
                      </p>
                      <NumberStepper
                        id="settings-join-notice-cooldown"
                        value={draftJoinNoticeCooldownMinutes}
                        min={0}
                        max={JOIN_NOTICE_COOLDOWN_MINUTES_MAX}
                        disabled={joinNoticeSaving || !draftJoinNoticeEnabled}
                        suffix="分钟"
                        onChange={setDraftJoinNoticeCooldownMinutes}
                      />
                    </div>
                    {joinNoticeDirty && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={joinNoticeSaving}
                          onClick={() => onSaveJoinNotice({
                            enabled: draftJoinNoticeEnabled,
                            cooldownMinutes: draftJoinNoticeCooldownMinutes,
                          })}
                          className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                        >
                          {joinNoticeSaving ? '保存中…' : '保存进房提醒'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isOwner && (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <Toggle
                      checked={draftRoomAiEnabled}
                      disabled={roomAiSaving || !globalAiEnabled}
                      onChange={setDraftRoomAiEnabled}
                      label="聊天室 AI 助手"
                      description={
                        globalAiEnabled
                          ? '关闭后本房无法 @ 助手'
                          : '站点尚未开启 AI，请联系管理员在后台启用'
                      }
                    />
                    <div className={draftRoomAiEnabled && globalAiEnabled ? '' : 'opacity-50'}>
                      <label htmlFor="settings-room-ai-name" className="text-sm font-medium text-white">
                        助手昵称
                      </label>
                      <p className="mt-0.5 text-xs text-netease-muted">
                        留空则使用站点默认「{defaultAiBotName || '小音'}」；设置后本房优先用此昵称唤醒（@昵称 / /昵称）
                      </p>
                      <input
                        id="settings-room-ai-name"
                        type="text"
                        maxLength={20}
                        value={draftRoomAiBotName}
                        disabled={roomAiSaving || !globalAiEnabled || !draftRoomAiEnabled}
                        onChange={(e) => setDraftRoomAiBotName(e.target.value)}
                        placeholder={defaultAiBotName || '小音'}
                        className="mt-2 w-full rounded-xl border border-netease-border/60 bg-netease-dark px-3 py-2 text-sm text-white outline-none focus:border-netease-red/50 disabled:opacity-50"
                      />
                    </div>
                    {roomAiDirty && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={roomAiSaving || !globalAiEnabled}
                          onClick={() => onSaveRoomAi({
                            enabled: draftRoomAiEnabled,
                            botName: draftRoomAiBotName.trim(),
                          })}
                          className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                        >
                          {roomAiSaving ? '保存中…' : '保存 AI 设置'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-medium text-white">违禁词</label>
                    <span className="text-[11px] text-netease-muted">{forbiddenWords.length} 个</span>
                  </div>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    聊天消息命中任一词语将被拦截；自定义词排在前面，默认词可删除
                  </p>
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const word = draftForbiddenWord.trim();
                      if (!word || forbiddenWordSaving) return;
                      void Promise.resolve(onAddForbiddenWord?.(word)).then((ok) => {
                        if (ok) setDraftForbiddenWord('');
                      });
                    }}
                  >
                    <input
                      type="text"
                      value={draftForbiddenWord}
                      maxLength={FORBIDDEN_WORD_MAX_LEN}
                      disabled={forbiddenWordSaving}
                      onChange={(e) => setDraftForbiddenWord(e.target.value.slice(0, FORBIDDEN_WORD_MAX_LEN))}
                      placeholder="输入要拦截的词语"
                      className="min-w-0 flex-1 rounded-lg border border-netease-border/60 bg-netease-dark px-2.5 py-1.5 text-xs text-white outline-none focus:border-netease-red/50 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={forbiddenWordSaving || !draftForbiddenWord.trim()}
                      className="flex-shrink-0 rounded-lg bg-netease-red px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-40"
                    >
                      添加
                    </button>
                  </form>

                  {defaultForbiddenWords.length > 0 && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/10 px-2.5 py-2">
                      <p className="text-[11px] text-netease-muted">
                        默认违禁词 {defaultForbiddenWords.length} 个（内容较脏，默认隐藏）
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowDefaultForbiddenWords((prev) => !prev)}
                        className="flex-shrink-0 rounded-md px-2 py-1 text-[10px] text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
                      >
                        {showDefaultForbiddenWords ? '收起' : '查看默认违禁词'}
                      </button>
                    </div>
                  )}

                  {customForbiddenWords.length > 0 || (showDefaultForbiddenWords && defaultForbiddenWords.length > 0) ? (
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-0.5">
                      {customForbiddenWords.map((entry) => (
                        <div
                          key={`${entry.word}:${entry.addedAt ?? ''}`}
                          className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5"
                        >
                          <p className="min-w-0 flex-1 truncate text-xs text-white/90">{entry.word}</p>
                          <button
                            type="button"
                            disabled={forbiddenWordSaving}
                            onClick={() => onRemoveForbiddenWord?.(entry.word)}
                            className="flex-shrink-0 rounded-md px-2 py-1 text-[10px] text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                      {showDefaultForbiddenWords && defaultForbiddenWords.map((entry) => (
                        <div
                          key={`${entry.word}:${entry.addedAt ?? ''}`}
                          className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5"
                        >
                          <p className="min-w-0 flex-1 truncate text-xs text-white/90">{entry.word}</p>
                          <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] text-netease-muted bg-white/5">
                            默认
                          </span>
                          <button
                            type="button"
                            disabled={forbiddenWordSaving}
                            onClick={() => onRemoveForbiddenWord?.(entry.word)}
                            className="flex-shrink-0 rounded-md px-2 py-1 text-[10px] text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-netease-muted/80">暂无自定义违禁词</p>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeTab === 'songRequest' && canModerate && (
            <section>
              <div className="space-y-3">
                <p role="status" className="text-xs text-netease-muted">
                  {songRequestSaving ? '正在保存点歌设置…' : '修改后自动保存；数字输入框在失焦或按回车后保存。'}
                </p>
                <Toggle
                  checked={songRequest.enabled}
                  disabled={songRequestSaving}
                  onChange={(enabled) => saveSongRequest('enabled', enabled)}
                  label="允许成员点歌"
                  description="关闭后仅房主与管理员可点歌"
                />

                <Toggle
                  checked={songRequest.queueLikeSortEnabled}
                  disabled={songRequestSaving}
                  onChange={(enabled) => saveSongRequest('queueLikeSortEnabled', enabled)}
                  label="点赞提高排序"
                  description="默认开启；关闭后待播歌曲点赞只计数，仍保留插队与手动排序的优先级"
                />

                <Toggle
                  checked={songRequest.memberJumpEnabled}
                  disabled={songRequestSaving}
                  onChange={(memberJumpEnabled) => saveSongRequest('memberJumpEnabled', memberJumpEnabled)}
                  label="允许成员插队"
                  description="默认关闭；开启后全体成员可点歌并插队，也可对自己的待播歌曲插队；房主与管理员始终可用"
                />

                <Toggle
                  checked={songRequest.memberSeekEnabled}
                  disabled={songRequestSaving}
                  onChange={(memberSeekEnabled) => saveSongRequest('memberSeekEnabled', memberSeekEnabled)}
                  label="允许成员拖动进度条"
                  description="默认关闭；开启后成员可调节播放进度；房主与管理员始终可操作"
                />

                <Toggle
                  checked={songRequest.memberPauseEnabled}
                  disabled={songRequestSaving}
                  onChange={(memberPauseEnabled) => saveSongRequest('memberPauseEnabled', memberPauseEnabled)}
                  label="允许成员暂停/播放"
                  description="默认关闭；开启后成员可暂停或继续播放；房主与管理员始终可操作"
                />

                <Toggle
                  checked={songRequest.systemMediaPlayBound}
                  disabled={songRequestSaving}
                  onChange={(systemMediaPlayBound) => saveSongRequest('systemMediaPlayBound', systemMediaPlayBound)}
                  label="系统播放键绑定"
                  description="绑定耳机键 / 锁屏 / 通知栏的播放暂停；关闭可防止摘耳机误触暂停房间"
                />

                <Toggle
                  checked={songRequest.systemMediaSkipBound}
                  disabled={songRequestSaving}
                  onChange={(systemMediaSkipBound) => saveSongRequest('systemMediaSkipBound', systemMediaSkipBound)}
                  label="系统切歌键绑定"
                  description="绑定耳机键 / 锁屏 / 通知栏的下一首切歌；关闭可防止误触切歌"
                />

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label className="text-sm font-medium text-white">
                    踩歌切歌规则
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    正在播放的歌曲被踩满后自动切歌
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={songRequestSaving}
                      onClick={() => saveSongRequest('dislikeSkipMode', 'count')}
                      className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                        songRequest.dislikeSkipMode === 'count'
                          ? 'bg-netease-red/20 text-white'
                          : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      固定人数
                    </button>
                    <button
                      type="button"
                      disabled={songRequestSaving}
                      onClick={() => saveSongRequest('dislikeSkipMode', 'percent')}
                      className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                        songRequest.dislikeSkipMode === 'percent'
                          ? 'bg-netease-red/20 text-white'
                          : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      在线比例
                    </button>
                  </div>
                  {songRequest.dislikeSkipMode === 'count' ? (
                    <NumberStepper
                      id="settings-dislike-threshold"
                      value={songRequest.dislikeSkipThreshold}
                      min={1}
                      max={DISLIKE_SKIP_THRESHOLD_MAX}
                      disabled={songRequestSaving}
                      commitOnBlur
                      suffix="人"
                      onChange={(dislikeSkipThreshold) => saveSongRequest('dislikeSkipThreshold', dislikeSkipThreshold)}
                    />
                  ) : (
                    <NumberStepper
                      id="settings-dislike-percent"
                      value={songRequest.dislikeSkipPercent}
                      min={1}
                      max={100}
                      disabled={songRequestSaving}
                      commitOnBlur
                      suffix="%"
                      onChange={(dislikeSkipPercent) => saveSongRequest('dislikeSkipPercent', dislikeSkipPercent)}
                    />
                  )}
                </div>

                <Toggle
                  checked={songRequest.clearSongsOnLeaveEnabled}
                  disabled={songRequestSaving}
                  onChange={(clearSongsOnLeaveEnabled) => saveSongRequest('clearSongsOnLeaveEnabled', clearSongsOnLeaveEnabled)}
                  label="退出后清除已点歌曲"
                  description="成员离房后，在等待时间到期仍未回来则清除其待播点歌"
                />

                {songRequest.clearSongsOnLeaveEnabled && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                    <label htmlFor="settings-clear-on-leave-delay" className="text-sm font-medium text-white">
                      退出清除等待时间
                    </label>
                    <p className="mt-0.5 text-xs text-netease-muted">
                      0 表示立即清除；期内重新进房会取消清除
                    </p>
                    <NumberStepper
                      id="settings-clear-on-leave-delay"
                      value={songRequest.clearSongsOnLeaveDelayMinutes}
                      min={0}
                      max={CLEAR_ON_LEAVE_DELAY_MINUTES_MAX}
                      disabled={songRequestSaving}
                      commitOnBlur
                      suffix="分钟"
                      onChange={(clearSongsOnLeaveDelayMinutes) => saveSongRequest('clearSongsOnLeaveDelayMinutes', clearSongsOnLeaveDelayMinutes)}
                    />
                  </div>
                )}

                <Toggle
                  checked={songRequest.deferOfflineRequesterSongs}
                  disabled={songRequestSaving}
                  onChange={(deferOfflineRequesterSongs) => saveSongRequest('deferOfflineRequesterSongs', deferOfflineRequesterSongs)}
                  label="离房成员歌曲置后"
                  description="仅用户轮播生效；关闭后离房成员仍按原始点歌人轮次播放"
                />

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label htmlFor="settings-min-stay" className="text-sm font-medium text-white">
                    进房等待时间
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    新成员需待在房间一定时间后才能点歌，0 表示不限制
                  </p>
                  <NumberStepper
                    id="settings-min-stay"
                    value={songRequest.minStayMinutes}
                    min={0}
                    max={MIN_STAY_MINUTES_MAX}
                    disabled={songRequestSaving}
                    commitOnBlur
                    suffix="分钟"
                    onChange={(minStayMinutes) => saveSongRequest('minStayMinutes', minStayMinutes)}
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label htmlFor="settings-max-per-user" className="text-sm font-medium text-white">
                    每人最多点歌
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    待播队列中每人最多保留几首，0 表示不限制
                  </p>
                  <NumberStepper
                    id="settings-max-per-user"
                    value={songRequest.maxPerUser}
                    min={0}
                    max={MAX_PER_USER_MAX}
                    disabled={songRequestSaving}
                    commitOnBlur
                    suffix="首"
                    onChange={(maxPerUser) => saveSongRequest('maxPerUser', maxPerUser)}
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label className="text-sm font-medium text-white">
                    点歌冷却时间
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    每人每次点歌的最短间隔，防止连续刷屏占列表
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COOLDOWN_OPTIONS.map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        disabled={songRequestSaving}
                        onClick={() => saveSongRequest('cooldownSec', sec)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                          songRequest.cooldownSec === sec
                            ? 'bg-netease-red/20 text-white'
                            : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {formatCooldownLabel(sec)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label className="text-sm font-medium text-white">
                    队列长度上限
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    待播队列最多保留几首，超出后无法继续点歌
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {QUEUE_LIMIT_OPTIONS.map((limit) => (
                      <button
                        key={limit}
                        type="button"
                        disabled={songRequestSaving}
                        onClick={() => saveSongRequest('queueMaxLength', limit)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                          songRequest.queueMaxLength === limit
                            ? 'bg-netease-red/20 text-white'
                            : 'bg-white/5 text-netease-muted hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {limit} 首
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-medium text-white">禁播歌曲</label>
                    <span className="text-[11px] text-netease-muted">{bannedSongs.length} 首</span>
                  </div>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    可在播放队列中禁播某首歌；同名歌曲（任意平台）均无法点入
                  </p>
                  {bannedSongs.length > 0 ? (
                    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-0.5">
                      {bannedSongs.map((song) => (
                        <div
                          key={`${song.name}:${song.bannedAt ?? ''}`}
                          className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-white/90">{song.name || '未知歌曲'}</p>
                            <p className="truncate text-[10px] text-netease-muted">{song.artist || '未知歌手'}</p>
                          </div>
                          <SourceBadge source={song.source} className="flex-shrink-0 rounded-full px-1.5 py-0 text-[9px]" />
                          <button
                            type="button"
                            disabled={songRequestSaving}
                            onClick={() => onUnbanSong?.(song.name)}
                            className="flex-shrink-0 rounded-md px-2 py-1 text-[10px] text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                          >
                            解除
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-netease-muted/80">暂无禁播歌曲</p>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
      )}
      <WechatUinBindModal
        open={wechatUinModalMode !== null}
        mode={wechatUinModalMode || 'bind'}
        roomId={roomId}
        onClose={() => {
          setWechatUinModalMode(null);
          onClose();
        }}
        onCompleted={() => {
          void fetchWechatUinStatus(roomId).then((status) => {
            setWechatUinEnabled(status.enabled);
            setWechatUinBound(status.bound);
          });
        }}
      />
      {confirmTransfer && selectedTransferUser && (
        <ConfirmModal
          title="确认转让房主"
          message={(
            <>
              确定将房主转让给「{selectedTransferUser.nickname}」？
              <br />
              转让后对方成为房主，你将失去创建者权限（名额未满时自动变为管理员）。
            </>
          )}
          confirmLabel="确认转让"
          confirmVariant="danger"
          loading={transferSaving}
          onCancel={() => setConfirmTransfer(false)}
          onConfirm={() => {
            if (!selectedTransferUser || !onTransferOwner) return;
            void Promise.resolve(onTransferOwner(selectedTransferUser.id)).finally(() => {
              setConfirmTransfer(false);
            });
          }}
        />
      )}
      {confirmDestroy && (
        <ConfirmModal
          title="确认解散房间"
          message={(
            <>
              确定解散当前房间？在线成员将被移出，房间内容无法恢复。
              {protectedFromDestroy ? (
                <>
                  <br />
                  该房为常驻房间，解散后常驻保护一并取消。
                </>
              ) : null}
            </>
          )}
          confirmLabel="确认解散"
          confirmVariant="danger"
          loading={destroySaving}
          onCancel={() => setConfirmDestroy(false)}
          onConfirm={() => {
            if (!onDestroyRoom) return;
            void Promise.resolve(onDestroyRoom()).finally(() => {
              setConfirmDestroy(false);
            });
          }}
        />
      )}
    </>
  );
}
