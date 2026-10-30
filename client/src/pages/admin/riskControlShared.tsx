import { createContext, useContext, type ReactNode } from 'react';
import { Space, Tag, Typography } from 'antd';
import { formatAuditTime } from './utils';

export type AccountStatus = 'normal' | 'watch' | 'blocked';
export type Policy = { minuteLimit: number; dayLimit: number; musicMinuteLimit: number; musicDayLimit: number; ipMinuteLimit: number; urlMinuteLimit: number; urlBurstLimit: number };
export type Decision = { status: AccountStatus; tags: string[]; note: string; reason: string };
export type Identity = { provider: string; username: string; subjectHint: string; linkedAt: number };
export type Factor = { id: string; label: string; value: number; points: number; threshold?: number; maxPoints?: number; matched?: boolean; window?: string; category?: string };
export type HumanChallengeState = { pending: boolean; day: string; triggers: number; passes: number; triggerTotal: number; passTotal: number; bypass: boolean; bypassReason: string; lastTriggeredAt: number; lastVerifiedAt: number; cooldownUntil: number; dailyLimit: number };
export type RiskAccount = Decision & {
  humanChallenge?: HumanChallengeState;
  id: string; email: string; displayName: string; nickname: string; emailVerified: boolean; hasPassword: boolean; identityAvailable: boolean;
  identities: Identity[]; identityCount: number; roomUserId: string; createdAt: number; firstSeenAt: number; lastSeenAt: number; lastLoginAt: number;
  registrationIp: string; lastLoginIp: string; lastRequestIp: string; loginCount: number; requests: number; musicRequests: number;
  socketRequests: number; denied: number; errors: number; ipCount: number; sharedAccounts: number; clientCount: number;
  roomCount: number; roomHistoryCount: number; roomJoins: number; lastRoomId: string; lastRoomAt: number; authFailures: number;
  sampledScore: number; queueScore?: number; scoredAt: number; score: number; level: 'low' | 'medium' | 'high'; reasons: string[]; factors: Factor[];
  daily: Record<string, number>; dailyEstimated: boolean;
  lastHumanVerifiedAt?: number; lastNetworkRoute?: 'direct' | 'trusted_proxy' | '';
  musicIpCount?: number; musicIpChanges?: number;
};
export type Day = { date: string; requests?: string; music?: string; socketRequests?: string; denied?: string; errors?: string; authFailures?: string; roomJoins?: string };
export const hasDailyActivity = (day: Day) => (['requests', 'music', 'socketRequests', 'denied', 'errors', 'authFailures', 'roomJoins'] as const).some(key => Number(day[key] || 0) > 0);
export type AccountError = { groupId: string; status: number; code: string; category: string; label: string; operation: string; source: string; method: string };
export type ErrorBreakdown = {
  trackedTotal: number; legacyUnclassified: number; sinceAt: number;
  groups: (AccountError & { count: number; today: number; firstSeenAt: number; lastSeenAt: number })[];
  recent: (AccountError & { at: number })[];
};
export type MusicResponse = {
  requestId: string; at: number; ip: string; operation: string; source: string; requestedSongId: string;
  status: number; durationMs: number; outcome: 'ok' | 'empty' | 'failed' | 'substituted' | 'aborted'; resultCount?: number;
  songs: { id: string; source: string; name: string; artist: string }[];
};
export type MusicResponseAnalysis = { sampleCount: number; targetedResponses: number; distinctSongs: number; topSongs: { id: string; source: string; name: string; artist: string; requests: number }[] };
export type AccountDetail = RiskAccount & {
  ipRequests?: { ip: string; total: number; music: number; socket: number; image: number; api: number; firstSeenAt: number; lastSeenAt: number }[];
  requestEvents?: { id: string; at: number; ip: string; kind: string; operation: string; response?: MusicResponse }[];
  musicResponses?: MusicResponse[]; musicResponseAnalysis?: MusicResponseAnalysis;
  errorBreakdown?: ErrorBreakdown;
  ips: { ip: string; lastSeenAt: number }[];
  logins: { at: number; ip: string; method: string; userAgent: string }[];
  days: Day[]; legacyDays: Day[]; relatedAccounts: string[]; policy: Policy;
  rooms: { roomId: string; roomName: string; nickname: string; joins: number; firstSeenAt: number; lastSeenAt: number; ip: string; readOnly: boolean }[];
  clients: { userAgent: string; lastSeenAt: number }[];
  nicknames: { name: string; lastSeenAt: number }[];
  decisions: { at: number; previousStatus: AccountStatus; status: AccountStatus; reason: string }[];
};
export type RiskPage = { items: RiskAccount[]; total: number; high: number; blocked: number; generatedAt: number };
export type RiskEvent = { at: number; ip: string; accountId?: string; accountHash?: string; code: string; kind?: string };

export const STATUS_OPTIONS = [{ value: 'normal', label: '正常' }, { value: 'watch', label: '关注' }, { value: 'blocked', label: '限制访问' }];
export const PROVIDERS: Record<string, string> = { email: '邮箱', github: 'GitHub', linuxdo: 'Linux.do', wechat: '微信文件传输助手登录' };
export const POLICY_LABELS: Record<keyof Policy, string> = { minuteLimit: '账户每分钟总请求', dayLimit: '账户每日总请求', musicMinuteLimit: '账户每分钟音乐请求', musicDayLimit: '账户每日音乐请求', ipMinuteLimit: '同 IP 每分钟总请求', urlMinuteLimit: '账户每分钟取链', urlBurstLimit: '取链突发容量（10秒补满）' };
export const time = (value: number) => value ? formatAuditTime(value) : '未记录';
export const count = (value: number | string | undefined) => Number(value || 0).toLocaleString('zh-CN');
export const statusLabel = (status: AccountStatus) => STATUS_OPTIONS.find(entry => entry.value === status)?.label || status;
export const riskColor = (score: number) => score >= 60 ? 'red' : score >= 30 ? 'orange' : 'green';
export const riskLabel = (score: number) => score >= 60 ? '高风险' : score >= 30 ? '待关注' : '低风险';
export const queueScore = (account: RiskAccount) => account.queueScore ?? account.sampledScore ?? account.score;
export const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export const RiskHelpContext = createContext(false);

export function RiskSection({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const showHelp = useContext(RiskHelpContext);
  return <section className="risk-section"><div className="risk-section-heading"><div className="risk-section-intro"><h3>{title}</h3>{showHelp && description && <details className="risk-section-note"><summary aria-label={`${title}说明`}>说明</summary><p>{description}</p></details>}</div>{actions}</div>{children}</section>;
}

export function IdentityTags({ account }: { account: RiskAccount }) {
  return <Space size={[0, 4]} wrap>{account.email && <Tag color={account.emailVerified ? 'blue' : 'default'}>{account.emailVerified ? '已验证邮箱' : '邮箱验证待确认'}</Tag>}{account.identities?.filter(identity => identity.provider !== 'email').map(identity => <Tag key={identity.provider}>{PROVIDERS[identity.provider] || identity.provider}</Tag>)}{!account.identityAvailable && <Typography.Text type="secondary">历史身份待补全</Typography.Text>}</Space>;
}
