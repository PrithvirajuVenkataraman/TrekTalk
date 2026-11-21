import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {chromium, firefox, webkit} = require('playwright-core');
const {exchange, localStore} = require('../server/mailbox.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const store = localStore();
let online = true;
const types = {'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/pair' && req.method === 'POST') {
      if (!online) {res.writeHead(503).end();return;}
      let body = '';
      for await (const chunk of req) body += chunk;
      const [status, result] = await exchange(store, JSON.parse(body));
      res.writeHead(status, {'Content-Type':'application/json'}).end(JSON.stringify(result));
      return;
    }
    if (!online) {res.writeHead(503).end();return;}
    const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'text/plain','Cache-Control':'no-cache'});
    res.end(await readFile(path.join(root, file)));
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const site = 'http://127.0.0.1:' + server.address().port;
const browsers = new Map();
const errors = [];
function fixtures() {
  window.audioAttempts = [];
  window.cameraRequests = 0;
  window.peerReports = [];
  const deny = action => {window.audioAttempts.push(action);throw Error(action);};
  for (const key of ['Audio','AudioContext','webkitAudioContext']) {
    if (window[key]) window[key] = class {constructor(){deny(key);}};
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function(...args) {
    if (this.tagName !== 'VIDEO' || this.id !== 'camera' || !this.muted ||
        (this.srcObject && this.srcObject.getAudioTracks().length)) deny('media playback');
    if (!this.srcObject) return Promise.resolve();
    return play.apply(this, args);
  };
  const nativeCamera = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let failedCamera = false;
  window.cameraTracks = [];
  Object.defineProperty(navigator, 'mediaDevices', {configurable:true,value:{
    getSupportedConstraints:()=>({facingMode:true}),
    getUserMedia:async constraints => {
      window.cameraRequests++;
      if (constraints.audio !== false) deny('microphone');
      if (constraints.video?.facingMode?.exact !== 'environment') throw Error('Rear camera required');
      if (!window.isTestHost && !failedCamera) {
        failedCamera = true;
        throw new DOMException('Camera unavailable for recovery test', 'NotAllowedError');
      }
      const stream = await nativeCamera(constraints);
      window.cameraTracks.push(...stream.getTracks());
      return stream;
    }
  }});
  const Peer = RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(config) {super(config);window.peerReports.push(this);}
  };
}
async function phone(engine, name) {
  const context = await browsers.get(engine).newContext({
    viewport:{width:320,height:568}, hasTouch:true,
    ...(engine === 'firefox' ? {} : {isMobile:true})
  });
  // CI cannot resolve multicast hostnames reliably. This browser permission
  // exposes routable test candidates while the fixture still fails camera access.
  if (engine !== 'firefox') await context.grantPermissions(['camera']);
  await context.addInitScript(fixtures);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(engine + ': ' + error.message));
  await page.goto(site);
  await page.getByText('Ready offline · v17', {exact:true}).waitFor({timeout:15000});
  await page.fill('#name', name);
  return page;
}
async function signal(sender, receiver) {
  const button = sender.getByRole('button', {name:'Signal everyone',exact:true});
  await button.dispatchEvent('pointerdown', {pointerType:'touch',pointerId:9,isPrimary:true,button:0,bubbles:true});
  await sender.getByText('Signaling · release to stop', {exact:true}).waitFor({timeout:5000});
  await receiver.getByText(/^Signal from /).waitFor({timeout:5000});
  await button.dispatchEvent('pointercancel', {pointerType:'touch',pointerId:9,isPrimary:true,bubbles:true});
  await Promise.all([sender,receiver].map(p=>p.getByText('Ready',{exact:true}).waitFor({timeout:5000})));
}
try {
  browsers.set('chromium', await chromium.launch({args:['--no-sandbox','--allow-loopback-in-peer-connection','--disable-background-timer-throttling']}));
  browsers.set('firefox', await firefox.launch({firefoxUserPrefs:{'media.peerconnection.ice.loopback':true,'media.peerconnection.ice.obfuscate_host_addresses':false}}));
  browsers.set('webkit', await webkit.launch());
  for (const hostEngine of browsers.keys()) {
    for (const guestEngine of browsers.keys()) {
      online = true;
      const host = await phone(hostEngine, 'Guide');
      const guest = await phone(guestEngine, 'WWWWWWWWWWWWWWWWWWWWWWWW');
      try {
        await host.evaluate(() => {window.isTestHost = true;});
        await host.click('#host');
        await host.locator('#joinQr').waitFor({state:'visible'});
        await guest.click('#guest');
        await guest.getByText('Camera unavailable',{exact:true}).waitFor();
        const png = await host.locator('#joinQr').evaluate(canvas=>canvas.toDataURL().split(',')[1]);
        await guest.locator('#photoFile').setInputFiles({
          name:'group.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')
        });
        await guest.locator('#radio').waitFor({state:'visible',timeout:45000});
        await host.getByText('Connected',{exact:true}).waitFor();
        await host.click('#go');
        await Promise.all([host,guest].map(p=>p.getByText('Ready',{exact:true}).waitFor()));
        online = false;
        await signal(host,guest);
        await signal(guest,host);
        for (const page of [host,guest]) {
          await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
          for (const viewport of [{width:320,height:568},{width:568,height:320},{width:768,height:1024}]) {
            await page.setViewportSize(viewport);
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,
              hostEngine + '/' + guestEngine + ': content overflows viewport');
          }
          const media = await page.evaluate(()=>({
            audio:window.audioAttempts,transceivers:window.peerReports.reduce((n,p)=>n+p.getTransceivers().length,0)
          }));
          assert.deepEqual(media,{audio:[],transceivers:0});
        }
        if (hostEngine !== 'webkit') assert.equal(await host.evaluate(()=>window.cameraRequests),0);
        for (const p of [host, guest]) {
          assert.equal(await p.evaluate(()=>window.cameraTracks.every(track=>track.readyState === 'ended')),true);
        }
        // Offline cached startup is verified separately from live camera permission recovery.
        await guest.locator('#tools summary').click();
        await guest.click('#leave');
        await host.getByText('Waiting for another person.',{exact:true}).waitFor();
        await guest.reload();
        await guest.getByText('Ready offline · v17',{exact:true}).waitFor();
        console.log('PASS: ' + hostEngine + ' host -> ' + guestEngine + ' guest, QR photo recovery, touch cancellation, offline signals and layouts');
      } catch (error) {
        console.error('PAIR',hostEngine,guestEngine);
        for (const p of [host,guest]) console.error(await p.evaluate(()=>({
          hint:document.getElementById('pairHint').textContent,
          notice:document.getElementById('notice').textContent,
          peers:window.peerReports.map(pc=>({connection:pc.connectionState,ice:pc.iceConnectionState,sdp:pc.localDescription?.sdp}))
        })));
        throw error;
      } finally {await host.context().close();await guest.context().close();}
    }
  }
  assert.deepEqual(errors,[]);
} finally {
  await Promise.all([...browsers.values()].map(browser=>browser.close()));
  server.close();
}
