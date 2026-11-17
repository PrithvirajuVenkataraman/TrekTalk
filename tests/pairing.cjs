const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pako=require('../vendor/pako.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const codec=source.slice(source.indexOf('function encode('),source.indexOf('async function setup('));
const ctx=vm.createContext({pako,TextDecoder,btoa,atob,Uint8Array});vm.runInContext(codec,ctx);
for(const type of ['offer','answer']){
 const original={type,sdp:'v=0\r\ns=தமிழ் voice\r\n'+ 'a=test\r\n'.repeat(300)};
 ctx.input=original;const actual=vm.runInContext('decode(encode(input))',ctx);
 assert.equal(actual.type,original.type);assert.equal(actual.sdp,original.sdp);
}
assert.throws(()=>vm.runInContext("decode('invalid')",ctx));
console.log('Pairing offer/answer UTF-8 round trips and invalid prefix passed');
