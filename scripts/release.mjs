#!/usr/bin/env node
/**
 * Builds the folder (and zip) you hand to a customer. It contains only what runs the app:
 * the built website, one bundled server file, the setup wizard, start scripts, the licence
 * and the customer guide. No source code, no tests, no node_modules, none of your secrets.
 *
 *   npm run release                                   builds release/haveli-<version>-customer.zip
 *   npm run release -- --licensee "Grand Palace Hotels"   puts the customer's name on the licence
 *   npm run release -- --seller "Your Company"        the name shown as licensor (default: Swayam Koli)
 *   npm run release -- --skip-build                   reuse the dist/ folder that is already built
 *   npm run release -- --no-zip                       only make the folder
 *
 * The customer needs Node.js 20+ and nothing else.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const say = (s = '') => console.log(s);
const die = (s) => {
  console.error(`\n${s}\n`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const licensee = arg('licensee', 'the licensee named on the invoice');
const seller = arg('seller', process.env.HAVELI_SELLER || 'Swayam Koli');
const slug = arg('licensee') ? '-' + arg('licensee').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '-customer';
const name = `haveli-${version}${slug}`;
const OUT = join(ROOT, 'release');
const DIR = join(OUT, name);
const date = new Date().toISOString().slice(0, 10);

say(`Building ${name} ...`);

/* 1. the website */
if (!flag('skip-build')) {
  let vite;
  try {
    vite = join(dirname(createRequire(join(ROOT, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js');
  } catch {
    die('Vite is not installed. Run "npm install" first.');
  }
  say('  - building the website (vite) ...');
  const r = spawnSync(process.execPath, [vite, 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) die('The website build failed. Fix the error above and run this again.');
}
if (!existsSync(join(ROOT, 'dist', 'index.html'))) die('dist/index.html is missing. Run "npm run build" (or leave out --skip-build).');

/* 2. fresh output folder */
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
cpSync(join(ROOT, 'dist'), join(DIR, 'dist'), { recursive: true });

/* 3. the server as one minified file */
let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  die('esbuild is not installed. Run "npm install" first.');
}
say('  - bundling the server ...');
await esbuild.build({
  entryPoints: [join(ROOT, 'server', 'start.ts')],
  outfile: join(DIR, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: "import { createRequire as __haveliRequire } from 'node:module'; const require = __haveliRequire(import.meta.url);" },
});

/* 4. wizard, scripts, licence, guide */
const fill = (text) =>
  text
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{DATE}}', date)
    .replaceAll('{{LICENSEE}}', licensee)
    .replaceAll('{{SELLER}}', seller);
copyFileSync(join(ROOT, 'scripts', 'setup.mjs'), join(DIR, 'setup.mjs'));
copyFileSync(join(ROOT, '.env.example'), join(DIR, '.env.example'));
for (const f of readdirSync(join(ROOT, 'scripts', 'customer'))) {
  const from = join(ROOT, 'scripts', 'customer', f);
  const to = join(DIR, f);
  const isText = /\.(txt|md)$/.test(f);
  if (isText) writeFileSync(to, fill(readFileSync(from, 'utf8')));
  else {
    // Windows scripts need CRLF line endings, shell scripts need LF.
    const body = readFileSync(from, 'utf8').replace(/\r\n/g, '\n');
    writeFileSync(to, f.endsWith('.bat') ? body.replace(/\n/g, '\r\n') : body);
  }
  if (f.endsWith('.sh')) chmodSync(to, 0o755);
}
writeFileSync(join(DIR, 'VERSION.txt'), `Haveli ${version}\nIssued ${date} to ${licensee}\n`);

/* 5. check what is going out */
const forbidden = [/\.env$/, /\.pem$/, /node_modules/, /service-account/i, /-key\.json$/, /\.ts$/, /\.tsx$/, /\.map$/];
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(DIR);
const bad = files.filter((f) => forbidden.some((re) => re.test(f)));
if (bad.length) die(`These files must not be shipped:\n  ${bad.join('\n  ')}`);
const pem = /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=\\n]{40,}/;
const leak = files.filter((f) => /\.(mjs|js|html|css|md|txt|example|bat|sh|json)$/.test(f) && pem.test(readFileSync(f, 'utf8')));
if (leak.length) die(`A private key was found in:\n  ${leak.join('\n  ')}`);
say(`  - ${files.length} files, no secrets, no source code.`);

/* 6. zip */
let zipPath = '';
if (!flag('no-zip')) {
  zipPath = join(OUT, `${name}.zip`);
  rmSync(zipPath, { force: true });
  const tries =
    process.platform === 'win32'
      ? [['tar', ['-a', '-c', '-f', zipPath, '-C', OUT, name]], ['powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${DIR}' -DestinationPath '${zipPath}' -Force`]]]
      : [['zip', ['-rq', zipPath, name]], ['tar', ['-a', '-c', '-f', zipPath, name]]];
  let made = false;
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { cwd: OUT, stdio: 'ignore' });
    if (r.status === 0 && existsSync(zipPath)) {
      made = true;
      break;
    }
  }
  if (!made) {
    say('  ! Could not make the zip automatically. Right-click the folder below and choose "Send to > Compressed (zipped) folder".');
    zipPath = '';
  }
}

say('');
say('Done.');
say(`  Folder: ${DIR}`);
if (zipPath) say(`  Zip:    ${zipPath}`);
say(`  Licensed to: ${licensee}`);
say('');
say('Give the customer the zip. They unzip it, double-click start.bat (Windows) or run start.sh (Mac/Linux),');
say('answer the setup questions, and open the address that appears. CUSTOMER-GUIDE.md walks them through it.');
