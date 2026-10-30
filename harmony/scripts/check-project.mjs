import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const clientRequire = createRequire(new URL('../../client/package.json', import.meta.url));
const configFiles = [
  'build-profile.json5', 'oh-package.json5', 'hvigor/hvigor-config.json5',
  'AppScope/app.json5', 'AppScope/resources/base/element/string.json',
  'entry/build-profile.json5', 'entry/oh-package.json5', 'entry/src/main/module.json5',
  'entry/src/main/resources/base/profile/main_pages.json',
  'entry/src/main/resources/base/element/string.json',
  'entry/src/main/resources/base/element/color.json',
];

function insideFile(base, relative, extension) {
  if (typeof relative !== 'string' || !relative) return false;
  const absolute = path.resolve(base, relative);
  const local = path.relative(base, absolute);
  return local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local)
    && absolute.endsWith(extension) && fs.existsSync(absolute) && fs.statSync(absolute).isFile();
}

function loadPolicy(ts) {
  const source = fs.readFileSync(path.join(projectRoot, 'entry/src/main/ets/security/NavigationPolicy.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  // 运行本工程策略，不复制另一套 Origin 校验规则，也不加载传入目录中的脚本
  new Function('exports', 'module', output)(module.exports, module);
  return module.exports.NavigationPolicy;
}

export function checkProject(root = projectRoot, { requireSite = false } = {}) {
  const errors = [];
  const warnings = [];
  let JSON5;
  let NavigationPolicy;
  try {
    JSON5 = clientRequire('json5');
    NavigationPolicy = loadPolicy(clientRequire('typescript'));
  } catch {
    return { errors: ['无法加载预检依赖或导航策略，请先安装 client 依赖并检查源码'], warnings };
  }
  const configs = new Map();
  for (const name of configFiles) {
    try {
      const value = JSON5.parse(fs.readFileSync(path.join(root, name), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid config');
      configs.set(name, value);
    } catch {
      // 解析器错误可能包含签名口令或 URL，诊断只输出已知的相对文件名
      errors.push(`配置不可读取或格式无效：${name}`);
    }
  }
  if (errors.length) return { errors, warnings };

  const module = configs.get('entry/src/main/module.json5').module;
  const abilities = module?.abilities;
  if (!Array.isArray(abilities) || !abilities.some(a => a?.name === module.mainElement)) {
    errors.push('模块缺少有效的主能力入口');
  } else {
    for (const ability of abilities) {
      if (!insideFile(path.join(root, 'entry/src/main'), ability?.srcEntry, '.ets')) {
        errors.push('能力入口不存在或超出模块目录');
      }
    }
  }
  if (!Array.isArray(module?.requestPermissions) ||
    !module.requestPermissions.some(p => p?.name === 'ohos.permission.INTERNET')) {
    errors.push('模块未声明网络权限');
  }
  if (!Array.isArray(module?.requestPermissions) ||
    !module.requestPermissions.some(p => p?.name === 'ohos.permission.KEEP_BACKGROUND_RUNNING')) {
    errors.push('模块未声明后台运行权限');
  }
  const mainAbility = Array.isArray(abilities) ? abilities.find(a => a?.name === module.mainElement) : undefined;
  if (!Array.isArray(mainAbility?.backgroundModes) || !mainAbility.backgroundModes.includes('audioPlayback')) {
    errors.push('主能力未声明 audioPlayback 后台模式');
  }
  const pages = configs.get('entry/src/main/resources/base/profile/main_pages.json').src;
  if (!Array.isArray(pages) || !pages.length || pages.some(page =>
    typeof page !== 'string' || !insideFile(path.join(root, 'entry/src/main/ets'), `${page}.ets`, '.ets'))) {
    errors.push('页面声明为空、越界或引用不存在的页面');
  }
  const products = configs.get('build-profile.json5').app?.products;
  if (!Array.isArray(products) || !products.some(p =>
    p?.name === 'default' && p.runtimeOS === 'HarmonyOS' && p.compatibleSdkVersion)) {
    errors.push('缺少 HarmonyOS default 产品或兼容 SDK 配置');
  }
  const target = Array.isArray(products) ? products.find(p => p?.name === 'default')?.targetSdkVersion : undefined;
  const targetApi = typeof target === 'number' ? target : Number(String(target).match(/\((\d+)\)$/)?.[1]);
  if (!(targetApi >= 18)) errors.push('系统媒体集成需要 API 18 或以上目标 SDK，兼容版本仍可保留 API 12');

  const resources = new Set(['$profile:main_pages']);
  for (const config of configs.values()) {
    for (const kind of ['string', 'color']) {
      if (Array.isArray(config[kind])) {
        for (const item of config[kind]) {
          if (typeof item?.name === 'string') resources.add(`$${kind}:${item.name}`);
          else errors.push('资源声明缺少有效名称');
        }
      }
    }
  }
  for (const dir of ['AppScope/resources/base/media', 'entry/src/main/resources/base/media']) {
    const absolute = path.join(root, dir);
    if (fs.existsSync(absolute)) {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isFile()) resources.add(`$media:${path.parse(entry.name).name}`);
      }
    }
  }
  function visit(value) {
    if (typeof value === 'string' && /^\$(string|color|media|profile):[a-zA-Z0-9_]+$/.test(value)) {
      if (!resources.has(value)) errors.push(`资源引用不存在：${value}`);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  }
  for (const config of configs.values()) visit(config);

  const strings = configs.get('entry/src/main/resources/base/element/string.json').string;
  const sites = Array.isArray(strings) ? strings.filter(item => item?.name === 'server_url') : [];
  if (sites.length !== 1 || typeof sites[0].value !== 'string') {
    errors.push('必须配置唯一的 server_url 字符串资源');
  } else if (sites[0].value === '') {
    (requireSite ? errors : warnings).push('server_url 未配置，应用只会显示配置提示，不能用于发布');
  } else if (!new NavigationPolicy(sites[0].value, raw => new URL(raw)).origin) {
    errors.push('server_url 必须是不含凭据、路径、查询参数或片段的 HTTPS Origin');
  }
  return { errors, warnings };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--require-site')) {
    console.error('用法：node harmony/scripts/check-project.mjs [--require-site]');
    return 1;
  }
  const result = checkProject(projectRoot, { requireSite: args.includes('--require-site') });
  for (const message of result.warnings) console.warn(`WARN ${message}`);
  for (const message of result.errors) console.error(`FAIL ${message}`);
  if (result.errors.length) return 1;
  const ts = clientRequire('typescript');
  const sourceFiles = ['security/NavigationPolicy.ts', 'media/MediaProtocol.ts', 'media/MediaCoordinator.ts']
    .map(name => path.join(projectRoot, 'entry/src/main/ets', name));
  const program = ts.createProgram(sourceFiles, {
    strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    console.error(ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: name => name,
      getCurrentDirectory: () => projectRoot,
      getNewLine: () => '\n',
    }));
    return 1;
  }
  console.log('PASS 工程配置、后台权限、资源引用、站点规则、导航与媒体策略类型检查');
  console.log('此预检不执行 ArkTS/Hvigor 编译、签名、安装或真机测试');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
