import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  CheckCircleOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LogoutOutlined,
  MenuOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import AdminProviders from './admin/AdminProviders';
import AdminLoading from './admin/AdminLoading';
import { ADMIN_TABS, AUDIT_ACTION_OPTIONS, AUDIT_PAGE_SIZE, LIST_PAGE_SIZE, TAB_META } from './admin/constants';
import CredentialsPanel from './admin/CredentialsPanel';
import InitialSetupGate from './admin/InitialSetupGate';
import LoginForm from './admin/LoginForm';
import OverviewDashboard from './admin/OverviewDashboard';
import RuntimeConfigPanel from './admin/RuntimeConfigPanel';
import SettingsSection from './admin/SettingsSection';
import type {
  AdminAuditEntry,
  AdminOverview,
  AdminRoom,
  AdminTabId,
  ErrorReportDetail,
  ErrorReportSummary,
  MetingUpstreamStatus,
  SiteAnnouncementConfig,
  DonationEntry,
  SiteBanEntry,
} from './admin/types';
import {
  adminFetch,
  ADMIN_ROOM_STATUS_FILTERS,
  createRandomEntryPath,
  filterAdminRooms,
  formatAuditAction,
  formatAuditTime,
  formatRelativeTime,
  shouldAutoRefreshAdminTab,
  type AdminRoomStatusFilter,
} from './admin/utils';
import { SOFT_BLOCK_CODE_HELP } from '../lib/softBlock';

const { Header, Sider, Content } = Layout;

const REPORT_DEBUG_PRE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.55,
  minHeight: 360,
  maxHeight: 'min(52vh, 520px)',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  padding: '12px 14px',
  background: 'rgba(0,0,0,0.02)',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.06)',
};

function ReportDebugPane({ text }: { text: string }) {
  const { message } = App.useApp();
  const content = text || '（无）';
  const canCopy = Boolean(text.trim());

  const handleCopy = async () => {
    if (!canCopy) {
      message.warning('没有可复制的内容');
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      message.success('已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动选择文本');
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 8,
        }}
      >
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={() => void handleCopy()}
          disabled={!canCopy}
        >
          一键复制
        </Button>
      </div>
      <pre style={REPORT_DEBUG_PRE_STYLE}>{content}</pre>
    </div>
  );
}

function buildReportDebugTabItems(report: ErrorReportDetail) {
  const items = [
    {
      key: 'meta',
      label: '上下文',
      children: (
        <ReportDebugPane text={JSON.stringify(report.meta || {}, null, 2)} />
      ),
    },
  ];

  if (report.type !== 'feedback') {
    const snapshotText = report.snapshot
      || (report.snapshots?.length
        ? report.snapshots.map((section) => `=== ${section.title} ===\n${section.content}`).join('\n\n')
        : '');

    if (snapshotText) {
      items.push({
        key: 'snapshots',
        label: 'Debug 快照',
        children: <ReportDebugPane text={snapshotText} />,
      });
    }

    items.push({
      key: 'events',
      label: `事件 (${report.events?.length || 0})`,
      children: (
        <ReportDebugPane
          text={(report.events || [])
            .map((ev) => `[${ev.at}] ${ev.name}${ev.line ? ` ${ev.line}` : ''}`.trimEnd())
            .join('\n')}
        />
      ),
    });
  }

  return items;
}

function AdminPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [protectingId, setProtectingId] = useState<string | null>(null);
  const [transferringOwnerKey, setTransferringOwnerKey] = useState<string | null>(null);
  const [permanentReviewingId, setPermanentReviewingId] = useState<string | null>(null);
  const [rejectPermanentRoom, setRejectPermanentRoom] = useState<AdminRoom | null>(null);
  const [rejectPermanentReason, setRejectPermanentReason] = useState('');
  const [entryPathDraft, setEntryPathDraft] = useState(
    () => (typeof window !== 'undefined' ? window.location.pathname : ''),
  );
  const [savingPath, setSavingPath] = useState(false);
  const [annEnabled, setAnnEnabled] = useState(false);
  const [annTitle, setAnnTitle] = useState('站点公告');
  const [annText, setAnnText] = useState('');
  const [annBumpId, setAnnBumpId] = useState(false);
  const [annSaving, setAnnSaving] = useState(false);
  const [donations, setDonations] = useState<DonationEntry[]>([]);
  const [donationName, setDonationName] = useState('');
  const [donationDate, setDonationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [donationAmount, setDonationAmount] = useState<number | null>(null);
  const [donationSaving, setDonationSaving] = useState(false);
  const [donationsPage, setDonationsPage] = useState(1);
  const [donationsPageSize, setDonationsPageSize] = useState(LIST_PAGE_SIZE);
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastRoomIds, setBroadcastRoomIds] = useState<string[]>([]);
  const [broadcasting, setBroadcasting] = useState(false);
  const [bans, setBans] = useState<SiteBanEntry[]>([]);
  const [banType, setBanType] = useState<'ip' | 'device'>('ip');
  const [banValue, setBanValue] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banSaving, setBanSaving] = useState(false);
  const [quickBanDraft, setQuickBanDraft] = useState<{
    mode: 'single' | 'both';
    type?: 'ip' | 'device';
    ip?: string;
    deviceId?: string;
    nickname?: string;
  } | null>(null);
  const [quickBanReason, setQuickBanReason] = useState('');
  const [quickBanSaving, setQuickBanSaving] = useState(false);
  const [errorReports, setErrorReports] = useState<ErrorReportSummary[]>([]);
  const [reportDetail, setReportDetail] = useState<ErrorReportDetail | null>(null);
  const [reportDetailLoading, setReportDetailLoading] = useState(false);
  const [reportBusyId, setReportBusyId] = useState<string | null>(null);
  const [reportNoteDraft, setReportNoteDraft] = useState('');
  const [upstreamBusyUrl, setUpstreamBusyUrl] = useState<string | null>(null);
  const [auditItems, setAuditItems] = useState<AdminAuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditKeyword, setAuditKeyword] = useState('');
  const [auditKeywordApplied, setAuditKeywordApplied] = useState('');
  const [auditAction, setAuditAction] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [roomsPage, setRoomsPage] = useState(1);
  const [roomsPageSize, setRoomsPageSize] = useState(10);
  const [roomsKeyword, setRoomsKeyword] = useState('');
  const [roomsStatusFilter, setRoomsStatusFilter] = useState<AdminRoomStatusFilter[]>([]);
  /** 按需揭示的房间明文密码（不进列表接口） */
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string | null>>({});
  const [revealingPasswordId, setRevealingPasswordId] = useState<string | null>(null);
  const [editingNicknameTarget, setEditingNicknameTarget] = useState<{
    roomId: string;
    userId: string;
    currentNickname: string;
    roomName: string;
  } | null>(null);
  const [editingNicknameDraft, setEditingNicknameDraft] = useState('');
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [violatingUserKey, setViolatingUserKey] = useState<string | null>(null);
  const [bansPage, setBansPage] = useState(1);
  const [reportsPage, setReportsPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const annLoadedRef = useRef(false);
  const loadingRef = useRef(false);
  const pendingForceRefreshRef = useRef(false);
  const refreshGenRef = useRef(0);
  const savedEntryPathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await adminFetch('/api/admin/session');
        if (!cancelled) setLoggedIn(true);
      } catch {
        if (!cancelled) setLoggedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminFetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // 即使请求失败也清本地 UI 状态
    }
    setLoggedIn(false);
    setOverview(null);
    setRooms([]);
    setRevealedPasswords({});
    setRevealingPasswordId(null);
    setBans([]);
    setErrorReports([]);
    setReportDetail(null);
    setAuditItems([]);
    setAuditTotal(0);
    setAuditPage(1);
  }, []);

  const refresh = useCallback(async (opts?: { force?: boolean }) => {
    if (loadingRef.current) {
      if (opts?.force) pendingForceRefreshRef.current = true;
      return;
    }

    do {
      pendingForceRefreshRef.current = false;
      loadingRef.current = true;
      setRefreshing(true);
      const gen = ++refreshGenRef.current;
      try {
        const [ov, rm, banRes, reportRes] = await Promise.all([
          adminFetch<AdminOverview>('/api/admin/overview'),
          adminFetch<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
          adminFetch<{ bans: SiteBanEntry[] }>('/api/admin/bans'),
          adminFetch<{ reports: ErrorReportSummary[] }>('/api/admin/error-reports'),
        ]);
        if (gen !== refreshGenRef.current) continue;
        setOverview(ov);
        setRooms(rm.rooms);
        setBans(banRes.bans);
        setErrorReports(reportRes.reports);
        if (ov.entryPath) {
          setEntryPathDraft((draft) => {
            if (savedEntryPathRef.current === null || draft === savedEntryPathRef.current) {
              savedEntryPathRef.current = ov.entryPath!;
              return ov.entryPath!;
            }
            return draft;
          });
          if (savedEntryPathRef.current === null) savedEntryPathRef.current = ov.entryPath;
        }
      } catch (err) {
        if (gen !== refreshGenRef.current) continue;
        const errMessage = err instanceof Error ? err.message : '加载失败';
        message.error(errMessage);
        const status = err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: number }).status)
          : 0;
        // 503 可能只是某个后台能力未配置/暂不可用，不应误判成登录失效
        if (status === 401) setLoggedIn(false);
      } finally {
        loadingRef.current = false;
        setRefreshing(false);
      }
    } while (pendingForceRefreshRef.current);
  }, []);

  useEffect(() => {
    if (!shouldAutoRefreshAdminTab(loggedIn === true, activeTab)) return undefined;
    // 重新进入看板时即使上一次请求尚未结束，也要排队执行一次最新加载。
    void refresh({ force: true });
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      clearInterval(timer);
      // 使离开看板后才完成的请求结果失效，避免覆盖其他页面的数据状态。
      refreshGenRef.current += 1;
    };
  }, [activeTab, loggedIn, refresh]);

  const loadAudit = useCallback(async (page: number, opts?: { q?: string; action?: string }) => {
    const q = opts?.q ?? auditKeywordApplied;
    const action = opts?.action ?? auditAction ?? '';
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(AUDIT_PAGE_SIZE),
      });
      if (q) params.set('q', q);
      if (action) params.set('action', action);
      const res = await adminFetch<{
        items: AdminAuditEntry[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>(`/api/admin/audit?${params.toString()}`);
      const maxPage = Math.max(1, res.totalPages || 1);
      if (page > maxPage) {
        setAuditPage(maxPage);
        return;
      }
      setAuditItems(res.items);
      setAuditTotal(res.total);
      setAuditPage(res.page);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载审计日志失败');
    } finally {
      setAuditLoading(false);
    }
  }, [auditKeywordApplied, auditAction]);

  useEffect(() => {
    if (!loggedIn || activeTab !== 'audit') return;
    void loadAudit(auditPage);
  }, [loggedIn, activeTab, auditPage, loadAudit]);

  useEffect(() => {
    if (!loggedIn || annLoadedRef.current) return;
    (async () => {
      try {
        const res = await adminFetch<{ announcement: SiteAnnouncementConfig }>('/api/admin/announcement');
        annLoadedRef.current = true;
        setAnnEnabled(res.announcement.enabled);
        setAnnTitle(res.announcement.title || '站点公告');
        setAnnText(res.announcement.text || '');
      } catch {
        // 拉取失败不阻塞面板，保存时仍可覆盖
      }
    })();
  }, [loggedIn]);

  const loadDonations = useCallback(async () => {
    const res = await adminFetch<{ donations: DonationEntry[] }>('/api/admin/donations');
    setDonations(Array.isArray(res.donations) ? res.donations : []);
  }, []);

  useEffect(() => {
    if (!loggedIn || activeTab !== 'donations') return;
    void loadDonations().catch(() => {});
  }, [activeTab, loadDonations, loggedIn]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(donations.length / donationsPageSize));
    if (donationsPage > maxPage) setDonationsPage(maxPage);
  }, [donations.length, donationsPage, donationsPageSize]);

  const addDonationRecord = useCallback(async () => {
    if (!donationName.trim() || donationSaving) return;
    setDonationSaving(true);
    try {
      await adminFetch('/api/admin/donations', {
        method: 'POST',
        body: JSON.stringify({ name: donationName.trim(), date: donationDate, amount: donationAmount }),
      });
      setDonationName('');
      setDonationAmount(null);
      message.success('已添加捐赠名单');
      await loadDonations();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '添加捐赠名单失败');
    } finally {
      setDonationSaving(false);
    }
  }, [donationAmount, donationDate, donationName, donationSaving, loadDonations, message]);

  const editDonationRecord = useCallback((entry: DonationEntry) => {
    let name = entry.name;
    let date = entry.date;
    let amount: number | null = entry.amount ?? null;
    Modal.confirm({
      title: '编辑捐赠署名',
      content: (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Input defaultValue={name} onChange={(e) => { name = e.target.value; }} maxLength={40} />
          <DatePicker defaultValue={dayjs(date, 'YYYY-MM-DD')} format="YYYY-MM-DD" style={{ width: '100%' }} onChange={(_, value) => { date = String(value || ''); }} />
          <InputNumber min={0} step={0.01} prefix="¥" defaultValue={amount ?? undefined} onChange={(value) => { amount = typeof value === 'number' ? value : null; }} placeholder="金额（仅后台可见）" style={{ width: '100%' }} />
        </Space>
      ),
      onOk: async () => {
        if (!name.trim()) throw new Error('署名不能为空');
        await adminFetch(`/api/admin/donations/${entry.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: name.trim(), date, amount }),
        });
        await loadDonations();
        message.success('已更新捐赠名单');
      },
    });
  }, [loadDonations, message]);

  const deleteDonationRecord = useCallback((entry: DonationEntry) => {
    Modal.confirm({
      title: '删除捐赠记录？',
      content: `将删除「${entry.name}」的公开名单记录。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await adminFetch(`/api/admin/donations/${entry.id}`, { method: 'DELETE' });
        await loadDonations();
        message.success('已删除捐赠记录');
      },
    });
  }, [loadDonations, message]);

  const saveAnnouncement = useCallback(async () => {
    if (annSaving) return;
    setAnnSaving(true);
    try {
      const res = await adminFetch<{ announcement: SiteAnnouncementConfig }>('/api/admin/announcement', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: annEnabled,
          title: annTitle.trim(),
          text: annText.trim(),
          bumpId: annBumpId,
        }),
      });
      setAnnEnabled(res.announcement.enabled);
      setAnnTitle(res.announcement.title);
      setAnnText(res.announcement.text);
      setAnnBumpId(false);
      const hint = res.announcement.enabled
        ? (annBumpId ? '已保存并作为新公告发布（所有用户重新弹窗）' : '已保存')
        : '已保存（公告处于停用状态）';
      message.success(hint);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存公告失败');
    } finally {
      setAnnSaving(false);
    }
  }, [annBumpId, annEnabled, annSaving, annText, annTitle, message]);

  const dissolveRoom = useCallback(async (room: AdminRoom) => {
    setDeletingId(room.id);
    try {
      await adminFetch(`/api/admin/rooms/${room.id}`, { method: 'DELETE' });
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
      message.success(`已解散房间 ${room.name}`);
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '解散失败');
    } finally {
      setDeletingId(null);
    }
  }, [message, refresh]);

  const revealRoomPassword = useCallback(async (room: AdminRoom) => {
    if (!room.hasPassword) return;

    let shouldFetch = true;
    setRevealedPasswords((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, room.id)) return prev;
      shouldFetch = false;
      const next = { ...prev };
      delete next[room.id];
      return next;
    });
    if (!shouldFetch) return;

    setRevealingPasswordId(room.id);
    try {
      const res = await adminFetch<{
        roomId: string;
        hasPassword: boolean;
        password: string | null;
      }>(`/api/admin/rooms/${room.id}/password`);
      setRevealedPasswords((prev) => ({
        ...prev,
        [room.id]: res.password,
      }));
      if (res.hasPassword && !res.password) {
        message.warning('该房间密码为升级前设置，明文不可恢复；请房主重新设置密码');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '查看密码失败');
    } finally {
      setRevealingPasswordId(null);
    }
  }, [message]);

  const openNicknameEditor = useCallback((room: AdminRoom, userId: string, currentNickname: string) => {
    setEditingNicknameTarget({
      roomId: room.id,
      userId,
      currentNickname,
      roomName: room.name,
    });
    setEditingNicknameDraft(currentNickname);
  }, []);

  const submitNicknameEdit = useCallback(async () => {
    if (!editingNicknameTarget || nicknameSaving) return;
    const nickname = editingNicknameDraft.trim();
    if (!nickname) {
      message.warning('请输入昵称');
      return;
    }
    setNicknameSaving(true);
    try {
      const res = await adminFetch<{ nickname: string }>(
        `/api/admin/rooms/${editingNicknameTarget.roomId}/users/${editingNicknameTarget.userId}/nickname`,
        {
          method: 'PUT',
          body: JSON.stringify({ nickname }),
        },
      );
      message.success(`昵称已修改为「${res.nickname}」`);
      setEditingNicknameTarget(null);
      setEditingNicknameDraft('');
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '修改昵称失败');
    } finally {
      setNicknameSaving(false);
    }
  }, [editingNicknameDraft, editingNicknameTarget, message, nicknameSaving, refresh]);

  const markUserViolation = useCallback(async (room: AdminRoom, userId: string, nickname: string) => {
    const actionKey = `${room.id}:${userId}`;
    setViolatingUserKey(actionKey);
    try {
      const res = await adminFetch<{ nickname: string }>(
        `/api/admin/rooms/${room.id}/users/${userId}/violation-reset`,
        { method: 'POST' },
      );
      message.success(`已将「${nickname}」重置为「${res.nickname}」`);
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '违规重置失败');
    } finally {
      setViolatingUserKey(null);
    }
  }, [message, refresh]);

  const transferRoomOwner = useCallback(async (room: AdminRoom, userId: string, nickname: string) => {
    const actionKey = `${room.id}:${userId}`;
    setTransferringOwnerKey(actionKey);
    try {
      const res = await adminFetch<{ message: string }>(`/api/admin/rooms/${room.id}/owner`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      message.success(res.message || `已将房主转让给「${nickname}」`);
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '转让房主失败');
    } finally {
      setTransferringOwnerKey(null);
    }
  }, [message, refresh]);

  const toggleRoomProtection = useCallback(async (room: AdminRoom) => {
    setProtectingId(room.id);
    const nextProtected = !room.protectedFromDestroy;
    try {
      await adminFetch(`/api/admin/rooms/${room.id}/protection`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: nextProtected }),
      });
      setRooms((prev) => prev.map((r) => (
        r.id === room.id ? { ...r, protectedFromDestroy: nextProtected } : r
      )));
      message.success(room.protectedFromDestroy ? '已取消房间常驻' : '已设为常驻');
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新房间常驻状态失败');
    } finally {
      setProtectingId(null);
    }
  }, [message, refresh]);

  const reviewPermanentApplication = useCallback(async (
    room: AdminRoom,
    approved: boolean,
    reason = '',
  ) => {
    setPermanentReviewingId(room.id);
    try {
      await adminFetch(`/api/admin/rooms/${room.id}/permanent-application`, {
        method: 'POST',
        body: JSON.stringify({ approved, reason }),
      });
      setRooms((prev) => prev.map((r) => {
        if (r.id !== room.id) return r;
        return {
          ...r,
          permanentApplication: null,
          protectedFromDestroy: approved ? true : r.protectedFromDestroy,
        };
      }));
      message.success(approved ? `已通过「${room.name}」的常驻申请` : `已拒绝「${room.name}」的常驻申请`);
      setRejectPermanentRoom(null);
      setRejectPermanentReason('');
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '审核常驻申请失败');
    } finally {
      setPermanentReviewingId(null);
    }
  }, [message, refresh]);

  const submitRejectPermanent = useCallback(() => {
    if (!rejectPermanentRoom) return;
    const reason = rejectPermanentReason.trim();
    if (!reason) {
      message.warning('请填写拒绝原因');
      return;
    }
    void reviewPermanentApplication(rejectPermanentRoom, false, reason);
  }, [rejectPermanentReason, rejectPermanentRoom, reviewPermanentApplication, message]);

  const resetUpstreamCooldown = useCallback(async (url: string) => {
    setUpstreamBusyUrl(url);
    try {
      await adminFetch('/api/admin/meting/reset-cooldown', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      message.success('已重置上游冷却');
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重置冷却失败');
    } finally {
      setUpstreamBusyUrl(null);
    }
  }, [message, refresh]);

  const toggleUpstreamDisabled = useCallback(async (up: MetingUpstreamStatus) => {
    setUpstreamBusyUrl(up.url);
    try {
      await adminFetch('/api/admin/meting/disable', {
        method: 'POST',
        body: JSON.stringify({ url: up.url, disabled: !up.disabled }),
      });
      message.success(up.disabled ? '已启用上游' : '已临时禁用上游');
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新上游状态失败');
    } finally {
      setUpstreamBusyUrl(null);
    }
  }, [message, refresh]);

  const sendBroadcast = useCallback(async () => {
    if (broadcasting || !broadcastText.trim()) return;
    setBroadcasting(true);
    try {
      const res = await adminFetch<{ roomCount: number }>('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          text: broadcastText.trim(),
          ...(broadcastRoomIds.length > 0 ? { roomIds: broadcastRoomIds } : {}),
        }),
      });
      setBroadcastText('');
      setBroadcastRoomIds([]);
      const hint = `已发送到 ${res.roomCount} 个房间`;
      message.success(hint);
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '广播失败');
    } finally {
      setBroadcasting(false);
    }
  }, [broadcastText, broadcasting, message, refresh]);

  const addBan = useCallback(async () => {
    if (banSaving || !banValue.trim()) return;
    setBanSaving(true);
    try {
      const res = await adminFetch<{ kicked: number }>('/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({
          type: banType,
          value: banValue.trim(),
          reason: banReason.trim(),
        }),
      });
      setBanValue('');
      setBanReason('');
      const hint = `已封禁${typeof res.kicked === 'number' && res.kicked > 0 ? `，踢出 ${res.kicked} 个在线连接` : ''}`;
      message.success(hint);
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '封禁失败');
    } finally {
      setBanSaving(false);
    }
  }, [banReason, banSaving, banType, banValue, message, refresh]);

  const postSiteBan = useCallback(async (type: 'ip' | 'device', value: string, reason: string) => {
    return adminFetch<{ kicked: number; ban?: SiteBanEntry }>('/api/admin/bans', {
      method: 'POST',
      body: JSON.stringify({
        type,
        value: value.trim(),
        reason: reason.trim(),
      }),
    });
  }, []);

  const openQuickBan = useCallback((draft: NonNullable<typeof quickBanDraft>) => {
    const hasIp = Boolean(draft.ip?.trim());
    const hasDevice = Boolean(draft.deviceId?.trim());
    if (draft.mode === 'single') {
      if (draft.type === 'ip' && !hasIp) return;
      if (draft.type === 'device' && !hasDevice) return;
    } else if (!hasIp && !hasDevice) {
      message.warning('该成员没有可封禁的 IP 或设备');
      return;
    }
    setQuickBanDraft(draft);
    setQuickBanReason('');
  }, [message]);

  const submitQuickBan = useCallback(async () => {
    if (!quickBanDraft || quickBanSaving) return;
    const reason = quickBanReason.trim();
    setQuickBanSaving(true);
    try {
      let kicked = 0;
      const done: string[] = [];
      const skipped: string[] = [];

      const tryOne = async (type: 'ip' | 'device', value?: string) => {
        const v = String(value || '').trim();
        if (!v) return;
        try {
          const res = await postSiteBan(type, v, reason);
          kicked += Number(res.kicked) || 0;
          done.push(type === 'ip' ? 'IP' : '设备');
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('已在封禁')) skipped.push(type === 'ip' ? 'IP' : '设备');
          else throw err;
        }
      };

      if (quickBanDraft.mode === 'both') {
        await tryOne('ip', quickBanDraft.ip);
        await tryOne('device', quickBanDraft.deviceId);
      } else if (quickBanDraft.type === 'ip') {
        await tryOne('ip', quickBanDraft.ip);
      } else {
        await tryOne('device', quickBanDraft.deviceId);
      }

      if (done.length === 0 && skipped.length > 0) {
        message.warning('目标已在封禁列表中');
      } else {
        const parts = [
          done.length ? `已封禁${done.join('、')}` : '',
          skipped.length ? `${skipped.join('、')}已在列表中` : '',
          kicked > 0 ? `踢出 ${kicked} 个在线连接` : '',
        ].filter(Boolean);
        message.success(parts.join(' · ') || '已封禁');
      }
      setQuickBanDraft(null);
      setQuickBanReason('');
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '封禁失败');
    } finally {
      setQuickBanSaving(false);
    }
  }, [message, postSiteBan, quickBanDraft, quickBanReason, quickBanSaving, refresh]);

  const removeBan = useCallback(async (banId: string) => {
    try {
      await adminFetch(`/api/admin/bans/${banId}`, { method: 'DELETE' });
      message.success('已解封');
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '解封失败');
    }
  }, [message, refresh]);

  const openErrorReport = useCallback(async (id: string) => {
    setReportDetailLoading(true);
    try {
      const res = await adminFetch<{ report: ErrorReportDetail }>(`/api/admin/error-reports/${id}`);
      setReportDetail(res.report);
      setReportNoteDraft(res.report.note || '');
    } catch (err) {
          message.error(err instanceof Error ? err.message : '加载上报详情失败');
    } finally {
      setReportDetailLoading(false);
    }
  }, []);

  const resolveErrorReport = useCallback(async (id: string, status: 'open' | 'resolved') => {
    setReportBusyId(id);
    try {
      const payload: { status: 'open' | 'resolved'; note?: string } = { status };
      if (reportDetail?.id === id) {
        payload.note = reportNoteDraft;
      } else if (status === 'resolved') {
        message.warning('请先打开详情填写解决方案后再标记已处理');
        setReportBusyId(null);
        void openErrorReport(id);
        return;
      }
      if (status === 'resolved' && !(payload.note || '').trim()) {
        message.warning('请填写解决方案后再标记已处理');
        setReportBusyId(null);
        return;
      }
      const res = await adminFetch<{ report: ErrorReportDetail; delivered?: number }>(`/api/admin/error-reports/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (reportDetail?.id === id) setReportDetail(res.report);
      if (status === 'resolved') {
        const online = res.delivered ? `（已推送给 ${res.delivered} 个在线连接）` : '（用户下次进入时会看到）';
        message.success(`已标记为已处理${online}`);
      } else {
        message.success('已重开');
      }
      await refresh({ force: true });
    } catch (err) {
          message.error(err instanceof Error ? err.message : '更新上报失败');
    } finally {
      setReportBusyId(null);
    }
  }, [message, openErrorReport, refresh, reportDetail?.id, reportNoteDraft]);

  const deleteErrorReportItem = useCallback(async (id: string) => {
    modal.confirm({
      title: '确定删除这条错误上报？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setReportBusyId(id);
        try {
          await adminFetch(`/api/admin/error-reports/${id}`, { method: 'DELETE' });
          if (reportDetail?.id === id) setReportDetail(null);
          message.success('已删除');
          await refresh({ force: true });
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除上报失败');
        } finally {
          setReportBusyId(null);
        }
      },
    });
  }, [message, modal, refresh, reportDetail?.id]);

  const randomizeEntryPath = useCallback(() => {
    setEntryPathDraft(createRandomEntryPath());
    message.success('已生成随机地址，点击保存后生效');
  }, []);

  const saveEntryPath = useCallback(async () => {
    if (savingPath) return;
    setSavingPath(true);
    try {
      const res = await adminFetch<{ entryPath: string }>('/api/admin/entry-path', {
        method: 'PUT',
        body: JSON.stringify({ path: entryPathDraft.trim() }),
      });
      savedEntryPathRef.current = res.entryPath;
      setEntryPathDraft(res.entryPath);
      setOverview((prev) => (prev ? { ...prev, entryPath: res.entryPath } : prev));
      message.success('已保存，请收藏新地址');
      if (window.location.pathname !== res.entryPath) {
        navigate(res.entryPath, { replace: true });
      }
      await refresh({ force: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存登录地址失败');
    } finally {
      setSavingPath(false);
    }
  }, [entryPathDraft, message, navigate, refresh, savingPath]);

  const openReportCount = errorReports.filter((r) => r.status === 'open').length;
  const pendingPermanentCount = useMemo(
    () => rooms.filter((room) => room.permanentApplication?.status === 'pending').length,
    [rooms],
  );
  const reportDebugTabItems = useMemo(
    () => (reportDetail ? buildReportDebugTabItems(reportDetail) : []),
    [reportDetail],
  );

  const handleTabChange = (tab: AdminTabId) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const menuItems = ADMIN_TABS.map((tab) => ({
    key: tab.id,
    icon: tab.icon,
    label: tab.id === 'reports' && openReportCount > 0
      ? (
        <Badge count={openReportCount} size="small" offset={[8, 0]}>
          {tab.label}
        </Badge>
      )
      : tab.id === 'rooms' && pendingPermanentCount > 0
        ? (
          <Badge count={pendingPermanentCount} size="small" offset={[8, 0]}>
            {tab.label}
          </Badge>
        )
        : tab.label,
  }));

  useEffect(() => {
    setRoomsPage(1);
  }, [roomsKeyword, roomsStatusFilter, roomsPageSize]);

  const filteredRooms = useMemo(
    () => filterAdminRooms(rooms, roomsKeyword, roomsStatusFilter),
    [rooms, roomsKeyword, roomsStatusFilter],
  );

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredRooms.length / roomsPageSize) || 1);
    if (roomsPage > maxPage) setRoomsPage(maxPage);
  }, [filteredRooms.length, roomsPage, roomsPageSize]);

  const renderRoomUserActions = useCallback((
    room: AdminRoom,
    user: { id: string; userId?: string; nickname: string; clientIp?: string; deviceId?: string },
  ) => {
    const targetUserId = user.userId || user.id;
    const actionKey = `${room.id}:${targetUserId}`;
    const canRename = Boolean(targetUserId);
    const canTransfer = canRename && targetUserId !== room.creatorId;
    return (
      <Space size={6} wrap>
        {canTransfer && (
          <Popconfirm
            title="强制转让房主？"
            description={`将「${user.nickname}」设为房主，原房主会降为管理员。`}
            okText="确认转让"
            cancelText="取消"
            onConfirm={() => void transferRoomOwner(room, targetUserId, user.nickname)}
          >
            <Button
              size="small"
              type="primary"
              loading={transferringOwnerKey === actionKey}
            >
              转让房主
            </Button>
          </Popconfirm>
        )}
        <Button
          size="small"
          icon={<EditOutlined />}
          disabled={!canRename}
          onClick={() => openNicknameEditor(room, targetUserId, user.nickname)}
        >
          改名
        </Button>
        <Popconfirm
          title="确认按违规处理？"
          description="会自动重置该用户昵称，并向房间发送系统通知。"
          okText="确认"
          cancelText="取消"
          disabled={!canRename}
          okButtonProps={{ danger: true, loading: violatingUserKey === actionKey }}
          onConfirm={() => markUserViolation(room, targetUserId, user.nickname)}
        >
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            disabled={!canRename}
            loading={violatingUserKey === actionKey}
          >
            违规
          </Button>
        </Popconfirm>
        <Button
          size="small"
          danger
          disabled={!user.clientIp && !user.deviceId}
          onClick={() => openQuickBan({
            mode: 'both',
            ip: user.clientIp,
            deviceId: user.deviceId,
            nickname: user.nickname,
          })}
        >
          一键拉黑
        </Button>
      </Space>
    );
  }, [markUserViolation, openNicknameEditor, openQuickBan, transferRoomOwner, transferringOwnerKey, violatingUserKey]);

  const roomColumns: ColumnsType<AdminRoom> = [
    {
      title: '房间',
      width: 280,
      ellipsis: true,
      render: (_, room) => (
        <div style={{ minWidth: 0, lineHeight: 1.35 }}>
          <Typography.Text strong ellipsis style={{ display: 'block', maxWidth: 260 }}>
            {room.name}
          </Typography.Text>
          <Typography.Text type="secondary" code style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
            {room.id}
          </Typography.Text>
          {room.ownerNickname || room.creatorNickname ? (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
              房主/建房人：{room.ownerNickname || room.creatorNickname}
              {room.ownerLastJoinedAt ? ` · 最后进房 ${formatAuditTime(room.ownerLastJoinedAt)}` : ''}
            </Typography.Text>
          ) : room.creatorIp || room.creatorDeviceId ? (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
              已记录建房人信息
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: '状态',
      width: 128,
      render: (_, room) => {
        const pending = room.permanentApplication?.status === 'pending';
        const badgeStatus = pending
          ? 'warning'
          : room.protectedFromDestroy
            ? 'success'
            : 'default';
        const badgeText = pending
          ? '待审'
          : room.protectedFromDestroy
            ? '常驻'
            : '普通';
        const attrs: string[] = [];
        if (room.isLocked) attrs.push('上锁');
        const passwordRevealed = Object.prototype.hasOwnProperty.call(revealedPasswords, room.id);
        const revealedPassword = passwordRevealed ? revealedPasswords[room.id] : undefined;
        return (
          <div className="admin-room-status" style={{ lineHeight: 1.35 }}>
            <Badge status={badgeStatus} text={badgeText} />
            {room.hasPassword ? (
              <div className="admin-room-status__attrs" style={{ fontSize: 11, marginTop: 2 }}>
                <Button
                  type="link"
                  size="small"
                  loading={revealingPasswordId === room.id}
                  icon={passwordRevealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    void revealRoomPassword(room);
                  }}
                  style={{ padding: 0, height: 'auto', fontSize: 11 }}
                >
                  {passwordRevealed
                    ? (revealedPassword ? `密码: ${revealedPassword}` : '密码: 不可恢复')
                    : '点击查看密码'}
                </Button>
              </div>
            ) : null}
            {attrs.length > 0 ? (
              <div className="admin-room-status__attrs" style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                {attrs.join(' · ')}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      title: '在线',
      width: 64,
      align: 'center',
      dataIndex: 'userCount',
      render: (count: number) => (
        <Typography.Text type={count > 0 ? undefined : 'secondary'}>{count}</Typography.Text>
      ),
    },
    {
      title: '最后进房',
      width: 132,
      sorter: (a, b) => (a.lastJoinedAt || 0) - (b.lastJoinedAt || 0),
      defaultSortOrder: undefined,
      render: (_, room) => {
        const at = room.lastJoinedAt;
        if (!at) return <Typography.Text type="secondary">—</Typography.Text>;
        return (
          <div style={{ lineHeight: 1.35 }}>
            <Typography.Text>{formatRelativeTime(at)}</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
              {formatAuditTime(at)}
            </Typography.Text>
          </div>
        );
      },
    },
    {
      title: '播放',
      width: 96,
      render: (_, room) => {
        if (!room.currentSong) {
          return <Badge status="default" text="未播放" />;
        }
        return room.isPlaying
          ? <Badge status="processing" text="播放中" />
          : <Badge status="default" text="已暂停" />;
      },
    },
    {
      title: '队列',
      width: 56,
      align: 'center',
      dataIndex: 'queueLength',
      render: (n: number) => (
        <Typography.Text type={n > 0 ? undefined : 'secondary'}>{n}</Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 188,
      render: (_, room) => {
        const pending = room.permanentApplication?.status === 'pending';
        const busy = protectingId === room.id || permanentReviewingId === room.id;
        return (
          <Space size={6} wrap onClick={(e) => e.stopPropagation()}>
            {pending ? (
              <>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  loading={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void reviewPermanentApplication(room, true);
                  }}
                >
                  通过
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  loading={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRejectPermanentRoom(room);
                    setRejectPermanentReason('');
                  }}
                >
                  拒绝
                </Button>
              </>
            ) : (
              <Button
                size="small"
                type={room.protectedFromDestroy ? 'primary' : 'default'}
                ghost={room.protectedFromDestroy}
                icon={<SafetyCertificateOutlined />}
                loading={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleRoomProtection(room);
                }}
              >
                {room.protectedFromDestroy ? '常驻' : '设常驻'}
              </Button>
            )}
            <Popconfirm
              title="解散此房间？"
              description="在线成员会被踢出，操作不可撤销。"
              okText="解散"
              cancelText="取消"
              okButtonProps={{ danger: true, loading: deletingId === room.id }}
              onConfirm={() => dissolveRoom(room)}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const banColumns: ColumnsType<SiteBanEntry> = [
    {
      title: '类型',
      width: 88,
      render: (_, ban) => (
        <Tag color={ban.type === 'ip' ? 'blue' : 'purple'}>
          {ban.type === 'ip' ? 'IP' : '设备'}
        </Tag>
      ),
    },
    {
      title: '封禁值',
      dataIndex: 'value',
      render: (v) => <Typography.Text code copyable={{ text: v }}>{v}</Typography.Text>,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      render: (v) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '时间',
      width: 168,
      render: (_, ban) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatAuditTime(ban.at)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 88,
      render: (_, ban) => (
        <Button size="small" onClick={() => void removeBan(ban.id)}>解封</Button>
      ),
    },
  ];

  const reportColumns: ColumnsType<ErrorReportSummary> = [
    {
      title: '类型',
      width: 88,
      render: (_, report) => (
        <Tag color={report.type === 'feedback' ? 'blue' : 'default'}>
          {report.type === 'feedback' ? '意见' : '错误'}
        </Tag>
      ),
    },
    {
      title: '状态',
      width: 96,
      render: (_, report) => (
        <Tag color={report.status === 'open' ? 'warning' : 'success'}>
          {report.status === 'open' ? '待处理' : '已处理'}
        </Tag>
      ),
    },
    {
      title: '问题描述',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '来源',
      width: 200,
      ellipsis: true,
      render: (_, report) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {[
            report.meta.nickname,
            report.meta.roomId ? `房间 ${report.meta.roomId}` : null,
            report.ip,
          ].filter(Boolean).join(' · ') || '—'}
        </Typography.Text>
      ),
    },
    {
      title: '时间',
      width: 168,
      render: (_, report) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatAuditTime(report.createdAt)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, report) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => void openErrorReport(report.id)}>
            处理
          </Button>
          <Button
            size="small"
            type="link"
            danger
            loading={reportBusyId === report.id}
            onClick={() => void deleteErrorReportItem(report.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const auditColumns: ColumnsType<AdminAuditEntry> = [
    {
      title: '时间',
      width: 160,
      render: (_, entry) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatAuditTime(entry.at)}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      render: (_, entry) => formatAuditAction(entry),
    },
    {
      title: 'IP',
      width: 130,
      render: (_, entry) => entry.ip ? <Typography.Text code style={{ fontSize: 11 }}>{entry.ip}</Typography.Text> : '—',
    },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewDashboard
            overview={overview}
            openReportCount={openReportCount}
            upstreamBusyUrl={upstreamBusyUrl}
            onResetCooldown={(url) => void resetUpstreamCooldown(url)}
            onToggleDisabled={(up) => void toggleUpstreamDisabled(up)}
            onGoReports={() => setActiveTab('reports')}
          />
        );

      case 'rooms':
        return (
          <Card
            title="房间列表"
            size="small"
            extra={(
              <Space size={8} wrap>
                {pendingPermanentCount > 0 && (
                  <Badge
                    status="warning"
                    text={`${pendingPermanentCount} 个待审常驻`}
                  />
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {roomsKeyword || roomsStatusFilter.length > 0
                    ? `${filteredRooms.length} / ${rooms.length}`
                    : `${rooms.length} 个房间`}
                </Typography.Text>
              </Space>
            )}
          >
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap size={8} style={{ width: '100%' }}>
                <Input.Search
                  placeholder="搜索房间、成员、IP、歌曲"
                  allowClear
                  value={roomsKeyword}
                  onChange={(e) => setRoomsKeyword(e.target.value)}
                  style={{ width: 260, maxWidth: '100%' }}
                />
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="状态筛选"
                  value={roomsStatusFilter}
                  options={ADMIN_ROOM_STATUS_FILTERS}
                  onChange={setRoomsStatusFilter}
                  maxTagCount="responsive"
                  style={{ minWidth: 200, flex: 1, maxWidth: 420 }}
                />
                <Button
                  disabled={!roomsKeyword && roomsStatusFilter.length === 0}
                  onClick={() => {
                    setRoomsKeyword('');
                    setRoomsStatusFilter([]);
                  }}
                >
                  重置
                </Button>
              </Space>
              <Table
                rowKey="id"
                size="middle"
                columns={roomColumns}
                dataSource={filteredRooms}
                scroll={{ x: 820 }}
                rowClassName={(room) => (
                  room.permanentApplication?.status === 'pending' ? 'admin-room-row-pending' : ''
                )}
                pagination={{
                  current: roomsPage,
                  pageSize: roomsPageSize,
                  total: filteredRooms.length,
                  onChange: (page, pageSize) => {
                    setRoomsPage(page);
                    if (pageSize && pageSize !== roomsPageSize) setRoomsPageSize(pageSize);
                  },
                  showTotal: (total) => `共 ${total} 条`,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 15, 20, 50, 100],
                  size: 'small',
                }}
                locale={{ emptyText: rooms.length === 0 ? '当前没有活跃房间' : '没有匹配的房间' }}
                onRow={(room) => ({
                  style: (
                    room.users.length > 0
                    || room.permanentApplication?.status === 'pending'
                    || Boolean(room.creatorId || room.creatorIp || room.creatorDeviceId)
                  )
                    ? { cursor: 'pointer' }
                    : undefined,
                })}
                expandable={{
                  expandRowByClick: true,
                  rowExpandable: (room) => (
                    room.users.length > 0
                    || room.permanentApplication?.status === 'pending'
                    || Boolean(room.creatorId || room.creatorIp || room.creatorDeviceId)
                  ),
                  expandIcon: ({ expanded, onExpand, record }) => (
                    (
                      record.users.length > 0
                      || record.permanentApplication?.status === 'pending'
                      || Boolean(record.creatorId || record.creatorIp || record.creatorDeviceId)
                    ) ? (
                      <RightOutlined
                        rotate={expanded ? 90 : 0}
                        onClick={(e) => onExpand(record, e)}
                        style={{
                          fontSize: 11,
                          color: 'rgba(0, 0, 0, 0.45)',
                          transition: 'transform 0.2s',
                        }}
                      />
                    ) : (
                      <span style={{ display: 'inline-block', width: 11 }} />
                    )
                  ),
                  expandedRowRender: (room) => {
                    const app = room.permanentApplication;
                    const busy = permanentReviewingId === room.id;
                    return (
                      <div className="admin-room-expand">
                        {app?.status === 'pending' && (
                          <div
                            className="admin-room-review"
                            style={{ marginBottom: room.users.length > 0 ? 12 : 0 }}
                          >
                            <div className="admin-room-review__main">
                              <div className="admin-room-review__title">
                                <Badge status="warning" text="常驻申请待审核" />
                              </div>
                              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                                申请人 {app.applicantNickname || room.ownerNickname || '房主'}
                                {app.appliedAt ? ` · ${formatAuditTime(app.appliedAt)}` : ''}
                              </Typography.Text>
                              {app.note ? (
                                <Typography.Text style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                                  {app.note}
                                </Typography.Text>
                              ) : null}
                            </div>
                            <Space size={8}>
                              <Button
                                size="small"
                                type="primary"
                                loading={busy}
                                onClick={() => void reviewPermanentApplication(room, true)}
                              >
                                通过
                              </Button>
                              <Button
                                size="small"
                                loading={busy}
                                onClick={() => {
                                  setRejectPermanentRoom(room);
                                  setRejectPermanentReason('');
                                }}
                              >
                                拒绝
                              </Button>
                            </Space>
                          </div>
                        )}
                        {room.users.length > 0 ? (
                          <Table
                            size="small"
                            pagination={false}
                            rowKey="id"
                            dataSource={room.users}
                            scroll={{ x: 820 }}
                            columns={[
                              {
                                title: '昵称',
                                width: 180,
                                render: (_, u) => (
                                  <Typography.Text ellipsis style={{ maxWidth: 160 }}>
                                    {u.nickname}
                                  </Typography.Text>
                                ),
                              },
                              {
                                title: 'IP',
                                width: 180,
                                render: (_, u) => (
                                  u.clientIp ? (
                                    <Typography.Text code copyable={{ text: u.clientIp }}>
                                      {u.clientIp}
                                    </Typography.Text>
                                  ) : (
                                    <Typography.Text type="secondary">—</Typography.Text>
                                  )
                                ),
                              },
                              {
                                title: '设备 ID',
                                width: 240,
                                render: (_, u) => (
                                  u.deviceId ? (
                                    <Typography.Text
                                      code
                                      copyable={{ text: u.deviceId }}
                                      ellipsis
                                      style={{ maxWidth: 220 }}
                                    >
                                      {u.deviceId}
                                    </Typography.Text>
                                  ) : (
                                    <Typography.Text type="secondary">—</Typography.Text>
                                  )
                                ),
                              },
                              {
                                title: '操作',
                                width: 220,
                                render: (_, u) => renderRoomUserActions(room, u),
                              },
                            ]}
                          />
                        ) : (
                          <div style={{ display: 'grid', gap: 8 }}>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              当前无在线成员
                              {(room.creatorNickname || room.creatorId || room.creatorIp || room.creatorDeviceId)
                                ? ' · 建房人信息如下'
                                : ' · 暂无建房人记录（旧房间可能未保存）'}
                            </Typography.Text>
                            {(room.creatorNickname || room.creatorId || room.creatorIp || room.creatorDeviceId) ? (
                              <Table
                                size="small"
                                pagination={false}
                                rowKey="id"
                                dataSource={[{
                                  id: 'creator',
                                  nickname: room.creatorNickname || room.ownerNickname || '—',
                                  clientIp: room.creatorIp || '',
                                  deviceId: room.creatorDeviceId || '',
                                  userId: room.creatorId || '',
                                }]}
                                scroll={{ x: 920 }}
                                columns={[
                                  {
                                    title: '昵称',
                                    width: 180,
                                    render: (_, row) => (
                                      <Typography.Text ellipsis style={{ maxWidth: 160 }}>
                                        {row.nickname || '—'}
                                      </Typography.Text>
                                    ),
                                  },
                                  {
                                    title: '用户 ID',
                                    width: 140,
                                    ellipsis: true,
                                    render: (_, row) => (
                                      row.userId ? (
                                        <Typography.Text code copyable={{ text: row.userId }} ellipsis style={{ maxWidth: 120 }}>
                                          {row.userId}
                                        </Typography.Text>
                                      ) : (
                                        <Typography.Text type="secondary">—</Typography.Text>
                                      )
                                    ),
                                  },
                                  {
                                    title: 'IP',
                                    width: 180,
                                    render: (_, row) => (
                                      row.clientIp ? (
                                        <Typography.Text code copyable={{ text: row.clientIp }}>
                                          {row.clientIp}
                                        </Typography.Text>
                                      ) : (
                                        <Typography.Text type="secondary">—</Typography.Text>
                                      )
                                    ),
                                  },
                                  {
                                    title: '设备 ID',
                                    width: 240,
                                    render: (_, row) => (
                                      row.deviceId ? (
                                        <Typography.Text
                                          code
                                          copyable={{ text: row.deviceId }}
                                          ellipsis
                                          style={{ maxWidth: 220 }}
                                        >
                                          {row.deviceId}
                                        </Typography.Text>
                                      ) : (
                                        <Typography.Text type="secondary">—</Typography.Text>
                                      )
                                    ),
                                  },
                                  {
                                    title: '操作',
                                    width: 220,
                                    render: (_, row) => renderRoomUserActions(room, row),
                                  },
                                ]}
                              />
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  },
                }}
              />
            </Space>
          </Card>
        );

      case 'bans':
        return (
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Card title="添加封禁" size="small">
              <Form layout="vertical" style={{ marginBottom: 0 }}>
                <Row gutter={16}>
                  <Col xs={24} sm={6} md={4}>
                    <Form.Item label="类型" style={{ marginBottom: 12 }}>
                      <Select
                        value={banType}
                        aria-label="封禁类型"
                        options={[
                          { value: 'ip', label: 'IP' },
                          { value: 'device', label: '设备' },
                        ]}
                        onChange={setBanType}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={10} md={8}>
                    <Form.Item
                      label={banType === 'ip' ? 'IP 地址' : '设备 ID'}
                      style={{ marginBottom: 12 }}
                    >
                      <Input
                        value={banValue}
                        onChange={(e) => setBanValue(e.target.value)}
                        placeholder={banType === 'ip' ? '例如 1.2.3.4' : '客户端设备 ID'}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={8} md={6}>
                    <Form.Item label="原因（可选）" style={{ marginBottom: 12 }}>
                      <Input
                        value={banReason}
                        onChange={(e) => setBanReason(e.target.value)}
                        placeholder="简要说明"
                        maxLength={120}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={24} md={6}>
                    <Form.Item label=" " colon={false} style={{ marginBottom: 12 }}>
                      <Button
                        type="primary"
                        loading={banSaving}
                        disabled={!banValue.trim()}
                        onClick={() => void addBan()}
                        block
                      >
                        添加封禁
                      </Button>
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                封禁后无法进房 / 建房；房间成员可一键拉黑
              </Typography.Text>
              <Collapse
                ghost
                size="small"
                style={{ marginTop: 8 }}
                items={[
                  {
                    key: 'soft-block-codes',
                    label: (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        用户反馈错误码对照
                      </Typography.Text>
                    ),
                    children: (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {SOFT_BLOCK_CODE_HELP.map((item) => (
                          <div key={item.code} style={{ fontSize: 12, lineHeight: 1.5 }}>
                            <Typography.Text code copyable={{ text: item.code }}>
                              {item.code}
                            </Typography.Text>
                            <Typography.Text strong style={{ margin: '0 6px' }}>
                              {item.label}
                            </Typography.Text>
                            <Typography.Text type="secondary">{item.hint}</Typography.Text>
                          </div>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            </Card>
            <Card title={`封禁记录（${bans.length}）`}>
              <Table
                rowKey="id"
                size="middle"
                columns={banColumns}
                dataSource={bans}
                pagination={{
                  current: bansPage,
                  pageSize: LIST_PAGE_SIZE,
                  total: bans.length,
                  onChange: setBansPage,
                  showTotal: (total) => `共 ${total} 条`,
                  showSizeChanger: false,
                }}
                locale={{ emptyText: '暂无封禁记录' }}
              />
            </Card>
          </Space>
        );

      case 'reports':
        return (
          <Card
            title="错误上报"
            extra={(
              <Space size={12}>
                <Typography.Text type="secondary">共 {errorReports.length} 条</Typography.Text>
                {errorReports.some((r) => r.status === 'open') && (
                  <Tag color="warning">
                    待处理 {errorReports.filter((r) => r.status === 'open').length}
                  </Tag>
                )}
              </Space>
            )}
          >
            <Table
              rowKey="id"
              size="middle"
              columns={reportColumns}
              dataSource={errorReports}
              scroll={{ x: 760 }}
              pagination={{
                current: reportsPage,
                pageSize: LIST_PAGE_SIZE,
                total: errorReports.length,
                onChange: setReportsPage,
                showTotal: (total) => `共 ${total} 条`,
                showSizeChanger: false,
              }}
              locale={{ emptyText: '暂无用户上报' }}
            />
          </Card>
        );

      case 'notify':
        return (
          <Space orientation="vertical" size="large" style={{ width: '100%' }}>
            <Card
              title="首页站点公告"
              extra={<Switch checked={annEnabled} onChange={setAnnEnabled} checkedChildren="启用" unCheckedChildren="停用" />}
            >
              <Form layout="vertical">
                <Form.Item label="公告标题">
                  <Input value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} maxLength={40} />
                </Form.Item>
                <Form.Item label="公告内容">
                  <Input.TextArea value={annText} onChange={(e) => setAnnText(e.target.value)} maxLength={4000} rows={4} />
                </Form.Item>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Checkbox checked={annBumpId} onChange={(e) => setAnnBumpId(e.target.checked)}>
                    作为新公告发布（已读用户重新弹窗）
                  </Checkbox>
                  <Button
                    type="primary"
                    loading={annSaving}
                    disabled={annEnabled && !annText.trim()}
                    onClick={() => void saveAnnouncement()}
                  >
                    保存公告
                  </Button>
                </Space>
              </Form>
            </Card>
            <Card title="广播">
              <Form layout="vertical">
                <Form.Item label="广播内容">
                  <Input.TextArea
                    value={broadcastText}
                    onChange={(e) => setBroadcastText(e.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="维护 / 活动预告"
                  />
                </Form.Item>
                <Form.Item label="发送范围">
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="全部房间（留空 = 全站广播）"
                    value={broadcastRoomIds}
                    onChange={(v) => setBroadcastRoomIds(v)}
                    options={rooms.map((r) => ({ label: `${r.name} (${r.id})`, value: r.id }))}
                    filterOption={(input, option) =>
                      String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    style={{ width: '100%' }}
                    maxTagCount="responsive"
                  />
                </Form.Item>
                <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {broadcastRoomIds.length > 0 ? `发送到 ${broadcastRoomIds.length} 个房间` : '全站广播'}
                  </Typography.Text>
                  <Button
                    type="primary"
                    loading={broadcasting}
                    disabled={!broadcastText.trim()}
                    onClick={() => void sendBroadcast()}
                  >
                    发送广播
                  </Button>
                </Space>
              </Form>
            </Card>
          </Space>
        );

      case 'donations':
        return (
          <Space orientation="vertical" size="large" style={{ width: '100%' }}>
            <Card title="添加捐赠记录" extra={<Typography.Text type="secondary">金额仅后台可见，用于同日排序</Typography.Text>}>
              <Form layout="vertical" onFinish={() => void addDonationRecord()}>
                <Row gutter={12}>
                  <Col xs={24} md={10}>
                    <Form.Item label="付款备注署名" required>
                      <Input value={donationName} onChange={(e) => setDonationName(e.target.value)} maxLength={40} placeholder="从微信 / 支付宝到账备注中填写" />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={7}>
                    <Form.Item label="捐赠日期">
                      <DatePicker value={dayjs(donationDate, 'YYYY-MM-DD')} format="YYYY-MM-DD" style={{ width: '100%' }} onChange={(_, value) => setDonationDate(String(value || ''))} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={7}>
                    <Form.Item label="捐赠金额">
                      <InputNumber min={0} step={0.01} prefix="¥" value={donationAmount} onChange={(value) => setDonationAmount(typeof value === 'number' ? value : null)} placeholder="仅后台可见" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                <Button type="primary" htmlType="submit" loading={donationSaving} disabled={!donationName.trim()}>
                  添加到名单
                </Button>
              </Form>
            </Card>
            <Card title={`已录入名单（${donations.length}）`}>
              <Table
                rowKey="id"
                size="middle"
                dataSource={[...donations].sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(b.amount || 0) - Number(a.amount || 0))}
                locale={{ emptyText: '暂无捐赠名单' }}
                pagination={{
                  current: donationsPage,
                  pageSize: donationsPageSize,
                  total: donations.length,
                  hideOnSinglePage: false,
                  showQuickJumper: true,
                  showSizeChanger: true,
                  pageSizeOptions: [10, 15, 30, 50, 100],
                  showTotal: (total) => `共 ${total} 条`,
                  onChange: (page, pageSize) => {
                    setDonationsPage(page);
                    if (pageSize !== donationsPageSize) {
                      setDonationsPageSize(pageSize);
                      setDonationsPage(1);
                    }
                  },
                }}
                columns={[
                  { title: '署名', dataIndex: 'name' },
                  { title: '日期', dataIndex: 'date', width: 140 },
                  { title: '金额', dataIndex: 'amount', width: 130, render: (amount) => `¥${Number(amount || 0).toFixed(2)}` },
                  {
                    title: '操作',
                    width: 150,
                    render: (_, entry: DonationEntry) => (
                      <Space size={4}>
                        <Button size="small" icon={<EditOutlined />} onClick={() => editDonationRecord(entry)}>编辑</Button>
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteDonationRecord(entry)}>删除</Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </Space>
        );

      case 'settings':
        return (
          <Card
            className="admin-settings-card"
            styles={{ body: { padding: '8px 20px 0' } }}
            style={{
              flex: '1 0 auto',
              display: 'flex',
              flexDirection: 'column',
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
            }}
          >
            <RuntimeConfigPanel
              onError={(text) => message.error(text)}
              securityTab={(
                <>
                  <SettingsSection title="登录地址" description="修改后旧地址失效，请收藏新链接">
                    <Space orientation="vertical" style={{ width: '100%' }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Typography.Text
                          type="secondary"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 11px',
                            background: '#fafafa',
                            border: '1px solid #d9d9d9',
                            borderRight: 0,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {typeof window !== 'undefined' ? window.location.origin : ''}
                        </Typography.Text>
                        <Input
                          value={entryPathDraft}
                          onChange={(e) => {
                            setEntryPathDraft(e.target.value);
                          }}
                          spellCheck={false}
                          placeholder="/随机路径"
                          suffix={(
                            <Button
                              type="text"
                              size="small"
                              icon={<ReloadOutlined />}
                              onClick={randomizeEntryPath}
                              title="随机生成登录地址"
                              aria-label="随机生成登录地址"
                            />
                          )}
                          style={{ fontFamily: 'monospace' }}
                        />
                      </Space.Compact>
                      <Button
                        type="primary"
                        loading={savingPath}
                        disabled={!entryPathDraft.trim() || entryPathDraft === overview?.entryPath}
                        onClick={() => void saveEntryPath()}
                      >
                        保存
                      </Button>
                    </Space>
                  </SettingsSection>
                  <Divider style={{ margin: 0 }} />
                  <SettingsSection
                    title="管理员账号"
                    badge={(
                      <Tag color={(overview?.credentialsPersisted ?? true) ? 'success' : 'error'}>
                        {(overview?.credentialsPersisted ?? true) ? 'Redis 持久化' : 'Redis 未就绪'}
                      </Tag>
                    )}
                    description="新密码至少 8 位；修改后其它会话立即失效"
                  >
                    <CredentialsPanel
                      bare
                      adminUsername={overview?.adminUsername || ''}
                      persisted={overview?.credentialsPersisted ?? true}
                      onError={(text) => message.error(text)}
                      onSaved={() => void refresh()}
                    />
                  </SettingsSection>
                </>
              )}
            />
          </Card>
        );

      case 'audit':
        return (
          <Card title="操作审计">
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Space wrap size={8} style={{ width: '100%' }}>
                <Input.Search
                  placeholder="搜索 IP、房间、用户、原因…"
                  allowClear
                  value={auditKeyword}
                  onChange={(e) => setAuditKeyword(e.target.value)}
                  onSearch={(value) => {
                    const next = value.trim();
                    setAuditKeyword(next);
                    setAuditKeywordApplied(next);
                    setAuditPage(1);
                  }}
                  style={{ width: 260, maxWidth: '100%' }}
                />
                <Select
                  allowClear
                  placeholder="类型"
                  value={auditAction}
                  options={AUDIT_ACTION_OPTIONS}
                  onChange={(value) => {
                    setAuditAction(value || undefined);
                    setAuditPage(1);
                  }}
                  style={{ width: 140 }}
                  showSearch
                  optionFilterProp="label"
                />
              </Space>
              <Table
                rowKey="id"
                size="small"
                loading={auditLoading}
                columns={auditColumns}
                dataSource={auditItems}
                pagination={{
                  current: auditPage,
                  pageSize: AUDIT_PAGE_SIZE,
                  total: auditTotal,
                  onChange: setAuditPage,
                  showTotal: (total) => `共 ${total} 条`,
                  showSizeChanger: false,
                }}
                locale={{ emptyText: '暂无操作记录' }}
              />
            </Space>
          </Card>
        );

      default:
        return null;
    }
  };

  if (loggedIn === null) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
        <Content style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AdminLoading minHeight="100vh" tip="加载中…" />
        </Content>
      </Layout>
    );
  }

  if (!loggedIn) {
    return <LoginForm onLoggedIn={() => setLoggedIn(true)} />;
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {overview?.setupRequired && (
        <InitialSetupGate overview={overview} onError={(text) => message.error(text)} onUpdated={() => void refresh()} />
      )}

      <Sider
        width={220}
        breakpoint="md"
        collapsedWidth={0}
        style={{
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          height: '100vh',
          overflow: 'auto',
          position: 'sticky',
          top: 0,
          insetInlineStart: 0,
        }}
        className="admin-desktop-sider"
      >
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div style={{ padding: '20px 16px 12px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <SafetyCertificateOutlined style={{ fontSize: 20, color: '#1677ff' }} />
            <Typography.Text strong>OpenMusic管理后台</Typography.Text>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[activeTab]}
            items={menuItems}
            onClick={({ key }) => handleTabChange(key as AdminTabId)}
            style={{ borderInlineEnd: 'none', flex: 1, overflow: 'auto' }}
          />
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
            <Button type="text" danger icon={<LogoutOutlined />} block onClick={() => void logout()}>
              退出登录
            </Button>
          </div>
        </div>
      </Sider>

      <Drawer
        title="OpenMusic管理后台"
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        styles={{ body: { padding: 0 } }}
        size={260}
      >
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          items={menuItems}
          onClick={({ key }) => handleTabChange(key as AdminTabId)}
        />
        <div style={{ padding: 12 }}>
          <Button type="text" danger icon={<LogoutOutlined />} block onClick={() => void logout()}>
            退出登录
          </Button>
        </div>
      </Drawer>

      <Layout style={{ height: '100vh', overflow: 'hidden', minWidth: 0 }}>
        <Header
          className="admin-page-header"
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            borderBottom: '1px solid #f0f0f0',
            height: 56,
            lineHeight: '56px',
            flexShrink: 0,
          }}
        >
          <Space align="center" style={{ minWidth: 0, flex: 1 }}>
            <Button
              className="admin-mobile-menu-btn"
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              aria-label="打开菜单"
            />
            <div style={{ minWidth: 0 }}>
              <Typography.Title
                level={5}
                style={{ margin: 0, lineHeight: 1.35 }}
                ellipsis
              >
                {TAB_META[activeTab].title}
              </Typography.Title>
            </div>
          </Space>
          <Button
            icon={<SyncOutlined spin={refreshing} />}
            onClick={() => void refresh({ force: true })}
            loading={refreshing}
            style={{ flexShrink: 0 }}
          >
            刷新
          </Button>
        </Header>

        <Content
          className={activeTab === 'settings' ? 'admin-content admin-content--settings' : 'admin-content'}
          style={{
            padding: activeTab === 'settings' ? '20px 24px 0' : '20px 24px 32px',
            background: '#f5f7fa',
            overflow: 'auto',
            flex: 1,
            minHeight: 0,
            ...(activeTab === 'settings'
              ? { display: 'flex', flexDirection: 'column' as const }
              : null),
          }}
        >
          {TAB_META[activeTab].description ? (
            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: 0, marginBottom: 16, flexShrink: 0 }}
            >
              {TAB_META[activeTab].description}
            </Typography.Paragraph>
          ) : null}
          <div
            className={activeTab === 'settings' ? 'admin-settings-fill' : undefined}
            style={
              activeTab === 'settings'
                ? { flex: '1 0 auto', display: 'flex', flexDirection: 'column' }
                : undefined
            }
          >
            {renderTabContent()}
          </div>
        </Content>
      </Layout>

      <Modal
        open={Boolean(reportDetail) || reportDetailLoading}
        onCancel={() => {
          if (reportBusyId) return;
          setReportDetail(null);
        }}
        width={760}
        centered
        title="处理错误上报"
        styles={{ body: { paddingTop: 12, paddingBottom: 12 } }}
        footer={reportDetail ? (
          <Space wrap>
            <Button onClick={() => setReportDetail(null)}>关闭</Button>
            {reportDetail.status === 'resolved' ? (
              <Button
                loading={reportBusyId === reportDetail.id}
                onClick={() => void resolveErrorReport(reportDetail.id, 'open')}
              >
                重开
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={reportBusyId === reportDetail.id}
                onClick={() => void resolveErrorReport(reportDetail.id, 'resolved')}
              >
                标记已处理
              </Button>
            )}
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={reportBusyId === reportDetail.id}
              onClick={() => void deleteErrorReportItem(reportDetail.id)}
            >
              删除
            </Button>
          </Space>
        ) : null}
      >
        {reportDetailLoading || !reportDetail ? (
          <AdminLoading tip="加载上报详情…" minHeight={180} />
        ) : (
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap size={8} align="center">
              <Tag color={reportDetail.type === 'feedback' ? 'blue' : 'default'} style={{ margin: 0 }}>
                {reportDetail.type === 'feedback' ? '意见' : '错误'}
              </Tag>
              <Tag color={reportDetail.status === 'open' ? 'warning' : 'success'} style={{ margin: 0 }}>
                {reportDetail.status === 'open' ? '待处理' : '已处理'}
              </Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatAuditTime(reportDetail.createdAt)}
                {reportDetail.meta?.nickname ? ` · ${String(reportDetail.meta.nickname)}` : ''}
                {reportDetail.meta?.roomId ? ` · 房间 ${String(reportDetail.meta.roomId)}` : ''}
                {reportDetail.ip ? ` · ${reportDetail.ip}` : ''}
              </Typography.Text>
            </Space>

            <Typography.Paragraph
              style={{ marginBottom: 0, fontSize: 13 }}
              ellipsis={{ rows: 2, expandable: 'collapsible', symbol: (expanded) => (expanded ? '收起' : '展开') }}
            >
              {reportDetail.description}
            </Typography.Paragraph>

            <Form layout="vertical" requiredMark={false} style={{ marginBottom: 0 }}>
              <Form.Item
                label="解决方案"
                required={reportDetail.status !== 'resolved'}
                style={{ marginBottom: 4 }}
                extra={
                  reportDetail.status === 'resolved' && reportDetail.solutionAckedAt
                    ? `用户已于 ${formatAuditTime(reportDetail.solutionAckedAt)} 确认`
                    : '处理后在线用户会收到弹窗'
                }
              >
                <Input.TextArea
                  value={reportNoteDraft}
                  onChange={(e) => setReportNoteDraft(e.target.value)}
                  maxLength={500}
                  rows={2}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  showCount
                  placeholder="写给用户的解决说明…"
                />
              </Form.Item>
            </Form>

            <Tabs
              size="small"
              type="card"
              items={reportDebugTabItems}
              style={{ width: '100%' }}
            />
            {reportDetail && (
              <Typography.Text type="secondary" copyable={{ text: reportDetail.id }} style={{ fontSize: 11 }}>
                ID {reportDetail.id}
              </Typography.Text>
            )}
          </Space>
        )}
      </Modal>

      <Modal
        title="修改用户昵称"
        open={Boolean(editingNicknameTarget)}
        onCancel={() => {
          if (nicknameSaving) return;
          setEditingNicknameTarget(null);
          setEditingNicknameDraft('');
        }}
        onOk={() => void submitNicknameEdit()}
        okText="保存"
        okButtonProps={{ loading: nicknameSaving, disabled: !editingNicknameDraft.trim() }}
        cancelText="取消"
        cancelButtonProps={{ disabled: nicknameSaving }}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            房间「{editingNicknameTarget?.roomName}」中的用户昵称会立即同步到当前房间。
          </Typography.Text>
          <Input
            value={editingNicknameDraft}
            onChange={(e) => setEditingNicknameDraft(e.target.value)}
            maxLength={20}
            placeholder="请输入新昵称"
            autoFocus
            onPressEnter={() => void submitNicknameEdit()}
          />
        </Space>
      </Modal>

      <Modal
        title="拒绝常驻申请"
        open={Boolean(rejectPermanentRoom)}
        onCancel={() => {
          setRejectPermanentRoom(null);
          setRejectPermanentReason('');
        }}
        onOk={submitRejectPermanent}
        okText="确认拒绝"
        okButtonProps={{ danger: true, loading: Boolean(permanentReviewingId) }}
        cancelText="取消"
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            房间「{rejectPermanentRoom?.name}」的申请将被拒绝，原因会弹窗通知房主。
          </Typography.Text>
          <Input.TextArea
            value={rejectPermanentReason}
            onChange={(e) => setRejectPermanentReason(e.target.value)}
            placeholder="请填写拒绝原因（必填）"
            maxLength={200}
            rows={3}
            showCount
          />
        </Space>
      </Modal>

      <Modal
        title={quickBanDraft?.mode === 'both' ? '一键拉黑' : '确认封禁'}
        open={Boolean(quickBanDraft)}
        onCancel={() => {
          if (quickBanSaving) return;
          setQuickBanDraft(null);
          setQuickBanReason('');
        }}
        onOk={() => void submitQuickBan()}
        okText={quickBanDraft?.mode === 'both' ? '拉黑 IP 和设备' : '确认封禁'}
        okButtonProps={{ danger: true, loading: quickBanSaving }}
        cancelText="取消"
        cancelButtonProps={{ disabled: quickBanSaving }}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {quickBanDraft?.nickname ? `成员「${quickBanDraft.nickname}」· ` : ''}
            {quickBanDraft?.mode === 'both'
              ? '将同时封禁其 IP 与设备，无法进房 / 建房。'
              : `将封禁该${quickBanDraft?.type === 'ip' ? ' IP' : '设备'}，无法进房 / 建房。`}
          </Typography.Text>
          {quickBanDraft?.mode === 'both' ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <Typography.Text style={{ fontSize: 12 }}>
                IP：{quickBanDraft.ip ? <Typography.Text code>{quickBanDraft.ip}</Typography.Text> : '—'}
              </Typography.Text>
              <Typography.Text style={{ fontSize: 12 }}>
                设备：{quickBanDraft.deviceId
                  ? <Typography.Text code>{quickBanDraft.deviceId}</Typography.Text>
                  : '—'}
              </Typography.Text>
            </div>
          ) : (
            <Typography.Text style={{ fontSize: 12 }}>
              {quickBanDraft?.type === 'ip' ? 'IP' : '设备'}：
              <Typography.Text code>
                {quickBanDraft?.type === 'ip' ? quickBanDraft.ip : quickBanDraft?.deviceId}
              </Typography.Text>
            </Typography.Text>
          )}
          <Input.TextArea
            value={quickBanReason}
            onChange={(e) => setQuickBanReason(e.target.value)}
            placeholder="封禁原因（可选）"
            maxLength={120}
            rows={3}
            showCount
          />
        </Space>
      </Modal>

      <style>{`
        .admin-room-row-pending > td {
          background: #fff !important;
        }
        .admin-room-row-pending > td:first-child {
          box-shadow: inset 3px 0 0 #faad14;
        }
        .admin-room-row-pending:hover > td {
          background: #fafafa !important;
        }
        .admin-room-status .ant-badge-status-text {
          font-size: 13px;
          color: rgba(0, 0, 0, 0.88);
        }
        .admin-room-status__attrs {
          margin-top: 2px;
          padding-left: 14px;
          font-size: 12px;
          color: rgba(0, 0, 0, 0.45);
          letter-spacing: 0.01em;
        }
        .admin-room-review {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 14px;
          border: 1px solid #f0f0f0;
          border-left: 3px solid #faad14;
          border-radius: 6px;
          background: #fafafa;
        }
        .admin-room-review__main {
          min-width: 0;
          flex: 1;
        }
        .admin-room-review__title .ant-badge-status-text {
          font-size: 13px;
          font-weight: 500;
          color: rgba(0, 0, 0, 0.88);
        }
        .admin-room-expand {
          padding: 4px 8px 8px 28px;
        }
        .admin-room-expand .ant-table {
          background: transparent;
        }
        .admin-room-expand .ant-table-thead > tr > th {
          background: rgba(0, 0, 0, 0.02);
          font-size: 12px;
        }
        .admin-page-header.ant-layout-header {
          height: 56px !important;
          line-height: 56px !important;
        }
        .admin-page-header .ant-typography {
          line-height: 1.35 !important;
        }
        .admin-metric-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.08) !important;
        }
        .admin-content--settings .admin-settings-fill {
          flex: 1 0 auto;
          display: flex;
          flex-direction: column;
        }
        .admin-content--settings .admin-settings-card.ant-card {
          flex: 1 0 auto;
          display: flex;
          flex-direction: column;
        }
        .admin-content--settings .admin-settings-card .ant-card-body {
          flex: 1 0 auto;
          display: flex;
          flex-direction: column;
        }
        /* 表格 / 嵌套 Spin 水平垂直居中 */
        .admin-content .ant-spin-nested-loading > div > .ant-spin {
          max-height: none;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .admin-content .ant-spin-nested-loading .ant-spin-container::after {
          background: rgba(255, 255, 255, 0.55);
        }
        @media (min-width: 768px) {
          .admin-mobile-menu-btn { display: none !important; }
        }
        @media (max-width: 767px) {
          .admin-desktop-sider { display: none !important; }
        }
      `}</style>
    </Layout>
  );
}

export default function Admin() {
  return (
    <AdminProviders>
      <AdminPage />
    </AdminProviders>
  );
}
