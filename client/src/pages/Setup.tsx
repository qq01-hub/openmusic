import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Layout,
  Radio,
  Row,
  Space,
  Switch,
  Typography,
} from 'antd';
import AdminProviders from './admin/AdminProviders';
import { buildRecommendedNginxConfig } from '../lib/nginxRecommended';

type RedisMode = 'host' | 'url';

interface SetupResult {
  ok: boolean;
  restartRequired: boolean;
  autoRestarting?: boolean;
  adminPath: string;
  username: string;
  password: string;
}

interface DockerDefaults {
  redisUrl: string;
  metingUrl: string;
}

interface SetupStatus {
  setupTokenRequired?: boolean;
  setupAuthorized?: boolean;
  dockerDefaults?: DockerDefaults;
}

function randomAdminPath() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `/${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

async function setupFetch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || `请求失败（${response.status}）`), {
      status: response.status,
      code: data.code,
    });
  }
  return data as T;
}

function SetupPage() {
  const { message } = App.useApp();
  const initialOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const [siteUrl, setSiteUrl] = useState(initialOrigin);
  const [trustProxy, setTrustProxy] = useState(true);
  const [mode, setMode] = useState<RedisMode>('host');
  const [redisUrl, setRedisUrl] = useState('redis://127.0.0.1:6379/0');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(6379);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState(0);
  const [metingApiUrl, setMetingApiUrl] = useState('https://meting.example.com');
  const [metingApiAuth, setMetingApiAuth] = useState('');
  const [adminPath, setAdminPath] = useState(() => randomAdminPath());
  const [testing, setTesting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [redisOk, setRedisOk] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SetupResult | null>(null);
  const [appRoot, setAppRoot] = useState('/www/openmusic');
  const [showNginx, setShowNginx] = useState(true);
  const [dockerDefaults, setDockerDefaults] = useState<DockerDefaults | null>(null);
  const [setupTokenRequired, setSetupTokenRequired] = useState(false);
  const [setupAuthorized, setSetupAuthorized] = useState(false);
  const [setupToken, setSetupToken] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [authorizationError, setAuthorizationError] = useState('');
  const needsAuthorization = setupTokenRequired && !setupAuthorized;

  const refreshSetupStatus = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/setup/status', { signal });
    if (!response.ok) throw new Error('无法读取安装状态');
    const data: SetupStatus = await response.json();
    if (signal?.aborted) return;
    setSetupTokenRequired(Boolean(data.setupTokenRequired));
    setSetupAuthorized(Boolean(data.setupAuthorized));
    if (data.dockerDefaults) {
      setDockerDefaults(data.dockerDefaults);
      setMode('url');
      setRedisUrl(data.dockerDefaults.redisUrl);
      setRedisOk(true);
      if (data.dockerDefaults.metingUrl) setMetingApiUrl(data.dockerDefaults.metingUrl);
    }
    return data;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshSetupStatus(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError('无法读取安装状态，请刷新页面重试');
    });
    return () => controller.abort();
  }, [refreshSetupStatus]);

  const authorize = async () => {
    setAuthorizing(true);
    setAuthorizationError('');
    try {
      await setupFetch('/api/setup/authorize', { token: setupToken.trim() });
      setSetupToken('');
      const status = await refreshSetupStatus();
      if (!status?.setupAuthorized) throw new Error('浏览器未保存安装授权，请检查 Cookie 设置后重试');
    } catch (err) {
      setAuthorizationError(err instanceof Error ? err.message : '安装令牌验证失败');
    } finally {
      setAuthorizing(false);
    }
  };

  const handleSetupError = (err: unknown, fallback: string) => {
    const text = err instanceof Error ? err.message : fallback;
    if (err instanceof Error && (('code' in err && err.code === 'SETUP_TOKEN_REQUIRED') || ('status' in err && err.status === 403))) {
      setSetupTokenRequired(true);
      setSetupAuthorized(false);
      setAuthorizationError(text);
    } else {
      setError(text);
    }
  };

  const redis = useMemo(() => (
    mode === 'url'
      ? { mode, url: redisUrl.trim() }
      : {
          mode,
          host: host.trim(),
          port: Number(port),
          username: username.trim(),
          password,
          database: Number(database),
        }
  ), [database, host, mode, password, port, redisUrl, username]);

  const nginxConfig = useMemo(
    () => buildRecommendedNginxConfig({ appRoot }),
    [appRoot],
  );

  const copyNginx = async () => {
    try {
      await navigator.clipboard.writeText(nginxConfig);
      message.success('已复制 Nginx 配置');
    } catch {
      setError('复制失败，请手动全选复制');
    }
  };

  const copyCredentials = async () => {
    if (!result) return;
    const text = [
      `账号：${result.username}`,
      `密码：${result.password}`,
      `管理入口：${result.adminPath}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制账号信息');
    } catch {
      message.error('复制失败，请手动选中复制');
    }
  };

  const testRedis = async () => {
    setTesting(true);
    setError('');
    setRedisOk(false);
    try {
      await setupFetch('/api/setup/test-redis', { redis });
      setRedisOk(true);
      message.success('Redis 连接成功');
    } catch (err) {
      handleSetupError(err, 'Redis 连接失败');
    } finally {
      setTesting(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setError('');
    try {
      const data = await setupFetch<SetupResult>('/api/setup/complete', {
        siteUrl: siteUrl.trim(),
        trustProxy,
        adminPath: adminPath.trim(),
        metingApiUrl: metingApiUrl.trim(),
        metingApiAuth: metingApiAuth.trim(),
        redis,
      });
      setResult(data);
    } catch (err) {
      handleSetupError(err, '安装失败');
    } finally {
      setInstalling(false);
    }
  };

  if (result) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
        <Layout.Content style={{ padding: '32px 24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card>
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space>
                  <CheckCircleOutlined style={{ fontSize: 22, color: '#52c41a' }} />
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    初始化完成
                  </Typography.Title>
                </Space>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {result.autoRestarting
                    ? '配置已保存且安装入口已锁定。服务正在自动重启，请稍候刷新页面。'
                    : '配置已保存且安装入口已锁定。请重启 OpenMusic 服务后继续。'}
                </Typography.Paragraph>
                <Card size="small" styles={{ body: { background: '#fafafa' } }}>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Typography.Text>
                      账号：<Typography.Text code copyable>{result.username}</Typography.Text>
                    </Typography.Text>
                    <Typography.Text>
                      密码：<Typography.Text code copyable>{result.password}</Typography.Text>
                    </Typography.Text>
                    <Typography.Text>
                      管理入口：
                      <Typography.Text code copyable style={{ wordBreak: 'break-all' }}>
                        {result.adminPath}
                      </Typography.Text>
                    </Typography.Text>
                  </Space>
                </Card>
                <Alert
                  type="warning"
                  showIcon
                  message="账号密码仅展示这一次，请立即复制并收藏；遗失后需用 Redis 重置。"
                />
                <Space wrap>
                  <Button icon={<CopyOutlined />} onClick={() => void copyCredentials()}>
                    复制账号信息
                  </Button>
                  {result.autoRestarting ? (
                    <Button
                      type="primary"
                      icon={<ReloadOutlined />}
                      onClick={() => setTimeout(() => window.location.reload(), 0)}
                    >
                      刷新页面（等待约 5 秒）
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      icon={<ReloadOutlined />}
                      onClick={() => window.location.reload()}
                    >
                      服务重启后刷新
                    </Button>
                  )}
                </Space>
              </Space>
            </Card>

            {showNginx && (
              <Card
                title={(
                  <Space>
                    <CloudServerOutlined />
                    <span>Nginx location 片段</span>
                  </Space>
                )}
                extra={(
                  <Button type="link" size="small" onClick={() => setShowNginx(false)}>
                    关闭
                  </Button>
                )}
              >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                    把下面的 <Typography.Text code>location</Typography.Text> 放进站点已有的 server 块
                    （删掉原来的 <Typography.Text code>location /</Typography.Text> 全站反代），
                    静态直出、仅 API / WebSocket 回 Node。保存后执行
                    {' '}
                    <Typography.Text code>nginx -t && nginx -s reload</Typography.Text>。
                  </Typography.Paragraph>
                  <Form layout="vertical" style={{ marginBottom: 0 }}>
                    <Form.Item
                      label="项目根目录（按服务器实际路径修改）"
                      style={{ marginBottom: 12 }}
                    >
                      <Input
                        value={appRoot}
                        onChange={(e) => setAppRoot(e.target.value)}
                        placeholder="/www/openmusic"
                        spellCheck={false}
                        style={{ fontFamily: 'monospace' }}
                      />
                    </Form.Item>
                  </Form>
                  <Button icon={<CopyOutlined />} onClick={() => void copyNginx()}>
                    复制配置
                  </Button>
                  <Input.TextArea
                    value={nginxConfig}
                    readOnly
                    autoSize={{ minRows: 12, maxRows: 24 }}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                </Space>
              </Card>
            )}
          </Space>
        </Layout.Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      <Layout.Content style={{ padding: '32px 24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div>
            <Space align="start" size={12}>
              <SafetyCertificateOutlined style={{ fontSize: 28, color: '#1677ff', marginTop: 2 }} />
              <div>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  OpenMusic 首次部署
                </Typography.Title>
                <Typography.Text type="secondary">
                  填写 Redis 与音源，其余安全信息自动生成，无需手改配置文件
                </Typography.Text>
              </div>
            </Space>
          </div>

          {needsAuthorization && (
            <Card title="一次性安装令牌">
              <Form layout="vertical" onFinish={() => void authorize()}>
                <Form.Item
                  label="安装令牌"
                  htmlFor="setup-token"
                  extra="可在部署目录的 data/.env 或服务端首启日志中查看令牌"
                >
                  <Input.Password
                    id="setup-token"
                    value={setupToken}
                    onChange={(event) => setSetupToken(event.target.value)}
                    autoComplete="off"
                  />
                </Form.Item>
                {authorizationError && (
                  <Alert type="error" message={authorizationError} showIcon style={{ marginBottom: 16 }} />
                )}
                <Button type="primary" htmlType="submit" disabled={!setupToken.trim()} loading={authorizing}>
                  验证令牌
                </Button>
              </Form>
            </Card>
          )}

          <Card
            title={(
              <Space>
                <DatabaseOutlined />
                <span>Redis 持久化</span>
              </Space>
            )}
          >
            <Form layout="vertical" requiredMark={false} disabled={needsAuthorization}>
              {dockerDefaults && (
                <Alert
                  type="success"
                  showIcon
                  message="已通过 Docker 环境自动配置 Redis"
                  style={{ marginBottom: 16 }}
                />
              )}
              <Form.Item label="配置方式" style={{ marginBottom: 16 }}>
                <Radio.Group
                  value={mode}
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                    { value: 'host', label: '分项配置' },
                    { value: 'url', label: '连接 URL' },
                  ]}
                  onChange={(e) => {
                    setMode(e.target.value as RedisMode);
                    setRedisOk(false);
                  }}
                />
              </Form.Item>

              {mode === 'url' ? (
                <Form.Item label="Redis URL" style={{ marginBottom: 16 }}>
                  <Input
                    value={redisUrl}
                    onChange={(e) => {
                      setRedisUrl(e.target.value);
                      setRedisOk(false);
                    }}
                    placeholder="redis://user:password@127.0.0.1:6379/0"
                    spellCheck={false}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Form.Item>
              ) : (
                <Row gutter={12}>
                  <Col xs={24} sm={12}>
                    <Form.Item label="主机" style={{ marginBottom: 16 }}>
                      <Input
                        value={host}
                        onChange={(e) => {
                          setHost(e.target.value);
                          setRedisOk(false);
                        }}
                        placeholder="127.0.0.1"
                        spellCheck={false}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label="端口" style={{ marginBottom: 16 }}>
                      <InputNumber
                        value={port}
                        onChange={(value) => {
                          setPort(Number(value) || 6379);
                          setRedisOk(false);
                        }}
                        min={1}
                        max={65535}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label="账号（可选）" style={{ marginBottom: 16 }}>
                      <Input
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          setRedisOk(false);
                        }}
                        autoComplete="off"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label="密码（可选）" style={{ marginBottom: 16 }}>
                      <Input.Password
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setRedisOk(false);
                        }}
                        autoComplete="new-password"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item label="数据库编号" style={{ marginBottom: 16 }}>
                      <InputNumber
                        value={database}
                        onChange={(value) => {
                          setDatabase(Number(value) || 0);
                          setRedisOk(false);
                        }}
                        min={0}
                        max={255}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}

              <Button
                onClick={() => void testRedis()}
                loading={testing}
                type={redisOk ? 'default' : 'primary'}
                ghost={redisOk}
                icon={redisOk ? <CheckCircleOutlined /> : <DatabaseOutlined />}
              >
                {redisOk ? 'Redis 连接成功' : '测试 Redis 连接'}
              </Button>
            </Form>
          </Card>

          <Card
            title={(
              <Space>
                <SoundOutlined />
                <span>音源（Meting API）</span>
              </Space>
            )}
          >
            <Form layout="vertical" requiredMark={false} disabled={needsAuthorization}>
              {dockerDefaults?.metingUrl && (
                <Alert
                  type="success"
                  showIcon
                  message="已通过 Docker 环境自动配置 Meting 地址"
                  style={{ marginBottom: 16 }}
                />
              )}
              <Form.Item label="Meting 地址" style={{ marginBottom: 16 }}>
                <Input
                  value={metingApiUrl}
                  onChange={(e) => setMetingApiUrl(e.target.value)}
                  placeholder="https://meting.example.com"
                  spellCheck={false}
                />
              </Form.Item>
              <Form.Item label="Meting 令牌（auth，可选）" style={{ marginBottom: 8 }}>
                <Input
                  value={metingApiAuth}
                  onChange={(e) => setMetingApiAuth(e.target.value)}
                  autoComplete="off"
                />
              </Form.Item>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                多个上游用英文逗号分隔自动负载均衡；留空可稍后在管理后台「运行配置」里填写。
                七牛 / 接口盒子等可选服务也在后台配置。
              </Typography.Text>
            </Form>
          </Card>

          <Card
            title={(
              <Space>
                <SafetyCertificateOutlined />
                <span>站点与安全</span>
              </Space>
            )}
          >
            <Form layout="vertical" requiredMark={false} disabled={needsAuthorization}>
              <Form.Item label="站点访问地址" style={{ marginBottom: 16 }}>
                <Input
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://music.example.com"
                  spellCheck={false}
                />
              </Form.Item>
              <Form.Item label="管理面板入口（已随机生成）" style={{ marginBottom: 16 }}>
                <Input
                  value={adminPath}
                  onChange={(e) => setAdminPath(e.target.value)}
                  spellCheck={false}
                  style={{ fontFamily: 'monospace' }}
                  suffix={(
                    <Button
                      type="text"
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => setAdminPath(randomAdminPath())}
                      aria-label="重新生成管理入口"
                    />
                  )}
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: 8 }}>
                <Space>
                  <Switch checked={trustProxy} onChange={setTrustProxy} />
                  <Typography.Text>使用 Nginx / 宝塔 / CDN 反向代理（推荐开启）</Typography.Text>
                </Space>
              </Form.Item>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                将自动生成会话签名密钥、随机管理员账号密码、写入配置并锁定安装入口。
              </Typography.Text>
            </Form>
          </Card>

          {error && (
            <Alert type="error" message={error} showIcon closable onClose={() => setError('')} />
          )}

          <Button
            type="primary"
            size="large"
            block
            loading={installing}
            disabled={needsAuthorization || !redisOk || !adminPath.trim()}
            onClick={() => void install()}
          >
            一键创建并保存配置
          </Button>
        </Space>
      </Layout.Content>
    </Layout>
  );
}

export default function Setup() {
  return (
    <AdminProviders>
      <SetupPage />
    </AdminProviders>
  );
}
