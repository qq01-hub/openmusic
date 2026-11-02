import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Descriptions, Space, Spin, Tag, Typography } from 'antd';
import SettingsSection from './SettingsSection';
import { adminFetch } from './utils';

interface UpgradeStatus {
  available: boolean;
  mode: 'docker' | 'source' | 'unmanaged';
  currentVersion: string;
  reason?: string;
  checkedAt?: number;
  latest: {
    id: number; tag: string; name: string; notes: string; url: string; publishedAt: string;
  } | null;
  job: {
    id: string; target: string; step: string; code?: string;
    status: 'running' | 'rolling_back' | 'succeeded' | 'failed' | 'rolled_back' | 'recovery_required';
  } | null;
}
const endpoint = '/api/admin/system-upgrade';
const isRunning = (status: UpgradeStatus | null) => ['running', 'rolling_back'].includes(status?.job?.status || '');

export default function SystemUpgradePanel({ active }: { active: boolean }) {
  const { modal } = App.useApp();
  const [status, setStatus] = useState<UpgradeStatus | null>(null);
  const [action, setAction] = useState<'check' | 'upgrade' | null>(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const loading = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await adminFetch<UpgradeStatus>(endpoint, { signal });
      setStatus(result);
      setError('');
    } catch (cause) {
      if (signal?.aborted) return;
      if ((cause as Error & { status?: number }).status === 401) {
        setExpired(true);
        setError('管理会话已过期，升级重启也会使会话失效，请重新登录后查看结果');
      } else {
        setError('暂时无法连接升级服务，升级重启期间会短暂断开，页面将自动重试');
      }
    } finally { loading.current = false; }
  }, []);
  useEffect(() => {
    if (!active || expired) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [active, expired, refresh]);

  const check = async () => {
    setAction('check');
    setError('');
    try {
      setStatus(await adminFetch<UpgradeStatus>(`${endpoint}/check`, { method: 'POST', signal: AbortSignal.timeout(35_000) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '检查失败，请稍后重试');
    } finally { setAction(null); }
  };
  const confirmUpgrade = () => {
    if (!status?.latest) return;
    const release = status.latest;
    modal.confirm({
      title: `升级到 ${release.tag}`,
      content: (
        <Space orientation="vertical" size={12}>
          <span>{status.mode === 'docker' ? '将拉取官方镜像并重建 OpenMusic 应用容器' : '将下载正式发布 ZIP、安装生产依赖并重启 OpenMusic'}</span>
          <span>升级会短暂中断播放与连接，请选择合适的时间，系统保留配置与持久化数据，并在切换失败时尝试恢复原版本</span>
          <span>建议先备份服务器配置和 Redis 数据，升级完成后需要重新登录管理端</span>
        </Space>
      ),
      okText: '确认升级',
      cancelText: '暂不升级',
      onOk: async () => {
        setAction('upgrade');
        setError('');
        try {
          setStatus(await adminFetch<UpgradeStatus>(endpoint, {
            method: 'POST', body: JSON.stringify({ releaseId: release.id }), signal: AbortSignal.timeout(35_000),
          }));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '提交结果暂未确认，请刷新状态');
          void refresh();
        } finally { setAction(null); }
      },
    });
  };
  const busy = isRunning(status);
  const current = status?.currentVersion;
  const sameVersion = Boolean(status?.latest && current === status.latest.tag);
  const labels = { docker: 'Docker 镜像部署', source: '源码 / 发布包部署', unmanaged: '未接入升级服务' };
  return (
    <SettingsSection title="系统升级" description="从官方正式发布更新当前站点，执行进度在页面关闭后仍会保留">
      <Space orientation="vertical" size={20} style={{ width: '100%' }}>
        {!status && !error && <Spin description="正在识别部署方式" />}
        {error && (
          <Alert type={expired ? 'warning' : 'error'} showIcon title={error} role="alert"
            action={expired ? <Button onClick={() => window.location.reload()}>重新登录</Button> : undefined} />
        )}
        {status && (
          <>
            <Descriptions column={1} size="small" items={[
              { key: 'mode', label: '部署方式', children: labels[status.mode] },
              { key: 'version', label: '当前版本', children: current === 'unknown' || current === 'development'
                ? '尚无正式版本记录，首次升级后自动记录' : current },
              { key: 'target', label: '最新正式版', children: status.latest
                ? <Space wrap><Typography.Text strong>{status.latest.tag}</Typography.Text>
                  {sameVersion && <Tag color="success">已是该版本</Tag>}</Space>
                : '点击「检查更新」获取' },
            ]} />
            {!status.available && <Alert type="info" showIcon title={status.reason || '升级服务尚未安装'}
              description="Docker 部署需更新 Compose 并启动 updater 服务，源码部署需安装随项目提供的 PM2 升级服务，接入步骤见部署文档" />}
            <Space wrap>
              <Button icon={<ReloadOutlined />} loading={action === 'check'} disabled={!status.available || busy || expired || Boolean(action)}
                onClick={() => void check()}>检查更新</Button>
              <Button type="primary" icon={<CloudDownloadOutlined />} loading={action === 'upgrade'}
                disabled={!status.available || !status.latest || sameVersion || busy || expired || Boolean(action)
                  || status.job?.status === 'recovery_required'}
                onClick={confirmUpgrade}>升级到最新正式版</Button>
              <Button onClick={() => void refresh()} disabled={expired || Boolean(action)}>刷新状态</Button>
            </Space>
            {status.job && (
              <Alert showIcon role="status" aria-live="polite"
                type={busy ? 'info' : status.job.status === 'succeeded' ? 'success' : 'warning'}
                title={`${status.job.target} · ${status.job.step}`}
                description={status.job.code ? `任务编号 ${status.job.id} · ${status.job.code}` : `任务编号 ${status.job.id}`}
              />
            )}
            {status.latest && (
              <div>
                <Typography.Text strong>发布说明</Typography.Text>
                <Typography.Paragraph style={{ marginTop: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {status.latest.notes || '该版本未提供发布说明'}
                </Typography.Paragraph>
                <Typography.Link href={status.latest.url} target="_blank" rel="noopener noreferrer">查看官方发布页</Typography.Link>
              </div>
            )}
          </>
        )}
      </Space>
    </SettingsSection>
  );
}
