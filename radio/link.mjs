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
      else reject(Object.assign(Error('No local network address. Join the same hotspot, then retry.'), {code:'NO_LOCAL_ADDRESS'}));
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
  constructor({initiator, ready, control, lost}) {
    this.pc = new RTCPeerConnection({iceServers: [], bundlePolicy: 'max-bundle'});
    this.closed = false;
    this.open = false;
    this.onLost = lost;
    const attach = channel => {
      if (channel.label !== 'control' || this.channel) { channel.close(); return; }
      this.channel = channel;
      channel.onmessage = event => {
        if (this.closed) return;
        if (typeof event.data !== 'string' || event.data.length > 8192) return;
        let details;
        try { details = JSON.parse(event.data); } catch { return; }
        if (details && typeof details.op === 'string') control(details);
      };
      channel.onclose = () => this.fail('Radio link closed.');
      channel.onerror = () => this.fail('Radio link interrupted.');
      const check = () => {
        if (!this.open && !this.closed && channel.readyState === 'open') {
          this.open = true;
          ready();
        }
      };
      channel.onopen = check;
      check();
    };
    this.pc.ondatachannel = ({channel}) => attach(channel);
    const connectionChanged = () => {
      if (this.closed) return;
      const connection = this.pc.connectionState;
      const ice = this.pc.iceConnectionState;
      if (connection === 'failed' || connection === 'closed' || ice === 'failed' || ice === 'closed') {
        this.fail('The local connection ended.');
      } else if (connection === 'disconnected' || ice === 'disconnected') {
        this.grace ??= setTimeout(() => this.fail('Lost the hotspot connection.'), 4000);
      } else {
        clearTimeout(this.grace);
        this.grace = null;
      }
    };
    this.pc.onconnectionstatechange = connectionChanged;
    this.pc.oniceconnectionstatechange = connectionChanged;
    if (initiator) {
      attach(this.pc.createDataChannel('control', {ordered: true}));
    }
  }
  async offer() { return localDescription(this.pc, await this.pc.createOffer()); }
  async answer(offer) {
    await this.pc.setRemoteDescription(offer);
    return localDescription(this.pc, await this.pc.createAnswer());
  }
  accept(answer) { return this.pc.setRemoteDescription(answer); }
  send(message) {
    if (this.channel?.readyState !== 'open') return false;
    try { this.channel.send(JSON.stringify(message)); return true; } catch { return false; }
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
    this.pc.oniceconnectionstatechange = null;
    this.pc.close();
  }
}
