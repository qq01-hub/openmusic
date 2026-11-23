import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Sparkles, Trash2, UserPlus, X } from 'lucide-react';
import type { RoomMemberSettings, RoomMemberTier, RoomUser } from '../types';
import {
  BADGE_LABEL_PRESETS,
  DEFAULT_MEMBER_TIER,
  MEMBER_BORDER_STYLE_ID,
  WELCOME_COOLDOWN_MINUTE_OPTIONS,
  WELCOME_TEMPLATE_PRESETS,
  getSelectableBadgeColorPresets,
  normalizeBadgeColor,
  normalizeWelcomeCooldownSec,
  normalizeWelcomeTemplateId,
  buildWelcomeText,
  resolveMemberWelcomeSettings,
} from '../lib/memberTierPresets';
import MemberTierBadge from './MemberTierBadge';
import MemberQueueFrame from './MemberQueueFrame';
import RoleBadge from './RoleBadge';
import UserRoleMarks from './UserRoleMarks';
import { getDisplayInitial } from '../lib/displayInitial';

interface Props {
  open: boolean;
  users: RoomUser[];
  userNicknames?: Record<string, string>;
  creatorId?: string;
  adminIds?: string[];
  isOwner?: boolean;
  myUserId?: string | null;
  adminSelfManageMemberTierEnabled?: boolean;
  memberTiers: Record<string, RoomMemberTier>;
  memberSettings: RoomMemberSettings;
  saving?: boolean;
  onClose: () => void;
  onSaveSettings?: (settings: RoomMemberSettings) => void;
  onSaveTier: (userId: string, tier: Omit<RoomMemberTier, 'userId' | 'assignedAt'>) => void;
  onRemoveTier: (userId: string) => void;
}

type DraftTier = Omit<RoomMemberTier, 'userId' | 'assignedAt'>;
type UserFilter = 'all' | 'vip';
type MemberUserOption = RoomUser & { offline?: boolean };

function buildDraftFromTier(
  tier: RoomMemberTier | undefined,
  roomSettings: RoomMemberSettings,
): DraftTier {
  const welcome = resolveMemberWelcomeSettings(tier, roomSettings);
  const base = tier
    ? {
        badgeLabel: tier.badgeLabel,
        badgeColor: tier.badgeColor,
        borderStyleId: MEMBER_BORDER_STYLE_ID,
        borderColor: tier.borderColor,
      }
    : { ...DEFAULT_MEMBER_TIER };

  const welcomeTemplateId = welcome.welcomeEnabled === false
    ? 'none'
    : normalizeWelcomeTemplateId(welcome.welcomeTemplateId);

  return {
    ...base,
    welcomeEnabled: welcomeTemplateId !== 'none',
    welcomeTemplateId,
    welcomeCustomText: welcome.welcomeCustomText,
    confettiEnabled: Boolean(welcome.confettiEnabled),
    welcomeCooldownSec: welcome.welcomeCooldownSec,
  };
}

function ColorSwatches({
  value,
  onChange,
  ariaPrefix,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  ariaPrefix: string;
  disabled?: boolean;
}) {
  const colors = getSelectableBadgeColorPresets();
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((preset) => {
        const active = normalizeBadgeColor(value) === preset.color;
        return (
          <button
            key={preset.id}
            type="button"
            title={preset.name}
            aria-label={`${ariaPrefix}${preset.name}`}
            disabled={disabled}
            onClick={() => onChange(preset.color)}
            className={`h-7 w-7 rounded-full transition-transform disabled:cursor-not-allowed disabled:opacity-45 ${
              active ? 'scale-110 ring-2 ring-amber-300/70 ring-offset-1 ring-offset-netease-dark' : 'hover:scale-105'
            }`}
            style={{ backgroundColor: preset.color }}
          />
        );
      })}
    </div>
  );
}

export default function RoomMemberModal({
  open,
  users,
  userNicknames = {},
  creatorId,
  adminIds = [],
  isOwner = false,
  myUserId = null,
  adminSelfManageMemberTierEnabled = false,
  memberTiers,
  memberSettings,
  saving = false,
  onClose,
  onSaveTier,
  onRemoveTier,
}: Props) {
  const [userFilter, setUserFilter] = useState<UserFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTier>(buildDraftFromTier(undefined, memberSettings));

  useEffect(() => {
    if (!open) return;
    setUserFilter('all');
    setQuery('');
    setSelectedUserId(null);
    setDraft(buildDraftFromTier(undefined, memberSettings));
  }, [open, memberSettings]);

  const onlineAssignableUsers = useMemo(() => {
    return users.filter((user) => !user.readOnly);
  }, [users]);

  const assignableUsers = useMemo<MemberUserOption[]>(() => {
    const onlineIds = new Set(onlineAssignableUsers.map((user) => user.id));
    const offlineVipUsers = Object.keys(memberTiers)
      .filter((userId) => !onlineIds.has(userId))
      .map((userId) => ({
        id: userId,
        nickname: userNicknames[userId] || `离线贵宾 · ${userId.slice(0, 6)}`,
        readOnly: false,
        joinedAt: memberTiers[userId]?.assignedAt || 0,
        offline: true,
      }));
    return [...onlineAssignableUsers, ...offlineVipUsers];
  }, [memberTiers, onlineAssignableUsers, userNicknames]);

  const vipCount = useMemo(
    () => assignableUsers.filter((user) => Boolean(memberTiers[user.id])).length,
    [assignableUsers, memberTiers],
  );

  useEffect(() => {
    if (selectedUserId && !assignableUsers.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [assignableUsers, selectedUserId]);

  const selectableUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assignableUsers
      .filter((user) => {
        if (userFilter === 'vip' && !memberTiers[user.id]) return false;
        if (keyword && !user.nickname.toLowerCase().includes(keyword)) return false;
        return true;
      })
      .sort((a, b) => {
        const aOffline = a.offline ? 1 : 0;
        const bOffline = b.offline ? 1 : 0;
        if (aOffline !== bOffline) return aOffline - bOffline;

        const getRoleOrder = (user: MemberUserOption) => {
          if (creatorId && user.id === creatorId) return 0;
          if (adminIds.includes(user.id)) return 1;
          return 2;
        };
        const roleOrderDiff = getRoleOrder(a) - getRoleOrder(b);
        if (roleOrderDiff !== 0) return roleOrderDiff;
        return a.nickname.localeCompare(b.nickname, 'zh-CN');
      });
  }, [adminIds, assignableUsers, creatorId, memberTiers, query, userFilter]);

  const selectedUser = selectableUsers.find((user) => user.id === selectedUserId)
    || assignableUsers.find((user) => user.id === selectedUserId)
    || null;
  const selectedIsVip = Boolean(selectedUser && memberTiers[selectedUser.id]);
  const selectedIsOwner = Boolean(selectedUser && creatorId && selectedUser.id === creatorId);
  const selectedIsAdmin = Boolean(selectedUser && adminIds.includes(selectedUser.id) && !selectedIsOwner);
  const canEditSelected = isOwner
    || (adminSelfManageMemberTierEnabled ? selectedUser?.id === myUserId : (!selectedIsOwner && !selectedIsAdmin));
  const cooldownMinutes = Math.floor(normalizeWelcomeCooldownSec(draft.welcomeCooldownSec) / 60);
  const cooldownIsPreset = (WELCOME_COOLDOWN_MINUTE_OPTIONS as readonly number[]).includes(cooldownMinutes);
  const previewNickname = selectedUser?.nickname || '贵宾昵称';
  const previewWelcome = buildWelcomeText(
    normalizeWelcomeTemplateId(draft.welcomeTemplateId),
    draft.welcomeCustomText || '',
    draft.badgeLabel || '贵宾',
    previewNickname,
  );

  if (!open) return null;

  const selectUser = (userId: string) => {
    const tier = memberTiers[userId];
    setSelectedUserId(userId);
    setDraft(buildDraftFromTier(tier, memberSettings));
  };

  const updateAccentColor = (color: string) => {
    if (!canEditSelected) return;
    setDraft((prev) => ({
      ...prev,
      badgeColor: color,
      borderColor: color,
    }));
  };

  const welcomeTemplateId = normalizeWelcomeTemplateId(draft.welcomeTemplateId);
  const welcomeOn = welcomeTemplateId !== 'none';
  const confettiOn = Boolean(draft.confettiEnabled);
  const entryFxOn = welcomeOn || confettiOn;

  const handleSaveTier = () => {
    if (!selectedUserId || !canEditSelected) return;
    const templateId = normalizeWelcomeTemplateId(draft.welcomeTemplateId);
    onSaveTier(selectedUserId, {
      badgeLabel: draft.badgeLabel.trim().slice(0, 8) || '贵宾',
      badgeColor: normalizeBadgeColor(draft.badgeColor),
      borderStyleId: MEMBER_BORDER_STYLE_ID,
      borderColor: normalizeBadgeColor(draft.borderColor),
      welcomeEnabled: templateId !== 'none',
      welcomeTemplateId: templateId,
      welcomeCustomText: (draft.welcomeCustomText || '').trim().slice(0, 200),
      confettiEnabled: Boolean(draft.confettiEnabled),
      welcomeCooldownSec: normalizeWelcomeCooldownSec(draft.welcomeCooldownSec),
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 room-feature-scrim"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="room-feature-dialog relative flex h-[min(86vh,680px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-netease-border/60 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-shrink-0 items-start justify-between gap-3 px-4 pt-3.5 pb-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Sparkles className="h-4 w-4 flex-shrink-0 text-amber-300" />
              贵宾管理
            </h2>
            <p className="mt-0.5 text-xs text-netease-muted">
              {vipCount > 0 ? `已设置 ${vipCount} 人 · 角标与欢迎按人配置` : '选择成员，配置专属角标与进房欢迎'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-netease-muted hover:bg-netease-hover hover:text-white"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-netease-border/40 lg:border-b-0 lg:border-r lg:border-netease-border/40">
            <div className="flex-shrink-0 space-y-2 px-3 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-netease-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索昵称"
                  className="w-full rounded-lg border border-netease-border/50 bg-netease-card py-1.5 pl-8 pr-2.5 text-sm text-white outline-none placeholder:text-netease-muted/50 focus:border-amber-400/35"
                />
              </div>
              <div className="flex gap-1">
                {([
                  { id: 'all' as const, label: '全部' },
                  { id: 'vip' as const, label: `贵宾${vipCount ? ` ${vipCount}` : ''}` },
                ]).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setUserFilter(item.id)}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      userFilter === item.id
                        ? 'bg-amber-500/15 text-amber-100'
                        : 'text-netease-muted hover:bg-netease-hover hover:text-white'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 max-h-[150px] flex-1 overflow-y-auto px-2 pb-2 lg:max-h-none">
              {assignableUsers.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-netease-muted">暂无可设置的成员</p>
              ) : selectableUsers.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-netease-muted">没有匹配用户</p>
              ) : (
                <div className="space-y-0.5">
                  {selectableUsers.map((user) => {
                    const tier = memberTiers[user.id];
                    const active = selectedUserId === user.id;
                    const isAdminUser = adminIds.includes(user.id);
                    const isOwnerUser = Boolean(creatorId && user.id === creatorId);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => selectUser(user.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                          active
                            ? 'bg-amber-400/12 text-white'
                            : 'text-white/90 hover:bg-netease-hover'
                        }`}
                      >
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 text-[10px] font-bold text-white">
                          {getDisplayInitial(user.nickname)}
                        </div>
                        <p className="min-w-0 flex-1 truncate text-sm">{user.nickname}</p>
                        {user.offline && <span className="flex-shrink-0 text-[10px] text-netease-muted">已离房</span>}
                        {(tier || isAdminUser || isOwnerUser) && (
                          <UserRoleMarks
                            isOwner={isOwnerUser}
                            isAdmin={isAdminUser && !isOwnerUser}
                            memberTier={tier}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            {!selectedUser ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center text-netease-muted">
                <UserPlus className="h-8 w-8 opacity-40" />
                <p className="text-sm text-white/80">选择一位成员开始设置</p>
                <p className="max-w-xs text-xs">角标、欢迎语与冷却均按该用户保存</p>
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3 sm:px-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <MemberTierBadge tier={draft} />
                      {selectedIsOwner && <RoleBadge role="owner" variant="icon" />}
                      {selectedIsAdmin && <RoleBadge role="admin" variant="icon" />}
                      <span className="truncate text-sm font-medium text-white">{selectedUser.nickname}</span>
                      <span className="ml-auto flex-shrink-0 text-[10px] text-netease-muted">
                        {selectedIsVip ? '已是贵宾' : '未设置'}
                      </span>
                    </div>
                    {!canEditSelected && (
                      <p className="text-[11px] text-amber-200/75">{adminSelfManageMemberTierEnabled && !isOwner ? '当前仅允许修改自己的贵宾标识' : '房主或管理员的贵宾设置仅限房主修改'}</p>
                    )}
                    <MemberQueueFrame tier={draft} variant="preview" innerClassName="bg-netease-card px-3 py-2">
                      <p className="text-sm font-medium text-white">点歌边框预览</p>
                      <p className="text-[11px] text-netease-muted">队列中将显示此边框效果</p>
                    </MemberQueueFrame>
                  </div>

                  <section className="space-y-3">
                    <p className="text-[11px] font-medium tracking-wide text-netease-muted">角标</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-netease-muted">名称</label>
                        <span className="text-[10px] tabular-nums text-netease-muted/70">
                          {draft.badgeLabel.length}/8
                        </span>
                      </div>
                      <input
                        value={draft.badgeLabel}
                        disabled={!canEditSelected}
                        onChange={(event) => setDraft((prev) => ({ ...prev, badgeLabel: event.target.value.slice(0, 8) }))}
                        maxLength={8}
                        placeholder="如：赞助、VIP、老铁"
                        className="w-full rounded-xl border border-netease-border/50 bg-netease-card px-3 py-2 text-sm text-white outline-none placeholder:text-netease-muted/50 focus:border-amber-400/35"
                      />
                      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin]">
                        {BADGE_LABEL_PRESETS.map((label) => (
                          <button
                            key={label}
                            type="button"
                            disabled={!canEditSelected}
                            onClick={() => setDraft((prev) => ({ ...prev, badgeLabel: label }))}
                            className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                              draft.badgeLabel === label
                                ? 'bg-amber-500/18 text-amber-100'
                                : 'bg-netease-card text-netease-muted hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-netease-muted">角标色 / 边框色</label>
                      <ColorSwatches
                        ariaPrefix="角标色与边框色"
                        value={draft.badgeColor}
                        onChange={updateAccentColor}
                        disabled={!canEditSelected}
                      />
                    </div>
                  </section>

                  <section className="space-y-3 border-t border-netease-border/35 pt-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium tracking-wide text-netease-muted">进房效果 · 仅此用户</p>
                      <p className="mt-0.5 text-[11px] text-netease-muted/70">欢迎语与礼花可分开开关</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-white/90">礼花</p>
                          <p className="text-[11px] text-netease-muted/70">进房时全员可见礼花动画</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={confettiOn}
                          disabled={saving || !canEditSelected}
                          onClick={() => setDraft((prev) => ({
                            ...prev,
                            confettiEnabled: !prev.confettiEnabled,
                          }))}
                          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                            confettiOn ? 'bg-amber-500' : 'bg-netease-card'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                              confettiOn ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-netease-muted">欢迎语</p>
                      <div className="flex flex-wrap gap-1.5">
                        {WELCOME_TEMPLATE_PRESETS.map((preset) => {
                          const active = welcomeTemplateId === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              disabled={!canEditSelected}
                              onClick={() => setDraft((prev) => ({
                                ...prev,
                                welcomeTemplateId: preset.id,
                                welcomeEnabled: preset.id !== 'none',
                              }))}
                              className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                                active
                                  ? 'bg-amber-500/18 text-amber-100'
                                  : 'bg-netease-card text-netease-muted hover:text-white'
                              }`}
                            >
                              {preset.name}
                            </button>
                          );
                        })}
                      </div>

                      {welcomeTemplateId === 'custom' && (
                        <div className="space-y-1.5">
                          <textarea
                            value={draft.welcomeCustomText || ''}
                            disabled={!canEditSelected}
                            onChange={(event) => setDraft((prev) => ({
                              ...prev,
                              welcomeCustomText: event.target.value.slice(0, 200),
                            }))}
                            rows={3}
                            placeholder="自定义欢迎语，例如：欢迎 {badge} {nickname} 回家"
                            className="w-full resize-none rounded-xl border border-netease-border/50 bg-netease-card px-3 py-2 text-sm text-white outline-none placeholder:text-netease-muted/50 focus:border-amber-400/35"
                          />
                          <p className="text-[11px] text-netease-muted/75">
                            可用参数：
                            <code className="mx-1 rounded bg-netease-card px-1.5 py-0.5 text-amber-200/90">{'{badge}'}</code>
                            角标名、
                            <code className="mx-1 rounded bg-netease-card px-1.5 py-0.5 text-amber-200/90">{'{nickname}'}</code>
                            昵称
                          </p>
                        </div>
                      )}

                      {welcomeOn && (
                        <div className="rounded-xl bg-netease-card/80 px-3 py-2.5">
                          <p className="mb-1 text-[10px] text-netease-muted">预览</p>
                          <p className="text-sm leading-6 text-white/90">{previewWelcome}</p>
                        </div>
                      )}
                    </div>

                    <div className={`space-y-2 ${entryFxOn ? '' : 'pointer-events-none opacity-40'}`}>
                      <p className="text-xs text-netease-muted">重复触发间隔</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {WELCOME_COOLDOWN_MINUTE_OPTIONS.map((minutes) => {
                          const sec = minutes * 60;
                          const active = normalizeWelcomeCooldownSec(draft.welcomeCooldownSec) === sec;
                          return (
                            <button
                              key={minutes}
                              type="button"
                              disabled={saving || !entryFxOn || !canEditSelected}
                              onClick={() => setDraft((prev) => ({ ...prev, welcomeCooldownSec: sec }))}
                              className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                                active
                                  ? 'bg-amber-500/18 text-amber-100'
                                  : 'bg-netease-card text-netease-muted hover:text-white'
                              }`}
                            >
                              {minutes === 0 ? '每次' : `${minutes} 分`}
                            </button>
                          );
                        })}
                        <label
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${
                            entryFxOn && !cooldownIsPreset
                              ? 'bg-amber-500/18 text-amber-100'
                              : 'bg-netease-card text-netease-muted'
                          }`}
                        >
                          <input
                            type="number"
                            min={0}
                            max={24 * 60}
                            step={1}
                            disabled={saving || !entryFxOn || !canEditSelected}
                            value={cooldownMinutes}
                            onChange={(event) => {
                              const raw = event.target.value;
                              if (raw === '') {
                                setDraft((prev) => ({ ...prev, welcomeCooldownSec: 0 }));
                                return;
                              }
                              const minutes = Math.min(
                                24 * 60,
                                Math.max(0, Math.floor(Number(raw) || 0)),
                              );
                              setDraft((prev) => ({ ...prev, welcomeCooldownSec: minutes * 60 }));
                            }}
                            className="w-14 rounded-md border border-netease-border/50 bg-netease-dark px-1.5 py-0.5 text-center text-xs text-white outline-none focus:border-amber-400/35 disabled:opacity-50"
                            aria-label="自定义迎宾间隔分钟"
                          />
                          <span>分</span>
                        </label>
                      </div>
                      <p className="text-[11px] text-netease-muted/70">
                        欢迎语或礼花任一开启时生效（0 = 每次进房都触发，最长 24 小时）
                      </p>
                    </div>
                  </section>
                </div>

                <footer className="flex flex-shrink-0 items-center gap-2 border-t border-netease-border/35 px-3 py-3 sm:px-4">
                  <button
                    type="button"
                    disabled={saving || !canEditSelected}
                    onClick={handleSaveTier}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
                  >
                    {selectedIsVip ? '保存此用户设置' : '设为贵宾并保存'}
                  </button>
                  {selectedIsVip && (
                    <button
                      type="button"
                      disabled={saving || !canEditSelected}
                      onClick={() => onRemoveTier(selectedUser.id)}
                      className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm text-red-300/90 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      移除贵宾
                    </button>
                  )}
                </footer>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
