'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCalculationHandler } = require('../src/commands/calculation-handler');

// Fake repo mimicking CalculationRepository against Postgres NUMERIC(20,2) strings.
function fakeRepo() {
  const balances = new Map();
  const seenMessageIds = new Set();
  return {
    async recordCalculation({ groupId, messageId, amount }) {
      if (messageId && seenMessageIds.has(messageId)) {
        const current = balances.get(groupId) || 0;
        return { duplicate: true, balanceBefore: current.toFixed(2), balanceAfter: current.toFixed(2) };
      }
      if (messageId) seenMessageIds.add(messageId);
      const before = balances.get(groupId) || 0;
      const after = Math.round((before + amount) * 100) / 100;
      balances.set(groupId, after);
      return { duplicate: false, balanceBefore: before.toFixed(2), balanceAfter: after.toFixed(2) };
    }
  };
}

function send(handler, groupId, body, messageId) {
  const captured = { text: null };
  const message = {
    from: groupId, fromMe: false, body,
    id: { _serialized: messageId || `${groupId}:${body}:${Math.random()}` },
    reply: async (t) => { captured.text = t; }
  };
  return handler(message).then(() => captured.text);
}

test('a message starting with "-" is answered, not neglected, and the sign/value are correct', async () => {
  const handler = createCalculationHandler({ logger: {}, calculationRepository: fakeRepo() });
  const reply = await send(handler, 'G@g.us', '-32*4');
  assert.equal(
    reply,
    '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n🎉 Start To Work 🎉\n① -32*4=-128\nCur Total: -128\n\nAll Total:-128'
  );
});

test('a bare negative number is answered too, echoed exactly as received', async () => {
  const handler = createCalculationHandler({ logger: {}, calculationRepository: fakeRepo() });
  const reply = await send(handler, 'G@g.us', '-463.60');
  assert.equal(
    reply,
    '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n🎉 Start To Work 🎉\n-463.60\nCur Total: -463.60\n\nAll Total:-463.6'
  );
});

test('running balance keeps accumulating correctly across several "-" led messages', async () => {
  const handler = createCalculationHandler({ logger: {}, calculationRepository: fakeRepo() });
  const r1 = await send(handler, 'G@g.us', '-32*4'); // -128
  assert.match(r1, /All Total:-128$/);
  const r2 = await send(handler, 'G@g.us', '-22');   // -150
  assert.match(r2, /All Total:-150$/);
  const r3 = await send(handler, 'G@g.us', '150');   // bare unsigned -> ignored, total unchanged
  assert.equal(r3, null);
  const r4 = await send(handler, 'G@g.us', '+150');  // back to 0 -> cleared
  assert.match(r4, /All Total:0\.0\n\n✅ Thanks! All clear\nGop Gop$/);
});

test('a duplicate message id for a "-" led expression does not double-reply or double-count', async () => {
  const handler = createCalculationHandler({ logger: {}, calculationRepository: fakeRepo() });
  const first = await send(handler, 'G@g.us', '-32*4', 'dup-1');
  const second = await send(handler, 'G@g.us', '-32*4', 'dup-1');
  assert.match(first, /All Total:-128$/);
  assert.equal(second, null);
});
