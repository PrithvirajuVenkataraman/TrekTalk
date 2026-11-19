const test = require('node:test');
const assert = require('node:assert/strict');
global.pako = require('../vendor/pako.js');
test('single scan reply survives sample offset, gain, echo, noise and clock drift, and authenticates the guest', async () => {
  const {newInvite,sealAnswer,openAnswer} = await import('../radio/pairing.mjs');
  const {renderTone,ToneReader} = await import('../radio/sound.mjs');
  const offer='v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 11:22\r\na=setup:actpass\r\n';
  const answer=offer.replace('actpass','active').replace('11:22','33:44');
  const invite=newInvite(), packet=await sealAnswer(invite,offer,answer);
  const signal=renderTone(packet);
  let seed=531, received;
  const audio=new Float32Array(signal.length+4500);
  for(let i=731;i<audio.length;i++){
    const t=(i-731)*1.00015,j=Math.floor(t),f=t-j;
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    audio[i]=0.25*((1-f)*(signal[j]||0)+f*(signal[j+1]||0))+0.06*(signal[j-40]||0)+(seed/2**32-.5)*.02;
  }
  const reader=new ToneReader(data=>{received=data;});
  for(let i=0;i<audio.length;i+=1024)reader.push(audio.subarray(i,i+1024));
  assert.deepEqual(received,packet);
  assert.deepEqual(await openAnswer(invite,offer,received),{type:'answer',sdp:answer});
  assert.equal(await openAnswer(newInvite(),offer,received),null);
  received[received.length-1]^=1;
  assert.equal(await openAnswer(invite,offer,received),null);
});
