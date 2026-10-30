export type MusicSource = 'netease' | 'tencent' | 'kugou' | 'qishui';

export interface RoomAudioQuality {
  netease: string;
  tencent: string;
  kugou: string;
  qishui?: string;
}

export interface RoomMemberTier {
  userId: string;
  badgeLabel: string;
  badgeColor: string;
  borderStyleId: string;
  borderColor: string;
  assignedAt?: number;
  /** 该贵宾是否进房欢迎（缺省跟随房间默认） */
  welcomeEnabled?: boolean;
  welcomeTemplateId?: string;
  welcomeCustomText?: string;
  /** 该贵宾进房是否放礼花（与欢迎语独立） */
  confettiEnabled?: boolean;
  /** 该贵宾重复迎宾冷却（秒）；缺省跟随房间默认 */
  welcomeCooldownSec?: number;
}

export interface RoomMemberSettings {
  welcomeEnabled: boolean;
  welcomeTemplateId: string;
  welcomeCustomText?: string;
  /** 进房是否放礼花（与欢迎语独立；房间默认） */
  confettiEnabled?: boolean;
  /** 同一贵宾重复迎宾冷却（秒），0 = 每次进房都欢迎 */
  welcomeCooldownSec?: number;
}

export interface Song {
  id: string;
  source: MusicSource;
  name: string;
  artist: string;
  album?: string;
  pic?: string;
  duration?: number;
  /** 直链播放地址（酷狗等） */
  url?: string;
  /** 歌词文本或歌词 API 地址 */
  lrc?: string;
}

export interface QueueItem extends Song {
  queueId: string;
  requestedBy: string;
  requestedById?: string;
  addedAt: number;
  likedByIds?: string[];
  /** 当前播放点赞仅计数，不带入循环队列排序 */
  currentLikedByIds?: string[];
  /** 当前曲被踩的人（仅对正在播放有效，切歌后清空） */
  dislikedByIds?: string[];
  ownerPriority?: number;
  /** 插队置顶的操作者昵称，房主操作时不填 */
  priorityBy?: string;
  /** 拖拽排序后的锁定序号（服务端排序用，客户端可不展示） */
  manualOrder?: number;
}

export interface SongHistoryItem extends Song {
  requestedBy: string;
  requestedById?: string;
  requestedAt: number;
}

/** 平台热榜条目（按播放完成次数排序） */
export interface HotSongItem extends Song {
  count: number;
  lastPlayedAt?: number;
}

export interface BannedSong {
  source: MusicSource;
  id: string;
  name: string;
  artist: string;
  bannedAt?: number;
}

export interface ForbiddenWord {
  word: string;
  /** 是否为房间默认词（排序靠后，可删除） */
  isDefault?: boolean;
  addedAt?: number;
}

export interface RoomUser {
  id: string;
  nickname: string;
  readOnly?: boolean;
  joinedAt: number;
  location?: string;
  avatar_url?: string;
}

export interface JumpRequest {
  id: string;
  queueId: string;
  songName: string;
  nickname: string;
  requestedBy: string;
  requestedAt: number;
}

export interface ChatMention {
  id: string;
  nickname: string;
}

export interface ChatReplyRef {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  imageUrl?: string | null;
  imageKey?: string | null;
  asSticker?: boolean;
}

export interface ChatReactionUser {
  userId: string;
  nickname: string;
}

export interface ChatReactionGroup {
  emoji: string;
  users: ChatReactionUser[];
}

export interface RoomAiCommandHint {
  id: string;
  label: string;
  description: string;
  insert: string;
  example: string;
  botName: string;
}

export interface RoomAiConfig {
  enabled: boolean;
  botName: string;
  wakePrefixes: string[];
  commands: RoomAiCommandHint[];
  /** 站点是否已开启 AI */
  globalEnabled?: boolean;
  /** 房主是否允许本房 AI */
  roomAiEnabled?: boolean;
  /** 本房自定义昵称（有值时 botName 即为此） */
  roomAiBotName?: string;
  /** 站点默认昵称 */
  defaultBotName?: string;
}

export interface ChatSongCard {
  id: string;
  source: MusicSource;
  name: string;
  artist: string;
  album?: string;
  duration?: number;
  /** 音乐 CDN 封面直链（服务端已校验 https + 平台域名） */
  pic?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  imageUrl?: string | null;
  imageKey?: string | null;
  asSticker?: boolean;
  kind?: 'chat' | 'welcome' | 'system' | 'notice' | 'recall' | 'ai_bot';
  /** 服务端 HMAC 签名，仅 AI 助手消息携带 */
  aiBotSig?: string;
  mentions?: ChatMention[];
  replyTo?: ChatReplyRef | null;
  timestamp: number;
  reactions?: ChatReactionGroup[];
  memberTier?: Pick<RoomMemberTier, 'badgeLabel' | 'badgeColor' | 'borderStyleId' | 'borderColor'>;
  targetUserId?: string;
  targetNickname?: string;
  /** 本条迎宾是否触发礼花（与欢迎语文案独立） */
  confettiEnabled?: boolean;
  /** 聊天音乐卡片（一条消息可带多张，如 AI 候选） */
  songs?: ChatSongCard[];
}

export interface SkipRequest {
  id: string;
  songName: string;
  nickname: string;
  requestedBy: string;
  requestedAt: number;
}

/** 房主扫码绑定的音源账号公开信息 */
export interface RoomMusicAccount {
  cookieId: string;
  platform: 'netease' | 'tencent' | 'kugou' | 'qishui';
  shared: boolean;
  hasVip: boolean;
  hasSvip?: boolean;
  canSearchSongs?: boolean;
  canSearchPlaylists?: boolean;
  /** vip=写入 Meting 用于搜索/播放；fm=仅本房间网易漫游（不入 Meting） */
  usage?: 'vip' | 'fm';
  nickname: string;
  providerName?: string;
  avatarUrl: string;
  userId: string;
  isValid: boolean;
  updatedAt: number;
}

export interface RoomMusicAccounts {
  netease: RoomMusicAccount | null;
  tencent: RoomMusicAccount | null;
  kugou: RoomMusicAccount | null;
  qishui: RoomMusicAccount | null;
}

export interface RoomState {
  id: string;
  name: string;
  hasPassword?: boolean;
  isLocked?: boolean;
  muteAll?: boolean;
  mutedUserIds?: string[];
  /** 仅加入时由服务端按当前用户计算；广播更新请用 isChatMutedForUser */
  chatMuted?: boolean;
  ownerId: string | null;
  ownerAccountId?: string | null;
  /** 房间初创房主（可通过转让变更；唯一显示「房主」） */
  creatorId?: string | null;
  /** 管理员（房主可设人数上限，默认 5） */
  adminIds?: string[];
  /** 正式管理员人数上限 */
  maxAdmins?: number;
  /** 临时自动提升管理（仅播放权，不含管理敏感字段） */
  autoPromotedAdminIds?: string[];
  /** 曾进房用户的最近昵称（用于离线管理员展示） */
  userNicknames?: Record<string, string>;
  /** 用户头像 URL（所有用户可见） */
  userAvatarUrls?: Record<string, string>;
  ownerConnectionId?: string | null;
  queue: QueueItem[];
  current: QueueItem | null;
  isPlaying: boolean;
  currentTime: number;
  /** 房间统一播放倍速，仅房主可修改 */
  playbackRate?: number;
  users: RoomUser[];
  userCount: number;
  jumpRequests: JumpRequest[];
  skipRequests: SkipRequest[];
  messages?: ChatMessage[];
  /** 非 null 时仅能看到该时间戳之后的消息（首次进入且未发言的新用户） */
  chatVisibleSince?: number | null;
  /** @deprecated 不再随 room_update 广播，由 chatStore 维护 */
  chatHasMore?: boolean;
  /** @deprecated 不再随 room_update 广播，按需 load_song_history */
  songHistory?: SongHistoryItem[];
  /** 队列为空时服务端已预取的下一首私人漫游（含稳定 queueId，便于客户端预拉 URL） */
  nextRandom?: QueueItem | null;
  /** 服务端正在为空队列拉取私人漫游 */
  randomLoading?: boolean;
  /** 漫游失败提示，等待服务端重试时不显示加载动画 */
  randomError?: string;
  /** 房间播放音质（网易 / QQ） */
  audioQuality?: RoomAudioQuality;
  /** 播放顺序：顺序 / 随机 / 收藏随机 / 单曲循环 / 列表循环 / 列表内随机 */
  playMode?: 'order' | 'shuffle' | 'user-round-robin' | 'favorite-shuffle' | 'loop-one' | 'loop-all' | 'shuffle-loop';
  /** 队列为空时私人漫游推荐模式 */
  neteaseFmMode?: string;
  /** 私人漫游使用的推荐平台 */
  fmSource?: 'netease' | 'tencent' | 'kugou' | 'qishui';
  /** 漫游关闭前的模式，重新开启时恢复 */
  fmModeBeforeOff?: string;
  /** 汽水密文是否经同源代理后仍在浏览器本地解密 */
  qishuiProxyEnabled?: boolean;
  qishuiProxyPercent?: number;
  /** 队列为空时仅从这些歌单的合并曲库循环取歌；不存在时使用私人漫游 */
  playlistRoaming?: {
    /** 开启后同名歌曲按网易云、QQ、汽水、酷狗顺序保留一个候选 */
    dedupeByName: boolean;
    enabled: boolean;
    playlists: Array<{
      id: string;
      source: 'netease' | 'tencent' | 'kugou' | 'qishui';
      name: string;
      /** 直接导入的 HTTP(S) 链接；搜索结果加入的歌单为空 */
      url?: string;
      songs: Song[];
    }>;
  } | null;
  /** 房主扫码绑定的音源账号（公开信息；Cookie 在 Meting） */
  musicAccounts?: RoomMusicAccounts;
  /** 公告是否开启 */
  announcementEnabled?: boolean;
  /** 公告内容 */
  announcementText?: string;
  /** 房主自定义封面；有值时不再跟随当前歌曲封面 */
  customCoverUrl?: string;
  /** 仅创建者可见：房间是否常驻（空房不销毁） */
  protectedFromDestroy?: boolean;
  /** 仅创建者可见：常驻申请进度 */
  permanentApplication?: {
    status: 'pending';
    appliedAt: number;
    applicantNickname?: string;
    note?: string;
  } | null;
  /** 进房是否可查看聊天历史（关闭时仅见进房后的消息） */
  chatHistoryVisibleOnJoin?: boolean;
  /** 聊天室是否在昵称左侧显示头像（仅房主可设） */
  chatShowAvatars?: boolean;
  /** 房间右上角成员列表是否隐藏 IP 归属（仅房主可设，默认显示） */
  hideIpLocation?: boolean;
  /** 是否在聊天室提示“昵称进入房间” */
  joinNoticeEnabled?: boolean;
  /** 同一用户进房提醒的防重复间隔（秒），默认 180 */
  joinNoticeCooldownSec?: number;
  /** 房主是否允许本房 AI（默认 true） */
  roomAiEnabled?: boolean;
  /** 本房 AI 昵称；有值时优先于站点默认 */
  roomAiBotName?: string;
  /** 是否允许成员点歌（关闭后仅房主/管理员可点） */
  songRequestEnabled?: boolean;
  /** 待播歌曲点赞是否提高排序，默认开启 */
  queueLikeSortEnabled?: boolean;
  /** 是否允许成员为自己的点歌插队（默认关闭，房主/管理员始终可插队） */
  memberJumpEnabled?: boolean;
  /** 是否允许成员拖动进度条（默认关闭，房主/管理员始终可） */
  memberSeekEnabled?: boolean;
  /** 是否允许成员暂停/播放（默认关闭，房主/管理员始终可） */
  memberPauseEnabled?: boolean;
  /** 是否绑定系统媒体键播放/暂停（耳机键、锁屏控件等；关闭可防摘耳机误触） */
  systemMediaPlayBound?: boolean;
  /** 是否绑定系统媒体键切歌（耳机键、锁屏下一首等） */
  systemMediaSkipBound?: boolean;
  /** 踩歌切歌模式：固定人数或在线比例 */
  dislikeSkipMode?: 'count' | 'percent';
  /** 踩歌切歌固定人数（count 模式），默认 5 */
  dislikeSkipThreshold?: number;
  /** 踩歌切歌在线比例（percent 模式），1–100，默认 50 */
  dislikeSkipPercent?: number;
  /** 退出房间后是否清除该成员已点待播曲（默认关闭） */
  clearSongsOnLeaveEnabled?: boolean;
  /** 退出后等待多久再清除，秒，默认 60 */
  clearSongsOnLeaveDelaySec?: number;
  /** 用户轮播时，离房成员的待播歌曲是否在在线成员之后播放，默认开启 */
  deferOfflineRequesterSongs?: boolean;
  /** 进房后需等待的秒数才能点歌，0 表示不限制 */
  songRequestMinStaySec?: number;
  /** 每人队列中最多保留几首，0 表示不限制 */
  songRequestMaxPerUser?: number;
  /** 每人点歌冷却秒数，0 表示不限制 */
  songRequestCooldownSec?: number;
  /** 队列最多保留几首 */
  queueMaxLength?: number;
  /** 禁播歌曲（仅房主/管理员可见） */
  bannedSongs?: BannedSong[];
  /** 聊天违禁词（仅房主/管理员可见） */
  forbiddenWords?: ForbiddenWord[];
  /** 房间贵宾角标（userId → 配置） */
  memberTiers?: Record<string, RoomMemberTier>;
  /** 贵宾欢迎语等房间级设置 */
  memberSettings?: RoomMemberSettings;
  /** 房主是否允许管理员仅修改自己的贵宾标识（默认关闭） */
  adminSelfManageMemberTierEnabled?: boolean;
  /** 房间 AI 助手公开配置（进房时下发） */
  roomAi?: RoomAiConfig;
}

/** “我的房间”接口返回的轻量摘要，不包含队列或播放状态详情。 */
export interface AccountRoomSummary {
  id: string;
  name: string;
  isLocked: boolean;
  userCount: number;
  createdAt: number;
}

/** CRDT 播放状态（服务端唯一时间源） */
export interface PlaybackState {
  roomId: string;
  version: number;
  trackId: string;
  status: 'playing' | 'paused';
  positionSec: number;
  /** 当前曲目时长（秒），供客户端判断 position 是否已超出曲目 */
  durationSec?: number;
  serverNowMs: number;
  startedAt: number;
  currentTime: number;
  /** 房间统一播放倍速 */
  playbackRate?: number;
  updatedAt: number;
  /** 房间内已解析的当前曲播放地址（可选，进房加速） */
  mediaUrl?: string;
  mediaQuality?: string;
  mediaCrossSource?: boolean;
  /** 跨源取到音源的平台 */
  mediaCrossSourceFrom?: MusicSource;
  mediaLoudness?: { gain?: number; peak?: number; lra?: number };
  mediaDuration?: number;
}

/** 房间广播：当前曲媒体地址（成员取链成功后分享） */
export interface PlaybackMediaShare {
  roomId: string;
  trackId: string;
  url: string;
  qualityLabel?: string;
  crossSource?: boolean;
  crossSourceFrom?: MusicSource;
  loudness?: { gain?: number; peak?: number; lra?: number };
  duration?: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  /** 当前设备对应的身份是否为该房间房主/管理员 */
  isOwner?: boolean;
  isAdmin?: boolean;
  userCount: number;
  hasPassword: boolean;
  isLocked?: boolean;
  isPlaying: boolean;
  /** 房主自定义封面（优先于 currentSong.pic） */
  customCoverUrl?: string;
  currentSong: {
    name: string;
    artist: string;
    id?: string;
    source?: MusicSource;
    pic?: string;
  } | null;
  queueLength: number;
  createdAt: number;
}

export interface RoomCheckResult {
  exists: boolean;
  hasPassword: boolean;
  isLocked?: boolean;
  name?: string;
}

export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

export interface SearchResult extends Song {
  url?: string;
  lrc?: string;
}

export interface FavoriteSong extends Song {
  favoritedAt?: number;
  /** 用户为此收藏选择的分类；缺失时归入“未分类”。 */
  category?: string;
}
