const test = require('node:test');
const assert = require('node:assert/strict');

test('rear camera works without optional constraint reporting and rejects front camera output', async () => {
  const {openRearCamera} = await import('../radio/camera.mjs');
  let stopped = 0;
  const track = {getSettings:()=>({facingMode:'environment'}), stop:()=>stopped++};
  const stream = {getVideoTracks:()=>[track], getTracks:()=>[track]};
  const media = {getUserMedia:async options => {
    assert.deepEqual(options.video.facingMode, {exact:'environment'});
    assert.equal(options.audio, false);
    return stream;
  }};
  assert.equal(await openRearCamera(media), stream);
  track.getSettings = () => ({facingMode:'user'});
  await assert.rejects(openRearCamera(media), /Rear camera unavailable/);
  assert.equal(stopped, 1);
  await assert.rejects(openRearCamera({getSupportedConstraints:()=>({facingMode:false})}));
});

test('a stalled native QR detector falls back and rejected playback stops the rear camera', async t => {
  globalThis.document = {hidden:false, createElement:()=>({getContext:()=>({})})};
  t.after(() => {delete globalThis.document;delete globalThis.MediaStream;delete globalThis.BarcodeDetector;});
  globalThis.MediaStream = class {};
  globalThis.BarcodeDetector = class {detect(){return new Promise(()=>{});}};
  const {Scanner} = await import('../radio/scanner.mjs');
  const video = {play:async()=>{}, readyState:4, videoWidth:640, videoHeight:480, currentTime:1};
  let scanner;
  const decoded = new Promise(resolve => {
    scanner = new Scanner(video, text=>{scanner.stop();resolve(text);}, ()=>{});
  });
  let decodedFrames = 0;
  scanner.imageText = () => ++decodedFrames > 1 ? 'TREK14:0123456789ABCDEF0123456789ABCDEF' : null;
  let stopped = 0;
  await scanner.start({stop:()=>stopped++});
  assert.equal(await Promise.race([decoded,new Promise(resolve=>setTimeout(()=>resolve('timeout'),1000))]),
    'TREK14:0123456789ABCDEF0123456789ABCDEF');
  assert.equal(stopped,1);
  video.play = async () => {throw Error('Playback refused');};
  await assert.rejects(scanner.start({stop:()=>stopped++}), /Playback refused/);
  assert.equal(stopped,2);
  assert.equal(video.srcObject,null);
});

test('ICE state changes detect lost links even without connectionState events', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  t.after(() => {delete globalThis.RTCPeerConnection;});
  globalThis.RTCPeerConnection = class {
    constructor(){this.iceConnectionState='connected';}
    close(){this.iceConnectionState='closed';}
  };
  const {Link} = await import('../radio/link.mjs');
  let lost = 0;
  const link = new Link({initiator:false,ready:()=>{},control:()=>{},lost:()=>lost++});
  link.pc.iceConnectionState = 'disconnected';
  link.pc.oniceconnectionstatechange();
  t.mock.timers.tick(2000);
  link.pc.iceConnectionState = 'connected';
  link.pc.oniceconnectionstatechange();
  t.mock.timers.tick(4000);
  assert.equal(lost,0);
  link.pc.iceConnectionState = 'disconnected';
  link.pc.oniceconnectionstatechange();
  t.mock.timers.tick(4000);
  assert.equal(lost,1);
  assert.equal(link.closed,true);
  assert.equal(link.pc.oniceconnectionstatechange,null);
});

test('missing local candidates identify permission recovery instead of a generic connection failure', async t => {
  t.after(() => {delete globalThis.RTCPeerConnection;});
  globalThis.RTCPeerConnection = class extends EventTarget {
    constructor(){super();this.iceGatheringState='complete';this.signalingState='stable';}
    createDataChannel(){return {label:'control',readyState:'connecting'};}
    async createOffer(){return {type:'offer',sdp:'v=0\r\n'};}
    async setLocalDescription(description){this.localDescription=description;}
    close(){this.signalingState='closed';}
  };
  const {Link} = await import('../radio/link.mjs');
  const link = new Link({initiator:true,ready:()=>{},control:()=>{},lost:()=>{}});
  await assert.rejects(link.offer(), {code:'NO_LOCAL_ADDRESS'});
  link.close();
});
