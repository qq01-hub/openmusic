import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const reference = process.argv[2];
if (!reference) throw new Error('Pass the directory containing the pinned upstream source files');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = {};
function read(name) {
  const text = fs.readFileSync(path.join(reference, name), 'utf8');
  sources[name] = crypto.createHash('sha256').update(text).digest('hex');
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function literal(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((entry) => {
    if (!ts.isPropertyAssignment(entry) || !('text' in entry.name)) throw new Error('Nonliteral property');
    return [entry.name.text, literal(entry.initializer)];
  }));
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Set') {
    return literal(node.arguments[0]);
  }
  throw new Error(`Nonliteral upstream data: ${node.getText().slice(0, 60)}`);
}
const renderer = read('renderer-pet.js');
const wanted = ['ANIM', 'CHARS', 'SPRITE', 'SPRITE_MAP', 'ACTIONS', 'WHISPERS', 'NO_MIRROR'];
const constants = {};
for (const statement of renderer.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && wanted.includes(declaration.name.text)) {
      constants[declaration.name.text] = literal(declaration.initializer);
    }
  }
}
if (Object.keys(constants).length !== wanted.length) throw new Error('Upstream renderer data is incomplete');
const index = read('anims-index.js');
let animations;
for (const statement of index.statements) {
  if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
    && statement.expression.left.getText(index) === 'window.PET_ANIMS') animations = literal(statement.expression.right);
}
if (!Array.isArray(animations) || !animations.length) throw new Error('Upstream animation index is missing');
constants.VIDEO_NAMES = animations;
// 形象选择器使用官网专门的缩略图，不能用运行时待机池替代
const previewHtml = fs.readFileSync(path.join(reference, 'reference-web/index.html'), 'utf8');
sources['web/index.html'] = crypto.createHash('sha256').update(previewHtml).digest('hex');
const previewEntries = [...previewHtml.matchAll(/<button\b[^>]*data-character="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
if (previewEntries.length !== Object.keys(constants.CHARS).length) throw new Error('Upstream character previews are incomplete');
constants.CHARACTER_PREVIEWS = Object.fromEntries(previewEntries.map(([, id, body]) => {
  if (!(id in constants.CHARS)) throw new Error('Unknown upstream preview character');
  const image = body.match(/<img\b[^>]*src="([^"]+)"/)?.[1];
  const description = body.match(/<small>(.*?)<\/small>/)?.[1];
  if (!description || (image && image !== `assets/chars/${id}.webp`)) throw new Error('Unexpected upstream preview markup');
  if (image) {
    const bytes = fs.readFileSync(path.join(reference, 'reference-web', image));
    sources[`web/${image}`] = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(path.join(root, 'public/desk-pet/previews'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/desk-pet/previews', `${id}.webp`), bytes);
  }
  return [id, { src: image ? `/desk-pet/previews/${id}.webp` : '', description }];
}));
const header = '// 由 scripts/sync-desk-pet-upstream.mjs 从固定提交的源码提取，请勿手改\n';
fs.writeFileSync(path.join(root, 'src/lib/deskPetUpstream.ts'), header
  + Object.entries(constants).map(([name, value]) => `export const UPSTREAM_${name} = ${JSON.stringify(value, null, 2)} as const;\n`).join('\n'));

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const physics = [];
function take(name, names) {
  const tree = read(name);
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    const id = statement.name?.text ?? (ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0].name.getText(tree) : '');
    if (!names || names.includes(id)) physics.push(printer.printNode(ts.EmitHint.Unspecified, statement, tree));
  }
}
take('dsh-types.ts', ['PhysicsParams']);
take('dsh-pet-src-shared-physics-constants.ts');
take('dsh-pet-src-shared-physics-contact.ts');
take('dsh-pet-src-shared-physics-spring.ts');
take('dsh-pet-src-shared-physics-release.ts');
take('dsh-pet-src-shared-physics-squash.ts');
take('dsh-pet-src-shared-physics-throw.ts', ['DragSample', 'ThrowBounds', 'ThrowState', 'ThrowHit', 'GravityVector', 'throwStep', 'throwSubsteps']);
fs.writeFileSync(path.join(root, 'src/lib/deskPetPhysics.ts'), header
  + '// PC2005-cloud/dsh-pet 单视口物理算法，MIT 许可见 public/desk-pet/LICENSE-dsh-pet.txt\n'
  + physics.join('\n\n') + '\n');
fs.writeFileSync(path.join(root, 'public/desk-pet/upstream-sources.json'), JSON.stringify({
  repositories: {
    'shenliuyu18/dafeiyu-pet': '4d9aadf05af87d94ecadc05bd206fc94cb6eb639',
    'PC2005-cloud/dsh-pet': '09aa6c3beae269e3ab0738a1d4c84066e5c03a23',
  },
  sha256: sources,
}, null, 2) + '\n');
console.log(`Extracted ${animations.length} animations, ${Object.keys(constants.CHARS).length} characters and the original single-viewport physics`);
