export const HOST = 'host';
export const ALL = '*';
export const CAPACITY = 10;
export const FRAME_BYTES = 326;
const LEASE_MS = 3500;

export function displayName(input, fallback) {
  return String(input || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 24) || fallback;
}

// The hub is the single authority for membership, channel ownership, and
// addressing. Only the intended listeners receive a transmission's audio bytes.
export class Room {
  constructor({name, code, deliver, audio, now = () => performance.now()}) {
    this.members = new Map([[HOST, displayName(name, 'Host')]]);
    this.code = code;
    this.deliver = deliver;
    this.audio = audio;
    this.now = now;
    this.started = false;
    this.floor = null;
    this.nextFloor = 0;
    this.nextId = 0;
  }
  add(name) {
    if (this.members.size >= CAPACITY) throw Error('This group is full.');
    const id = 'p' + ++this.nextId;
    const base = displayName(name, 'Hiker');
    let label = base;
    let suffix = 2;
    const existing = new Set([...this.members.values()].map(x => x.toLowerCase()));
    while (existing.has(label.toLowerCase())) label = base + ' ' + suffix++;
    this.members.set(id, label);
    return id;
  }
  publish() {
    const people = Array.from(this.members, ([id, name]) => ({id, name}));
    for (const self of this.members.keys()) {
      this.deliver(self, {op: 'room', self, code: this.code, started: this.started, people});
      this.sendFloor(self);
    }
  }
  start() { this.started = true; this.publish(); }
  remove(id) {
    if (id === HOST || !this.members.delete(id)) return;
    if (this.floor?.speaker === id || this.floor?.target === id || this.members.size < 2) this.floor = null;
    this.publish();
  }
  hears(id) {
    return this.floor && id !== this.floor.speaker && (this.floor.target === ALL || id === this.floor.target);
  }
  sendFloor(id) {
    const f = this.floor;
    if (!f) return this.deliver(id, {op: 'floor', mode: 'idle'});
    if (id === f.speaker) {
      this.deliver(id, {op: 'floor', mode: 'tx', token: f.token, press: f.press, target: f.target});
    } else if (this.hears(id)) {
      this.deliver(id, {op: 'floor', mode: 'rx', token: f.token, name: this.members.get(f.speaker)});
    } else {
      this.deliver(id, {op: 'floor', mode: 'busy'});
    }
  }
  broadcastFloor() { for (const id of this.members.keys()) this.sendFloor(id); }
  input(id, message) {
    if (!this.members.has(id) || !Number.isSafeInteger(message.press) || message.press < 1) return;
    if (message.op === 'ask') {
      const target = message.target;
      if (!this.started || this.members.size < 2 || target === id || (target !== ALL && !this.members.has(target)) || this.floor) {
        this.deliver(id, {op: 'denied', press: message.press});
        return;
      }
      this.nextFloor = (this.nextFloor + 1) >>> 0 || 1;
      this.floor = {speaker: id, target, token: this.nextFloor, press: message.press, until: this.now() + LEASE_MS};
      this.broadcastFloor();
      return;
    }
    if (this.floor?.speaker !== id || this.floor.press !== message.press) return;
    if (message.op === 'keep') this.floor.until = this.now() + LEASE_MS;
    if (message.op === 'release') { this.floor = null; this.broadcastFloor(); }
  }
  tick() {
    if (this.floor && this.now() >= this.floor.until) { this.floor = null; this.broadcastFloor(); }
  }
  frame(id, packet) {
    if (!this.floor || this.floor.speaker !== id || this.now() >= this.floor.until || packet.byteLength !== FRAME_BYTES) return;
    if (new DataView(packet).getUint32(0) !== this.floor.token) return;
    for (const member of this.members.keys()) if (this.hears(member)) this.audio(member, packet);
  }
}
