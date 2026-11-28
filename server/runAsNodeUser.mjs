import { fileURLToPath } from 'node:url';

if (process.getuid?.() === 0) {
  try {
    process.setgroups([1000, 0]);
    process.setgid(1000);
    process.setuid(1000);
  } catch (error) {
    console.warn(`OpenMusic 容器降权失败，将以 UID ${process.getuid()} / GID ${process.getgid()} 继续启动（${error.code || error.message}）`);
  }
}

process.argv[1] = fileURLToPath(new URL('./index.js', import.meta.url));
await import('./index.js');
