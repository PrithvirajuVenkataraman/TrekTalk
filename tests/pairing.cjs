const test=require('node:test');
const assert=require('node:assert/strict');
const {exchange,localStore}=require('../server/mailbox.cjs');
test('pairing mailbox validates requests, isolates invitations and retains only the latest packet', async()=>{
  const store=localStore(), box='a'.repeat(64), packet='A'.repeat(32);
  assert.equal((await exchange(store,{op:'write',box:'bad',packet}))[0],400);
  assert.equal((await exchange(store,{op:'read',box:[box]}))[0],400);
  assert.equal((await exchange(store,{op:'write',box,packet:'bad'}))[0],400);
  assert.equal((await exchange(store,{op:'write',box,packet}))[0],200);
  assert.equal((await exchange(store,{op:'read',box}))[1].packet,packet);
  assert.equal((await exchange(store,{op:'read',box:'b'.repeat(64)}))[1].packet,null);
});
