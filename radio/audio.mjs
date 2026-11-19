const sampleTable = Float32Array.from({length: 256}, (_, value) => {
  const bits = (~value) & 255;
  const magnitude = (((bits & 15) << 3) + 132) << ((bits >> 4) & 7);
  return ((bits & 128 ? -1 : 1) * (magnitude - 132)) / 32768;
});

export class RadioAudio {
  constructor(context, stream, transmit) {
    this.context = context;
    this.track = stream.getAudioTracks()[0];
    this.track.enabled = false;
    this.transmit = transmit;
    this.token = 0;
    this.listening = 0;
    this.scheduled = new Set();
    this.sequences = new Set();
  }
  async init() {
    await this.context.audioWorklet.addModule('./radio/capture.worklet.js?v=11');
    this.capture = new AudioWorkletNode(this.context, 'trek-capture');
    this.mic = this.context.createMediaStreamSource(new MediaStream([this.track]));
    this.mic.connect(this.capture);
    // The worklet has a silent output. Keeping it connected drives its render loop.
    this.capture.connect(this.context.destination);
    this.capture.port.onmessage = ({data}) => {
      if (data instanceof Float32Array) this.reader?.push(data);
      else if (this.token && new DataView(data).getUint32(0) === this.token) this.transmit(data);
    };
  }
  pairing(reader) {
    this.reader = reader;
    this.track.enabled = Boolean(reader || this.token);
    this.capture.port.postMessage(reader ? 'pairing' : this.token);
  }
  playTone(samples) {
    this.stopTone();
    const source = this.context.createBufferSource();
    source.buffer = this.context.createBuffer(1, samples.length, 16000);
    source.buffer.copyToChannel(samples, 0);
    source.connect(this.context.destination);
    source.onended = () => { source.disconnect(); if (this.tone === source) this.tone = null; };
    this.tone = source;
    source.start();
    return source.buffer.duration;
  }
  stopTone() {
    if (this.tone) { this.tone.stop(); this.tone = null; }
  }
  gate(token) {
    if (this.token === token) return;
    this.token = token;
    this.track.enabled = Boolean(token);
    this.capture?.port.postMessage(token);
  }
  listen(token) {
    if (this.listening === token) return;
    this.listening = token;
    this.anchor = null;
    this.sequences.clear();
  }
  play(packet) {
    if (!this.listening || packet.byteLength !== 326 || this.context.state !== 'running') return;
    const header = new DataView(packet);
    if (header.getUint32(0) !== this.listening) return;
    const seq = header.getUint16(4);
    if (this.sequences.has(seq)) return;
    const now = this.context.currentTime;
    if (!this.anchor || now - this.lastArrival > 0.25) this.anchor = {seq, time: now + 0.075};
    const relative = ((seq - this.anchor.seq + 32768) & 65535) - 32768;
    let when = this.anchor.time + relative * 0.02;
    if (when < now - 0.015) return;
    if (when > now + 0.22) when = now + 0.075;
    when = Math.max(now, when);
    if (relative >= 0) this.anchor = {seq, time: when};
    this.lastArrival = now;
    this.sequences.add(seq);
    if (this.sequences.size > 32) this.sequences.delete(this.sequences.values().next().value);
    const buffer = this.context.createBuffer(1, 320, 16000);
    const samples = buffer.getChannelData(0);
    const bytes = new Uint8Array(packet, 6);
    for (let i = 0; i < bytes.length; i++) samples[i] = sampleTable[bytes[i]];
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.scheduled.add(source);
    source.onended = () => { this.scheduled.delete(source); source.disconnect(); };
    source.start(when);
  }
  close() {
    this.stopTone();
    this.gate(0);
    this.track.stop();
    this.capture?.disconnect();
    this.capture?.port.close();
    this.mic?.disconnect();
    for (const source of this.scheduled) { try { source.stop(); } catch {} }
    this.scheduled.clear();
  }
}
