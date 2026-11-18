import {newInvite, roomNumber, pack, unpack, drawCode} from './radio/pairing.mjs?v=9';
import {Link} from './radio/link.mjs?v=9';
import {Room, HOST, ALL, CAPACITY, displayName} from './radio/room.mjs?v=9';
import {RadioAudio} from './radio/audio.mjs?v=9';
import {Scanner} from './radio/scanner.mjs?v=9';

const $ = id => document.getElementById(id);
const cameraSettings = {facingMode: {ideal: 'user'}, width: {ideal: 1280}, height: {ideal: 960}};
let current;
let page = 'home';

function view(next) {
  page = next;
  for (const id of ['home', 'pair', 'radio']) $(id).hidden = id !== next;
  $('tools').hidden = next === 'home';
  $('tools').open = false;
  $('photo').hidden = $('retryCamera').hidden = next !== 'pair';
  window.scrollTo(0, 0);
}
function hint(message) { $('pairHint').textContent = message; }
function optics(mode, message = '') {
  $('hostCard').hidden = mode !== 'offer';
  $('replyQr').hidden = mode !== 'answer';
  $('guide').hidden = mode !== 'scan';
  $('preparing').hidden = mode !== 'wait';
  $('preparing').textContent = message;
}
function errorText(error) {
  if (error?.name === 'NotAllowedError') return 'Allow camera and microphone access in your browser, then try again.';
  if (error?.name === 'NotReadableError') return 'Camera or microphone is in use. Close the other camera app and try again.';
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
    $('pairTiming').hidden = true;
    this.scanner = new Scanner($('camera'), (text, seconds) => this.readQR(text, seconds), hint);
    if (host) {
      this.room = new Room({
        name, code: roomNumber(),
        deliver: (id, msg) => id === HOST ? this.receive(msg) : this.connections.get(id)?.send(msg),
        audio: (id, frame) => id === HOST ? this.audio?.play(frame) : this.connections.get(id)?.sendVoice(frame)
      });
    }
  }
  async begin() {
    view('pair');
    $('pairTitle').textContent = this.host ? 'Pair your group' : 'Scan host QR';
    $('pairMeta').textContent = this.host ? 'Group ' + this.room.code : 'Front camera';
    $('go').hidden = !this.host;
    $('go').disabled = true;
    optics('wait', 'Starting camera…');
    hint('Allow camera and microphone access.');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw Error('Open TrekTalk in Safari or Chrome using its HTTPS address.');
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Context({latencyHint: 'interactive'});
    if (!this.ctx.audioWorklet) throw Error('This browser needs AudioWorklet support. Open TrekTalk in an up-to-date browser.');
    this.ctx.resume().catch(() => {});
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true},
      video: cameraSettings
    });
    if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    this.audio = new RadioAudio(this.ctx, stream, frame => {
      if (this.host) this.room.frame(HOST, frame);
      else this.guestAttempt?.link.sendVoice(frame);
    });
    await this.audio.init();
    if (this.closed) return;
    this.ctx.onstatechange = () => this.renderAudioButton();
    await this.scanner.start(stream.getVideoTracks()[0]);
    if (this.closed) return;
    this.leaseTimer = setInterval(() => {
      if (this.host) this.room.tick();
      if (this.held && this.radioState.mode === 'tx') this.command({op: 'keep', press: this.held.press});
    }, 700);
    this.wake();
    if (this.host) {
      this.room.publish();
      await this.invite();
    } else {
      optics('scan');
      hint('Face your screen toward the host screen, about a handspan apart. Keep them facing until Talkie opens.');
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
    if (this.closed || page !== 'pair' || !this.audio || this.restarting) return;
    this.restarting = true;
    try {
      this.scanner.stop();
      const stream = await navigator.mediaDevices.getUserMedia({video: cameraSettings, audio: false});
      const track = stream.getVideoTracks()[0];
      if (this.closed || page !== 'pair') { track.stop(); return; }
      await this.scanner.start(track);
    } finally { this.restarting = false; }
  }
  drop(attempt) {
    if (!attempt) return;
    clearTimeout(attempt.timeout);
    if (this.pending === attempt) this.pending = null;
    if (this.guestAttempt === attempt) this.guestAttempt = null;
    attempt.link.close();
  }
  async invite() {
    if (this.closed || !this.host || page !== 'pair') return;
    this.drop(this.pending);
    if (this.room.members.size >= CAPACITY) {
      optics('wait', 'All 10 radios are paired.');
      hint('Your group is ready.');
      return;
    }
    const attempt = {invite: newInvite(), phase: 'generating'};
    const link = new Link({
      host: true, ready: () => {}, control: msg => this.fromGuest(attempt, msg),
      voice: frame => { if (attempt.id) this.room.frame(attempt.id, frame); },
      lost: reason => this.hostLost(attempt, reason)
    });
    attempt.link = link;
    this.pending = attempt;
    optics('wait', 'Creating local QR…');
    try {
      const sdp = await link.offer();
      if (this.closed || this.pending !== attempt) return;
      drawCode($('hostQr'), pack('offer', attempt.invite, sdp));
      attempt.phase = 'offer';
      optics('offer');
      hint('Face the two screens toward each other. Pair one phone at a time. Tap the QR to refresh.');
    } catch (e) {
      if (this.pending !== attempt || this.closed) return;
      this.drop(attempt);
      optics('wait', 'Invitation unavailable');
      hint(errorText(e));
      $('retryCamera').textContent = 'Retry pairing';
    }
  }
  readQR(text, seconds) {
    if (this.closed || page !== 'pair' || !this.audio) return;
    if (text.startsWith('TT1:') || text.startsWith('TT3:')) {
      hint('That QR is from an older version. Open TrekTalk v9 on both phones.');
      return;
    }
    if (this.host) {
      const a = this.pending;
      if (!a || a.phase !== 'offer' || !text.startsWith('TK9A:' + a.invite + ':')) return;
      const decoded = unpack(text);
      if (!decoded) return;
      a.readAt = performance.now();
      a.phase = 'linking';
      hint('Reply read. Connecting over the hotspot…');
      a.timeout = setTimeout(() => this.hostLost(a, 'Connection timed out. Check the hotspot and pair again.'), 20000);
      a.link.accept(decoded.description).catch(e => this.hostLost(a, errorText(e)));
    } else {
      if (!text.startsWith('TK9O:') || this.guestAttempt?.welcomed) return;
      if (this.guestAttempt && text.startsWith('TK9O:' + this.guestAttempt.invite + ':')) return;
      const decoded = unpack(text);
      if (!decoded) return;
      this.answer(decoded, seconds);
    }
  }
  async answer(decoded, seconds) {
    this.drop(this.guestAttempt);
    const a = {invite: decoded.invite, readAt: performance.now(), scanSeconds: seconds};
    try {
      a.link = new Link({
        host: false,
        ready: () => a.link.send({op: 'hello', version: 9, name: this.name}),
        control: msg => {
          if (this.guestAttempt !== a || this.closed) return;
          if (msg.op === 'welcome' && msg.invite === a.invite) {
            a.welcomed = true;
            a.link.send({op: 'here'});
          } else if (a.welcomed) this.receive(msg);
        },
        voice: frame => { if (this.guestAttempt === a) this.audio.play(frame); },
        lost: reason => this.guestLost(a, reason)
      });
      this.guestAttempt = a;
      optics('wait', 'Preparing reply…');
      hint('Keep both screens facing each other.');
      const sdp = await a.link.answer(decoded.description);
      if (this.closed || this.guestAttempt !== a || page !== 'pair') return;
      drawCode($('replyQr'), pack('answer', a.invite, sdp));
      optics('answer');
      $('pairTitle').textContent = 'Pairing';
      hint('Keep the screens facing. The host front camera reads this reply automatically.');
      a.timeout = setTimeout(() => this.guestLost(a, 'The host did not confirm. Refresh the host QR and face the screens again.'), 24000);
    } catch (e) {
      if (this.guestAttempt === a) this.guestLost(a, errorText(e));
      else if (!this.closed && !this.guestAttempt) hint(errorText(e));
    }
  }
  fromGuest(a, msg) {
    if (this.closed) return;
    if (a.id) {
      if (this.connections.get(a.id) !== a.link) return;
      if (msg.op === 'leave') this.hostLost(a, 'Left the group.');
      else this.room.input(a.id, msg);
      return;
    }
    if (this.pending !== a || a.phase !== 'linking') return;
    if (msg.op === 'hello' && msg.version === 9) {
      a.name = displayName(msg.name, 'Hiker');
      a.link.send({op: 'welcome', invite: a.invite});
    }
    if (msg.op === 'here' && a.name) {
      clearTimeout(a.timeout);
      $('pairTiming').textContent = 'Last guest connected ' + ((performance.now() - a.readAt) / 1000).toFixed(1) + ' s after reading their reply.';
      $('pairTiming').hidden = false;
      a.id = this.room.add(a.name);
      this.connections.set(a.id, a.link);
      this.pending = null;
      this.room.publish();
      if (page === 'pair') this.invite();
    }
  }
  hostLost(a, reason) {
    if (this.closed) return;
    if (a.id) {
      if (this.connections.get(a.id) !== a.link) return;
      this.connections.delete(a.id);
      this.drop(a);
      this.room.remove(a.id);
      if (page === 'pair' && !this.pending) this.invite();
    } else if (this.pending === a) {
      this.drop(a);
      if (page === 'pair') { hint(reason); this.invite(); }
    }
  }
  guestLost(a, reason) {
    if (this.closed || this.guestAttempt !== a) return;
    this.drop(a);
    if (page === 'radio') { end(reason + ' Ask the host to open pairing.'); return; }
    optics('scan');
    $('pairTitle').textContent = 'Scan host QR';
    hint(reason);
  }
  enterRadio() {
    view('radio');
    this.scanner.stop();
    $('add').hidden = !this.host || this.roster?.people.length >= CAPACITY;
    this.renderAudioButton();
    this.paintTargets();
  }
  go() {
    if (!this.host || this.room.members.size < 2 || page !== 'pair') return;
    // Preserve all confirmed links and let an already accepted reply finish.
    if (this.pending?.phase !== 'linking') this.drop(this.pending);
    this.enterRadio();
    this.room.start();
  }
  async addPhone() {
    if (!this.host || this.room.members.size >= CAPACITY) return;
    this.release();
    view('pair');
    $('go').hidden = false;
    $('go').disabled = false;
    $('pairTitle').textContent = 'Pair another phone';
    optics('wait', 'Starting front camera…');
    await this.restartCamera();
    if (!this.closed && page === 'pair' && this.pending?.phase !== 'linking') await this.invite();
  }
  receive(msg) {
    if (this.closed) return;
    if (msg.op === 'ended') { end('The host closed this group.'); return; }
    if (msg.op === 'room') {
      if (!Array.isArray(msg.people) || msg.people.length > CAPACITY || !msg.people.some(p => p.id === msg.self)) return;
      this.roster = msg;
      if (this.host) {
        $('go').disabled = msg.people.length < 2;
        $('pairMeta').textContent = 'Group ' + msg.code + ' · ' + (msg.people.length - 1) + ' paired';
      } else if (page === 'pair') {
        clearTimeout(this.guestAttempt.timeout);
        const a = this.guestAttempt;
        const read = a.scanSeconds ? 'QR read ' + a.scanSeconds.toFixed(1) + ' s after camera start. ' : '';
        $('pairTiming').textContent = read + 'Connected ' + ((performance.now() - a.readAt) / 1000).toFixed(1) + ' s after reading the offer.';
        $('pairTiming').hidden = false;
        this.enterRadio();
      }
      $('add').hidden = !this.host || msg.people.length >= CAPACITY;
      $('roomMeta').textContent = 'Group ' + msg.code + ' · ' + msg.people.length + ' connected';
      this.paintTargets();
      return;
    }
    if (msg.op === 'denied') {
      if (this.held?.press === msg.press) { this.audio.gate(0); this.held = null; this.paintFloor(); }
      return;
    }
    if (msg.op !== 'floor') return;
    this.radioState = msg;
    if (msg.mode === 'tx') {
      if (this.held?.press !== msg.press || this.held?.target !== msg.target || page !== 'radio' || document.hidden) {
        this.audio.gate(0);
        this.command({op: 'release', press: msg.press});
        return;
      }
      this.audio.listen(0);
      this.audio.gate(msg.token);
    } else {
      this.audio?.gate(0);
      this.audio?.listen(msg.mode === 'rx' ? msg.token : 0);
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
        label.textContent = 'Talk to ' + name;
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
    let label = 'Listening';
    if (!this.roster.started) label = 'Paired. Waiting for the host to open Talkie.';
    else if (this.roster.people.length < 2) label = 'Waiting for another radio.';
    else if (mode === 'tx' && this.held) label = 'Transmitting · release to listen';
    else if (mode === 'rx') label = 'Receiving from ' + name;
    else if (mode === 'busy') label = 'Channel busy';
    else if (this.held) label = 'Requesting channel…';
    $('channel').dataset.mode = mode;
    $('channelLabel').textContent = label;
    for (const button of $('targets').children) {
      const active = this.held?.target === button.dataset.target && mode === 'tx';
      button.classList.toggle('held', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-disabled', String(!enabled || (!active && mode !== 'idle')));
      button.lastElementChild.textContent = active ? 'ON AIR' : 'HOLD';
    }
  }
  command(msg) {
    if (this.host) this.room.input(HOST, msg);
    else this.guestAttempt?.link.send(msg);
  }
  press(target, key) {
    if (page !== 'radio' || !this.roster?.started || this.roster.people.length < 2 || this.held ||
        this.radioState.mode !== 'idle' || document.hidden) return;
    this.ctx.resume().catch(() => {});
    this.held = {target, press: ++this.counter, key};
    this.paintFloor();
    this.command({op: 'ask', target, press: this.held.press});
  }
  release(key) {
    if (!this.held || (key !== undefined && key !== this.held.key)) return;
    const {press} = this.held;
    this.held = null;
    this.audio?.gate(0);
    this.command({op: 'release', press});
    this.paintFloor();
  }
  renderAudioButton() {
    $('resume').hidden = page !== 'radio' || this.ctx.state === 'running';
  }
  close() {
    if (this.closed) return;
    this.release();
    this.closed = true;
    clearInterval(this.leaseTimer);
    if (this.host) {
      for (const link of this.connections.values()) { link.send({op: 'ended'}); link.close(); }
      this.connections.clear();
    } else this.guestAttempt?.link.send({op: 'leave'});
    this.drop(this.pending);
    this.drop(this.guestAttempt);
    this.scanner.stop();
    this.audio?.close();
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close().catch(() => {});
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
  const name = displayName($('name').value, host ? 'Host' : 'Hiker');
  try { localStorage.setItem('trektalk-name', $('name').value.trim()); } catch {}
  const session = new Session(host, name);
  current = session;
  try { await session.begin(); }
  catch (e) { if (current === session) end(errorText(e)); }
}
try { $('name').value = localStorage.getItem('trektalk-name') || ''; } catch {}
$('host').onclick = () => start(true);
$('guest').onclick = () => start(false);
$('go').onclick = () => current?.go();
$('hostCard').onclick = () => { if (current?.pending?.phase === 'offer') current.invite(); };
$('leave').onclick = () => end();
$('add').onclick = () => current?.addPhone().catch(e => hint(errorText(e)));
$('resume').onclick = () => current?.ctx.resume().catch(e => { $('channelLabel').textContent = errorText(e); });
$('retryCamera').onclick = async () => {
  $('tools').open = false;
  const s = current;
  if (!s) return;
  try { await s.restartCamera(); if (s.host && !s.pending) await s.invite(); }
  catch (e) { hint(errorText(e)); }
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
    const code = unpack(text);
    if (!code || code.description.type !== (s.host ? 'answer' : 'offer') || (s.host && code.invite !== s.pending?.invite)) {
      hint('This is not the current partner QR. Use the code on the other phone.');
    } else s.readQR(text, 0);
  } catch (e) { if (s === current) hint(errorText(e)); }
};

$('targets').onpointerdown = e => {
  const button = e.target.closest('button[data-target]');
  if (!button || !e.isPrimary || e.button !== 0) return;
  e.preventDefault();
  button.setPointerCapture(e.pointerId);
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
  else { current?.wake(); current?.renderAudioButton(); }
});

async function prepareOffline() {
  if (!('serviceWorker' in navigator) || !('caches' in window)) throw Error();
  const reg = await navigator.serviceWorker.register('./sw.js', {updateViaCache: 'none'});
  const markReady = async () => {
    const hit = await caches.match(new URL('./__trektalk_ready_v9__', location.href).href, {cacheName: 'trektalk-v9'});
    if (hit) $('offline').textContent = 'Ready offline · v9';
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
  await navigator.serviceWorker.ready;
  await markReady();
}
prepareOffline().catch(() => { $('offline').textContent = 'Offline files unavailable. Reopen this page while online.'; });
