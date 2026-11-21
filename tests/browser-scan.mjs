import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright-core');
const {exchange, localStore} = require('../server/mailbox.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const store = localStore();
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/pair' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const [status, result] = await exchange(store, JSON.parse(body));
      res.writeHead(status, {'Content-Type':'application/json'}).end(JSON.stringify(result));
      return;
    }
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const data = await readFile(path.join(root, file));
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'text/plain','Cache-Control':'no-cache'}).end(data);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const site = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  executablePath:process.env.TREKTALK_CHROME || '/usr/bin/google-chrome',
  args:['--no-sandbox','--use-fake-ui-for-media-stream','--allow-loopback-in-peer-connection']
});
const errors = [];
const cases = [
  {width:1280,height:720,size:.62,angle:0,native:false},
  {width:720,height:1280,size:.62,angle:15,native:false},
  {width:640,height:480,size:.35,angle:0,native:false},
  {width:1280,height:720,size:.62,angle:0,native:true},
  {width:1920,height:1080,size:.30,angle:0,native:false},
  {width:1280,height:720,size:.62,angle:0,native:false,offset:.12},
  {width:1280,height:720,size:.35,angle:0,native:false,throttle:6}
];
const timings = [];
try {
  const context = await browser.newContext({viewport:{width:393,height:852}});
  await context.grantPermissions(['camera']);
  await context.addInitScript(() => {
    window.picture = null;
    window.scanFinished = null;
    navigator.mediaDevices.getUserMedia = async options => {
      if (options.audio !== false || options.video.facingMode.exact !== 'environment') throw Error('Rear camera only');
      const {width,height} = window.scene;
      const canvas = document.createElement('canvas');
      canvas.width = width;canvas.height = height;
      const ctx = canvas.getContext('2d');
      const draw = () => {
        ctx.fillStyle = '#b3b9ac';ctx.fillRect(0,0,width,height);
        if (!window.picture) return;
        const edge = Math.min(width,height) * window.scene.size;
        ctx.save();
        ctx.translate(width/2 + Math.min(width,height)*(window.scene.offset || 0),height/2);
        ctx.rotate(window.scene.angle*Math.PI/180);
        ctx.drawImage(window.picture,-edge/2,-edge/2,edge,edge);
        ctx.restore();
      };
      draw();
      window.cameraInterval = setInterval(draw,33);
      const stream = canvas.captureStream(30);
      stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(window.cameraInterval));
      return stream;
    };
  });
  const page = await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  const device = await context.newCDPSession(page);
  for (const scenario of cases) {
    await device.send('Emulation.setCPUThrottlingRate',{rate:scenario.throttle || 1});
    await page.goto(site);
    await page.getByText('Ready offline · v17',{exact:true}).waitFor();
    await page.evaluate(scene=>{
      window.scene = scene;
      window.BarcodeDetector = scene.native ? class {detect(){return new Promise(()=>{});}} : undefined;
      new MutationObserver(()=>{
        if (document.getElementById('preparing').textContent === 'QR scanned' && !window.scanFinished) {
          window.scanFinished = performance.now();
        }
      }).observe(document.getElementById('preparing'),{childList:true,subtree:true});
    },scenario);
    await page.click('#guest');
    await page.locator('#guide').waitFor({state:'visible'});
    await page.evaluate(async()=>{
      const {drawCode} = await import('/radio/pairing.mjs?v=17');
      const canvas = document.createElement('canvas');
      drawCode(canvas,'TREK14:0123456789ABCDEF0123456789ABCDEF');
      const image = new Image();
      image.src = canvas.toDataURL();
      await image.decode();
      window.visibleAt = performance.now();
      window.picture = image;
    });
    await page.waitForFunction(()=>window.scanFinished!==null,{},{timeout:3000});
    const elapsed = await page.evaluate(()=>window.scanFinished-window.visibleAt);
    timings.push(Math.round(elapsed));
    assert.ok(elapsed<2000,'QR took '+Math.round(elapsed)+'ms for '+JSON.stringify(scenario));
    await page.locator('#tools summary').click();
    await page.click('#leave');
    await page.evaluate(()=>clearInterval(window.cameraInterval));
  }
  await device.send('Emulation.setCPUThrottlingRate',{rate:1});
  if (process.env.TREKTALK_SCREENSHOTS) {
    const dir = process.env.TREKTALK_SCREENSHOTS;
    await mkdir(dir,{recursive:true});
    await page.goto(site);
    await page.getByText('Ready offline · v17',{exact:true}).waitFor();
    await page.fill('#name','Prithvi');
    await page.screenshot({path:path.join(dir,'home.png'),fullPage:true});
    await page.click('#host');
    await page.locator('#joinQr').waitFor({state:'visible'});
    await page.screenshot({path:path.join(dir,'host.png'),fullPage:true});
    await page.locator('#tools summary').click();await page.click('#leave');
    await page.evaluate(()=>{window.scene={width:720,height:1280,size:.62,angle:0};});
    await page.click('#guest');
    await page.locator('#guide').waitFor({state:'visible'});
    await page.screenshot({path:path.join(dir,'scanner.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: visible QR detection in ms '+timings.join(', ')+'; all seven cases under 2 seconds');
} finally {await browser.close();server.close();}
