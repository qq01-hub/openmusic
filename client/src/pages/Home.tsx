import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, ArrowRight, Lock, ListMusic,
  Loader2, RefreshCw, Plus, X, Disc3, Sparkles, Github, History, HeartHandshake, Heart,
  Play, Activity, Search, ShieldCheck, Crown, Download, Shuffle
} from 'lucide-react';
import { createRoom, checkRoom, listRooms, randomMatchRoom } from '../api/meting';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import type { RoomSummary } from '../types';
import { usePageSeo, useSiteSeoConfig } from '../lib/seo';
import { partitionRoomsByRecent, sortRecentRooms } from '../lib/recentRooms';
import { getStoredRoomPassword } from '../lib/roomPassword';
import { areRoomListsEqual, isLobbyHardLocked, sortLobbyRooms } from '../lib/roomListCompare';
import { resizeCoverUrl } from '../lib/coverUrl';
import { markRoomConfigApplyPending, rememberLatestCreatedRoom } from '../lib/roomConfigCache';
import {
  fetchSiteAnnouncement,
  markSiteAnnouncementSeen,
  shouldAutoShowSiteAnnouncement,
  type SiteAnnouncement,
} from '../lib/siteAnnouncement';
import Tooltip from '../components/Tooltip';
import ClientDownloadModal from '../components/ClientDownloadModal';
import MusicContributionModal from '../components/MusicContributionModal';
import SiteAnnouncementPopup from '../components/SiteAnnouncementPopup';
import UserGuideTour from '../components/UserGuideTour';
import Toast from '../components/Toast';
import BrandMark from '../components/BrandMark';
import HomeAuroraBackdrop from '../components/react-bits/HomeAuroraBackdrop';
import GradientText from '../components/react-bits/GradientText';
import ShinyText from '../components/react-bits/ShinyText';
import SpotlightCard from '../components/react-bits/SpotlightCard';
import BlurText from '../components/react-bits/BlurText';
import Magnet from '../components/react-bits/Magnet';
import TiltedCard from '../components/react-bits/TiltedCard';
import BorderGlow from '../components/react-bits/BorderGlow';
import { getRememberedAdminEntryPath } from '../lib/adminEntryShortcut';
import { markGuideFeatureUsed } from '../lib/userGuide';
import { useSiteFeaturesStore } from '../stores/siteFeaturesStore';
import type { MusicAccountPlatform } from '../lib/musicAccountQr';
import { fetchDonations, type DonationEntry } from '../lib/donations';
import AccountAccess from '../components/AccountAccess';

/** 大厅只用接口带回的 CDN 直链，不走 meting type=pic 再查 */
function lobbyDirectCoverUrl(pic?: string): string | null {
  const raw = String(pic || '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.searchParams.get('type') === 'pic') return null;
  } catch {
    return null;
  }
  return resizeCoverUrl(raw, 'thumb');
}

function GiteeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" className={className} aria-hidden>
      <path d="M512 1024q-104 0-199-40-92-39-163-110T40 711Q0 616 0 512t40-199Q79 221 150 150T313 40q95-40 199-40t199 40q92 39 163 110t110 163q40 95 40 199t-40 199q-39 92-110 163T711 984q-95 40-199 40z m259-569H480q-10 0-17.5 7.5T455 480v64q0 10 7.5 17.5T480 569h177q11 0 18.5 7.5T683 594v13q0 31-22.5 53.5T607 683H367q-11 0-18.5-7.5T341 657V417q0-31 22.5-53.5T417 341h354q11 0 18-7t7-18v-63q0-11-7-18t-18-7H417q-38 0-72.5 14T283 283q-27 27-41 61.5T228 417v354q0 11 7 18t18 7h373q46 0 85.5-22.5t62-62Q796 672 796 626V480q0-10-7-17.5t-18-7.5z" />
    </svg>
  );
}

const headerIconCls =
  'home-header-icon group/hicon relative inline-flex items-center justify-center h-10 w-10 rounded-full text-white/55 border border-white/8 bg-white/[0.03] outline-none transition-[color,background,border-color,transform,box-shadow] duration-300 hover:text-white hover:bg-white/[0.1] hover:border-white/18 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,0,0,0.35)] focus-visible:text-white focus-visible:ring-2 focus-visible:ring-netease-red/40';

const headerPillCls =
  'home-header-pill group/pill inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium text-white/65 border border-white/8 bg-white/[0.03] outline-none transition-[color,background,border-color,transform,box-shadow] duration-300 hover:text-white hover:bg-white/[0.1] hover:border-white/18 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:ring-netease-red/40';


/** 逐字母渐变色：品牌红 → 玫红 → 紫，跨整个词插值（hover 时逐字点亮） */
function buildGradientLetters(text: string) {
  const stops = [
    [255, 77, 85],
    [244, 114, 182],
    [192, 132, 252],
  ];
  return text.split('').map((char, i, arr) => {
    const t = arr.length > 1 ? i / (arr.length - 1) : 0;
    const seg = t * (stops.length - 1);
    const idx = Math.min(Math.floor(seg), stops.length - 2);
    const f = seg - idx;
    const mix = stops[idx].map((v, c) => Math.round(v + (stops[idx + 1][c] - v) * f));
    return { char, color: `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})` };
  });
}

const BRAND_LETTERS = buildGradientLetters('OpenMusic');

const COVER_GRADIENTS = [
  'from-rose-500 to-orange-400',
  'from-sky-500 to-indigo-500',
  'from-violet-500 to-fuchsia-500',
  'from-emerald-500 to-teal-400',
  'from-amber-500 to-red-500',
  'from-cyan-500 to-blue-500',
  'from-pink-500 to-rose-500',
  'from-lime-500 to-emerald-500',
];

function gradientForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return COVER_GRADIENTS[hash % COVER_GRADIENTS.length];
}

function EqualizerBars({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[3px] h-3.5 ${className}`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current animate-equalizer"
          style={{
            animationDelay: `${i * 0.12}s`,
            animationDuration: `${0.7 + (i % 3) * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

/** 大厅封面：优先自定义封面，否则用接口带回的歌曲 CDN 直链（不走 meting type=pic） */
function lobbyCoverUrl(room: Pick<RoomSummary, 'customCoverUrl' | 'currentSong'>): string | null {
  const custom = String(room.customCoverUrl || '').trim();
  if (custom.startsWith('data:image/')) return custom;
  if (custom) {
    const fromCustom = lobbyDirectCoverUrl(custom);
    if (fromCustom) return fromCustom;
  }
  return lobbyDirectCoverUrl(room.currentSong?.pic);
}

const RoomCard = memo(function RoomCard({
  room,
  onJoin,
  guideAnchor = false,
}: {
  room: RoomSummary;
  onJoin: (room: RoomSummary) => void;
  /** 大厅指引高亮用：只标第一张卡片，避免整页列表把遮罩挤没 */
  guideAnchor?: boolean;
}) {
  const isActive = room.isPlaying && room.currentSong;
  const hardLocked = isLobbyHardLocked(room);
  const gradient = gradientForId(room.id);
  const coverUrl = lobbyCoverUrl(room);
  const [coverFailed, setCoverFailed] = useState(false);
  const showCover = Boolean(coverUrl) && !coverFailed;

  useEffect(() => {
    setCoverFailed(false);
  }, [coverUrl]);

  const cardClassName = `group relative w-full text-left rounded-[24px] border overflow-hidden backdrop-blur-md
    ${hardLocked
      ? 'border-white/5 bg-black/40 opacity-60 cursor-not-allowed'
      : 'border-white/10 bg-gradient-to-br from-white/[0.09] to-white/[0.02] shadow-xl shadow-black/40 hover:border-white/25 hover:from-white/[0.14] hover:to-white/[0.04] hover:shadow-2xl hover:shadow-black/70'
    }`;

  const body = (
    <>
      {/* 炫光背景 */}
      {isActive && !hardLocked && (
        <div className={`absolute -top-20 -right-20 w-48 h-48 rounded-full bg-gradient-to-br ${gradient} opacity-[0.08] blur-3xl group-hover:opacity-20 transition-opacity duration-500 pointer-events-none`} />
      )}

      {/* 顶部细亮线，增强边缘立体感 */}
      {!hardLocked && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[11] h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      )}

      {(room.isOwner || room.isAdmin) && (
        <Tooltip content={room.isOwner ? '房主' : '管理员'}>
          <div
            className="absolute right-4 top-4 z-20 inline-flex items-center justify-center rounded-full border border-white/10 bg-black/45 p-2 text-amber-300 shadow-lg backdrop-blur-md"
            aria-label={room.isOwner ? '房主' : '管理员'}
          >
            {room.isOwner ? <Crown className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4 text-sky-300" />}
          </div>
        </Tooltip>
      )}

      <div className="relative p-5 sm:p-6" style={{ transformStyle: 'preserve-3d' }}>
        <div className="flex items-center gap-5" style={{ transformStyle: 'preserve-3d' }}>
          {/* 封面区块（倾斜时视差浮起） */}
          <div className="relative flex-shrink-0 transition-transform duration-300 ease-out [transform:translateZ(0)] group-hover:[transform:translateZ(45px)]">
            <div className={`relative w-16 h-16 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-gradient-to-br ${gradient} flex items-center justify-center transition-all duration-300 shadow-[0_10px_22px_rgba(0,0,0,0.55),0_2px_5px_rgba(0,0,0,0.5),inset_0_1.5px_0_rgba(255,255,255,0.35),inset_0_-2px_4px_rgba(0,0,0,0.35)] ${hardLocked ? 'grayscale' : 'group-hover:shadow-[0_18px_36px_rgba(0,0,0,0.65),0_3px_7px_rgba(0,0,0,0.5),inset_0_1.5px_0_rgba(255,255,255,0.4),inset_0_-2px_4px_rgba(0,0,0,0.35)] group-hover:scale-105'}`}>
              {showCover && (
                <img
                  key={coverUrl!}
                  src={coverUrl!}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setCoverFailed(true)}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              )}
              {showCover && <div className="absolute inset-0 bg-black/20 pointer-events-none" />}
              {isActive && !hardLocked ? (
                <EqualizerBars className="relative text-white drop-shadow-md scale-110" />
              ) : !showCover ? (
                <Disc3 className={`relative w-8 h-8 sm:w-10 sm:h-10 text-white/90 drop-shadow-md transition-transform duration-500 ${hardLocked ? '' : 'group-hover:rotate-[20deg]'}`} />
              ) : null}
            </div>
            {isActive && !hardLocked && (
              <span className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-[#111] border border-white/10 backdrop-blur-md flex items-center justify-center shadow-xl">
                <Play className="w-3.5 h-3.5 text-netease-red fill-netease-red ml-0.5" />
              </span>
            )}
          </div>

          {/* 信息区块（倾斜时视差浮起） */}
          <div className="min-w-0 flex-1 flex flex-col h-full justify-center transition-transform duration-300 ease-out [transform:translateZ(0)] group-hover:[transform:translateZ(24px)]">
            <div className="flex items-center gap-2.5 mb-1.5 min-h-[3.5rem] sm:min-h-[3.75rem]">
              <h3 className={`min-w-0 flex-1 text-xl sm:text-[22px] font-black tracking-tight break-words whitespace-normal leading-snug line-clamp-2 ${hardLocked ? 'text-white/50' : 'text-emboss'}`}>
                {room.name}
              </h3>
              {room.hasPassword && !hardLocked && (
                <span className="flex-shrink-0 p-1 rounded-full bg-amber-400/10 text-amber-400 group-hover:bg-amber-400/20 transition-colors">
                  <Lock className="w-3.5 h-3.5" />
                </span>
              )}
            </div>

            {room.currentSong ? (
              <div className="min-w-0 max-w-full self-start mt-0.5 rounded-lg bg-black/25 px-2.5 py-1 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.06)]">
                <p className={`flex items-center gap-1.5 text-[13px] truncate transition-colors ${isActive && !hardLocked ? 'text-white/65' : 'text-white/50'} group-hover:text-white/75`}>
                  {isActive && !hardLocked && (
                    <span className="flex-shrink-0 text-netease-red/80 text-[12px] animate-pulse">♪</span>
                  )}
                  <span className="flex-none max-w-full truncate">{room.currentSong.name}</span>
                  <span className="flex-shrink-0 text-white/25">·</span>
                  <span className="min-w-0 truncate text-white/35 group-hover:text-white/50 transition-colors">{room.currentSong.artist}</span>
                </p>
              </div>
            ) : (
              <p className="self-start mt-0.5 rounded-lg bg-black/25 px-2.5 py-1 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.06)] text-[13px] text-white/30 italic group-hover:text-white/50 transition-colors">等待点播...</p>
            )}

            <div className="flex items-center gap-2 sm:gap-5 mt-4 pt-3.5 border-t border-black/40 [box-shadow:inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2.5">
                <span className="inline-flex flex-shrink-0 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-lg px-1.5 sm:px-2 py-1 text-xs font-semibold text-white/55 group-hover:text-white/85 transition-colors bg-gradient-to-b from-white/[0.09] to-white/[0.02] border border-white/10 shadow-[0_2px_4px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <Users className="w-3.5 h-3.5 flex-shrink-0 text-white/40 group-hover:text-emerald-400 group-hover:scale-110 transition-all duration-300" />
                  {room.userCount}人
                </span>
                <span className="inline-flex flex-shrink-0 items-center gap-1 sm:gap-1.5 whitespace-nowrap rounded-lg px-1.5 sm:px-2 py-1 text-xs font-semibold text-white/55 group-hover:text-white/85 transition-colors bg-gradient-to-b from-white/[0.09] to-white/[0.02] border border-white/10 shadow-[0_2px_4px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <ListMusic className="w-3.5 h-3.5 flex-shrink-0 text-white/40 group-hover:text-violet-400 group-hover:scale-110 transition-all duration-300" />
                  {room.queueLength}首
                </span>
              </div>
              
              <span className="ml-auto flex-shrink-0">
                {hardLocked ? (
                  <span className="flex items-center gap-1 whitespace-nowrap text-xs text-red-400/60 font-medium">
                    <Lock className="w-3.5 h-3.5" />
                    已上锁
                  </span>
                ) : (
                  <span className="hidden sm:flex items-center gap-1 text-[13px] text-netease-red opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 font-bold">
                    立即加入
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <TiltedCard
      disabled={hardLocked}
      rotateAmplitude={11}
      scaleOnHover={1.025}
      spotlightColor="rgba(255, 77, 85, 0.2)"
      onClick={() => onJoin(room)}
      data-guide={guideAnchor ? 'home-lobby' : undefined}
      className={cardClassName}
    >
      {body}
    </TiltedCard>
  );
});

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative w-full max-w-md bg-[#111111]/90 backdrop-blur-xl rounded-[32px] border border-white/10 shadow-2xl p-7 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-white/40 bg-white/5 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DonationModal({ open, onClose, donations }: { open: boolean; onClose: () => void; donations: DonationEntry[] }) {
  if (!open) return null;
  const sortedDonations = [...donations].sort((a, b) => {
    const dateDiff = String(a.date).localeCompare(String(b.date));
    if (dateDiff !== 0) return dateDiff;
    return Number(b.amount || 0) - Number(a.amount || 0);
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} aria-label="关闭赞赏弹窗" />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#171016]/95 backdrop-blur-xl rounded-[28px] border border-pink-300/20 shadow-[0_24px_80px_rgba(236,72,153,0.18)] p-6 sm:p-8 animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-pink-300/25 bg-pink-400/15 text-pink-200">
              <Heart className="w-4 h-4 fill-current" />
            </span>
            <div>
            <h2 className="text-xl font-bold text-pink-50">支持 OpenMusic</h2>
            <p className="text-sm text-white/45 mt-1">感谢每一份支持与心意，让 OpenMusic 能继续陪大家听喜欢的歌，走过更多美好的时光 🎵</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full text-pink-100/50 bg-pink-300/10 hover:text-pink-50 hover:bg-pink-300/20" aria-label="关闭">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          {[
            { name: '微信', src: '/donate-wechat.png' },
            { name: '支付宝', src: '/donate-alipay.png' },
          ].map((item) => (
            <div key={item.name} className="rounded-2xl border border-pink-300/15 bg-pink-300/[0.05] p-4 text-center">
              <img src={item.src} alt={`${item.name}赞赏二维码`} className="mx-auto w-full max-w-[240px] aspect-square object-contain rounded-xl bg-white" />
              <div className="mt-3 text-sm font-semibold text-pink-100/85">{item.name}</div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-center text-xs text-pink-100/45">请在备注中注明昵称，以便感谢</p>

        <div className="mt-7 border-t border-pink-300/15 pt-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-pink-100">捐赠名单</div>
            <div className="text-xs text-pink-100/35">按捐赠时间排序</div>
          </div>
          {donations.length > 0 ? (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sortedDonations.map((entry, index) => (
                <div key={entry.id} className="flex items-center justify-between rounded-xl border border-pink-300/10 bg-pink-300/[0.04] px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-pink-50/80 truncate"><span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pink-300/10 text-[11px] tabular-nums text-pink-200/70">{index + 1}</span>{entry.name}</span>
                  <span className="text-pink-100/35 ml-3 shrink-0">{entry.date}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-pink-100/40">感谢第一位支持者。</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const sharedMembershipEnabled = useSiteFeaturesStore((state) => state.sharedMembershipEnabled);
  const musicSourcesEnabled = useSiteFeaturesStore((state) => state.musicSourcesEnabled);
  const contributionPlatforms = useMemo<MusicAccountPlatform[]>(
    () => (['netease', 'tencent', 'kugou', 'qishui'] as MusicAccountPlatform[])
      .filter((platform) => musicSourcesEnabled[platform]),
    [musicSourcesEnabled],
  );
  const contributionEnabled = sharedMembershipEnabled && contributionPlatforms.length > 0;
  const navigate = useNavigate();
  const nickname = useRoomStore((s) => s.nickname);
  const setNickname = useRoomStore((s) => s.setNickname);
  const { leaveRoom } = useSocket();

  usePageSeo({ path: '/' });
  const siteSeo = useSiteSeoConfig();

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [adminEntryPath] = useState(() => getRememberedAdminEntryPath());
  const [error, setError] = useState('');
  const [matchError, setMatchError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [createRoomName, setCreateRoomName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [modalError, setModalError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [contributionOpen, setContributionOpen] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);
  const [donations, setDonations] = useState<DonationEntry[]>([]);
  const [siteAnnouncement, setSiteAnnouncement] = useState<SiteAnnouncement | null>(null);
  const [siteAnnouncementOpen, setSiteAnnouncementOpen] = useState(false);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);

  const roomsFetchSeq = useRef(0);
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const heroCopyRef = useRef<HTMLParagraphElement | null>(null);
  const handleHeroCopyMove = useCallback((e: React.MouseEvent) => {
    const el = heroCopyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--hx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty('--hy', `${((e.clientY - rect.top) / rect.height) * 100}%`);
  }, []);

  const handleBtnTilt = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--brx', `${(-py * 16).toFixed(2)}deg`);
    el.style.setProperty('--bry', `${(px * 12).toFixed(2)}deg`);
  }, []);

  const resetBtnTilt = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.setProperty('--brx', '0deg');
    el.style.setProperty('--bry', '0deg');
  }, []);

  const fetchRooms = useCallback(async (silent = false) => {
    const seq = ++roomsFetchSeq.current;
    if (!silent) setRoomsLoading(true);

    const maxAttempts = silent ? 2 : 3;
    let succeeded = false;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const data = await listRooms();
          if (seq !== roomsFetchSeq.current) return;
          setRooms((prev) => (areRoomListsEqual(prev, data) ? prev : data));
          setError('');
          succeeded = true;
          break;
        } catch {
          if (seq !== roomsFetchSeq.current) return;
          if (attempt < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
            if (seq !== roomsFetchSeq.current) return;
          }
        }
      }

      if (seq !== roomsFetchSeq.current) return;
      if (!succeeded) {
        // 手动/首屏失败才提示；已有列表时轮询失败保持静默
        if (!silent || roomsRef.current.length === 0) {
          setError('房间列表加载失败，请重试');
        }
      }
    } finally {
      if (seq === roomsFetchSeq.current) {
        setRoomsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (useRoomStore.getState().room) {
      leaveRoom();
    }
  }, [leaveRoom]);

  useEffect(() => {
    void fetchRooms();
    const POLL_MS = 8000;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchRooms(true);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void fetchRooms(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      roomsFetchSeq.current += 1;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchRooms]);

  // 空闲后再预热热歌榜 / Room chunk，避免与首屏房间列表抢带宽
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void import('../api/music/toplist')
        .then((m) => m.getNeteaseHotToplist(200))
        .catch(() => {});
      void import('../pages/Room');
    };
    const ric = typeof window !== 'undefined'
      ? (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
      : undefined;
    const idleId = ric ? ric(warm, { timeout: 2500 }) : 0;
    const timeoutId = ric ? 0 : window.setTimeout(warm, 1200);
    return () => {
      cancelled = true;
      const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (idleId && cic) cic(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    void fetchDonations().then(setDonations);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSiteAnnouncement().then((announcement) => {
      if (cancelled || !announcement) return;
      setSiteAnnouncement(announcement);
      if (shouldAutoShowSiteAnnouncement(announcement)) {
        setSiteAnnouncementOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCloseSiteAnnouncement = useCallback(() => {
    if (siteAnnouncement?.id) {
      markSiteAnnouncementSeen(siteAnnouncement.id);
    }
    setSiteAnnouncementOpen(false);
  }, [siteAnnouncement?.id]);

  const goToRoom = (roomId: string, password?: string) => {
    navigate(`/room/${roomId}`, { state: password ? { password } : undefined });
  };

  const handleCreate = async () => {
    setActionLoading(true);
    setError('');
    setMatchError('');
    setModalError('');
    const pwd = createPassword.trim();
    if (pwd && pwd.length < 4) {
      setModalError('房间密码至少 4 位');
      setActionLoading(false);
      return;
    }
    try {
      const room = await createRoom(createRoomName, createPassword);
      rememberLatestCreatedRoom(room.id);
      markRoomConfigApplyPending(room.id);
      setShowCreate(false);
      setCreateRoomName('');
      setCreatePassword('');
      goToRoom(room.id, pwd || undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message.trim() : '';
      if (msg.startsWith('你创建房间有点频繁啦') || msg.startsWith('刚刚已经创建过房间啦')) {
        setModalError('');
        setToast({ message: msg, type: 'error' });
      } else {
        setModalError(msg || '创建房间失败，请重试');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleRandomMatch = async () => {
    if (matchLoading) return;
    setMatchLoading(true);
    setError('');
    setMatchError('');
    setModalError('');
    try {
      const room = await randomMatchRoom();
      goToRoom(room.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message.trim() : '';
      setMatchError(msg || '暂时没有可随机加入的公开房间');
      void fetchRooms(true);
    } finally {
      setMatchLoading(false);
    }
  };

  const handleJoinByCode = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setModalError('请输入房间号');
      return;
    }
    setActionLoading(true);
    setError('');
    setMatchError('');
    setModalError('');
    try {
      const result = await checkRoom(code);
      if (!result.exists) {
        setModalError('房间不存在，请检查房间号');
        return;
      }
      setShowJoin(false);
      setJoinCode('');
      setJoinPassword('');
      goToRoom(code, joinPassword.trim() || undefined);
    } catch {
      setModalError('加入房间失败，请重试');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRoomCardClick = useCallback((room: RoomSummary) => {
    setError('');
    setMatchError('');
    const storedPassword = getStoredRoomPassword(room.id);
    if (room.hasPassword && !storedPassword) {
      navigate(`/room/${room.id}`, { state: { hasPassword: true } });
      return;
    }
    goToRoom(room.id, storedPassword);
  }, [navigate]);

  const { recent: recentRooms, others: otherRooms } = useMemo(() => {
    const { recent, others } = partitionRoomsByRecent(rooms);
    return {
      recent: sortRecentRooms(recent),
      others: sortLobbyRooms(others),
    };
  }, [rooms]);

  const inputCls =
    'home-modal-input w-full rounded-2xl px-5 py-3.5 text-white text-[15px] caret-white placeholder:text-white/30 outline-none border border-white/10 bg-[#1a1a1a] focus:border-netease-red/60 transition-[border-color] duration-200';

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-[#050505] text-white font-sans selection:bg-netease-red/30">
      {/* React Bits Aurora 背景（弱设备 / 移动端自动降级） */}
      <HomeAuroraBackdrop />

      {/* 悬浮顶栏 */}
      <header className="home-hero-stage home-hero-stage--header relative z-20 pt-6 px-4 sm:px-6 max-w-7xl mx-auto w-full">
        <div className="bg-white/[0.03] border border-white/10 backdrop-blur-xl rounded-full px-5 py-3 flex items-center justify-between shadow-2xl">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10 drop-shadow-[0_8px_20px_rgba(255,77,85,.18)]" />
            <span className="brand-wordmark text-xl font-extrabold tracking-tight select-none" aria-label="OpenMusic">
              {BRAND_LETTERS.map((letter, index) => (
                <span
                  key={index}
                  aria-hidden
                  className="brand-letter"
                  style={{
                    transitionDelay: `${index * 28}ms`,
                    ['--brand-c' as string]: letter.color,
                  }}
                >
                  {letter.char}
                </span>
              ))}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <AccountAccess
                allowAutoPrompt={!siteAnnouncementOpen}
                onOpenChange={setAccountPanelOpen}
              />
              <Tooltip content="支持 OpenMusic">
                <button type="button" onClick={() => setDonationOpen(true)} className={`hidden sm:inline-flex ${headerPillCls}`} aria-label="支持 OpenMusic">
                  <Heart className="h-4 w-4 text-pink-300 fill-current" />
                  <span>赞赏</span>
                </button>
              </Tooltip>
              <Tooltip content="支持 OpenMusic">
                <button type="button" onClick={() => setDonationOpen(true)} className={`inline-flex sm:hidden ${headerIconCls}`} aria-label="支持 OpenMusic">
                  <Heart className="h-5 w-5 text-pink-300 fill-current" />
                </button>
              </Tooltip>
              {contributionEnabled && (
                <>
                  <Tooltip content="把会员能力分享给大家">
                    <button type="button" onClick={() => setContributionOpen(true)} className={`sm:hidden ${headerIconCls}`} aria-label="共享会员">
                      <HeartHandshake className="h-4 w-4 text-rose-200" />
                    </button>
                  </Tooltip>
                  <Tooltip content="把会员能力分享给大家">
                    <button type="button" onClick={() => setContributionOpen(true)} className={`hidden sm:inline-flex ${headerPillCls}`} aria-label="共享会员">
                      <HeartHandshake className="h-4 w-4 text-rose-200" />
                      <span>共享会员</span>
                    </button>
                  </Tooltip>
                </>
              )}
              <Tooltip content="下载客户端">
                <button type="button" onClick={() => setDownloadModalOpen(true)} className={`inline-flex ${headerIconCls}`} aria-label="下载客户端">
                  <Download className="home-header-icon__download h-5 w-5" />
                </button>
              </Tooltip>
              {adminEntryPath && (
                <Tooltip content="管理后台（仅本机可见）">
                  <a href={adminEntryPath} className={`hidden sm:inline-flex ${headerIconCls}`} aria-label="管理后台">
                    <ShieldCheck className="home-header-icon__shield w-5 h-5" />
                  </a>
                </Tooltip>
              )}
              <Tooltip content="Gitee 仓库">
                <a
                  href="https://gitee.com/w3126197382/openmusic"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hidden sm:inline-flex ${headerIconCls}`}
                  aria-label="Gitee"
                >
                  <GiteeIcon className="home-header-icon__gitee w-5 h-5" />
                </a>
              </Tooltip>
              <Tooltip content="GitHub · 欢迎 Star">
                <a
                  href="https://github.com/qq01-hub/openmusic"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hidden sm:inline-flex ${headerIconCls}`}
                  aria-label="GitHub"
                >
                  <Github className="w-5 h-5" />
                </a>
              </Tooltip>
            </div>
          </div>
        </div>
      </header>

      {/* 滚动内容区 */}
      <main className="relative z-10 flex-1 overflow-y-auto pb-20 custom-scrollbar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16">
          
          {/* 精简居中版 Hero Section */}
          <section className="mb-16 flex flex-col items-center text-center max-w-3xl mx-auto">
            {/* 状态徽章 */}
            <div className="home-hero-stage home-hero-stage--badge mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md text-xs sm:text-[13px] font-medium">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <ShinyText
                text="多人实时同步 · 边听边聊"
                speed={5.8}
                color="rgba(255,255,255,0.58)"
                shineColor="rgba(255,255,255,0.95)"
              />
            </div>

            <h1 className="home-hero-stage home-hero-stage--title relative text-4xl sm:text-5xl lg:text-[68px] font-black tracking-tight leading-[1.1] mb-5">
              <BlurText
                text={siteSeo.heroHeadline}
                delay={40}
                startDelay={60}
                charClassName="hero-char"
              />
              {' '}
              <br className="sm:hidden" />
              <span className="relative inline-block sm:ml-4 align-baseline home-hero-gradient-enter">
                <span
                  aria-hidden
                  className="home-gradient-glow pointer-events-none absolute inset-0 select-none blur-2xl"
                >
                  <GradientText
                    className="text-4xl sm:text-5xl lg:text-[68px] font-black tracking-tight leading-[1.1]"
                    colors={['#ff4d55', '#fb7185', '#e17ce8', '#fb7185', '#ff4d55']}
                    animationSpeed={8}
                    direction="diagonal"
                  >
                    {siteSeo.heroSubline}
                  </GradientText>
                </span>
                <GradientText
                  className="relative text-4xl sm:text-5xl lg:text-[68px] font-black tracking-tight leading-[1.1]"
                  colors={['#ff4d55', '#fb7185', '#e17ce8', '#fb7185', '#ff4d55']}
                  animationSpeed={8}
                  direction="diagonal"
                >
                  {siteSeo.heroSubline}
                </GradientText>
              </span>
            </h1>

            <p
              ref={heroCopyRef}
              onMouseMove={handleHeroCopyMove}
              className="home-hero-stage home-hero-stage--copy hero-copy text-[15px] sm:text-lg mb-10 max-w-xl leading-relaxed"
            >
              打破距离的限制，创造属于你们的
              <br />
              <span className="font-semibold">专属音乐时刻</span>
            </p>

            {/* 居中控制台 — Spotlight + BorderGlow（与房间卡片同款跟手高亮） */}
            <div className="home-hero-stage home-hero-stage--bar w-full">
              <BorderGlow
                className="w-full rounded-[28px] sm:rounded-full"
                color="#ff4d55"
                colorSecondary="#c084fc"
                duration={7}
                bloom={0.55}
                edgeProximity
                edgeZone={48}
              >
                <SpotlightCard
                  className="w-full rounded-[28px] sm:rounded-full border-0 bg-white/[0.03] p-2.5 shadow-2xl backdrop-blur-xl"
                  spotlightColor="rgba(255, 77, 85, 0.22)"
                >
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div className="relative flex-1 group" data-guide="home-nickname">
                      <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                        <Users className="w-5 h-5 text-white/40 transition-all duration-300 group-focus-within:text-netease-red group-focus-within:scale-110" />
                      </div>
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => {
                          setNickname(e.target.value);
                          setError('');
                          if (e.target.value.trim()) markGuideFeatureUsed('home-nickname');
                        }}
                        placeholder="给自己起个昵称..."
                        maxLength={20}
                        className="w-full h-12 sm:h-14 bg-transparent pl-14 pr-6 text-white caret-netease-red placeholder:text-white/30 outline-none rounded-full text-[15px] transition-colors focus:bg-white/[0.04]"
                      />
                    </div>
                    <div className="flex flex-wrap sm:flex-nowrap gap-2.5">
                      <Magnet className="order-2 flex flex-1 sm:flex-none" strength={0.28} maxOffset={8}>
                        <div data-guide="home-match" className="flex w-full">
                          <button
                            type="button"
                            onClick={() => {
                              markGuideFeatureUsed('home-match');
                              void handleRandomMatch();
                            }}
                            disabled={matchLoading}
                            onMouseMove={handleBtnTilt}
                            onMouseLeave={resetBtnTilt}
                            className="btn-shine btn-tilt group/match h-12 sm:h-14 w-full px-5 sm:px-7 rounded-full bg-white/10 hover:bg-white/18 border border-white/10 hover:border-white/25 text-white font-semibold shadow-lg shadow-black/20 whitespace-nowrap disabled:cursor-wait disabled:opacity-70"
                          >
                            <span className="btn-tilt-face flex h-full w-full items-center justify-center gap-2">
                              {matchLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : null}
                              匹配
                              {!matchLoading && (
                                <Shuffle className="h-4 w-0 ml-0 opacity-0 -translate-x-1 transition-all duration-300 ease-out group-hover/match:w-4 group-hover/match:ml-1.5 group-hover/match:opacity-100 group-hover/match:translate-x-0 group-focus-visible/match:w-4 group-focus-visible/match:ml-1.5 group-focus-visible/match:opacity-100 group-focus-visible/match:translate-x-0 group-active/match:w-4 group-active/match:ml-1.5 group-active/match:opacity-100 group-active/match:translate-x-0" />
                              )}
                            </span>
                          </button>
                        </div>
                      </Magnet>
                      <Magnet className="order-1 flex flex-1 sm:flex-none" strength={0.28} maxOffset={8}>
                        <div data-guide="home-create" className="flex w-full">
                          <button
                            type="button"
                            onClick={() => {
                              setError('');
                              setModalError('');
                              setShowCreate(true);
                              markGuideFeatureUsed('home-create');
                            }}
                            onMouseMove={handleBtnTilt}
                            onMouseLeave={resetBtnTilt}
                            className="btn-shine btn-tilt group/create h-12 sm:h-14 w-full px-6 sm:px-8 rounded-full bg-netease-red hover:bg-netease-red/90 text-white font-semibold shadow-lg shadow-netease-red/25 hover:shadow-xl hover:shadow-netease-red/45 whitespace-nowrap"
                          >
                            <span className="btn-tilt-face flex h-full w-full items-center justify-center gap-2">
                              <Plus className="w-5 h-5 transition-transform duration-300 ease-out group-hover/create:rotate-90" />
                              创建房间
                            </span>
                          </button>
                        </div>
                      </Magnet>
                      <Magnet className="order-3 flex flex-1 sm:flex-none" strength={0.28} maxOffset={8}>
                        <div data-guide="home-join" className="flex w-full">
                          <button
                            type="button"
                            onClick={() => {
                              setError('');
                              setModalError('');
                              setShowJoin(true);
                              markGuideFeatureUsed('home-join');
                            }}
                            onMouseMove={handleBtnTilt}
                            onMouseLeave={resetBtnTilt}
                            className="btn-shine btn-tilt group/join h-12 sm:h-14 w-full px-6 sm:px-8 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/25 text-white font-medium whitespace-nowrap"
                          >
                            <span className="btn-tilt-face flex h-full w-full items-center justify-center">
                              加入
                              <ArrowRight className="h-4 w-0 ml-0 opacity-0 -translate-x-1 group-hover/join:w-4 group-hover/join:ml-1.5 group-hover/join:opacity-100 group-hover/join:translate-x-0 transition-all duration-300 ease-out" />
                            </span>
                          </button>
                        </div>
                      </Magnet>
                    </div>
                  </div>
                </SpotlightCard>
              </BorderGlow>
            </div>

            {error && rooms.length > 0 && (
              <div className="mt-4 flex items-center gap-2 px-5 py-3 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-fade-in">
                <Activity className="w-4 h-4 shrink-0" />
                <span className="flex-1 min-w-0">{error}</span>
                <button
                  type="button"
                  onClick={() => void fetchRooms()}
                  disabled={roomsLoading}
                  className="shrink-0 text-red-300 hover:text-white underline-offset-2 hover:underline disabled:opacity-50"
                >
                  重试
                </button>
                <button
                  type="button"
                  aria-label="关闭提示"
                  onClick={() => setError('')}
                  className="shrink-0 p-0.5 rounded-full text-red-400/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {matchError && (
              <div className="mt-4 flex items-center gap-2 px-5 py-3 rounded-full bg-white/[0.06] border border-white/10 text-white/70 text-sm animate-fade-in">
                <Shuffle className="w-4 h-4 shrink-0 text-netease-red/80" />
                <span className="flex-1 min-w-0">{matchError}</span>
                <button
                  type="button"
                  aria-label="关闭提示"
                  onClick={() => setMatchError('')}
                  className="shrink-0 p-0.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </section>

          {/* 房间列表区（突出显示，变宽） */}
          <div className="flex items-center justify-between mb-8 border-b border-white/5 pb-5">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              大厅
              {rooms.length > 0 && (
                <span className="text-sm font-medium bg-white/10 text-white/80 px-3 py-1 rounded-full align-middle">
                  {rooms.length} 活跃
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => void fetchRooms()}
              disabled={roomsLoading}
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 group-hover:rotate-180 transition-transform duration-500 ${roomsLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">刷新列表</span>
            </button>
          </div>

          {roomsLoading && rooms.length === 0 ? (
            <div data-guide="home-lobby" className="flex flex-col items-center justify-center py-32 text-white/40">
              <Loader2 className="w-10 h-10 animate-spin mb-4 text-netease-red" />
              <p className="text-base font-medium">寻找房间中...</p>
            </div>
          ) : error && rooms.length === 0 ? (
            <div data-guide="home-lobby" className="flex flex-col items-center justify-center py-24 px-4 text-center bg-red-500/[0.04] border border-red-500/15 rounded-[32px]">
              <div className="w-24 h-24 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
                <Activity className="w-10 h-10 text-red-400/80" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">房间加载失败</h3>
              <p className="text-white/45 mb-8 max-w-sm">网络不稳定或服务暂时无响应。稍后重试即可，不影响你创建或加入房间。</p>
              <button
                type="button"
                onClick={() => void fetchRooms()}
                disabled={roomsLoading}
                className="flex items-center gap-2 px-8 py-4 rounded-full bg-white text-black font-bold hover:bg-white/90 hover:scale-105 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-5 h-5 ${roomsLoading ? 'animate-spin' : ''}`} />
                重新加载
              </button>
            </div>
          ) : rooms.length === 0 ? (
            <div data-guide="home-lobby" className="flex flex-col items-center justify-center py-24 px-4 text-center bg-white/[0.01] border border-white/5 rounded-[32px]">
              <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 shadow-inner">
                <Search className="w-10 h-10 text-white/20" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">当前没有活跃房间</h3>
              <p className="text-white/40 mb-8 max-w-sm">一切都很安静。不如由你来开启第一首歌，邀请朋友们一起来听吧。</p>
              <button
                type="button"
                onClick={() => { setError(''); setShowCreate(true); }}
                className="flex items-center gap-2 px-8 py-4 rounded-full bg-white text-black font-bold hover:bg-white/90 hover:scale-105 transition-all"
              >
                <Plus className="w-5 h-5" />
                创建我的房间
              </button>
            </div>
          ) : (
            <div className="space-y-10">
              {recentRooms.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <History className="w-5 h-5 text-sky-400" />
                    <h3 className="text-lg font-bold text-white">最近去过</h3>
                  </div>
                  {/* 这里改成了更宽的网格，最大 3 列，从而让卡片变宽 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
                    {recentRooms.map((room, index) => (
                      <RoomCard
                        key={room.id}
                        room={room}
                        onJoin={handleRoomCardClick}
                        guideAnchor={index === 0}
                      />
                    ))}
                  </div>
                </section>
              )}
              {otherRooms.length > 0 && (
                <section>
                  {recentRooms.length > 0 && (
                    <div className="flex items-center gap-2 mb-6 mt-4">
                      <Search className="w-5 h-5 text-white/50" />
                      <h3 className="text-lg font-bold text-white/80">探索更多</h3>
                    </div>
                  )}
                  {/* 同样最大 3 列，保证宽度充足 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
                    {otherRooms.map((room, index) => (
                      <RoomCard
                        key={room.id}
                        room={room}
                        onJoin={handleRoomCardClick}
                        guideAnchor={recentRooms.length === 0 && index === 0}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>

      {/* 弹窗: 创建房间 */}
      {showCreate && (
        <Modal title="创建新房间" onClose={() => { setShowCreate(false); setCreateRoomName(''); setCreatePassword(''); setModalError(''); }}>
          <form
            className="space-y-5"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (!actionLoading) void handleCreate();
            }}
          >
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">给房间起个名字</label>
              <input
                type="text"
                name="om-room-name"
                value={createRoomName}
                onChange={(e) => { setCreateRoomName(e.target.value); if (modalError) setModalError(''); }}
                placeholder="例如：周杰伦专场、深夜EMO"
                maxLength={20}
                className={inputCls}
                autoFocus
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">访问密码 <span className="text-white/30 font-normal">(可选，至少 4 位)</span></label>
              <input
                type="text"
                inputMode="text"
                name="om-room-gate"
                value={createPassword}
                onChange={(e) => { setCreatePassword(e.target.value); if (modalError) setModalError(''); }}
                placeholder="留空即为公开房间"
                maxLength={32}
                className={`${inputCls} om-secret-input`}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
              />
            </div>
            {modalError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <Activity className="w-4 h-4 flex-shrink-0" />
                {modalError}
              </div>
            )}
            <button
              type="submit"
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 bg-white text-black hover:bg-gray-200 disabled:opacity-50 font-bold py-4 rounded-2xl transition-all mt-2"
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
              开启音乐之旅
            </button>
          </form>
        </Modal>
      )}

      {/* 弹窗: 加入房间 */}
      {showJoin && (
        <Modal title="加入房间" onClose={() => { setShowJoin(false); setJoinCode(''); setJoinPassword(''); setModalError(''); }}>
          <form
            className="space-y-5"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (!actionLoading) void handleJoinByCode();
            }}
          >
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">房间代码</label>
              <input
                type="text"
                name="om-room-code"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); if (modalError) setModalError(''); }}
                placeholder="输入 6 位房间号"
                maxLength={6}
                className={`${inputCls} uppercase tracking-[0.2em] font-mono text-center text-lg`}
                autoFocus
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2 pl-1">房间密码 <span className="text-white/30 font-normal">(如未上锁请留空)</span></label>
              <input
                type="text"
                inputMode="text"
                name="om-room-gate-join"
                value={joinPassword}
                onChange={(e) => { setJoinPassword(e.target.value); if (modalError) setModalError(''); }}
                placeholder="输入密码"
                maxLength={32}
                className={`${inputCls} om-secret-input`}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-bwignore="true"
                data-form-type="other"
              />
            </div>
            {modalError && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                <Activity className="w-4 h-4 flex-shrink-0" />
                {modalError}
              </div>
            )}
            <button
              type="submit"
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-50 text-white font-bold py-4 rounded-2xl transition-all mt-2"
            >
              {actionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              立即加入
            </button>
          </form>
        </Modal>
      )}

      <ClientDownloadModal open={downloadModalOpen} onClose={() => setDownloadModalOpen(false)} />
      <MusicContributionModal open={contributionOpen} onClose={() => setContributionOpen(false)} defaultProvider={nickname} enabledPlatforms={contributionPlatforms} />
      <DonationModal open={donationOpen} onClose={() => setDonationOpen(false)} donations={donations} />

      <SiteAnnouncementPopup
        open={siteAnnouncementOpen}
        title={siteAnnouncement?.title}
        text={siteAnnouncement?.text || ''}
        onClose={handleCloseSiteAnnouncement}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <UserGuideTour scope="home" paused={siteAnnouncementOpen || accountPanelOpen || showCreate || showJoin} delayMs={1000} />
    </div>
  );
}
