const test = require('node:test');
const assert = require('node:assert/strict');

test('one shared channel with ten parties, private and group visual signals, contention and timeout', async () => {
  const {Room, HOST, ALL} = await import('../radio/room.mjs');
  const messages = new Map();
  let clock = 0;
  const room = new Room({name:'Guide',code:'000014',now:()=>clock,
    deliver:(id,m)=>messages.set(id,m)});
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
  assert.equal(messages.get(b).name,'Priya');
  for (const id of other) assert.equal(messages.get(id).mode,'busy');
  ask(b,ALL,1);assert.equal(messages.get(b).op,'denied');
  room.input(a,{op:'release',press:1});assert.ok(room.floor);
  room.input(a,{op:'release',press:2});assert.equal(room.floor,null);
  ask(HOST,ALL,3);
  for(const id of [a,b,...other])assert.deepEqual(messages.get(id),{op:'floor',mode:'rx',name:'Guide'});
  clock=5000; room.tick();assert.equal(room.floor,null);
  ask(a,HOST,4);room.remove(a);assert.equal(room.floor,null);
  ask(b,other[0],2);room.remove(other[0]);assert.equal(room.floor,null);
});

test('a delayed keep cannot revive an expired signal before the next timer tick', async () => {
  const {Room, HOST, ALL} = await import('../radio/room.mjs');
  let clock = 0;
  const room = new Room({name:'Host', code:'012345', now:()=>clock, deliver:()=>{}});
  const guest = room.add('Guest');
  room.start();
  room.input(HOST, {op:'ask', target:ALL, press:1});
  clock = 3600;
  room.input(HOST, {op:'keep', press:1});
  assert.equal(room.floor, null);
  room.input(guest, {op:'ask', target:HOST, press:1});
  assert.equal(room.floor.speaker, guest);
  clock = 7200;
  room.input(HOST, {op:'ask', target:ALL, press:2});
  assert.equal(room.floor.speaker, HOST);
});
