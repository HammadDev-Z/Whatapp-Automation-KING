'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageHandler } = require('../src/commands/message-handler');
const { lowStockThreshold, isLowStock, lowStockAlertMessage } = require('../src/utilities/low-stock');

test('lowStockThreshold: configured value or null', () => {
  assert.equal(lowStockThreshold('830'), 10);
  assert.equal(lowStockThreshold('27k'), 2);
  assert.equal(lowStockThreshold('unknown'), null);
});

test('isLowStock: fires strictly below threshold only', () => {
  assert.equal(isLowStock(9, '830'), true);
  assert.equal(isLowStock(10, '830'), false);
  assert.equal(isLowStock(11, '830'), false);
  assert.equal(isLowStock(1, '27k'), true);
  assert.equal(isLowStock(2, '27k'), false);
  assert.equal(isLowStock(0, 'no-such-category'), false);
});

test('lowStockAlertMessage: exact format', () => {
  assert.equal(
    lowStockAlertMessage('13k', 3, 4),
    '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n⚠️ Low stock alert\n13k: 3 codes left (threshold 4)'
  );
});

// --- behaviour inside the message handler ----------------------------------

function tagHarness({ remaining, sendMessage }) {
  const calls = { replies: [], alerts: [], recordDelivery: [] };
  const pool = {
    async query(sql) {
      if (/FROM processed_messages/.test(sql)) return { rowCount: 0, rows: [] };
      if (/status='unused'/.test(sql)) return { rows: [{ count: remaining }] };
      return { rows: [], rowCount: 0 };
    }
  };
  const handler = createMessageHandler({
    allocationService: {
      async allocate() {
        return { status: 'allocated', partial: false, requestedQuantity: 1, issuedQuantity: 1, codes: [{ codeId: 1, code: 'SECRET' }], codeId: 1, code: 'SECRET' };
      },
      async recordDelivery(x) { calls.recordDelivery.push(x); }
    },
    categoryRepository: { async resolve(c) { return c; }, async listActive() { return []; } },
    pool,
    isAdmin: () => false,
    rateLimiter: { consume: () => true },
    lowStockAlertGroupId: 'ALERT@g.us',
    sleep: async () => {},
    random: () => 0,
    logger: { info() {}, warn() {}, error() {} }
  });
  const message = {
    from: 'G@g.us', fromMe: false, body: '/tag 830', author: '111@c.us',
    id: { _serialized: 'mm-' + Math.random() },
    client: { async sendMessage(to, text) { if (sendMessage) return sendMessage(to, text); calls.alerts.push({ to, text }); } },
    async reply(t) { calls.replies.push(t); }
  };
  return { handler, message, calls };
}

test('alert fires to the alert group when unused stock drops below threshold', async () => {
  const { handler, message, calls } = tagHarness({ remaining: 9 });
  await handler(message);
  assert.equal(calls.recordDelivery[0].success, true);
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.alerts[0].to, 'ALERT@g.us');
  assert.match(calls.alerts[0].text, /Low stock alert\n830: 9 codes left \(threshold 10\)/);
});

test('no alert when unused stock is at or above threshold', async () => {
  const { handler, message, calls } = tagHarness({ remaining: 10 });
  await handler(message);
  assert.equal(calls.alerts.length, 0);
});

test('a failing alert send never breaks the already-completed delivery flow', async () => {
  const { handler, message, calls } = tagHarness({ remaining: 1, sendMessage: async () => { throw new Error('offline'); } });
  await handler(message);
  assert.equal(calls.replies.length, 1);
  assert.equal(calls.recordDelivery[0].success, true);
});
