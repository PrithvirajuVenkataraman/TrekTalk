// 20 ms, 16 kHz, mono. Each packet has a grant ID, sequence and 320 µ-law samples.
function encodeSample(value) {
  const sample = Math.max(-1, Math.min(1, value)) * 32767;
  const magnitude = Math.min(32635, Math.abs(sample)) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent && !(magnitude & mask); mask >>= 1) exponent--;
  const mantissa = (magnitude >> (exponent + 3)) & 15;
  return ~( (sample < 0 ? 128 : 0) | (exponent << 4) | mantissa ) & 255;
}

class TrekCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.token = 0;
    this.port.onmessage = ({data}) => {
      this.token = data >>> 0;
      this.seq = this.phase = this.sum = this.count = this.used = 0;
      this.packet = new Uint8Array(326);
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!this.token || !input) return true;
    for (const sample of input) {
      this.sum += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      this.packet[6 + this.used++] = encodeSample(this.sum / this.count);
      this.sum = this.count = 0;
      if (this.used === 320) {
        const bytes = this.packet.buffer;
        const header = new DataView(bytes);
        header.setUint32(0, this.token);
        header.setUint16(4, this.seq++);
        this.port.postMessage(bytes, [bytes]);
        this.packet = new Uint8Array(326);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('trek-capture', TrekCapture);
