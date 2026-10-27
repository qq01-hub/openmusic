import type { AdminAuditEntry, AdminRoom, AdminTabId } from './types';

export function shouldAutoRefreshAdminTab(loggedIn: boolean, activeTab: AdminTabId): boolean {
  return loggedIn && activeTab === 'overview';
}

export async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `请求失败（${res.status}）`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}

export function formatAuditTime(at: number) {
  try {
    return new Date(at).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  } catch {
    return String(at);
  }
}

/** 相对时间，如「刚刚」「5 分钟前」「2 小时前」「3 天前」 */
export function formatRelativeTime(at: number | null | undefined): string {
  const ts = Number(at) || 0;
  if (!ts) return '—';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return formatAuditTime(ts);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 48) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return formatAuditTime(ts);
}

export function formatAuditAction(entry: AdminAuditEntry) {
  switch (entry.action) {
    case 'login_ok': {
      if (entry.via === 'linuxdo') return `登录成功（Linux.do：${entry.linuxdoUsername || ''}）`;
      if (entry.via === 'github') return `登录成功（GitHub：${entry.githubUsername || ''}）`;
      return `登录成功${entry.username ? ` ${entry.username}` : ''}`;
    }
    case 'login_fail': {
      if (entry.via === 'linuxdo') return `登录失败（Linux.do：${entry.linuxdoUsername || ''}）`;
      if (entry.via === 'github') return `登录失败（GitHub：${entry.githubUsername || ''}）`;
      return `登录失败${entry.username ? ` ${entry.username}` : ''}`;
    }
    case 'logout':
      return '退出登录';
    case 'linuxdo_bind':
      return `绑定 Linux.do 账号${entry.linuxdoUsername ? `（${entry.linuxdoUsername}）` : ''}`;
    case 'linuxdo_unbind':
      return '解绑 Linux.do 账号';
    case 'github_bind':
      return `绑定 GitHub 账号${entry.githubUsername ? `（${entry.githubUsername}）` : ''}`;
    case 'github_unbind':
      return '解绑 GitHub 账号';
    case 'set_credentials':
      return `修改管理员账号密码${entry.username ? `（${entry.username}）` : ''}`;
    case 'set_credentials_fail':
      return '修改管理员账号密码失败';
    case 'set_entry_path':
      return `更新登录地址 ${entry.path || ''}`;
    case 'set_runtime_config':
      return '更新运行配置';
    case 'risk_account_update':
      return `更新账户风控 ${entry.accountId || ''}（${entry.status === 'blocked' ? '限制访问' : entry.status === 'watch' ? '关注' : '正常'}）`;
    case 'risk_policy_update':
      return '更新全局请求额度';
    case 'reset_music_api_circuit':
      return `重置音源熔断 ${entry.id || ''}`;
    case 'set_announcement':
      return `更新站点公告（${entry.enabled ? '启用' : '停用'}）`;
    case 'set_room_protection':
      return `${entry.enabled ? '开启' : '关闭'}房间保活 ${entry.roomId || ''}`;
    case 'view_room_password':
      return `查看房间密码 ${entry.roomId || ''}${
        entry.recoverable === false ? '（明文不可恢复）' : ''
      }`;
    case 'rename_room_user':
      return `修改房间昵称 ${entry.roomId || ''}${entry.previousNickname ? ` · ${entry.previousNickname}` : ''}${
        entry.nickname ? ` -> ${entry.nickname}` : ''
      }`;
    case 'reset_room_user_nickname':
      return `违规重置昵称 ${entry.roomId || ''}${entry.previousNickname ? ` · ${entry.previousNickname}` : ''}${
        entry.nickname ? ` -> ${entry.nickname}` : ''
      }`;
    case 'review_permanent_application':
      return `${entry.approved ? '通过' : '拒绝'}常驻申请 ${entry.roomId || ''}${
        entry.reason ? `：${entry.reason}` : ''
      }`;
    case 'meting_reset_cooldown':
      return `重置上游冷却 ${entry.url || ''}`;
    case 'meting_set_disabled':
      return `${entry.disabled ? '禁用' : '启用'}上游 ${entry.url || ''}`;
    case 'ai_test':
      return `测试硅基流动 AI${entry.model ? `（${entry.model}）` : ''}${
        entry.success === false ? ` 失败${entry.error ? `：${entry.error}` : ''}` : ' 成功'
      }`;
    case 'broadcast':
      return `全局广播（${entry.roomCount ?? 0} 个房间）`;
    case 'site_ban_add':
      return `封禁 ${entry.banType || ''} ${entry.value || ''}${typeof entry.kicked === 'number' ? ` · 踢出 ${entry.kicked}` : ''}`;
    case 'site_ban_remove':
      return `解除封禁 ${entry.banId || ''}`;
    case 'room_create_blocked': {
      const reasonMap: Record<string, string> = {
        site_ban: '站点封禁',
        cooldown: '建房冷却',
        max_owned_rooms: '房间数上限',
      };
      const label = reasonMap[String(entry.reason || '')] || entry.reason || '未知';
      const code = typeof entry.code === 'string' && entry.code.trim() ? ` · ${entry.code.trim()}` : '';
      const extra =
        entry.reason === 'cooldown' && entry.retryAfterSec
          ? ` · ${entry.retryAfterSec}s`
          : entry.reason === 'max_owned_rooms' && entry.ownedCount != null
            ? ` · ${entry.ownedCount}/${entry.maxOwnedRooms ?? 2}`
            : '';
      return `拦截建房（${label}${code}${extra}）`;
    }
    case 'join_blocked':
      return `拦截进房（${entry.reason === 'site_ban' ? '站点封禁' : entry.reason || '未知'}）${
        entry.roomId ? ` ${entry.roomId}` : ''
      }`;
    case 'site_access_blocked':
      return '拦截全站访问（站点封禁）';
    case 'session_blocked': {
      const reasonMap: Record<string, string> = {
        bootstrap_rate_limit: '会话限流',
        new_session_rate_limit: '新会话限流',
      };
      const code = typeof entry.code === 'string' && entry.code.trim() ? ` · ${entry.code.trim()}` : '';
      return `拦截会话（${reasonMap[String(entry.reason || '')] || entry.reason || '未知'}${code}）`;
    }
    case 'error_report_update':
      return `处理错误上报 ${entry.reportId || ''}${entry.status ? ` → ${entry.status}` : ''}`;
    case 'error_report_delete':
      return `删除错误上报 ${entry.reportId || ''}`;
    case 'destroy_room':
      return `解散房间 ${entry.roomId || ''}${entry.name ? `（${entry.name}）` : ''}${
        typeof entry.kicked === 'number' ? ` · 踢出 ${entry.kicked}` : ''
      }`;
    case 'owner_destroy_room':
      return `房主解散房间 ${entry.roomId || ''}${entry.name ? `（${entry.name}）` : ''}${
        typeof entry.kicked === 'number' ? ` · 踢出 ${entry.kicked}` : ''
      }`;
    case 'owner_destroy_room_denied':
      return `拒绝房主解散 ${entry.roomId || ''}${entry.error ? `：${entry.error}` : ''}`;
    case 'destroy_room_fail':
      return `解散失败 ${entry.roomId || ''}${entry.error ? `：${entry.error}` : ''}`;
    default:
      return entry.action;
  }
}

/** 与服务端 createRandomAdminEntryPath 一致：12 字节 base64url */
export function createRandomEntryPath() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `/${b64}`;
}

export type AdminRoomStatusFilter =
  | 'playing'
  | 'paused'
  | 'idle'
  | 'password'
  | 'locked'
  | 'protected'
  | 'pending_permanent'
  | 'empty';

export const ADMIN_ROOM_STATUS_FILTERS: { value: AdminRoomStatusFilter; label: string }[] = [
  { value: 'pending_permanent', label: '待审常驻' },
  { value: 'playing', label: '播放中' },
  { value: 'paused', label: '已暂停' },
  { value: 'idle', label: '未播放' },
  { value: 'password', label: '有密码' },
  { value: 'locked', label: '已上锁' },
  { value: 'protected', label: '常驻' },
  { value: 'empty', label: '空房间' },
];

function roomMatchesStatusFilter(room: AdminRoom, tag: AdminRoomStatusFilter): boolean {
  switch (tag) {
    case 'playing':
      return room.isPlaying;
    case 'paused':
      return Boolean(room.currentSong) && !room.isPlaying;
    case 'idle':
      return !room.currentSong;
    case 'password':
      return room.hasPassword;
    case 'locked':
      return room.isLocked;
    case 'protected':
      return room.protectedFromDestroy;
    case 'pending_permanent':
      return room.permanentApplication?.status === 'pending';
    case 'empty':
      return room.userCount === 0;
    default:
      return true;
  }
}

function roomMatchesKeyword(room: AdminRoom, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;
  if (room.id.toLowerCase().includes(kw)) return true;
  if (room.name.toLowerCase().includes(kw)) return true;
  if (room.currentSong?.name.toLowerCase().includes(kw)) return true;
  if (room.currentSong?.artist.toLowerCase().includes(kw)) return true;
  if (room.ownerNickname?.toLowerCase().includes(kw)) return true;
  if (room.creatorNickname?.toLowerCase().includes(kw)) return true;
  if (room.creatorId?.toLowerCase().includes(kw)) return true;
  if (room.creatorIp?.toLowerCase().includes(kw)) return true;
  if (room.creatorDeviceId?.toLowerCase().includes(kw)) return true;
  return room.users.some((user) => (
    user.nickname.toLowerCase().includes(kw)
    || user.clientIp?.toLowerCase().includes(kw)
    || user.deviceId?.toLowerCase().includes(kw)
  ));
}

/** 待审常驻申请优先 → 已常驻优先 → 人数多优先 → 最后进房新优先 */
function compareAdminRooms(a: AdminRoom, b: AdminRoom): number {
  const aPending = a.permanentApplication?.status === 'pending' ? 0 : 1;
  const bPending = b.permanentApplication?.status === 'pending' ? 0 : 1;
  if (aPending !== bPending) return aPending - bPending;

  const aProtected = a.protectedFromDestroy ? 0 : 1;
  const bProtected = b.protectedFromDestroy ? 0 : 1;
  if (aProtected !== bProtected) return aProtected - bProtected;
  if (a.userCount !== b.userCount) return b.userCount - a.userCount;
  return (b.lastJoinedAt || 0) - (a.lastJoinedAt || 0);
}

export function filterAdminRooms(
  rooms: AdminRoom[],
  keyword: string,
  statusFilters: AdminRoomStatusFilter[],
): AdminRoom[] {
  return rooms
    .filter((room) => {
      if (!roomMatchesKeyword(room, keyword)) return false;
      if (statusFilters.length === 0) return true;
      return statusFilters.some((tag) => roomMatchesStatusFilter(room, tag));
    })
    .sort(compareAdminRooms);
}
