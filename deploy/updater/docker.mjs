import http from 'node:http';
import { hostname } from 'node:os';
import { updateError } from './core.mjs';

const IMAGE = 'w3126197382/openmusic';
export class DockerEngine {
  constructor(socketPath = '/var/run/docker.sock') { this.socketPath = socketPath; }
  request(method, route, body, timeout = 60_000) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : undefined;
      const request = http.request({
        socketPath: this.socketPath, method, path: route,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
      }, response => {
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) request.destroy(new Error('Docker response too large'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(updateError('UPDATE_DOCKER_FAILED', `Docker 操作失败（HTTP ${response.statusCode}）`, 502));
          }
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            if (route.startsWith('/images/create')) {
              for (const line of text.trim().split('\n').filter(Boolean)) {
                if (JSON.parse(line).error) throw new Error('pull failed');
              }
              return resolve({});
            }
            resolve(text ? JSON.parse(text) : {});
          } catch { reject(updateError('UPDATE_DOCKER_FAILED', '镜像拉取失败或 Docker 返回无效响应', 502)); }
        });
      });
      const timer = setTimeout(() => request.destroy(new Error('Docker timeout')), timeout);
      request.on('close', () => clearTimeout(timer));
      request.on('error', reject);
      request.end(data);
    });
  }
}

export async function findApplication(engine) {
  const self = await engine.request('GET', `/containers/${encodeURIComponent(hostname())}/json`);
  const project = self.Config.Labels?.['com.docker.compose.project'];
  if (!project || self.Config.Labels?.['com.docker.compose.service'] !== 'updater') {
    throw updateError('UPDATE_DOCKER_TARGET', '升级服务必须通过同一 Compose 项目启动');
  }
  const filters = encodeURIComponent(JSON.stringify({ label: [
    `com.docker.compose.project=${project}`, 'com.docker.compose.service=openmusic',
  ] }));
  const containers = await engine.request('GET', `/containers/json?filters=${filters}`);
  if (containers.length !== 1) throw updateError('UPDATE_DOCKER_TARGET', '无法唯一识别正在运行的应用容器');
  const target = await engine.request('GET', `/containers/${containers[0].Id}/json`);
  if (!target.Config.Image.startsWith(`${IMAGE}:`) && !target.Config.Image.startsWith(`${IMAGE}@sha256:`)) {
    throw updateError('UPDATE_DOCKER_TARGET', '当前容器未使用官方 OpenMusic 镜像');
  }
  if (JSON.stringify(target.Config.Cmd) !== JSON.stringify(['node', 'index.js'])
    || JSON.stringify(target.Config.Entrypoint) !== JSON.stringify(['docker-entrypoint.sh'])) {
    throw updateError('UPDATE_DOCKER_UNSUPPORTED', '自定义容器启动命令不支持自动升级');
  }
  return target;
}

export function replacementConfig(target, image, jobId, imageEnv = []) {
  if (target.HostConfig.AutoRemove || target.HostConfig.NetworkMode.startsWith('container:')) {
    throw updateError('UPDATE_DOCKER_UNSUPPORTED', '该容器配置不支持自动升级');
  }
  // Mounts 使用实际挂载名，匿名卷也保留原数据，不申请新卷
  const mounts = target.Mounts.map(mount => ({
    Type: mount.Type, Source: mount.Type === 'volume' ? mount.Name : mount.Source,
    Target: mount.Destination, ReadOnly: !mount.RW,
    ...(mount.Type === 'bind' && mount.Propagation ? { BindOptions: { Propagation: mount.Propagation } } : {}),
  }));
  const endpoints = Object.fromEntries(Object.entries(target.NetworkSettings.Networks).map(([network, config]) => [
    network, { Aliases: (config.Aliases || []).filter(alias => alias !== target.Id.slice(0, 12)),
      ...(config.IPAMConfig ? { IPAMConfig: config.IPAMConfig } : {}) },
  ]));
  // 执行入口使用新镜像默认值，保留原部署的环境变量、端口、资源限制与网络
  const { Hostname: _hostname, Image: _image, Cmd: _cmd, Entrypoint: _entrypoint, ...config } = target.Config;
  const host = { ...target.HostConfig, Binds: null, Mounts: mounts };
  return {
    ...config, Image: image, Labels: { ...config.Labels, 'openmusic.update.job': jobId },
    Env: [...(config.Env || []).filter(value => !value.startsWith('OPENMUSIC_RELEASE_VERSION=')),
      ...imageEnv.filter(value => value.startsWith('OPENMUSIC_RELEASE_VERSION='))],
    HostConfig: host, NetworkingConfig: { EndpointsConfig: endpoints },
  };
}

export function dockerExecutor(engine, health) {
  return async (release, journal, checkpoint) => {
    const target = await findApplication(engine);
    const image = `${IMAGE}:${release.tag}`;
    await checkpoint('正在拉取官方 Docker 镜像，主站仍保持运行');
    await engine.request('POST', `/images/create?fromImage=${encodeURIComponent(IMAGE)}&tag=${encodeURIComponent(release.tag)}`, undefined, 10 * 60_000);
    const pulled = await engine.request('GET', `/images/${encodeURIComponent(image)}/json`);
    if (pulled.Id === target.Image) return;
    const name = target.Name.replace(/^\//, '');
    const jobId = `${Date.now()}-${target.Id.slice(0, 8)}`;
    Object.assign(journal, { kind: 'docker', oldId: target.Id, oldImage: target.Image,
      name, backupName: `${name}-backup-${jobId}`, jobId });
    await checkpoint('正在保留旧容器并切换新镜像');
    await engine.request('POST', `/containers/${target.Id}/stop?t=30`);
    await engine.request('POST', `/containers/${target.Id}/rename?name=${encodeURIComponent(journal.backupName)}`);
    const created = await engine.request('POST', `/containers/create?name=${encodeURIComponent(name)}`,
      replacementConfig(target, `${IMAGE}:${release.tag}`, jobId, pulled.Config?.Env));
    journal.newId = created.Id;
    await checkpoint('正在启动新容器并检查服务响应');
    await engine.request('POST', `/containers/${created.Id}/start`);
    await health();
    const active = await engine.request('GET', `/containers/${created.Id}/json`);
    if (!active.State.Running || active.Image !== pulled.Id) throw new Error('container not running');
  };
}

export async function rollbackDocker(engine, journal) {
  if (journal.kind !== 'docker') return;
  const { oldId, name, jobId } = journal;
  const previous = await engine.request('GET', `/containers/${oldId}/json`);
  // 创建容器后进程中断时 newId 可能尚未落盘，通过固定标签识别本次新容器
  const filters = encodeURIComponent(JSON.stringify({ label: [`openmusic.update.job=${jobId}`] }));
  const created = await engine.request('GET', `/containers/json?all=1&filters=${filters}`);
  for (const container of created) {
    if (container.Id !== oldId) await engine.request('DELETE', `/containers/${container.Id}?force=1`);
  }
  if (previous.Name !== `/${name}`) {
    await engine.request('POST', `/containers/${oldId}/rename?name=${encodeURIComponent(name)}`);
  }
  if (!previous.State.Running) await engine.request('POST', `/containers/${oldId}/start`);
}

export async function cleanupDocker(engine, journal) {
  if (journal.kind !== 'docker') return;
  const filters = encodeURIComponent(JSON.stringify({ id: [journal.oldId], status: ['exited'] }));
  const old = await engine.request('GET', `/containers/json?all=1&filters=${filters}`);
  if (old.some(item => item.Id === journal.oldId)) {
    // 成功状态已落盘后才删除停用容器，不删除镜像或数据卷
    await engine.request('DELETE', `/containers/${journal.oldId}`);
  }
}
