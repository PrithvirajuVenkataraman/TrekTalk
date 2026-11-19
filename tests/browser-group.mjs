import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium:pw}=require('playwright-core');
const root=fileURLToPath(new URL('../', import.meta.url));
// Run with Playwright Core installed and TREKTALK_CHROME pointing to Chrome.
// Camera images are the actual partner canvases. WebRTC and the audio worklet run normally.
let online=true;
let relayOnline=true;
const {exchange,localStore}=require('../server/mailbox.cjs');
const store=localStore();
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'};
const server=createServer(async(req,res)=>{
  try {
    if(req.url==='/api/pair' && req.method==='POST'){
      if(!relayOnline){res.writeHead(503).end();return;}
      let body='';for await(const chunk of req)body+=chunk;
      const [status,msg]=await exchange(store,JSON.parse(body));
      res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(msg));return;
    }
    if(!online){res.writeHead(503).end('offline');return;}
    const f=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    const bytes=await readFile(path.join(root,f));res.writeHead(200,{'Content-Type':types[path.extname(f)]||'text/plain','Cache-Control':'no-cache'});res.end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const site='http://127.0.0.1:'+server.address().port;
const browser=await pw.launch({executablePath:process.env.TREKTALK_CHROME || '/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--allow-loopback-in-peer-connection','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
const pages=[];

try{
  function installMediaFixtures(){
    window.heard=0;window.cameraPicture=null;window.cameraRequests=0;
    window.playbackStarts=0;
    const play=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      if(this.buffer?.length===320 && this.buffer.sampleRate===16000 && this.buffer.getChannelData(0).some(n=>Math.abs(n)>0.01))window.heard++;
      window.playbackStarts++;
      return play.apply(this,args);
    };
    const rtc=RTCPeerConnection;
    window.peerReports=[];
    window.RTCPeerConnection=class extends rtc{
      constructor(opts){super(opts);window.peerReports.push(this);}
      async createAnswer(...args){
        if(window.failNextAnswer){window.failNextAnswer=false;throw Error('Test connection failed');}
        return super.createAnswer(...args);
      }
    };
    const originalMic = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async function(constraints){
      const tracks=[];
      if(constraints.audio){
        // Exercise browser microphone permissions before supplying a deterministic test tone.
        const granted = await originalMic({audio:true});
        granted.getTracks().forEach(track=>track.stop());
        const c=new AudioContext();await c.resume();const o=c.createOscillator();o.frequency.value=440;
        const gain=c.createGain();gain.gain.value=.3;
        const dest=c.createMediaStreamDestination();o.connect(gain).connect(dest);o.start();window.tone={c,o,dest};
        tracks.push(...dest.stream.getAudioTracks());
      }
      if(constraints.video){
        window.cameraRequests++;
        if(window.isTestHost)throw Error('The host must never request a camera');
        if(constraints.video.facingMode?.exact !== 'environment') throw Error('Every camera request must require the rear camera');
        if(window.noRearCamera) throw new DOMException('Missing rear camera','OverconstrainedError');
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;
        const cx=canvas.getContext('2d');const draw=()=>{cx.fillStyle='#777';cx.fillRect(0,0,640,640);if(window.cameraPicture)cx.drawImage(window.cameraPicture,115,120,396,396);};
        draw();const s=canvas.captureStream(20);clearInterval(window.cameraLoop);window.cameraLoop=setInterval(draw,50);tracks.push(...s.getVideoTracks());
      }
      return new MediaStream(tracks);
    };
    window.pointAt=async url=>{const im=new Image();im.src=url;await im.decode();window.cameraPicture=im;};
  }
  async function phone(name){
    const ctx=await browser.newContext({viewport:{width:393,height:852}, ...(name==='iPhone' ? {userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'} : {})});
    await ctx.grantPermissions(['microphone','camera']);
    await ctx.addInitScript(installMediaFixtures);
    const p=await ctx.newPage();
    p.on('pageerror',e=>console.log('PAGE ERROR',name,e.message));p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',name,m.text());});
    await p.goto(site);await p.getByText('Ready offline · v13').waitFor({timeout:10000});await p.fill('#name',name);return p;
  }
  const host=await phone('OnePlus'),iphone=await phone('iPhone'),third=await phone('Arun');
  pages.push(host,iphone,third);
  const more=[];
  for(let i=4;i<=10;i++) more.push(await phone('Hiker '+i));
  online=false;
  await iphone.reload();await iphone.getByText('Ready offline · v13').waitFor();await iphone.fill('#name','');
  await host.evaluate(()=>{window.isTestHost=true;});
  await host.click('#host');
  assert.equal(await host.evaluate(()=>window.cameraRequests),0);
  async function imageOf(p,id){await p.locator(id).waitFor({state:'visible',timeout:10000});return p.locator(id).evaluate(e=>e.toDataURL());}
  async function point(p,data){await p.evaluate(data=>window.pointAt(data),data);}
  async function pair(guest, started=false){
    const name=await guest.locator('#name').inputValue() || 'iPhone';
    const hostStarts=await host.evaluate(()=>window.playbackStarts);
    const guestStarts=await guest.evaluate(()=>window.playbackStarts);
    await guest.evaluate(()=>{window.cameraPicture=null;});
    await guest.click('#guest');
    await guest.locator('#guide').waitFor({state:'visible'});
    await point(guest,await imageOf(host,'#joinQr'));
    await guest.locator('#radio').waitFor({state:'visible',timeout:45000});
    const row=host.locator('#scanList li').filter({has:host.getByText(name,{exact:true})});
    await row.getByText('Connected',{exact:true}).waitFor();
    assert.equal(await row.count(),1);
    assert.equal(await host.evaluate(()=>window.cameraRequests),0);
    assert.equal(await host.evaluate(()=>window.playbackStarts),hostStarts);
    assert.equal(await guest.evaluate(()=>window.playbackStarts),guestStarts);
    assert.match(await guest.locator('#channelLabel').innerText(),started ? /Listening/ : /Waiting for the host/);
  }
  await pair(iphone);await pair(third);
  assert.match(await host.locator('#pairMeta').innerText(),/2 paired/);
  await host.click('#go');
  for(const p of pages){await p.getByText('Listening',{exact:true}).waitFor();assert.equal(await p.locator('#targets button').count(),3);}
  // Tap a target with a real pointer. Count decoded, non-silent frames scheduled for playback.
  async function transmit(p,label,expected){
    const before=await Promise.all(pages.map(q=>q.evaluate(()=>window.heard)));
    const btn=p.getByRole('button',{name:label,exact:true});await btn.scrollIntoViewIfNeeded();const box=await btn.boundingBox();
    await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
    await p.getByText('Transmitting · release to listen').waitFor({timeout:3000});
    await new Promise(r=>setTimeout(r,850));await p.mouse.up();
    await new Promise(r=>setTimeout(r,200));
    const after=await Promise.all(pages.map(q=>q.evaluate(()=>window.heard)));
    const delta=after.map((x,i)=>x-before[i]);console.log(label,delta);
    delta.forEach((n,i)=>assert.equal(n>0,expected.includes(i)));
    await Promise.all(pages.map(q=>q.getByText('Listening',{exact:true}).waitFor()));
  }
  relayOnline=false;
  await transmit(iphone,'Talk to Arun',[2]);
  await transmit(host,'Talk to iPhone',[1]);
  await transmit(third,'Talk to everyone',[0,1]);
  await transmit(host,'Talk to everyone',[1,2]);
  await third.locator('#tools summary').click();await third.click('#leave');
  await host.waitForFunction(()=>document.getElementById('roomMeta').textContent.includes('2 connected'));
  assert.equal(await iphone.locator('#targets button').count(),2);
  // Reopen pairing without losing the existing radio. Refresh rotates just the pending offer.
  relayOnline=true;
  await host.click('#add');
  await host.locator('#scanList li').filter({hasText:'Arun'}).getByText('Disconnected',{exact:true}).waitFor();
  assert.equal(await iphone.locator('#targets button').count(),2);
  await pair(third,true);
  for(const hiker of more){pages.push(hiker);await pair(hiker,true);}
  await host.getByText('All 10 radios are paired.').waitFor();
  assert.equal(await host.locator('#scanList li[data-state=connected]').count(),9);
  await host.click('#go');
  for(const page of pages) assert.equal(await page.locator('#targets button').count(),10);
  await transmit(host,'Talk to everyone',pages.slice(1).map((_,i)=>i+1));
  await transmit(iphone,'Talk to Hiker 10',[9]);

  const key = async (p,name,event)=>p.getByRole('button',{name,exact:true})
    .dispatchEvent(event,{key:'Enter',bubbles:true});
  await key(iphone,'Talk to everyone','keydown');
  await iphone.getByText('Transmitting · release to listen').waitFor();
  await third.getByText('Receiving from iPhone',{exact:true}).waitFor();
  await key(third,'Talk to OnePlus','keydown');
  assert.match(await third.locator('#channelLabel').innerText(),/Receiving from iPhone/);
  // Losing focus must release the active microphone and the shared channel.
  await iphone.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await Promise.all(pages.map(p=>p.getByText('Listening',{exact:true}).waitFor()));
  console.log('PASS: ten offline radios, one guest scan, no host camera, zero pairing playback, voice with the pairing service offline, retained roster, targeted and group audio, contention, refresh, rejoin and focus loss');
}catch(e){
 console.error(String(e));
 for(const p of pages)console.log(await p.evaluate(()=>({screen:document.querySelector('section:not([hidden])')?.id,hint:document.querySelector('#pairHint')?.textContent,notice:document.querySelector('#notice')?.textContent,offline:document.querySelector('#offline')?.textContent,peers:window.peerReports.map(p=>[p.connectionState,p.iceGatheringState,(p.localDescription?.sdp||'').split('\n').filter(l=>l.includes('candidate:')).length]),ctx:window.tone?.c?.state})).catch(()=>({})));
 process.exitCode=1;
}finally{await browser.close();server.close();}
