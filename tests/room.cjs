const test = require('node:test');
const assert = require('node:assert/strict');

test('one shared channel with ten parties, private audio, broadcast, stale packets and timeout', async () => {
  const {Room, HOST, ALL} = await import('../radio/room.mjs');
  const messages = new Map(), listeners = [];
  let clock = 0;
  const room = new Room({name:'Guide',code:'000014',now:()=>clock,
    deliver:(id,m)=>messages.set(id,m),audio:id=>listeners.push(id)});
  const a=room.add('Priya'), b=room.add('Ravi'), other=[];
  for (let i=0;i<7;i++) other.push(room.add('Hiker'));
  assert.equal(room.members.size,10);
  assert.equal(new Set(room.members.values()).size,10);
  assert.throws(()=>room.add('Extra'));
  const ask=(id,target,press)=>room.input(id,{op:'ask',target,press});
  ask(a,b,1);assert.equal(messages.get(a).op,'denied');
  room.start();
  ask(a,b,2);
  assert.equal(messages.get(a).mode,'tx');
  assert.equal(messages.get(b).mode,'rx');
  assert.equal(messages.get(HOST).mode,'busy');
  const frame=new ArrayBuffer(326);
  new DataView(frame).setUint32(0,room.floor.token);
  ask(b,ALL,1);assert.equal(messages.get(b).op,'denied');
  room.frame(b,frame);assert.deepEqual(listeners,[]);
  room.frame(a,frame);assert.deepEqual(listeners,[b]);
  room.input(a,{op:'release',press:1});assert.ok(room.floor);
  room.input(a,{op:'release',press:2});assert.equal(room.floor,null);
  ask(HOST,ALL,3);listeners.length=0;
  room.frame(HOST,frame);assert.deepEqual(listeners,[]);
  new DataView(frame).setUint32(0,room.floor.token);
  room.frame(HOST,frame);assert.deepEqual(listeners,[a,b,...other]);
  clock=5000; room.tick();assert.equal(room.floor,null);
  ask(a,HOST,4);room.remove(a);assert.equal(room.floor,null);
  ask(b,other[0],2);room.remove(other[0]);assert.equal(room.floor,null);
});
