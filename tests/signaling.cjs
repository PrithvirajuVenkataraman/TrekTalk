const test = require('node:test');
const assert = require('node:assert/strict');

test('a temporary service error retries the same encrypted join, and a rejected request stops', async t => {
  const {mailbox, newId} = await import('../radio/signaling.mjs');
  const sends = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sends.push(options.body);
    return sends.length === 1 ? new Response(null, {status:503}) : Response.json({ok:true});
  });
  const controller = new AbortController();
  const box = await mailbox(newId(), 'join', 'https://test.invalid', controller.signal);
  await box.send({id:newId()});
  assert.equal(sends.length, 2);
  assert.equal(sends[0], sends[1]);
  fetch.mock.mockImplementation(async () => new Response(null, {status:400}));
  await assert.rejects(box.read());
  assert.equal(fetch.mock.callCount(), 3);
  controller.abort();
  await assert.rejects(box.read());
  assert.equal(fetch.mock.callCount(), 3);
});
