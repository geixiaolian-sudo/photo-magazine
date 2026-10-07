import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
await fs.mkdir(out, { recursive: true });
const [template, css, result, pkg] = await Promise.all([
  fs.readFile(path.join(root, 'src/index.html'), 'utf8'),
  fs.readFile(path.join(root, 'src/styles.css'), 'utf8'),
  build({ entryPoints: [path.join(root, 'src/app.js')], bundle: true, minify: true, platform: 'browser', format: 'iife', target: ['es2020'], write: false, legalComments: 'inline' }),
  fs.readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse)
]);
const runtime = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
await fs.writeFile(path.join(out, 'index.html'), template.replace('/*__STYLES__*/', () => css).replace('/*__RUNTIME__*/', () => runtime));
await fs.writeFile(path.join(out, '.nojekyll'), '');
await fs.mkdir(path.join(out, 'licenses'), { recursive: true });
const dependencies = [];
for (const name of ['cropperjs', 'justified-layout', 'colorthief', 'page-flip']) {
  const source = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const license = (await fs.readdir(source)).find(x => /^license(?:\.md|\.txt)?$/i.test(x));
  if (!license) throw new Error('Missing upstream license: ' + name);
  await fs.copyFile(path.join(source, license), path.join(out, 'licenses', name + '-LICENSE.txt'));
  dependencies.push({ name, version: pkg.dependencies[name], license: metadata.license, repository: metadata.repository });
}
await fs.writeFile(path.join(out, 'dependencies.json'), JSON.stringify(dependencies, null, 2) + '\n');
await fs.copyFile(path.join(root, 'README.md'), path.join(out, 'README.md'));
console.log('Built self-contained index.html:', (await fs.stat(path.join(out, 'index.html'))).size, 'bytes. Four pinned libraries bundled; no runtime CDN.');
