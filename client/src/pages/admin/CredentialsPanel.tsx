import { useEffect, useRef, useState } from 'react';
import { GithubOutlined, KeyOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Divider, Input, Row, Space, Tag, Typography } from 'antd';
import { adminFetch } from './utils';
import { LinuxDoIcon } from './brandIcons';

interface LinuxdoAdminBinding {
  id: string;
  username: string;
  avatarUrl: string;
  boundAt: number;
}

type GithubAdminBinding = LinuxdoAdminBinding;

export default function CredentialsPanel({
  adminUsername,
  persisted,
  forced,
  bare,
  onError,
  onSaved,
}: {
  adminUsername: string;
  persisted: boolean;
  forced?: boolean;
  bare?: boolean;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [username, setUsername] = useState(adminUsername);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const touchedRef = useRef(false);
  const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
  const [linuxdoBound, setLinuxdoBound] = useState<LinuxdoAdminBinding | null>(null);
  const [linuxdoUnbinding, setLinuxdoUnbinding] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [githubBound, setGithubBound] = useState<GithubAdminBinding | null>(null);
  const [githubUnbinding, setGithubUnbinding] = useState(false);
  useEffect(() => {
    if (!touchedRef.current) setUsername(adminUsername);
  }, [adminUsername]);

  useEffect(() => {
    void adminFetch<{ enabled: boolean; bound: LinuxdoAdminBinding | null }>('/api/admin/linuxdo/status')
      .then((status) => {
        setLinuxdoEnabled(status.enabled);
        setLinuxdoBound(status.bound);
      })
      .catch(() => setLinuxdoEnabled(false));
    void adminFetch<{ enabled: boolean; bound: GithubAdminBinding | null }>('/api/admin/github/status')
      .then((status) => {
        setGithubEnabled(status.enabled);
        setGithubBound(status.bound);
      })
      .catch(() => setGithubEnabled(false));

    const url = new URL(window.location.href);
    const linuxdoResult = url.searchParams.get('linuxdo');
    const githubResult = url.searchParams.get('github');
    const showBindResult = (provider: string, result: string) => {
      if (result === 'bound') message.success(`已绑定 ${provider} 账号`);
      else if (result === 'expired') message.error('会话已过期，请重新登录后绑定');
      else if (result === 'error') message.error(`绑定 ${provider} 账号失败，请稍后再试`);
    };
    if (linuxdoResult) showBindResult('Linux.do', linuxdoResult);
    if (githubResult) showBindResult('GitHub', githubResult);
    if (linuxdoResult || githubResult) {
      url.searchParams.delete('linuxdo');
      url.searchParams.delete('github');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, [message]);

  const unbindLinuxdo = async () => {
    setLinuxdoUnbinding(true);
    try {
      await adminFetch('/api/admin/linuxdo/unbind', { method: 'POST' });
      setLinuxdoBound(null);
      message.success('已解绑 Linux.do 账号');
    } catch (err) {
      onError(err instanceof Error ? err.message : '解绑失败');
    } finally {
      setLinuxdoUnbinding(false);
    }
  };

  const unbindGithub = async () => {
    setGithubUnbinding(true);
    try {
      await adminFetch('/api/admin/github/unbind', { method: 'POST' });
      setGithubBound(null);
      message.success('已解绑 GitHub 账号');
    } catch (err) {
      onError(err instanceof Error ? err.message : '解绑失败');
    } finally {
      setGithubUnbinding(false);
    }
  };

  const save = async () => {
    if (saving) return;
    if (password !== passwordConfirm) {
      onError('两次输入的新密码不一致');
      return;
    }
    if (password === '123456') {
      onError('不能继续使用默认密码');
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch<{ username: string; persisted: boolean }>('/api/admin/credentials', {
        method: 'PUT',
        body: JSON.stringify({ username: username.trim(), password, currentPassword }),
      });
      touchedRef.current = false;
      setPassword('');
      setPasswordConfirm('');
      setCurrentPassword('');
      message.success(`已保存到 Redis（${res.username}），其它已登录会话已失效`);
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : '修改账号密码失败');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            账号（2–32 位字母数字或 _ . @ -）
          </Typography.Text>
          <Input
            value={username}
            onChange={(e) => {
              touchedRef.current = true;
              setUsername(e.target.value);
            }}
            autoComplete="username"
            spellCheck={false}
          />
        </Col>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            当前密码
          </Typography.Text>
          <Input.Password
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Col>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            新密码（8–64 位）
          </Typography.Text>
          <Input.Password
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Col>
        <Col xs={24} sm={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
            确认新密码
          </Typography.Text>
          <Input.Password
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Col>
      </Row>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          onClick={() => void save()}
          loading={saving}
          disabled={!username.trim() || password.length < 8 || !currentPassword}
        >
          保存账号密码
        </Button>
      </div>
    </Space>
  );

  const oauthSections = (
    <>
      {linuxdoEnabled && (
        <>
          <Divider style={{ margin: '20px 0 16px' }} />
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            Linux.do 登录
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            绑定后可用该账号登录后台
          </Typography.Paragraph>
          {linuxdoBound ? (
            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
              <span>
                已绑定：{linuxdoBound.username || linuxdoBound.id}
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {new Date(linuxdoBound.boundAt).toLocaleString()}
                </Typography.Text>
              </span>
              <Button danger loading={linuxdoUnbinding} onClick={() => void unbindLinuxdo()}>
                解绑
              </Button>
            </Space>
          ) : (
            <Button
              icon={<LinuxDoIcon />}
              onClick={() => { window.location.href = '/api/admin/linuxdo/bind/start'; }}
            >
              绑定 Linux.do 账号
            </Button>
          )}
        </>
      )}
      {githubEnabled && (
        <>
          <Divider style={{ margin: '20px 0 16px' }} />
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            GitHub 登录
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            绑定后可用该账号登录后台
          </Typography.Paragraph>
          {githubBound ? (
            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
              <span>
                已绑定：{githubBound.username || githubBound.id}
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {new Date(githubBound.boundAt).toLocaleString()}
                </Typography.Text>
              </span>
              <Button danger loading={githubUnbinding} onClick={() => void unbindGithub()}>
                解绑
              </Button>
            </Space>
          ) : (
            <Button
              icon={<GithubOutlined />}
              onClick={() => { window.location.href = '/api/admin/github/bind/start'; }}
            >
              绑定 GitHub 账号
            </Button>
          )}
        </>
      )}
    </>
  );

  if (bare) {
    return (
      <>
        {body}
        {oauthSections}
      </>
    );
  }

  return (
    <Card
      title={(
        <Space>
          <KeyOutlined />
          <span>管理员账号</span>
          {forced && <Tag color="warning">必须修改</Tag>}
          <Tag color={persisted ? 'success' : 'error'} style={{ marginLeft: 'auto' }}>
            {persisted ? 'Redis 持久化' : 'Redis 未就绪'}
          </Tag>
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        新密码至少 8 位；修改后其它会话立即失效
      </Typography.Paragraph>
      {body}
      {oauthSections}
    </Card>
  );
}
