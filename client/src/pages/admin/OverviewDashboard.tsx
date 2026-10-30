import { useMemo } from 'react';
import { ApiOutlined, ArrowRightOutlined, PlayCircleOutlined, SoundOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { EChartsCoreOption } from 'echarts/core';
import type { AdminOverview, AdminRoom, MetingUpstreamRecentError, MetingUpstreamStatus } from './types';
import AdminChart from './AdminChart';
import AdminLoading from './AdminLoading';
import { formatUptime } from './utils';
import './OverviewDashboard.css';

type Props = {
  overview: AdminOverview | null;
  rooms: AdminRoom[];
  openReportCount: number;
  pendingPermanentCount: number;
  upstreamBusyUrl: string | null;
  onResetCooldown: (url: string) => void;
  onToggleDisabled: (up: MetingUpstreamStatus) => void;
  onGoReports: () => void;
  onGoRooms: () => void;
};

const number = (value: number) => value.toLocaleString('zh-CN');
const axis = {
  type: 'value' as const, minInterval: 1,
  axisLabel: { color: '#737b83', fontSize: 11 },
  splitLine: { lineStyle: { color: '#edf0f2' } },
};
const blueGradient = {
  type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
  colorStops: [{ offset: 0, color: '#c7ddff' }, { offset: 1, color: '#83b2f5' }],
};

function roomBars(names: string[], values: number[], seriesName: string): EChartsCoreOption {
  return {
    grid: { left: 100, right: 38, top: 12, bottom: 28 },
    tooltip: { trigger: 'axis', renderMode: 'richText', axisPointer: { type: 'shadow' } },
    xAxis: { ...axis, splitNumber: 3 },
    yAxis: {
      type: 'category', inverse: true, data: names,
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { color: '#525b65', width: 84, overflow: 'truncate', fontSize: 12 },
    },
    series: [{
      type: 'bar', name: seriesName, data: values, barMaxWidth: 18,
      itemStyle: { color: blueGradient, borderRadius: 9 },
      label: { show: true, position: 'right', color: '#46566b', fontSize: 12 },
    }],
  };
}

export default function OverviewDashboard({
  overview, rooms, openReportCount, pendingPermanentCount, upstreamBusyUrl,
  onResetCooldown, onToggleDisabled, onGoReports, onGoRooms,
}: Props) {
  const topRooms = useMemo(() => [...rooms]
    .filter((room) => room.userCount > 0)
    .sort((a, b) => b.userCount - a.userCount || a.id.localeCompare(b.id)).slice(0, 5), [rooms]);
  const upstreams = overview?.metingUpstreams || [];
  const topQueues = useMemo(() => [...rooms]
    .filter((room) => room.queueLength > 0)
    .sort((a, b) => b.queueLength - a.queueLength || a.id.localeCompare(b.id)).slice(0, 5), [rooms]);
  const roomStates = useMemo(() => [
    { name: '正在播放', value: rooms.filter((r) => r.isPlaying).length },
    { name: '已选曲暂停', value: rooms.filter((r) => !r.isPlaying && r.currentSong).length },
    { name: '尚未选曲', value: rooms.filter((r) => !r.isPlaying && !r.currentSong).length },
  ], [rooms]);
  const roomOption = useMemo(() => roomBars(
    topRooms.map((r) => r.name), topRooms.map((r) => r.userCount), '在线人数',
  ), [topRooms]);
  const queueOption = useMemo(() => roomBars(
    topQueues.map((r) => r.name), topQueues.map((r) => r.queueLength), '待播歌曲',
  ), [topQueues]);
  const stateOption = useMemo(() => roomBars(
    roomStates.map((s) => s.name), roomStates.map((s) => s.value), '房间数',
  ), [roomStates]);
  const upstreamOption = useMemo<EChartsCoreOption>(() => ({
    grid: { left: 72, right: 16, top: 12, bottom: 28 },
    tooltip: { trigger: 'axis', renderMode: 'richText', axisPointer: { type: 'shadow' } },
    xAxis: { ...axis, splitNumber: 3 },
    yAxis: { type: 'category', inverse: true, data: upstreams.map((_, i) => `上游 ${i + 1}`),
      axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: '#525b65', fontSize: 12 } },
    series: [
      { name: '成功', color: blueGradient, values: upstreams.map((u) => u.okCount) },
      { name: '硬失败', color: { ...blueGradient, colorStops: [{ offset: 0, color: '#f9dce2' }, { offset: 1, color: '#efa8b6' }] }, values: upstreams.map((u) => u.failCount) },
      { name: '软失败', color: { ...blueGradient, colorStops: [{ offset: 0, color: '#e5ecf8' }, { offset: 1, color: '#becfe8' }] }, values: upstreams.map((u) => u.softFailCount || 0) },
    ].map((s) => ({ name: s.name, type: 'bar', stack: 'requests', barMaxWidth: 18,
      data: s.values, itemStyle: { color: s.color, borderRadius: 8, borderColor: '#fff', borderWidth: 1 } })),
  }), [overview?.metingUpstreams]);

  if (!overview) return <Card><AdminLoading tip="加载概览…" minHeight={240} /></Card>;

  const healthyCount = upstreams.filter((u) => u.healthy && !u.disabled).length;
  const unhealthyCount = upstreams.filter((u) => !u.healthy && !u.disabled).length;
  const disabledCount = upstreams.filter((u) => u.disabled).length;
  const totalOk = upstreams.reduce((sum, u) => sum + (u.okCount || 0), 0);
  const totalHardFail = upstreams.reduce((sum, u) => sum + (u.failCount || 0), 0);
  const totalSoftFail = upstreams.reduce((sum, u) => sum + (u.softFailCount || 0), 0);
  const hardTotal = totalOk + totalHardFail;
  const successRate = hardTotal ? `${(totalOk / hardTotal * 100).toFixed(1)}%` : '—';
  const emptyRooms = rooms.filter((r) => r.userCount === 0).length;
  const queueTotal = rooms.reduce((sum, r) => sum + r.queueLength, 0);
  const attentionCount = openReportCount + pendingPermanentCount + unhealthyCount;
  const upstreamColumns: ColumnsType<MetingUpstreamStatus> = [
    {
      title: '状态',
      width: 96,
      render: (_, up) => (
        <Badge
          status={up.disabled ? 'default' : up.healthy ? 'success' : 'error'}
          text={up.disabled ? '已禁用' : up.healthy ? '可用' : '冷却中'}
        />
      ),
    },
    {
      title: '上游地址',
      dataIndex: 'url',
      ellipsis: true,
      render: (url: string, _, index) => (
        <Space size={6} wrap>
          <Typography.Text type="secondary">上游 {index + 1}</Typography.Text>
          <Typography.Text code style={{ fontSize: 12 }}>{url}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '成功 / 失败',
      width: 140,
      align: 'right',
      render: (_, up) => (
        <Typography.Text style={{ fontSize: 13 }}>
          <span>{number(up.okCount)}</span>
          <Typography.Text type="secondary"> / </Typography.Text>
          <span style={{ color: up.failCount ? '#bd4747' : undefined }}>{number(up.failCount)}</span>
          {up.softFailCount ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {' '}(+{up.softFailCount} 软)
            </Typography.Text>
          ) : null}
        </Typography.Text>
      ),
    },
    {
      title: '冷却',
      width: 88,
      render: (_, up) => (
        !up.disabled && !up.healthy && up.cooldownRemainingSec > 0
          ? <Tag>{up.cooldownRemainingSec}s</Tag>
          : <Typography.Text type="secondary">—</Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right' as const,
      render: (_, up) => (
        <Space size="small">
          <Button
            size="small"
            disabled={upstreamBusyUrl === up.url || up.disabled || up.cooldownRemainingSec <= 0}
            loading={upstreamBusyUrl === up.url}
            onClick={() => onResetCooldown(up.url)}
          >
            重置冷却
          </Button>
          <Button
            size="small"
            type={up.disabled ? 'primary' : 'default'}
            danger={!up.disabled}
            disabled={upstreamBusyUrl === up.url}
            loading={upstreamBusyUrl === up.url}
            onClick={() => onToggleDisabled(up)}
          >
            {up.disabled ? '启 用' : '临时禁用'}
          </Button>
        </Space>
      ),
    },
  ];


  return (
    <div className="admin-overview">
      <div className="overview-title-row">
        <div>
          <h1>全站运行概览</h1>
          <p>{attentionCount ? `${number(attentionCount)} 项待关注，查看下方运营待办` : '当前无待处理上报、常驻申请或冷却中的音源'} · 可见时每 10 秒刷新</p>
        </div>
        <Button onClick={onGoRooms} icon={<ArrowRightOutlined />} iconPlacement="end">管理房间</Button>
      </div>
      {!overview.redisEnabled && <Alert type="error" showIcon title="存储依赖未就绪，请检查服务端 Redis 连接" />}

      <div className="overview-metrics">
        {[
          { label: '当前房间', icon: <SoundOutlined />, value: overview.roomCount, hint: `${emptyRooms} 间无人在线` },
          { label: '在线成员', icon: <TeamOutlined />, value: overview.onlineUsers, hint: '各房间在线成员合计' },
          { label: '正在播放', icon: <PlayCircleOutlined />, value: overview.playingRooms, hint: overview.roomCount ? `占全部房间 ${(overview.playingRooms / overview.roomCount * 100).toFixed(0)}%` : '暂无房间' },
          { label: '实时连接', icon: <ApiOutlined />, value: overview.connectedSockets, hint: 'Socket 长连接数' },
        ].map((m) => <div className="overview-metric" key={m.label}>
          <div className="overview-metric-label"><span>{m.label}</span>{m.icon}</div><strong>{number(m.value)}</strong><small>{m.hint}</small>
        </div>)}
      </div>

      <div className="overview-worklist" aria-label="运营待办">
        <button onClick={onGoReports}><span>待处理上报</span><strong className={openReportCount ? 'needs-attention' : ''}>{number(openReportCount)}</strong><ArrowRightOutlined /></button>
        <button onClick={onGoRooms}><span>待审常驻申请</span><strong className={pendingPermanentCount ? 'needs-attention' : ''}>{number(pendingPermanentCount)}</strong><ArrowRightOutlined /></button>
        <a href="#overview-upstreams"><span>音源冷却中</span><strong className={unhealthyCount ? 'needs-attention' : ''}>{number(unhealthyCount)}</strong><ArrowRightOutlined /></a>
      </div>

      {/* 两列共享 16px 间距，首尾与指标、上游表格对齐 */}
      <div className="overview-charts">
        <section className="overview-panel">
          <div className="overview-panel-heading"><div><h2>房间在线分布</h2><p>当前快照 · 在线人数最多的 5 个房间</p></div><span className="overview-unit">人</span></div>
          {topRooms.length ? <AdminChart option={roomOption} label={topRooms.map((r) => `${r.name}：${r.userCount} 人`).join('；')} />
            : <div className="overview-chart-empty">当前没有在线成员，房间有人加入后显示分布</div>}
          <div className="overview-chart-footer"><span>全站待播队列 <b>{number(queueTotal)}</b> 首</span><span>有成员的房间 <b>{number(rooms.length - emptyRooms)}</b> 间</span></div>
        </section>
        <section className="overview-panel">
          <div className="overview-panel-heading"><div><h2>音源请求结果</h2><p>当前进程累计 · 重启后重新计数</p></div><span className="overview-unit">次</span></div>
          <div className="overview-chart-legend"><span><i />成功 {number(totalOk)}</span><span><i className="legend-error" />硬失败 {number(totalHardFail)}</span><span><i className="legend-soft" />软失败 {number(totalSoftFail)}</span></div>
          {upstreams.length && (hardTotal + totalSoftFail) > 0 ? <AdminChart option={upstreamOption} label={`音源请求成功 ${totalOk} 次，硬失败 ${totalHardFail} 次，软失败 ${totalSoftFail} 次`} />
            : <div className="overview-chart-empty">{upstreams.length ? '尚无音源请求样本' : '尚未配置 Meting 音源上游'}</div>}
          <div className="overview-chart-footer"><span>请求成功率 <b>{successRate}</b></span><span>口径：成功 /（成功 + 硬失败）</span></div>
        </section>
      </div>

      <div className="overview-charts overview-charts--secondary">
        <section className="overview-panel">
          <div className="overview-panel-heading"><div><h2>房间播放状态</h2><p>当前房间列表快照 · 播放、暂停与未选曲</p></div><span className="overview-unit">间</span></div>
          {rooms.length ? <AdminChart option={stateOption} label={roomStates.map((s) => `${s.name} ${s.value} 间`).join('；')} />
            : <div className="overview-chart-empty">还没有房间，创建后显示播放状态分布</div>}
          <div className="overview-chart-footer"><span>房间总数 <b>{number(rooms.length)}</b> 间</span><span>暂停表示已选曲但未播放</span></div>
        </section>
        <section className="overview-panel">
          <div className="overview-panel-heading"><div><h2>待播队列排行</h2><p>待播歌曲最多的 5 个房间 · 不含当前播放曲目</p></div><span className="overview-unit">首</span></div>
          {topQueues.length ? <AdminChart option={queueOption} label={topQueues.map((r) => `${r.name}：${r.queueLength} 首待播`).join('；')} />
            : <div className="overview-chart-empty">所有房间的待播队列均为空</div>}
          <div className="overview-chart-footer"><span>有待播歌曲的房间 <b>{number(rooms.filter((r) => r.queueLength > 0).length)}</b> 间</span><Button type="link" size="small" onClick={onGoRooms}>查看房间</Button></div>
        </section>
      </div>

      <section className="overview-panel overview-upstreams" id="overview-upstreams">
        <div className="overview-panel-heading"><div><h2>Meting 音源上游</h2><p>按请求反馈显示状态，可展开查看最近失败记录</p></div><span className="overview-upstream-summary">{healthyCount} 可用 · {unhealthyCount} 冷却 · {disabledCount} 禁用</span></div>
        <Table
          rowKey="url" size="middle" columns={upstreamColumns} dataSource={upstreams}
          locale={{ emptyText: '尚未配置音源上游，可在系统设置中维护' }}
          pagination={upstreams.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
          scroll={{ x: 780 }}
            expandable={{
              expandedRowRender: (up) => {
                const errors: MetingUpstreamRecentError[] = up.recentErrors?.length
                  ? up.recentErrors
                  : (up.lastError
                    ? [{ at: up.lastErrorAt || 0, message: up.lastError, type: '', id: '', server: '' }]
                    : []);
                if (errors.length === 0) return null;
                return (
                  <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      最近失败记录（最多 {errors.length} 条）
                    </Typography.Text>
                    {errors.map((err, index) => (
                      <Typography.Text
                        key={`${err.at}-${index}`}
                        type="danger"
                        style={{ fontSize: 12, display: 'block' }}
                      >
                        {err.at
                          ? `${new Date(err.at).toLocaleString()} · `
                          : ''}
                        {err.roomId || err.roomName
                          ? `房间 ${err.roomName || err.roomId}`
                            + (err.roomId && err.roomName ? ` (${err.roomId})` : '')
                            + ' · '
                          : ''}
                        {err.userNickname || err.userId
                          ? `用户 ${err.userNickname || err.userId} · `
                          : ''}
                        {err.clientIp ? `IP ${err.clientIp} · ` : ''}
                        {err.server || err.type
                          ? `[${[err.server, err.type, err.id].filter(Boolean).join(' / ')}] `
                          : ''}
                        {err.message}
                      </Typography.Text>
                    ))}
                  </Space>
                );
              },
              rowExpandable: (up) => Boolean(up.lastError || up.recentErrors?.length),
            }}
        />
      </section>
      <div className="overview-runtime"><span>服务已运行 {formatUptime(overview.uptimeSec)}</span><span>进程内存 {number(overview.memoryRssMb)} MB RSS</span><span>图表仅展示当前快照与进程累计数据</span></div>
    </div>
  );
}
