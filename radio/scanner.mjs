// A native detector is optional. The local jsQR fallback works without Internet.
export class Scanner {
  constructor(video, read, warn) {
    this.video = video;
    this.read = read;
    this.warn = warn;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', {willReadFrequently: true});
    this.sequence = 0;
    this.lastHint = 0;
    try {
      if (globalThis.BarcodeDetector) this.native = new BarcodeDetector({formats: ['qr_code']});
    } catch {}
  }
  async start(track) {
    this.stop();
    const generation = this.sequence;
    this.track = track;
    this.video.srcObject = new MediaStream([track]);
    try { await this.video.play(); }
    catch (error) {
      if (generation === this.sequence) this.stop();
      throw error;
    }
    if (generation !== this.sequence) return;
    this.started = performance.now();
    let frameNumber = 0;
    let lastVideoTime = -1;
    const loop = async () => {
      if (generation !== this.sequence) return;
      try {
        if (!document.hidden && this.video.readyState >= 2 && this.video.videoWidth && lastVideoTime !== this.video.currentTime) {
          lastVideoTime = this.video.currentTime;
          frameNumber++;
          // Match the square camera preview first. A small central crop is much
          // cheaper to decode than every pixel of a landscape camera frame.
          let text = this.imageText(this.video, this.video.videoWidth, this.video.videoHeight, true, 360);
          if (!text && frameNumber % 2 === 0) {
            text = this.imageText(this.video, this.video.videoWidth, this.video.videoHeight, true, 640);
          }
          if (!text && this.native) {
            try {
              let timer;
              try {
                const detected = await Promise.race([
                  this.native.detect(this.video),
                  new Promise((_, reject) => { timer = setTimeout(() => reject(Error('QR detector timed out')), 80); })
                ]);
                text = detected[0]?.rawValue;
              } finally { clearTimeout(timer); }
            }
            catch { this.native = null; }
          }
          if (!text) {
            text = this.imageText(this.video, this.video.videoWidth, this.video.videoHeight, false, 640);
          }
          if (text && generation === this.sequence) this.read(text, (performance.now() - this.started) / 1000);
        }
      } catch {
        if (performance.now() - this.lastHint > 3000) { this.lastHint = performance.now(); this.warn('Camera frame unavailable. Keep TrekTalk in the foreground.'); }
      }
      if (generation === this.sequence) this.timer = setTimeout(loop, 25);
    };
    this.timer = setTimeout(loop, 0);
  }
  imageText(image, w, h, crop, limit) {
    const cw = crop ? Math.min(w, h) * 0.90 : w;
    const ch = crop ? cw : h;
    const scale = Math.min(1, limit / Math.max(cw, ch));
    const width = Math.max(1, Math.round(cw * scale));
    const height = Math.max(1, Math.round(ch * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.drawImage(image, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, width, height);
    const pixels = this.ctx.getImageData(0, 0, width, height);
    return globalThis.jsQR(pixels.data, width, height, {inversionAttempts: 'dontInvert'})?.data;
  }
  async photo(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      for (const limit of [1000, 2000]) {
        const result = this.imageText(image, image.width, image.height, false, limit);
        if (result) return result;
      }
      throw Error('No QR found. Include all four corners.');
    } finally { URL.revokeObjectURL(url); }
  }
  stop() {
    this.sequence++;
    clearTimeout(this.timer);
    this.video.srcObject = null;
    if (this.track) { this.track.onended = null; this.track.stop(); }
    this.track = null;
  }
}
