import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const {chromium} = createRequire(import.meta.url)('playwright-core');
const currentRoot = fileURLToPath(new URL('../', import.meta.url));
const previousRoot = process.env.TREKTALK_V8_ROOT;
assert.ok(previousRoot, 'Set TREKTALK_V8_ROOT to a checkout of v8');
let root = previousRoot;
let online = true;
const types = {'.js':'text/javascript', '.mjs':'text/javascript', '.html':'text/html',
  '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json'};
const server = createServer(async (req, res) => {
  if (!online) { res.writeHead(503).end(); return; }
  try {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const body = await readFile(path.join(root, file));
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'text/plain', 'Cache-Control':'no-cache'}).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const site = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.TREKTALK_CHROME || '/usr/bin/google-chrome', args:['--no-sandbox']});
  const page = await browser.newPage();
  await page.goto(site + '/?update=8');
  await page.getByText(/Offline files saved \(v8\)/).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  assert.ok(await page.evaluate(() => caches.has('trektalk-v8')));

  // Simulate a deployment while this phone still has the old cache and worker.
  root = currentRoot;
  await page.goto(site + '/?update=9');
  await page.getByText('Ready offline · v9', {exact:true}).waitFor();
  await page.waitForFunction(async () => !(await caches.has('trektalk-v8')));
  online = false;
  await page.reload();
  await page.getByText('Ready offline · v9', {exact:true}).waitFor();
  const controls = await page.getByRole('button').allTextContents();
  assert.ok(controls.includes('Host a group') && controls.includes('Scan host QR'));
  console.log('PASS: a phone with the v8 worker and cache upgrades to v9, then opens the radio app offline');
} finally {
  await browser?.close();
  server.close();
}
