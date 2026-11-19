// The QR bootstraps a data-only WebRTC connection. Keeping the full browser SDP
// (including mDNS names and IPv6 candidates) avoids guessing network settings.
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const utf8 = new TextEncoder();
const dictionary = utf8.encode([
  'v=0', 'o=-  2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
  'a=extmap-allow-mixed', 'a=msid-semantic: WMS', 'a=ice-options:trickle',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
  'a=setup:actpass', 'a=setup:active', 'a=fingerprint:sha-256 ',
  'a=ice-ufrag:', 'a=ice-pwd:', 'a=candidate:', ' 1 udp 2122260223 ',
  '.local  typ host generation 0 network-id 1 network-cost 10', 'a=end-of-candidates'
].join('\r\n'));

function base45(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 2) {
    const paired = i + 1 < bytes.length;
    const value = paired ? bytes[i] * 256 + bytes[i + 1] : bytes[i];
    result += alphabet[value % 45] + alphabet[Math.floor(value / 45) % 45];
    if (paired) result += alphabet[Math.floor(value / 2025)];
  }
  return result;
}

function unbase45(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 3) {
    const digits = [...text.slice(i, i + 3)].map(c => alphabet.indexOf(c));
    if (digits.length < 2 || digits.includes(-1)) throw Error('Invalid QR characters.');
    const [a, b, c] = digits;
    const n = a + 45 * b + 2025 * (c ?? 0);
    if (n > (c === undefined ? 255 : 65535)) throw Error('Invalid QR value.');
    if (c !== undefined) bytes.push(n >> 8);
    bytes.push(n & 255);
  }
  return Uint8Array.from(bytes);
}

export function newInvite() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function roomNumber() {
  const word = new Uint32Array(1);
  do { crypto.getRandomValues(word); } while (word[0] >= 4294000000);
  return String(word[0] % 1000000).padStart(6, '0');
}

export function pack(type, invite, sdp, guest) {
  if (!['offer', 'answer'].includes(type) || !/^[0-9A-F]{32}$/.test(invite)) throw Error('Invalid invitation.');
  const compressed = globalThis.pako.deflateRaw(utf8.encode(sdp), {level: 9, dictionary});
  if (guest && type === 'offer') {
    const name = utf8.encode(guest.name);
    const device = utf8.encode(guest.device);
    if (name.length > 96 || device.length > 96 || !/^[0-9A-F]{12}$/.test(guest.tag)) throw Error('Invalid guest label.');
    const bytes = new Uint8Array(8 + name.length + device.length + compressed.length);
    bytes.set(guest.tag.match(/../g).map(part => parseInt(part, 16)));
    bytes.set([name.length, device.length], 6);
    bytes.set(name, 8);
    bytes.set(device, 8 + name.length);
    bytes.set(compressed, 8 + name.length + device.length);
    return 'TK12O:' + invite + ':' + base45(bytes) + '*';
  }
  return 'TK11' + (type === 'offer' ? 'O' : 'A') + ':' + invite + ':' + base45(compressed) + '*';
}

export function unpack(text) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  const header = /^(TK11[OA]|TK12O):([0-9A-F]{32}):/.exec(text);
  if (!header || !text.endsWith('*')) return null;
  try {
    let bytes = unbase45(text.slice(header[0].length, -1));
    let guest;
    if (header[1] === 'TK12O') {
      const nameEnd = 8 + bytes[6];
      const deviceEnd = nameEnd + bytes[7];
      if (bytes.length < 9 || bytes[6] > 96 || bytes[7] > 96 || deviceEnd >= bytes.length) return null;
      const decode = new TextDecoder('utf-8', {fatal: true});
      guest = {
        tag: Array.from(bytes.subarray(0, 6), n => n.toString(16).padStart(2, '0')).join('').toUpperCase(),
        name: decode.decode(bytes.subarray(8, nameEnd)),
        device: decode.decode(bytes.subarray(nameEnd, deviceEnd))
      };
      bytes = bytes.subarray(deviceEnd);
    }
    const sdp = inflateSDP(bytes, dictionary);
    if (!sdp) return null;
    const result = {invite: header[2], description: {type: header[1].endsWith('O') ? 'offer' : 'answer', sdp}};
    if (guest) result.guest = guest;
    return result;
  } catch { return null; }
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

function inflateSDP(compressed, dictionary) {
    const inflater = new globalThis.pako.Inflate({raw: true, dictionary, chunkSize: 8192});
    const chunks = [];
    let total = 0;
    inflater.onData = chunk => {
      total += chunk.length;
      if (total > 32768) throw Error('Oversized invitation.');
      chunks.push(chunk);
    };
    inflater.push(compressed, true);
    if (inflater.err || !inflater.ended || !total) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const sdp = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    if (!sdp.startsWith('v=0\r\n') || !/^m=application /m.test(sdp) || !/^a=fingerprint:/m.test(sdp)) return null;
    return sdp;
}

async function invitationKey(invite) {
  const raw = Uint8Array.from(invite.match(/../g), part => parseInt(part, 16));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt','decrypt']);
}

// The scanned QR supplies the secret and the exact offer used as the dictionary.
export async function sealAnswer(invite, offer, answer) {
  const data = globalThis.pako.deflateRaw(utf8.encode(answer), {dictionary:utf8.encode(offer), level:9});
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, await invitationKey(invite), data);
  const result = new Uint8Array(12 + cipher.byteLength);
  result.set(iv); result.set(new Uint8Array(cipher),12);
  return result;
}
export async function openAnswer(invite, offer, packet) {
  try {
    const data = await crypto.subtle.decrypt({name:'AES-GCM', iv:packet.subarray(0,12)}, await invitationKey(invite), packet.subarray(12));
    const sdp = inflateSDP(new Uint8Array(data), utf8.encode(offer));
    return sdp ? {type:'answer', sdp} : null;
  } catch { return null; }
}
