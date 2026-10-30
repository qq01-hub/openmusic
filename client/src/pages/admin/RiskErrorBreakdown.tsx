import { Collapse, Empty, Table } from 'antd';
import { count, RiskSection, time, type AccountDetail, type AccountError } from './riskControlShared';

const OPERATIONS: Record<string, string> = { url: '播放地址', search: '音乐搜索', pic: '封面', lrc: '歌词', song: '歌曲信息', playlist: '歌单', search_playlist: '歌单搜索', fm: '推荐电台', source: '音源', media: '媒体代理', qr: '二维码', queue: '队列', rooms: '房间', favorites: '收藏', wechat: '微信代理', api: '其他接口' };
const SOURCES: Record<string, string> = { netease: '网易云', tencent: 'QQ 音乐', qq: 'QQ 音乐', kugou: '酷狗', kuwo: '酷我', migu: '咪咕', bilibili: '哔哩哔哩', qishui: '汽水' };
const operation = (row: AccountError) => `${row.method === 'OTHER' ? '' : `${row.method} `}${OPERATIONS[row.operation] || '其他接口'}${row.source ? ` · ${SOURCES[row.source] || '其他音源'}` : ''}`;
const reason = (row: AccountError) => <div className="risk-cell-stack"><span>{row.label}</span><span className="risk-secondary risk-wrap">{row.code}</span></div>;

export default function RiskErrorBreakdown({ detail }: { detail: AccountDetail }) {
  const breakdown = detail.errorBreakdown;
  return <RiskSection title="错误分析" description="仅统计已认证业务请求的 HTTP 错误，鉴权门禁拒绝与凭据失败保留独立统计，不将上游或配置错误视为用户违规，分类累计保留，最近明细最多 100 条且不超过 90 天，不记录原始报错、完整地址或凭据">
    <p className="risk-muted">已分类 {count(breakdown?.trackedTotal)} 次 · 历史未分类 {count(breakdown?.legacyUnclassified ?? detail.errors)} 次{breakdown?.sinceAt ? ` · 开始采集 ${time(breakdown.sinceAt)}` : ''}</p>
    <Table size="small" rowKey="groupId" dataSource={breakdown?.groups || []} pagination={{ defaultPageSize: 8, showSizeChanger: true, pageSizeOptions: [8, 20, 50], hideOnSinglePage: true }} scroll={{ x: 900 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分类记录，历史错误无法还原，新错误发生后开始采集" /> }} columns={[
      { title: '错误原因', width: 260, render: (_, row) => reason(row) },
      { title: '接口操作', width: 180, render: (_, row) => operation(row) },
      { title: 'HTTP', dataIndex: 'status', width: 70, render: (value: number) => value || '多种' },
      { title: '累计', dataIndex: 'count', render: count, width: 80 },
      { title: '今日', dataIndex: 'today', render: count, width: 80 },
      { title: '最近发生', dataIndex: 'lastSeenAt', render: time, width: 185 },
    ]} />
    {!!breakdown?.recent.length && <Collapse items={[{ key: 'recent-errors', label: `最近错误记录（${count(breakdown.recent.length)} 条）`, children: <Table size="small" rowKey="rowId" dataSource={breakdown.recent.map((row, index) => ({ ...row, rowId: `${row.at}:${index}` }))} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50], hideOnSinglePage: true }} scroll={{ x: 780 }} columns={[
      { title: '北京时间', dataIndex: 'at', render: time, width: 185 },
      { title: '错误原因', width: 260, render: (_, row) => reason(row) },
      { title: '接口操作', width: 180, render: (_, row) => operation(row) },
      { title: 'HTTP', dataIndex: 'status', width: 70 },
    ]} /> }]} />}
  </RiskSection>;
}
