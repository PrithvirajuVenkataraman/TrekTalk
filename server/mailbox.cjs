// The mailbox holds only encrypted signaling messages, for at most 90 seconds.
const TTL = 90;
async function exchange(store, body) {
  if (!body || !/^[a-f0-9]{64}$/.test(String(body.box)) || !['read','write'].includes(body.op)) return [400, {}];
  const key = 'trektalk-v13-' + body.box;
  if (body.op === 'write') {
    if (typeof body.packet !== 'string' || body.packet.length < 32 || body.packet.length > 28000 ||
        !/^[A-Za-z0-9+/]+=*$/.test(body.packet)) return [400, {}];
    await store.set(key, body.packet, {ttl: TTL});
    return [200, {ok:true}];
  }
  return [200, {packet:await store.get(key) || null}];
}
function localStore() {
  const records = new Map();
  const timer = setInterval(() => {
    for (const [k, v] of records) if (v.until <= Date.now()) records.delete(k);
  }, 10000);
  timer.unref();
  return {
    get(key) { const r=records.get(key); return r && r.until>Date.now() ? r.value : null; },
    set(key,value) {
      if (!records.has(key) && records.size>=1024) throw Error('Local pairing service is full');
      records.set(key,{value,until:Date.now()+TTL*1000});
    }
  };
}
module.exports = {exchange, localStore};
