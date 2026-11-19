// One independent connection per guest. The QR carries only SCTP bootstrap
// information. Audio frames and channel control then use separate data channels.
async function localDescription(pc, description) {
  await pc.setLocalDescription(description);
  const snapshot = () => pc.localDescription?.sdp || '';
  const hasCandidate = () => /^a=candidate:/m.test(snapshot());
  if (pc.iceGatheringState === 'complete' && hasCandidate()) return snapshot();
  return new Promise((resolve, reject) => {
    let quiet;
    const finish = () => {
      clearTimeout(deadline);
      clearTimeout(quiet);
      pc.removeEventListener('icecandidate', changed);
      pc.removeEventListener('icegatheringstatechange', changed);
      pc.removeEventListener('signalingstatechange', changed);
      if (pc.signalingState === 'closed') reject(Error('Pairing ended.'));
      else if (hasCandidate()) resolve(snapshot());
      else reject(Error('No local network address. Join the same hotspot, then retry.'));
    };
    const changed = () => {
      if (pc.signalingState === 'closed' || pc.iceGatheringState === 'complete') return finish();
      if (hasCandidate()) {
        clearTimeout(quiet);
        quiet = setTimeout(finish, 300);
      }
    };
    const deadline = setTimeout(finish, 6500);
    pc.addEventListener('icecandidate', changed);
    pc.addEventListener('icegatheringstatechange', changed);
    pc.addEventListener('signalingstatechange', changed);
    changed();
  });
}

export class Link {
  constructor({initiator, ready, control, voice, lost}) {
    this.pc = new RTCPeerConnection({iceServers: [], bundlePolicy: 'max-bundle'});
    this.channels = {};
    this.closed = false;
    this.open = false;
    this.onLost = lost;
    const attach = channel => {
      const name = channel.label;
      if (!['control', 'voice'].includes(name) || this.channels[name]) { channel.close(); return; }
      this.channels[name] = channel;
      channel.binaryType = 'arraybuffer';
      channel.onmessage = event => {
        if (this.closed) return;
        if (name === 'voice') {
          if (event.data instanceof ArrayBuffer && event.data.byteLength === 326) voice(event.data);
          return;
        }
        if (typeof event.data !== 'string' || event.data.length > 8192) return;
        let details;
        try { details = JSON.parse(event.data); } catch { return; }
        if (details && typeof details.op === 'string') control(details);
      };
      channel.onclose = () => this.fail('Radio link closed.');
      channel.onerror = () => this.fail('Radio link interrupted.');
      const check = () => {
        if (!this.open && !this.closed && ['control', 'voice'].every(k => this.channels[k]?.readyState === 'open')) {
          this.open = true;
          ready();
        }
      };
      channel.onopen = check;
      check();
    };
    this.pc.ondatachannel = ({channel}) => attach(channel);
    this.pc.onconnectionstatechange = () => {
      clearTimeout(this.grace);
      const state = this.pc.connectionState;
      if (state === 'disconnected') this.grace = setTimeout(() => this.fail('Lost the hotspot connection.'), 4000);
      if (state === 'failed' || state === 'closed') this.fail('The local connection ended.');
    };
    if (initiator) {
      attach(this.pc.createDataChannel('control', {ordered: true}));
      attach(this.pc.createDataChannel('voice', {ordered: false, maxRetransmits: 0}));
    }
  }
  async offer() { return localDescription(this.pc, await this.pc.createOffer()); }
  async answer(offer) {
    await this.pc.setRemoteDescription(offer);
    return localDescription(this.pc, await this.pc.createAnswer());
  }
  accept(answer) { return this.pc.setRemoteDescription(answer); }
  send(message) {
    if (this.channels.control?.readyState !== 'open') return false;
    try { this.channels.control.send(JSON.stringify(message)); return true; } catch { return false; }
  }
  sendVoice(packet) {
    const channel = this.channels.voice;
    if (channel?.readyState === 'open' && channel.bufferedAmount < 8192) {
      try { channel.send(packet); } catch { /* A closing radio drops the frame. */ }
    }
  }
  fail(reason) {
    if (this.closed) return;
    this.close();
    this.onLost(reason);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.grace);
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }
}
