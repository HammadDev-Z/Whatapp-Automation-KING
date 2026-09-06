'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCalculationHandler } = require('../src/commands/calculation-handler');

// Mimic AdminRepository.isAllowed: normalize (strip @suffix + non-digits) then match.
function makeIsAdmin(numbers) {
  const set = new Set(numbers.map((n) => String(n).replace(/\D/g, '')));
  return (raw) => set.has(String(raw).split('@')[0].replace(/\D/g, ''));
}

function harness({ admins = [], reportGroup = 'REPORT@g.us' } = {}) {
  const saved = [];
  const repo = {
    async setGroupName(groupId, name) { saved.push({ groupId, name }); },
    async recordCalculation() { throw new Error('unused'); },
    async calculateReport() { return { rows: [], grandTotal: '0.00' }; }
  };
  const handler = createCalculationHandler({
    logger: {}, adminGroupId: reportGroup, calculationRepository: repo, isAdmin: makeIsAdmin(admins)
  });
  return { handler, saved };
}

async function send(handler, { from, author, body }) {
  const captured = { text: null };
  await handler({ from, author, fromMe: false, body, id: { _serialized: 'x' + Math.random() }, reply: async (t) => { captured.text = t; } });
  return captured.text;
}

test('/setname is refused for non-admins and writes nothing', async () => {
  const { handler, saved } = harness({ admins: ['923001234567'] });
  const text = await send(handler, { from: 'G1@g.us', author: '923009999999@c.us', body: '/setname Night Shift' });
  assert.equal(text, '❌ This command is restricted to administrators.');
  assert.equal(saved.length, 0);
});

test('/setname <name> from an admin labels the current group', async () => {
  const { handler, saved } = harness({ admins: ['923001234567'] });
  const text = await send(handler, { from: 'G1@g.us', author: '923001234567@c.us', body: '/setname Night Shift' });
  assert.deepEqual(saved, [{ groupId: 'G1@g.us', name: 'Night Shift' }]);
  assert.match(text, /✅ Saved: G1@g\.us → Night Shift/);
});

test('/setname <id> <name> is rejected outside the report group', async () => {
  const { handler, saved } = harness({ admins: ['923001234567'], reportGroup: 'REPORT@g.us' });
  const text = await send(handler, { from: 'G1@g.us', author: '923001234567@c.us', body: '/setname 12036300@g.us Ali Group' });
  assert.match(text, /only allowed from the report group/);
  assert.equal(saved.length, 0);
});

test('/setname <id> <name> from the report group labels the remote group', async () => {
  const { handler, saved } = harness({ admins: ['923001234567'], reportGroup: 'REPORT@g.us' });
  const text = await send(handler, { from: 'REPORT@g.us', author: '923001234567@c.us', body: '/setname 12036300@g.us Ali Group' });
  assert.deepEqual(saved, [{ groupId: '12036300@g.us', name: 'Ali Group' }]);
  assert.match(text, /✅ Saved: 12036300@g\.us → Ali Group/);
});

test('/setname with no name shows usage to an admin', async () => {
  const { handler, saved } = harness({ admins: ['923001234567'] });
  const text = await send(handler, { from: 'G1@g.us', author: '923001234567@c.us', body: '/setname' });
  assert.match(text, /^Usage: \/setname/);
  assert.equal(saved.length, 0);
});
