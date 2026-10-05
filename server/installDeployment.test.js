import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('镜像部署使用独立目录，保留旧部署并处理目录权限失败', { skip: process.platform === 'win32' && !process.env.BASH }, () => {
  const script = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  const directorySetup = script.slice(0, script.indexOf('echo "========================================"'));
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'openmusic-install-'));
  const bash = process.env.BASH || 'bash';
  const run = (directoryOverride = '', mkdirStatus = 0) => spawnSync(bash, ['-c', `mkdir() { return ${mkdirStatus}; }
cd() { return 0; }
${directorySetup}
printf "\nDEPLOY_DIR=%s\n" "$DEPLOY_DIR"`], {
    cwd: fixtureDirectory,
    env: { ...process.env, OPENMUSIC_DEPLOY_DIR: directoryOverride },
    encoding: 'utf8',
    timeout: 10000,
  });
  try {
    const fresh = run();
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.ok(fresh.stdout.trimEnd().endsWith('DEPLOY_DIR=/opt/openmusic'));
    const custom = run('/srv/music data');
    assert.equal(custom.status, 0, custom.stderr);
    assert.ok(custom.stdout.trimEnd().endsWith('DEPLOY_DIR=/srv/music data'));
    mkdirSync(join(fixtureDirectory, 'data'));
    writeFileSync(join(fixtureDirectory, 'data/.env'), 'existing-secret');
    const legacy = run();
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.match(legacy.stdout, /检测到当前目录已有部署/);
    assert.ok(!legacy.stdout.trimEnd().endsWith('DEPLOY_DIR=/opt/openmusic'));
    assert.equal(readFileSync(join(fixtureDirectory, 'data/.env'), 'utf8'), 'existing-secret');
    const overriddenLegacy = run('/srv/explicit');
    assert.equal(overriddenLegacy.status, 0, overriddenLegacy.stderr);
    assert.ok(overriddenLegacy.stdout.trimEnd().endsWith('DEPLOY_DIR=/srv/explicit'));
    const denied = run('/unwritable', 1);
    assert.equal(denied.status, 1);
    assert.match(denied.stderr, /无法创建部署目录/);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

test('管道安装保留配置，统一启动服务，配置或引擎失败时不启动容器', { skip: process.platform === 'win32' && !process.env.BASH }, () => {
  const fixtureRoot = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/');
  const existingEnv = 'METING_ADMIN_PATH=test-entry\nMETING_ADMIN_USERNAME=test-user\nMETING_ADMIN_PASSWORD=test-password\nROOM_CREDENTIAL_ENCRYPTION_KEY=existing-key\nOPENMUSIC_NETWORK_SUBNET=172.29.80.0/24\n';
  const cases = [
    { loudness: '', configStatus: '0', engineStatus: '0', status: 0 },
    { loudness: 'y', configStatus: '0', engineStatus: '0', status: 0, repair: true },
    { loudness: 'y', configStatus: '1', engineStatus: '0', status: 1 },
    { loudness: 'y', configStatus: '0', engineStatus: '1', status: 1 },
    { loudness: 'y', configStatus: '0', engineStatus: '0', networkStatus: '1', status: 1 },
    { loudness: 'y', configStatus: '0', engineStatus: '0', loudnessStatus: '1', status: 1 },
  ];
  for (const scenario of cases) {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'openmusic-installer-'));
    try {
      writeFileSync(join(fixtureDirectory, '.env'), existingEnv);
      if (scenario.repair) mkdirSync(join(fixtureDirectory, 'data/runtimeConfig.json'), { recursive: true });
      const result = spawnSync(process.env.BASH || 'bash', ['-c', `docker() {
  printf '%s\n' "$*" >> docker.calls
  if [ "$1" = info ]; then return "$ENGINE_STATUS"; fi
  case "$*" in *"exec -T meting"*) return "$LOUDNESS_STATUS" ;; *"exec -T openmusic"*) return "$NETWORK_STATUS" ;; esac
  case "$*" in *"config --quiet"*) return "$CONFIG_STATUS" ;; esac
  return 0
}
curl() { cp "$FIXTURE_ROOT/\${4##*/}" "$3"; }
export -f docker curl
bash < "$FIXTURE_ROOT/install.sh"`], {
        cwd: fixtureDirectory,
        env: { ...process.env, FIXTURE_ROOT: fixtureRoot, OPENMUSIC_DEPLOY_DIR: '.', OPENMUSIC_ENABLE_LOUDNESS: scenario.loudness, CONFIG_STATUS: scenario.configStatus, ENGINE_STATUS: scenario.engineStatus, NETWORK_STATUS: scenario.networkStatus || '0', LOUDNESS_STATUS: scenario.loudnessStatus || '0' },
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.status, scenario.status, result.stderr);
      assert.equal(readFileSync(join(fixtureDirectory, '.env'), 'utf8'), existingEnv);
      const calls = readFileSync(join(fixtureDirectory, 'docker.calls'), 'utf8');
      if (scenario.status === 0) {
        assert.ok(calls.includes('config --quiet'));
        assert.ok(calls.includes('up -d'));
        assert.ok(calls.includes('--wait --wait-timeout 180'));
        assert.ok(calls.includes('exec -T openmusic node -e'));
        assert.equal(calls.includes('exec -T meting node -e'), scenario.loudness === 'y');
        assert.equal(calls.includes('docker-compose.loudness.yml'), scenario.loudness === 'y');
        if (scenario.repair) {
          assert.ok(calls.includes('--force-recreate'));
          assert.ok(!calls.includes('--force-recreate openmusic'));
        }
      } else if (!scenario.networkStatus && !scenario.loudnessStatus) {
        assert.ok(!calls.includes(' pull'));
        assert.ok(!calls.includes(' up'));
      } else {
        assert.match(result.stderr, scenario.loudnessStatus ? /无法访问响度服务/ : /无法访问 Meting/);
        assert.ok(!result.stdout.includes('部署成功'));
      }
      assert.ok(!readdirSync(fixtureDirectory).some(name => name.includes('.tmp.')));
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  }
});

test('所有 Compose 变体使用同一显式子网网络及服务名互访', (context) => {
  if (spawnSync('docker', ['compose', 'version'], { timeout: 10000 }).status !== 0) {
    context.skip('需要 Docker Compose CLI，不需要运行 Docker 引擎');
    return;
  }
  const fixtureDirectory = mkdtempSync(join(tmpdir(), 'openmusic-network-'));
  const envFile = join(fixtureDirectory, '.env');
  writeFileSync(envFile, '');
  const fullCompose = fileURLToPath(new URL('../docker-compose.full.yml', import.meta.url));
  const loudnessCompose = fileURLToPath(new URL('../docker-compose.loudness.yml', import.meta.url));
  const cases = [
    { files: [fileURLToPath(new URL('../docker-compose.yml', import.meta.url))], services: ['redis', 'openmusic'] },
    { files: [fullCompose], services: ['redis', 'meting', 'openmusic'] },
    { files: [fullCompose, loudnessCompose], services: ['redis', 'meting', 'openmusic', 'loudness'] },
  ];
  try {
    for (const deployment of cases) {
      for (const subnet of ['', '172.29.80.0/24']) {
        const result = spawnSync('docker', ['compose', '--project-directory', fixtureDirectory, '--env-file', envFile, ...deployment.files.flatMap(file => ['-f', file]), 'config', '--format', 'json'], {
          env: { ...process.env, COMPOSE_PROJECT_NAME: 'openmusic-network-test', OPENMUSIC_NETWORK_SUBNET: subnet, METING_ADMIN_PATH: 'test-entry', METING_ADMIN_USERNAME: 'test-user', METING_ADMIN_PASSWORD: 'test-password', ROOM_CREDENTIAL_ENCRYPTION_KEY: 'test-encryption-key' },
          encoding: 'utf8',
          timeout: 10000,
        });
        assert.equal(result.status, 0, result.stderr);
        const config = JSON.parse(result.stdout);
        assert.deepEqual(Object.keys(config.networks), ['openmusic']);
        assert.equal(config.networks.openmusic.driver, 'bridge');
        assert.equal(config.networks.openmusic.name, 'openmusic-network-test_openmusic');
        assert.equal(config.networks.openmusic.ipam.config[0].subnet, subnet || '172.30.80.0/24');
        for (const service of deployment.services) {
          const alias = { meting: 'meting-api', loudness: 'meting-api-audio-loudness' }[service];
          assert.deepEqual(config.services[service].networks, { openmusic: alias ? { aliases: [alias] } : null });
        }
        assert.equal(config.services.openmusic.environment.DOCKER_REDIS_URL, 'redis://redis:6379/0');
        if (config.services.meting) assert.equal(config.services.openmusic.environment.DOCKER_METING_URL, 'http://meting-api:3000');
        if (config.services.loudness) {
          assert.equal(config.services.meting.environment.LOUDNESS_SERVICE_URL, 'http://meting-api-audio-loudness:3100/analyze');
          assert.equal(config.services.loudness.environment.REDIS_URL, 'redis://redis:6379');
        }
      }
    }
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});
