const test = require('node:test');
const assert = require('node:assert/strict');
global.pako = require('../vendor/pako.js');
global.qrcode = require('../vendor/qr.js');
const scan = require('../vendor/scan.js');

const sample = [
  'v=0','o=- 12345679 2 IN IP4 127.0.0.1','s=-','t=0 0','a=group:BUNDLE 0',
  'm=application 50800 UDP/DTLS/SCTP webrtc-datachannel','c=IN IP4 192.168.43.1',
  'a=ice-ufrag:AB09','a=ice-pwd:ArandomIceSecretABC12345',
  'a=fingerprint:sha-256 ' + Array.from({length:32}, (_,i)=>i.toString(16).padStart(2,'0')).join(':'),
  'a=setup:actpass','a=mid:0','a=candidate:1 1 UDP 2122260223 192.168.43.1 50800 typ host',
  'a=sctp-port:5000','a=max-message-size:262144',''
].join('\r\n');

test('camera-readable offers and replies retain exact local addresses, credentials, and invitation', async () => {
  const {newInvite, pack, unpack, drawCode} = await import('../radio/pairing.mjs');
  const invite = newInvite();
  for (const type of ['offer','answer']) {
    const sdp = type === 'answer' ? sample.replace('actpass','active').replaceAll('192.168.43.1','device-123.local') : sample;
    const text = pack(type, invite, sdp);
    let pixels, width;
    const ctx = {fillRect(x,y,w,h) {
      if (!pixels) {width=canvas.width; pixels=new Uint8ClampedArray(width*width*4).fill(255);}
      if (this.fillStyle === '#fff') return;
      for(let i=y;i<y+h;i++) for(let j=x;j<x+w;j++) {
        const pos=4*(i*width+j); pixels[pos]=9;pixels[pos+1]=18;pixels[pos+2]=15;
      }
    }};
    const canvas = {getContext:()=>ctx};
    drawCode(canvas,text);
    const detected=scan(pixels,width,width,{inversionAttempts:'dontInvert'});
    assert.ok(detected);
    assert.deepEqual(unpack(detected.data),{invite,description:{type,sdp}});
  }
  assert.equal(unpack('WIFI:S:unrelated;;'),null);
  assert.equal(unpack('TK9O:001122334455:???*'),null);
});

test('join QR carries the guest identity without changing the acoustic offer dictionary', async () => {
  const {newInvite, pack, unpack} = await import('../radio/pairing.mjs');
  const guest = {tag: 'AB0123CD4567', name: 'பிரித்வி', device: 'iPhone'};
  const invite = newInvite();
  assert.deepEqual(unpack(pack('offer', invite, sample, guest)), {
    invite, guest, description: {type: 'offer', sdp: sample}
  });
  assert.throws(() => pack('offer', invite, sample, {...guest, name: 'a'.repeat(97)}));
});
