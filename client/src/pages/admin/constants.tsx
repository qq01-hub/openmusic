import type { ReactNode } from 'react';
import {
  BugOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HeartOutlined,
  NotificationOutlined,
  SettingOutlined,
  SoundOutlined,
  StopOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { AdminTabId } from './types';

export const LIST_PAGE_SIZE = 15;
export const AUDIT_PAGE_SIZE = 10;

/**
 * 操作审计类型筛选（大类；value 为分组 key，服务端展开为多个 action）
 * 列表文案仍按单条 action 细粒度显示
 */
export const AUDIT_ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'auth', label: '登录 / 退出' },
  { value: 'oauth', label: '第三方授权 / 绑定' },
  { value: 'account', label: '账号与入口' },
  { value: 'risk', label: '风控处置' },
  { value: 'config', label: '系统配置' },
  { value: 'notify', label: '公告 / 广播' },
  { value: 'donation', label: '捐赠名单' },
  { value: 'room', label: '房间管理' },
  { value: 'ban', label: '全站封禁' },
  { value: 'guard', label: '防护拦截' },
  { value: 'report', label: '错误上报' },
];

export const ADMIN_TABS: { id: AdminTabId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: '概览', icon: <DashboardOutlined /> },
  { id: 'rooms', label: '房间管理', icon: <SoundOutlined /> },
  { id: 'bans', label: '全站封禁', icon: <StopOutlined /> },
  { id: 'risk', label: '账户风控', icon: <SafetyCertificateOutlined /> },
  { id: 'reports', label: '错误上报', icon: <BugOutlined /> },
  { id: 'notify', label: '公告广播', icon: <NotificationOutlined /> },
  { id: 'donations', label: '捐赠名单', icon: <HeartOutlined /> },
  { id: 'settings', label: '系统设置', icon: <SettingOutlined /> },
  { id: 'audit', label: '操作审计', icon: <FileTextOutlined /> },
];

export const TAB_META: Record<AdminTabId, { title: string; description: string }> = {
  overview: { title: '概览', description: '' },
  rooms: { title: '房间管理', description: '' },
  bans: { title: '全站封禁', description: '' },
  risk: { title: '账户风控', description: '账户画像、请求额度、风险信号与人工复核' },
  reports: { title: '错误上报', description: '' },
  notify: { title: '公告广播', description: '' },
  donations: { title: '捐赠名单', description: '仅管理员维护；首页只公开署名与日期，不展示金额。' },
  settings: { title: '系统设置', description: '' },
  audit: { title: '操作审计', description: '保留 15 天' },
};
