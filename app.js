import {openRearCamera} from './radio/camera.mjs?v=16';
import {roomNumber, drawCode} from './radio/pairing.mjs?v=16';
import {mailbox, newId, pairingURL} from './radio/signaling.mjs?v=16';
import {Link} from './radio/link.mjs?v=16';
import {Room, HOST, ALL, CAPACITY, displayName} from './radio/room.mjs?v=16';
import {Scanner} from './radio/scanner.mjs?v=16';

const $ = id => document.getElementById(id);

let current;
let page = 'home';
// This tag lasts for this page load. It only matches refreshed invitations in the host list.
let guestTag;
function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/i.test(ua)) {
    const model = /;\s*([^;()]+?)\s+Build\//i.exec(ua)?.[1];
    return model && model !== 'K' ? displayName(model, 'Android') : 'Android';
  }
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows device';
  if (/Linux/i.test(ua)) return 'Linux device';
  return 'Device';
}

function view(next) {
  page = next;
  for (const id of ['home', 'pair', 'radio']) $(id).hidden = id !== next;
  $('tools').hidden = next === 'home';
  $('tools').open = false;
  $('refreshOffer').hidden = next !== 'pair' || !current?.host;
  $('scannedGuests').hidden = next !== 'pair' || !current?.host;
  $('photo').hidden = $('retryCamera').hidden = next !== 'pair' || current?.host;
  window.scrollTo(0, 0);
}
function hint(message) { $('pairHint').textContent = message; }
function optics(mode, message = '') {
  $('joinQr').hidden = mode !== 'offer';
  $('guide').hidden = mode !== 'scan';
  $('preparing').hidden = mode !== 'wait';
  $('preparing').textContent = message;
}
function errorText(error) {
  if (error?.name === 'NotAllowedError') return 'Allow rear camera access to scan the group QR.';
  if (error?.name === 'NotReadableError') return 'The camera is in use. Close the other camera app and try again.';
  if (error?.name === 'OverconstrainedError' && (!error.constraint || error.constraint === 'facingMode')) return 'Rear camera unavailable. Check that your browser can use the rear camera.';
  return error?.message || 'The phone could not complete this step.';
}

class Session {
  constructor(host, name) {
    this.host = host;
    this.name = name;
    this.closed = false;
    this.connections = new Map();
    this.radioState = {mode: 'idle'};
    this.counter = 0;
    this.abort = new AbortController();
    this.attempts = new Map();
    $('pairTiming').hidden = true;
    this.scanner = new Scanner($('camera'), (text, seconds) => this.readQR(text, seconds), hint);
    if (host) {
      this.scans = new Map();
      $('scanList').replaceChildren();
      $('scanCount').textContent = '0';
      $('noScans').hidden = false;
      this.room = new Room({
        name, code: roomNumber(),
        deliver: (id, msg) => id === HOST ? this.receive(msg) : this.connections.get(id)?.send(msg),
      });
    }
  }
  async begin() {
    this.serviceURL = pairingURL($('relay').value);
    view('pair');
    $('pairTitle').textContent = this.host ? 'Group QR code' : 'Scan group QR';
    $('pairMeta').textContent = this.host ? 'Group ' + this.room.code : 'Guest';
    $('retryCamera').textContent = 'Restart rear camera';
    $('go').hidden = !this.host;
    $('go').disabled = true;
    optics('wait', this.host ? 'Creating group QR…' : 'Starting rear camera…');
    hint(this.host ? 'Preparing your group QR.' : 'Allow the rear camera to scan the group QR.');
    if (!window.isSecureContext || !window.RTCPeerConnection) {
      throw Error('Open TrekTalk in Safari or Chrome using its HTTPS address.');
    }
    let cameraError;
    if (!this.host) {
      try { await this.restartCamera(); }
      catch (error) { cameraError = errorText(error); }
      if (this.closed) return;
    }
    this.leaseTimer = setInterval(() => {
      if (this.host) this.room.tick();
      if (this.held && this.radioState.mode === 'tx') this.command({op: 'keep', press: this.held.press});
    }, 700);
    this.wake();
    if (this.host) {
      this.room.publish();
      await this.showGroup();
    } else if (page === 'pair' && !this.guestAttempt) {
      if (cameraError) {
        optics('wait', 'Camera unavailable');
        hint(cameraError + ' Use Options to restart the rear camera or read a QR photo.');
      } else {
        optics('scan');
        hint('Point the rear camera at the host’s group QR.');
      }
    }
  }
  async wake() {
    if (this.closed || document.hidden || !navigator.wakeLock || this.wakeLock && !this.wakeLock.released) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (this.closed) lock.release().catch(() => {}); else this.wakeLock = lock;
    } catch {}
  }
  async restartCamera() {
    if (this.host || this.closed || page !== 'pair' || this.restarting || this.guestAttempt) return;
    this.restarting = true;
    try {
      this.scanner.stop();
      const stream = await openRearCamera();
      const track = stream.getVideoTracks()[0];
      if (this.closed || page !== 'pair' || this.guestAttempt) { track.stop(); return; }
      await this.scanner.start(track);
      if (this.closed) return;
      track.onended = () => {
        if (this.closed || this.guestAttempt || page !== 'pair') return;
        this.scanner.stop();
        optics('wait', 'Rear camera stopped');
        hint('Use Options to restart the rear camera or read a QR photo.');
      };
    } finally { this.restarting = false; }
  }
  drop(attempt) {
    if (!attempt) return;
    clearTimeout(attempt.timeout);
    if (this.guestAttempt === attempt) this.guestAttempt = null;
    attempt.link?.close();
  }
  async showGroup() {
    if (this.closed || page !== 'pair' || !this.host) return;
    clearTimeout(this.pollTimer);
    const group = newId();
    this.group = group;
    const inbox = await mailbox(group, 'join', this.serviceURL, this.abort.signal);
    if (this.closed || this.group !== group || page !== 'pair') return;
    if (this.room.members.size >= CAPACITY) { optics('wait','All 10 radios are paired.'); return; }
    $('pairTitle').textContent = 'Group QR code';
    drawCode($('joinQr'), 'TREK14:' + group.toUpperCase());
    optics('offer');
    const prompt = 'Each guest scans this QR once. Their name appears below.';
    hint(prompt);
    const poll = async () => {
      if (this.closed || page !== 'pair' || this.group !== group) return;
      try {
        const message = await inbox.read();
        if (this.closed || page !== 'pair' || this.group !== group) return;
        for (const [id, record] of this.attempts) {
          if (record.expires <= performance.now()) this.attempts.delete(id);
        }
        if (message && /^[a-f0-9]{32}$/.test(message.id) && !this.attempts.has(message.id)) {
          this.connectGuest(group, message);
        }
        if (this.pollFailed) { this.pollFailed=false; hint(prompt); }
      } catch (e) {
        if (!this.closed && this.group===group) { this.pollFailed=true; hint(e.message); }
      }
      if (!this.closed && this.group===group && page==='pair') this.pollTimer=setTimeout(poll, this.pollFailed ? 2500 : 800);
    };
    poll();
  }
  readQR(text) {
    if (this.host || this.closed || page !== 'pair' || this.guestAttempt) return;
    const match=/^TREK14:([0-9A-F]{32})$/.exec(text);
    if (!match) { hint('Scan the TrekTalk group QR on the host phone.'); return; }
    this.joinGroup(match[1].toLowerCase());
  }
  async describeLink(attempt, options, offer) {
    const describe = () => offer ? attempt.link.answer(offer) : attempt.link.offer();
    attempt.link = new Link(options);
    try { return await describe(); }
    catch (error) {
      if (error.code !== 'NO_LOCAL_ADDRESS' || this.closed ||
          (this.host ? attempt.phase !== 'linking' : this.guestAttempt !== attempt)) throw error;
      attempt.link.close();
      hint('This browser needs rear camera access to enable local connections. Allow access when asked. The camera closes after the check.');
      // Share one permission request if several guests join the same host together.
      this.networkAccess ??= openRearCamera().then(stream => {
        stream.getTracks().forEach(track => track.stop());
      }).catch(() => {
        this.networkAccess = null;
        throw Error('Allow rear camera access in browser settings to enable local connections, then retry.');
      });
      await this.networkAccess;
      if (this.closed || (this.host ? attempt.phase !== 'linking' : this.guestAttempt !== attempt)) {
        throw Error('Pairing ended.');
      }
      attempt.link = new Link(options);
      return describe();
    }
  }
  async joinGroup(group) {
    const a={invite:newId(), readAt:performance.now()};
    this.guestAttempt=a;
    this.scanner.stop();
    $('retryCamera').hidden = $('photo').hidden = true;
    optics('wait','QR scanned');
    hint('Connecting to the host over the network…');
    try {
      const inbox=await mailbox(group,'join',this.serviceURL,this.abort.signal);
      const reply=await mailbox(group,a.invite,this.serviceURL,this.abort.signal);
      if (this.closed || this.guestAttempt !== a) return;
      const sdp=await this.describeLink(a, {
        initiator:true,
        ready:()=>a.link.send({op:'hello',version:14,name:this.name}),
        control:msg=>{
          if(this.guestAttempt!==a || this.closed)return;
          if(msg.op==='welcome' && msg.invite===a.invite){a.welcomed=true;a.link.send({op:'here'});}
          else if(a.welcomed)this.receive(msg);
        },
        lost:reason=>this.guestLost(a,reason)
      });
      guestTag ??= newId().slice(0,12);
      const request={id:a.invite,guest:{tag:guestTag,name:this.name,device:deviceLabel()},sdp};
      let nextSend=0;
      const check=async()=>{
        if(this.closed || this.guestAttempt!==a)return;
        try {
          if(performance.now()-a.readAt>35000)throw Error('Host did not confirm. Check both phones use the same pairing service and hotspot.');
          if(performance.now()>=nextSend){
            await inbox.send(request);
            nextSend=performance.now()+1600+Math.random()*1400;
          }
          const result=await reply.read();
          if(this.closed || this.guestAttempt!==a)return;
          if(result?.error)throw Error(result.error);
          if(typeof result?.sdp==='string'){
            await a.link.accept({type:'answer',sdp:result.sdp});
            if(!a.welcomed && !this.closed && this.guestAttempt===a)
              a.timeout=setTimeout(()=>this.guestLost(a,'The host replied, but the local connection timed out. Check the shared hotspot.'),16000);
            return;
          }
          a.timeout=setTimeout(check,650);
        } catch(e){this.guestLost(a,errorText(e));}
      };
      check();
    }catch(e){this.guestLost(a,errorText(e));}
  }
  showScan(invite, guest) {
    const key = guest?.tag || invite;
    let entry = this.scans.get(key);
    if (!entry || entry.row.dataset.state !== 'ended') {
      const row = document.createElement('li');
      const name = document.createElement('strong');
      const device = document.createElement('small');
      const state = document.createElement('span');
      row.append(name, device, state);
      entry = {row, name, device, state};
      this.scans.set(key, entry);
    }
    const device = displayName(guest?.device, '');
    entry.name.textContent = displayName(guest?.name, device || 'Guest device');
    entry.device.textContent = device === entry.name.textContent ? '' : device;
    entry.state.textContent = 'Scanned · Connecting';
    entry.row.dataset.state = 'pending';
    $('scanList').prepend(entry.row);
    $('scanList').scrollTop = 0;
    $('noScans').hidden = true;
    $('scanCount').textContent = String($('scanList').childElementCount);
    return entry;
  }
  async connectGuest(group, {id: invite, sdp, guest}) {
    if (typeof sdp !== "string" || sdp.length > 16000 || !guest || typeof guest.name !== "string") return;
    const a = {invite, phase: 'linking', readAt: performance.now()};
    this.attempts.set(invite,a);
    const reserved = [...this.attempts.values()].filter(p => p.phase === 'linking').length;
    const full = this.connections.size + reserved >= CAPACITY;
    if (full) a.phase = 'rejected';
    try {
      const reply=await mailbox(group,invite,this.serviceURL,this.abort.signal);
      if(this.closed)return;
      if (full) {
        this.retire(a);
        await reply.send({error:'This group is full.'});
        return;
      }
      a.reply = reply;
      a.entry = this.showScan(invite, guest);
      const answer=await this.describeLink(a, {
        initiator: false, ready: () => {}, control: msg => this.fromGuest(a, msg),
        lost: reason => this.hostLost(a, reason)
      }, {type:'offer',sdp});
      if(this.closed || a.phase!=='linking')return;
      await reply.send({sdp:answer});
      if(a.phase==='linking')a.timeout=setTimeout(()=>this.hostLost(a,'No local connection. Check the shared hotspot.'),20000);
    } catch (e) { this.hostLost(a, errorText(e)); }
  }
  fromGuest(a, msg) {
    if (this.closed) return;
    if (a.id) {
      if (this.connections.get(a.id) !== a.link) return;
      if (msg.op === 'leave') this.hostLost(a, 'Left the group.');
      else this.room.input(a.id, msg);
      return;
    }
    if (a.phase !== 'linking') return;
    if (msg.op === 'hello' && msg.version === 14) {
      a.name = displayName(msg.name, 'Hiker');
      a.link.send({op: 'welcome', invite: a.invite});
    }
    if (msg.op === 'here' && a.name) {
      clearTimeout(a.timeout);
      $('pairTiming').textContent = 'Last guest connected ' + ((performance.now() - a.readAt) / 1000).toFixed(1) + ' s after the join request.';
      $('pairTiming').hidden = false;
      a.phase = 'connected';
      a.id = this.room.add(a.name);
      a.entry.connected = true;
      a.entry.name.textContent = this.room.members.get(a.id);
      a.entry.state.textContent = 'Connected';
      a.entry.row.dataset.state = 'connected';
      this.connections.set(a.id, a.link);
      this.room.publish();
      if (page === 'pair' && this.room.members.size >= CAPACITY) optics('wait','All 10 radios are paired.');
    }
  }
  retire(a) {
    // Ignore duplicate delivery until the mailbox's 90 second retention period ends.
    this.attempts.set(a.invite, {phase:'ended', expires:performance.now() + 95000});
  }
  hostLost(a, reason) {
    if (this.closed) return;
    if (a.id) {
      if (this.connections.get(a.id) !== a.link) return;
      this.connections.delete(a.id);
      this.retire(a);
      a.entry.connected = false;
      a.entry.state.textContent = 'Disconnected';
      a.entry.row.dataset.state = 'ended';
      this.drop(a);
      this.room.remove(a.id);
      if (page === 'pair' && this.room.members.size===CAPACITY-1) this.showGroup();
    } else if (a.phase==='linking') {
      a.phase='failed';
      this.retire(a);
      a.reply?.send({error:'The host could not connect. Check that both phones are on the same hotspot, then scan again.'}).catch(() => {});
      if(a.entry){a.entry.state.textContent=reason;a.entry.row.dataset.state='ended';}
      this.drop(a);
    }
  }
  guestLost(a, reason) {
    if (this.closed || this.guestAttempt !== a) return;
    this.drop(a);
    if (page === 'radio') { end(reason); return; }
    // Wait for a deliberate retry rather than re-reading the same QR every frame.
    this.scanner.stop();
    $('retryCamera').hidden = $('photo').hidden = false;
    optics('wait', 'Could not join');
    hint(reason + ' Use Options to restart the scanner.');
  }
  enterRadio() {
    view('radio');
    this.scanner.stop();
    $('add').hidden = !this.host || this.roster?.people.length >= CAPACITY;
    this.paintTargets();
  }
  go() {
    if (!this.host || (!this.room.started && this.room.members.size < 2) || page !== 'pair') return;
    clearTimeout(this.pollTimer);
    this.enterRadio();
    this.room.start();
  }
  async addPhone() {
    if (!this.host || this.room.members.size >= CAPACITY) return;
    this.release();
    view('pair');
    $('go').hidden = false;
    $('go').disabled = false;
    await this.showGroup();
  }
  receive(msg) {
    if (this.closed) return;
    if (msg.op === 'ended') { end('The host closed this group.'); return; }
    if (msg.op === 'room') {
      if (!Array.isArray(msg.people) || msg.people.length > CAPACITY || !msg.people.some(p => p.id === msg.self)) return;
      this.roster = msg;
      if (this.host) {
        $('go').disabled = !msg.started && msg.people.length < 2;
        $('pairMeta').textContent = 'Group ' + msg.code + ' · ' + (msg.people.length - 1) + ' paired';
      } else if (page === 'pair') {
        clearTimeout(this.guestAttempt.timeout);
        const a = this.guestAttempt;
        $('pairTiming').textContent = 'Connected ' + ((performance.now() - a.readAt) / 1000).toFixed(1) + ' s after scanning the host QR.';
        $('pairTiming').hidden = false;
        this.enterRadio();
      }
      $('add').hidden = !this.host || msg.people.length >= CAPACITY;
      $('roomMeta').textContent = 'Group ' + msg.code + ' · ' + msg.people.length + ' connected';
      this.paintTargets();
      return;
    }
    if (msg.op === 'denied') {
      if (this.held?.press === msg.press) { this.held = null; this.paintFloor(); }
      return;
    }
    if (msg.op !== 'floor') return;
    if (this.radioState.mode === 'tx' && msg.mode !== 'tx' && this.held?.press === this.radioState.press) {
      this.held = null;
    }
    this.radioState = msg;
    if (msg.mode === 'tx' && (this.held?.press !== msg.press || this.held?.target !== msg.target || page !== 'radio' || document.hidden)) {
      this.command({op: 'release', press: msg.press});
      this.paintFloor();
      return;
    }
    this.paintFloor();
  }
  paintTargets() {
    if (page !== 'radio' || !this.roster) return;
    const {self, people} = this.roster;
    const members = people.filter(p => p.id !== self);
    const key = JSON.stringify(members);
    if (key !== this.renderKey) {
      this.renderKey = key;
      const container = $('targets');
      // Keep existing elements when possible to preserve pointer capture.
      const old = new Map(Array.from(container.children, b => [b.dataset.target, b]));
      for (const {id, name} of [{id: ALL, name: 'everyone'}, ...members]) {
        if (old.has(id)) { old.delete(id); continue; }
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.target = id;
        button.className = id === ALL ? 'all' : 'person';
        const label = document.createElement('span');
        label.textContent = 'Signal ' + name;
        const keyLabel = document.createElement('span');
        keyLabel.className = 'key';
        keyLabel.setAttribute('aria-hidden', 'true');
        keyLabel.textContent = 'HOLD';
        button.append(label, keyLabel);
        container.append(button);
      }
      for (const [id, button] of old) {
        if (this.held?.target === id) this.release();
        button.remove();
      }
    }
    this.paintFloor();
  }
  paintFloor() {
    if (page !== 'radio' || !this.roster) return;
    const {mode, name} = this.radioState;
    const enabled = this.roster.started && this.roster.people.length > 1;
    let label = 'Ready';
    if (!this.roster.started) label = 'Paired. Waiting for the host to open the group.';
    else if (this.roster.people.length < 2) label = 'Waiting for another person.';
    else if (mode === 'tx') label = this.held ? 'Signaling · release to stop' : 'Releasing channel…';
    else if (mode === 'rx') label = 'Signal from ' + name;
    else if (mode === 'busy') label = 'Channel busy';
    else if (this.held) label = 'Requesting channel…';
    $('channel').dataset.mode = mode;
    $('channelLabel').textContent = label;
    for (const button of $('targets').children) {
      const active = this.held?.target === button.dataset.target && mode === 'tx';
      button.classList.toggle('held', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-disabled', String(!enabled || (!active && mode !== 'idle')));
      button.lastElementChild.textContent = active ? 'SENDING' : 'HOLD';
    }
  }
  command(msg) {
    if (this.host) this.room.input(HOST, msg);
    else this.guestAttempt?.link.send(msg);
  }
  press(target, key) {
    if (page !== 'radio' || !this.roster?.started || this.roster.people.length < 2 || this.held ||
        this.radioState.mode !== 'idle' || document.hidden) return;
    this.held = {target, press: ++this.counter, key};
    this.paintFloor();
    this.command({op: 'ask', target, press: this.held.press});
  }
  release(key) {
    if (!this.held || (key !== undefined && key !== this.held.key)) return;
    const {press} = this.held;
    this.held = null;
    this.command({op: 'release', press});
    this.paintFloor();
  }
  close() {
    if (this.closed) return;
    this.release();
    this.closed = true;
    this.abort.abort();
    clearTimeout(this.pollTimer);
    clearInterval(this.leaseTimer);
    for (const a of this.attempts.values()) if (a.phase === 'linking') this.drop(a);
    this.attempts.clear();
    if (this.host) {
      for (const link of this.connections.values()) { link.send({op: 'ended'}); link.close(); }
      this.connections.clear();
    } else this.guestAttempt?.link.send({op: 'leave'});
    this.drop(this.guestAttempt);
    this.scanner.stop();
    this.wakeLock?.release().catch(() => {});
  }
}

function end(message = '') {
  current?.close();
  current = null;
  $('targets').replaceChildren();
  view('home');
  $('notice').textContent = message;
}
async function start(host) {
  if (current) return;
  const name = displayName($('name').value, host ? 'Host' : deviceLabel());
  try { localStorage.setItem('trektalk-name', $('name').value.trim()); } catch {}
  const session = new Session(host, name);
  current = session;
  try { await session.begin(); }
  catch (e) { if (current === session) end(errorText(e)); }
}
try { $('relay').value = localStorage.getItem('trektalk-relay') || ''; } catch {}
$('relay').onchange=()=>{try {localStorage.setItem('trektalk-relay',$('relay').value.trim());}catch{}};
try { $('name').value = localStorage.getItem('trektalk-name') || ''; } catch {}
$('host').onclick = () => start(true);
$('guest').onclick = () => start(false);
$('go').onclick = () => current?.go();
$('refreshOffer').onclick = () => { $('tools').open = false; current?.showGroup().catch(error => hint(errorText(error))); };
$('leave').onclick = () => end();
$('add').onclick = () => current?.addPhone().catch(e => hint(errorText(e)));
$('retryCamera').onclick = async () => {
  $('tools').open = false;
  const s = current;
  if (!s) return;
  try {
    await s.restartCamera();
    if (s === current && page === 'pair' && !s.guestAttempt && s.scanner.track) {
      optics('scan');
      hint('Scan the host group QR.');
    }
  } catch (e) { if (s === current) hint(errorText(e)); }
};
$('photo').onclick = () => { $('tools').open = false; $('photoFile').click(); };
$('photoFile').onchange = async () => {
  const file = $('photoFile').files[0];
  $('photoFile').value = '';
  const s = current;
  if (!s || !file) return;
  try {
    const text = await s.scanner.photo(file);
    if (s !== current || page !== 'pair') return;
    s.readQR(text);
  } catch (e) { if (s === current) hint(errorText(e)); }
};

$('targets').onpointerdown = e => {
  const button = e.target.closest('button[data-target]');
  if (!button || !e.isPrimary || e.button !== 0) return;
  e.preventDefault();
  try { button.setPointerCapture(e.pointerId); } catch {}
  current?.press(button.dataset.target, e.pointerId);
};
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  window.addEventListener(type, e => current?.release(e.pointerId), true);
}
$('targets').onkeydown = e => {
  if (![' ', 'Enter'].includes(e.key) || !e.target.dataset.target) return;
  e.preventDefault();
  if (!e.repeat) current?.press(e.target.dataset.target, e.key);
};
window.addEventListener('keyup', e => current?.release(e.key));
$('targets').oncontextmenu = e => e.preventDefault();
window.addEventListener('blur', () => current?.release());
window.addEventListener('pagehide', () => end());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) current?.release();
  else current?.wake();
});

async function prepareOffline() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) throw Error();
  const reg = await navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
  const markReady = async () => {
    const hit = await caches.match(new URL('./__trektalk_ready_v16__', location.href).href, {cacheName: 'trektalk-v16'});
    if (hit) $('offline').textContent = 'Ready offline · v16';
    return Boolean(hit);
  };
  if (await markReady()) return;
  const watch = worker => worker?.addEventListener('statechange', () => {
    if (['installed','activated'].includes(worker.state)) markReady().catch(() => {});
    if (worker.state === 'redundant') $('offline').textContent = 'Offline files could not be saved. Reload while online.';
  });
  watch(reg.installing);
  reg.addEventListener('updatefound', () => watch(reg.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => markReady().catch(() => {}));
  if (reg.active && !reg.installing) await reg.update();
  await navigator.serviceWorker.ready;
  await markReady();
}
prepareOffline().catch(() => { $('offline').textContent = 'Offline files unavailable. Reopen this page while online.'; });
