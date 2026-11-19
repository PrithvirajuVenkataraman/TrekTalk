import {ToneReader, renderTone} from './radio/sound.mjs?v=11';
import {newInvite, roomNumber, pack, unpack, drawCode, sealAnswer, openAnswer} from './radio/pairing.mjs?v=11';
import {Link} from './radio/link.mjs?v=11';
import {Room, HOST, ALL, CAPACITY, displayName} from './radio/room.mjs?v=11';
import {RadioAudio} from './radio/audio.mjs?v=11';
import {Scanner} from './radio/scanner.mjs?v=11';

const $ = id => document.getElementById(id);
async function openRearCamera(audio = false) {
  if (!navigator.mediaDevices.getSupportedConstraints().facingMode) {
    throw Error('This browser cannot select a rear camera. Open TrekTalk in Safari or Chrome on your phone.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {facingMode: {exact: 'environment'}, width: {ideal: 1280}, height: {ideal: 960}},
    audio
  });
  const track = stream.getVideoTracks()[0];
  const facing = track?.getSettings().facingMode;
  if (!track || (facing && facing !== 'environment')) {
    stream.getTracks().forEach(t => t.stop());
    throw Error('Rear camera unavailable. Check that your browser can use the rear camera.');
  }
  return stream;
}
let current;
let page = 'home';

function view(next) {
  page = next;
  for (const id of ['home', 'pair', 'radio']) $(id).hidden = id !== next;
  $('tools').hidden = next === 'home';
  $('tools').open = false;
  $('refreshOffer').hidden = next !== 'pair' || current?.host;
  $('photo').hidden = $('retryCamera').hidden = next !== 'pair' || !current?.host;
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
  if (error?.name === 'NotAllowedError') return 'Allow camera and microphone access in your browser, then try again.';
  if (error?.name === 'NotReadableError') return 'Camera or microphone is in use. Close the other camera app and try again.';
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
    $('pairTitle').textContent = this.host ? 'Scan guest QR' : 'Show your join QR';
    $('pairMeta').textContent = this.host ? 'Group ' + this.room.code : 'Guest';
    $('retryCamera').textContent = 'Restart rear camera';
    $('go').hidden = !this.host;
    $('go').disabled = true;
    optics('wait', this.host ? 'Starting rear camera…' : 'Preparing your QR…');
    hint(this.host ? 'Allow camera and microphone access.' : 'Allow the microphone to receive the pairing sound.');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw Error('Open TrekTalk in Safari or Chrome using its HTTPS address.');
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Context({latencyHint: 'interactive'});
    if (!this.ctx.audioWorklet) throw Error('This browser needs AudioWorklet support. Open TrekTalk in an up-to-date browser.');
    this.ctx.resume().catch(() => {});
    const stream = this.host
      ? await openRearCamera({channelCount: 1, echoCancellation: true, noiseSuppression: true})
      : await navigator.mediaDevices.getUserMedia({video: false, audio: {channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false}});
    if (this.closed) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    this.audio = new RadioAudio(this.ctx, stream, frame => {
      if (this.host) this.room.frame(HOST, frame);
      else this.guestAttempt?.link.sendVoice(frame);
    });
    await this.audio.init();
    if (this.closed) return;
    this.ctx.onstatechange = () => this.renderAudioButton();
    this.renderAudioButton();
    if (this.host) await this.scanner.start(stream.getVideoTracks()[0]);
    if (this.closed) return;
    this.leaseTimer = setInterval(() => {
      if (this.host) this.room.tick();
      if (this.held && this.radioState.mode === 'tx') this.command({op: 'keep', press: this.held.press});
    }, 700);
    this.wake();
    if (this.host) {
      this.room.publish();
      this.scanGuests();
    } else {
      await this.makeGuestQR();
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
    if (!this.host || this.closed || page !== 'pair' || !this.audio || this.restarting) return;
    this.restarting = true;
    try {
      this.scanner.stop();
      const stream = await openRearCamera();
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
    attempt.link?.close();
  }
  scanGuests(message) {
    if (this.closed || page !== 'pair' || this.pending) return;
    if (this.room.members.size >= CAPACITY) {
      optics('wait', 'All 10 radios are paired.');
      hint('Your group is ready.');
      return;
    }
    $('pairTitle').textContent = 'Scan guest QR';
    optics('scan');
    hint(message || 'Point the rear camera at a guest’s join QR. Keep the phone speaker on.');
  }
  async makeGuestQR() {
    if (this.host || this.closed || page !== 'pair' || !this.audio) return;
    this.drop(this.guestAttempt);
    const a = {invite: newInvite()};
    this.guestAttempt = a;
    optics('wait', 'Creating your join QR…');
    try {
      a.link = new Link({
        initiator: true,
        ready: () => a.link.send({op: 'hello', version: 11, name: this.name}),
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
      a.offer = await a.link.offer();
      if (this.closed || this.guestAttempt !== a) return;
      drawCode($('joinQr'), pack('offer', a.invite, a.offer));
      this.audio.pairing(new ToneReader(packet => this.heardAnswer(a, packet)));
      optics('offer');
      hint('Show this code to the host. Keep the phones close while the host plays the pairing sound.');
    } catch (e) { this.guestLost(a, errorText(e)); }
  }
  async heardAnswer(a, packet) {
    if (this.closed || this.guestAttempt !== a || a.accepting) return;
    const description = await openAnswer(a.invite, a.offer, packet);
    if (!description || this.closed || this.guestAttempt !== a || a.accepting) return;
    a.accepting = true;
    a.readAt = performance.now();
    this.audio.pairing(null);
    optics('wait', 'Connecting…');
    hint('Pairing sound received. Connecting over the hotspot…');
    a.timeout = setTimeout(() => this.guestLost(a, 'Connection timed out. Check the hotspot, then refresh your join QR in Options.'), 18000);
    try { await a.link.accept(description); }
    catch (e) { this.guestLost(a, errorText(e)); }
  }
  readQR(text) {
    if (!this.host || this.closed || page !== 'pair' || !this.audio || this.pending || this.room.members.size >= CAPACITY) return;
    if (/^(?:TK9|TT[13]:)/.test(text)) { hint('Open TrekTalk v11 on both phones. The guest must show their join QR.'); return; }
    const decoded = unpack(text);
    if (!decoded || decoded.description.type !== 'offer' || this.lastFailed === decoded.invite) return;
    for (const link of this.connections.values()) if (link.invite === decoded.invite) return;
    this.connectGuest(decoded);
  }
  async connectGuest({invite, description}) {
    const a = {invite, phase: 'linking', readAt: performance.now()};
    this.pending = a;
    optics('wait', 'QR read');
    hint('Keep the phones close. Sending the pairing sound from this phone’s speaker.');
    try {
      a.link = new Link({
        initiator: false, ready: () => {}, control: msg => this.fromGuest(a, msg),
        voice: frame => { if (a.id) this.room.frame(a.id, frame); },
        lost: reason => this.hostLost(a, reason)
      });
      a.link.invite = invite;
      const sdp = await a.link.answer(description);
      const bytes = await sealAnswer(invite, description.sdp, sdp);
      if (this.closed || this.pending !== a) return;
      const tone = renderTone(bytes);
      let tries = 0;
      const play = () => {
        if (this.closed || this.pending !== a) return;
        if (tries >= 3) {
          this.hostLost(a, 'No reply. Check speaker volume and hotspot access. Ask the guest to refresh their join QR.');
          return;
        }
        tries++;
        const seconds = this.audio.playTone(tone);
        a.timeout = setTimeout(play, seconds * 1000 + 2400);
      };
      play();
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
    if (this.pending !== a || a.phase !== 'linking') return;
    if (msg.op === 'hello' && msg.version === 11) {
      a.name = displayName(msg.name, 'Hiker');
      a.link.send({op: 'welcome', invite: a.invite});
    }
    if (msg.op === 'here' && a.name) {
      clearTimeout(a.timeout);
      $('pairTiming').textContent = 'Last guest connected ' + ((performance.now() - a.readAt) / 1000).toFixed(1) + ' s after scanning their QR.';
      $('pairTiming').hidden = false;
      this.audio.stopTone();
      a.id = this.room.add(a.name);
      this.connections.set(a.id, a.link);
      this.pending = null;
      this.room.publish();
      if (page === 'pair') this.scanGuests();
    }
  }
  hostLost(a, reason) {
    if (this.closed) return;
    if (a.id) {
      if (this.connections.get(a.id) !== a.link) return;
      this.connections.delete(a.id);
      this.drop(a);
      this.room.remove(a.id);
      if (page === 'pair' && !this.pending) this.scanGuests();
    } else if (this.pending === a) {
      this.drop(a);
      this.audio.stopTone();
      this.lastFailed = a.invite;
      if (page === 'pair') this.scanGuests(reason);
    }
  }
  guestLost(a, reason) {
    if (this.closed || this.guestAttempt !== a) return;
    this.drop(a);
    if (page === 'radio') { end(reason + ' Ask the host to open pairing.'); return; }
    this.audio?.pairing(null);
    optics('wait', 'Pairing paused');
    hint(reason + ' Use Options to refresh your QR.');
  }
  enterRadio() {
    view('radio');
    this.scanner.stop();
    if (!this.host) {
      this.audio.pairing(null);
      this.audio.track.applyConstraints({echoCancellation:true, noiseSuppression:true}).catch(() => {});
    }
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
    optics('wait', 'Starting rear camera…');
    await this.restartCamera();
    this.scanGuests();
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
        $('pairTiming').textContent = 'Connected ' + ((performance.now() - a.readAt) / 1000).toFixed(1) + ' s after receiving the pairing sound.';
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
    $('pairAudio').hidden = page !== 'pair' || this.ctx.state === 'running';
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
$('refreshOffer').onclick = () => { $('tools').open = false; current?.makeGuestQR(); };
$('leave').onclick = () => end();
$('add').onclick = () => current?.addPhone().catch(e => hint(errorText(e)));
$('pairAudio').onclick = () => current?.ctx.resume().catch(e => hint(errorText(e)));
$('resume').onclick = () => current?.ctx.resume().catch(e => { $('channelLabel').textContent = errorText(e); });
$('retryCamera').onclick = async () => {
  $('tools').open = false;
  const s = current;
  if (!s) return;
  try { await s.restartCamera(); s.lastFailed = null; s.scanGuests(); }
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
    if (!code || !s.host || code.description.type !== 'offer') {
      hint('This is not the current partner QR. Use the code on the other phone.');
    } else s.readQR(text);
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
    const hit = await caches.match(new URL('./__trektalk_ready_v11__', location.href).href, {cacheName: 'trektalk-v11'});
    if (hit) $('offline').textContent = 'Ready offline · v11';
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
