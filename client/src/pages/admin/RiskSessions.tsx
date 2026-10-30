import { useEffect, useState } from 'react';
import { Alert, App, Button, Form, Input, Table, Tag } from 'antd';
import { adminFetch } from './utils';
import { RiskSection, time } from './riskControlShared';

type Session = { id: string; createdAt: number; expiresAt: number; deviceBound: boolean; lastIp: string; lastSeenAt: number; ipCount: number; ipChanges: number; sharedAt: number };

export default function RiskSessions({ accountId }: { accountId: string }) {
  const { modal, message } = App.useApp();
  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setItems([]);
    void adminFetch<{ items: Session[] }>(`/api/admin/risk/accounts/${encodeURIComponent(accountId)}/sessions`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setItems(data.items); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message || '会话读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountId, revision]);
  const revoke = (session: Session) => {
    let reason = '';
    modal.confirm({ title: '撤销此登录会话？', okText: '撤销', cancelText: '取消', okButtonProps: { danger: true },
      content: <Form layout="vertical"><Form.Item label="撤销原因" required><Input maxLength={200} onChange={event => { reason = event.target.value; }} /></Form.Item></Form>,
      onOk: async () => {
        if (!reason.trim()) { message.error('请填写撤销原因'); throw new Error('请输入原因'); }
        try {
          await adminFetch(`/api/admin/risk/accounts/${encodeURIComponent(accountId)}/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE', body: JSON.stringify({ reason: reason.trim() }) });
          message.success('会话已撤销'); setRevision(value => value + 1);
        } catch (reason) { message.error(reason instanceof Error ? reason.message : '撤销失败'); throw reason; }
      },
    });
  };
  return <RiskSection title="登录会话" actions={<Button loading={loading} onClick={() => setRevision(value => value + 1)}>刷新</Button>} description="仅列出升级后建立的有效会话，最多 32 个，设备证明有效的请求在 10 分钟窗口内出现至少 3 个 IP 且切换至少 6 次时标记疑似共享，不因单次换网自动封禁">
    {error && <Alert type="error" showIcon title={error} />}
    <Table<Session> size="small" rowKey="id" loading={loading} dataSource={items} scroll={{ x: 760 }} pagination={{ pageSize: 8, showSizeChanger: false }} columns={[
      { title: '设备验证', render: (_, row) => <Tag color={row.deviceBound ? 'green' : 'orange'}>{row.deviceBound ? '已绑定' : '需重登'}</Tag> },
      { title: '最近 IP', dataIndex: 'lastIp', render: value => value || '暂无请求' },
      { title: '最近请求', dataIndex: 'lastSeenAt', render: value => value ? time(value) : '—' },
      { title: '网络行为', render: (_, row) => row.sharedAt ? <Tag color="orange">疑似共享</Tag> : '正常' },
      { title: '登录时间', dataIndex: 'createdAt', render: time },
      { title: '操作', render: (_, row) => <Button type="text" danger onClick={() => revoke(row)}>撤销</Button> },
    ]} />
  </RiskSection>;
}
