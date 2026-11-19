export function roomNumber() {
  const word = new Uint32Array(1);
  do { crypto.getRandomValues(word); } while (word[0] >= 4294000000);
  return String(word[0] % 1000000).padStart(6, '0');
}

export function drawCode(canvas, text) {
  const qr = globalThis.qrcode(0, 'M');
  qr.addData(text, 'Alphanumeric');
  qr.make();
  const count = qr.getModuleCount();
  const scale = 10;
  canvas.width = canvas.height = (count + 8) * scale;
  const ctx = canvas.getContext('2d', {alpha: false});
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#09120f';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + 4) * scale, (r + 4) * scale, scale, scale);
    }
  }
}

