'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCalculationHandler } = require('../src/commands/calculation-handler');

function fakeRepo(balances, accessGroups = [], { accessThrows = false } = {}) {
  return {
    async recordCalculation() { throw new Error('recordCalculation should not be called by /calculate'); },
    async calculateReport() {
      const grand = balances.reduce((sum, b) => sum + Number(b.current_total), 0);
      return { rows: balances, grandTotal: grand.toFixed(2) };
    },
    async isCalculateAllowed(groupId) {
      if (accessThrows) throw new Error('relation "calculate_access_groups" does not exist');
      return accessGroups.includes(groupId);
    }
  };
}

function messageFrom(from, body) {
  const captured = { text: null };
  return {
    m: { from, fromMe: false, body, id: { _serialized: from + body }, reply: async (t) => { captured.text = t; } },
    captured
  };
}

test('/calculate appends a Grand Total line summing every listed balance', async () => {
  const repo = fakeRepo([
    { group_id: 'a@g.us', group_name: 'Ahmer Group', current_total: '-199.00' },
    { group_id: 'b@g.us', group_name: 'Khan Group', current_total: '-599.00' },
    { group_id: 'c@g.us', group_name: 'Ali Group', current_total: '600.00' }
  ]);
  const handler = createCalculationHandler({ logger: {}, adminGroupId: 'ADM@g.us', calculationRepository: repo });
  const { m, captured } = messageFrom('ADM@g.us', '/calculate');
  await handler(m);
  assert.equal(
    captured.text,
    '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n📊 Groups Status\n\nAhmer Group : -199\nKhan Group : -599\nAli Group : 600\nGrand Total: -198.00'
  );
});

test('/calculate grand total is 0.00 when there are no active groups', async () => {
  const repo = fakeRepo([]);
  const handler = createCalculationHandler({ logger: {}, adminGroupId: 'ADM@g.us', calculationRepository: repo });
  const { m, captured } = messageFrom('ADM@g.us', '/calculate');
  await handler(m);
  assert.equal(captured.text, '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n📊 Groups Status\n\nGrand Total: 0.00');
});

test('/calculate stays silent outside the report group and access list', async () => {
  const repo = fakeRepo([{ group_id: 'a@g.us', group_name: 'X', current_total: '1.00' }], ['ALLOWED@g.us']);
  const handler = createCalculationHandler({ logger: {}, adminGroupId: 'ADM@g.us', calculationRepository: repo });
  const { m, captured } = messageFrom('SOMEWHERE@g.us', '/calculate');
  await handler(m);
  assert.equal(captured.text, null);
});

test('/calculate is allowed from a group in the DB access list (no env var set)', async () => {
  const repo = fakeRepo([{ group_id: 'a@g.us', group_name: 'X', current_total: '1.00' }], ['ALLOWED@g.us']);
  const handler = createCalculationHandler({ logger: {}, adminGroupId: '', calculationRepository: repo });
  const { m, captured } = messageFrom('ALLOWED@g.us', '/calculate');
  await handler(m);
  assert.equal(captured.text, '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n📊 Groups Status\n\nX : 1\nGrand Total: 1.00');
});

test('/calculate tolerates trailing space, letter case, and a leading bidi mark', async () => {
  const repo = fakeRepo([]);
  const handler = createCalculationHandler({ logger: {}, adminGroupId: 'ADM@g.us', calculationRepository: repo });
  for (const body of ['/calculate ', '  /calculate', '/CALCULATE', '‎/calculate', '/Calculate\n']) {
    const { m, captured } = messageFrom('ADM@g.us', body);
    await handler(m);
    assert.equal(captured.text, '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n📊 Groups Status\n\nGrand Total: 0.00', `body=${JSON.stringify(body)}`);
  }
});

test('/calculate does not throw or reply if the access-list table is missing', async () => {
  const repo = fakeRepo([{ group_id: 'a@g.us', group_name: 'X', current_total: '1.00' }], [], { accessThrows: true });
  const handler = createCalculationHandler({ logger: {}, adminGroupId: 'ADM@g.us', calculationRepository: repo });
  const { m, captured } = messageFrom('NEWGROUP@g.us', '/calculate');
  await handler(m); // must not throw
  assert.equal(captured.text, null);
});

test('env report group still works even when the access-list query would throw', async () => {
  const repo = fakeRepo([], [], { accessThrows: true });
  const handler = createCalculationHandler({ logger: {}, adminGroupId: 'ADM@g.us', calculationRepository: repo });
  const { m, captured } = messageFrom('ADM@g.us', '/calculate');
  await handler(m);
  assert.equal(captured.text, '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n📊 Groups Status\n\nGrand Total: 0.00');
});
