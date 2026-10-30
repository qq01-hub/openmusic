import { useEffect, useState } from 'react';
import {
  GithubOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App, Button, Card, Divider, Form, Input, Layout, Space, Typography } from 'antd';
import { adminFetch } from './utils';
import { LinuxDoIcon } from './brandIcons';

const LINUXDO_LOGIN_ERRORS: Record<string, string> = {
  denied: '这个 Linux.do 账号还没有绑定管理员，请先用账号密码登录后在后台绑定',
  locked: '登录尝试过于频繁，请稍后再试',
  error: 'Linux.do 登录失败，请稍后再试',
  expired: '登录已过期，请重试',
};

const GITHUB_LOGIN_ERRORS: Record<string, string> = {
  denied: '这个 GitHub 账号还没有绑定管理员，请先用账号密码登录后在后台绑定',
  locked: '登录尝试过于频繁，请稍后再试',
  error: 'GitHub 登录失败，请稍后再试',
  expired: '登录已过期，请重试',
};

export default function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);

  useEffect(() => {
    void adminFetch<{ enabled: boolean }>('/api/admin/linuxdo/status')
      .then((status) => setLinuxdoEnabled(Boolean(status.enabled)))
      .catch(() => setLinuxdoEnabled(false));
    void adminFetch<{ enabled: boolean }>('/api/admin/github/status')
      .then((status) => setGithubEnabled(Boolean(status.enabled)))
      .catch(() => setGithubEnabled(false));

    const url = new URL(window.location.href);
    const linuxdoResult = url.searchParams.get('linuxdo');
    const githubResult = url.searchParams.get('github');
    if (linuxdoResult && linuxdoResult !== 'login_ok') {
      message.error(LINUXDO_LOGIN_ERRORS[linuxdoResult] || 'Linux.do 登录失败');
    } else if (githubResult && githubResult !== 'login_ok') {
      message.error(GITHUB_LOGIN_ERRORS[githubResult] || 'GitHub 登录失败');
    }
    if (linuxdoResult || githubResult) {
      url.searchParams.delete('linuxdo');
      url.searchParams.delete('github');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, [message]);

  const submit = async (values: { username: string; password: string }) => {
    if (busy) return;
    setBusy(true);
    try {
      await adminFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: values.username.trim(), password: values.password }),
      });
      onLoggedIn();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      <Layout.Content
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <Card style={{ width: '100%', maxWidth: 400 }} variant="borderless">
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <Space>
              <SafetyCertificateOutlined style={{ fontSize: 22, color: '#1677ff' }} />
              <Typography.Title level={4} style={{ margin: 0 }}>
                OpenMusic管理后台
              </Typography.Title>
            </Space>
            <Typography.Text type="secondary">输入管理员账号密码登录</Typography.Text>
            <Form layout="vertical" onFinish={submit} requiredMark={false}>
              <Form.Item
                name="username"
                rules={[{ required: true, message: '请输入管理员账号' }]}
              >
                <Input
                  prefix={<UserOutlined />}
                  placeholder="管理员账号"
                  autoFocus
                  autoComplete="username"
                  spellCheck={false}
                />
              </Form.Item>
              <Form.Item
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="密码"
                  autoComplete="current-password"
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: (linuxdoEnabled || githubEnabled) ? 0 : undefined }}>
                <Button type="primary" htmlType="submit" block loading={busy}>
                  登录
                </Button>
              </Form.Item>
            </Form>
            {(linuxdoEnabled || githubEnabled) && <Divider style={{ margin: 0 }}>或</Divider>}
            {linuxdoEnabled && (
              <Button
                block
                icon={<LinuxDoIcon />}
                onClick={() => { window.location.href = '/api/admin/linuxdo/login/start'; }}
              >
                使用 Linux.do 登录
              </Button>
            )}
            {githubEnabled && (
              <Button
                block
                icon={<GithubOutlined />}
                onClick={() => { window.location.href = '/api/admin/github/login/start'; }}
              >
                使用 GitHub 登录
              </Button>
            )}
          </Space>
        </Card>
      </Layout.Content>
    </Layout>
  );
}
