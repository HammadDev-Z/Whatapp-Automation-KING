'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCalculationHandler } = require('../src/commands/calculation-handler');

const CONTROL = 'CONTROL@g.us';

// Mimic AdminRepository.isAllowed: normalize (strip @suffix) then match.
function makeIsAdmin(numbers) {
  const set = new Set(numbers.map((n) => String(n)));
  return (raw) => set.has(String(raw).split('@')[0]);
}

// Fake CalculationRepository covering just what the currency/broadcast
// feature needs: a currency label + active flag + running total per group.
function fakeRepo(initial = {}) {
  const groups = new Map(Object.entries(initial)); // groupId -> {currency, active, total}
  return {
    groups,
    async setCurrency(groupId, currency) {
      const entry = groups.get(groupId) || { active: true, total: 0 };
      entry.currency = currency;
      groups.set(groupId, entry);
    },
    async listGroupIdsByCurrency(currency) {
      const ids = [];
      for (const [groupId, entry] of groups) {
        if (!entry.active) continue;
        if (!entry.currency) continue;
        if (currency && entry.currency !== currency) continue;
        ids.push(groupId);
      }
      return ids;
    },
    async getCurrentTotal(groupId) {
      const entry = groups.get(groupId);
      return entry ? entry.total : null;
    }
  };
}

function harness({ admins = ['1'], control = CONTROL, repo = fakeRepo(), sleep, random = () => 0, client } = {}) {
  const sent = [];
  const sleepCalls = [];
  const fakeClient = client || { async sendMessage(to, text) { sent.push({ to, text }); } };
  const handler = createCalculationHandler({
    logger: { error() {}, info() {}, warn() {} },
    client: fakeClient,
    adminGroupId: 'REPORT@g.us',
    calculationRepository: repo,
    isAdmin: makeIsAdmin(admins),
    currencyBroadcastGroupId: control,
    broadcastDelayMinSeconds: 10,
    broadcastDelayMaxSeconds: 10,
    sleep: sleep || (async (ms) => { sleepCalls.push(ms); }),
    random
  });
  return { handler, repo, sent, sleepCalls };
}

function send(handler, { from, author = '1@c.us', body }) {
  const captured = { text: null };
  return handler({ from, author, fromMe: false, body, id: { _serialized: 'm' + Math.random() }, reply: async (t) => { captured.text = t; } })
    .then(() => captured.text);
}

// --- /pkr, /usdt parsing ----------------------------------------------------

test('/pkr bare sets currency and replies exactly', async () => {
  const { handler, repo } = harness();
  const text = await send(handler, { from: 'G1@g.us', body: '/pkr' });
  assert.equal(text, '✅ Currency set to PKR');
  assert.equal(repo.groups.get('G1@g.us').currency, 'pkr');
});

test('/usdt bare, mixed case and extra whitespace still recognized', async () => {
  const { handler, repo } = harness();
  assert.equal(await send(handler, { from: 'G1@g.us', body: '/USDT' }), '✅ Currency set to USDT');
  assert.equal(repo.groups.get('G1@g.us').currency, 'usdt');
  assert.equal(await send(handler, { from: 'G2@g.us', body: '   /PkR   ' }), '✅ Currency set to PKR');
  assert.equal(repo.groups.get('G2@g.us').currency, 'pkr');
});

test('bare /pkr never touches an existing running total', async () => {
  const repo = fakeRepo({ 'G1@g.us': { currency: null, active: true, total: 500 } });
  const { handler } = harness({ repo });
  await send(handler, { from: 'G1@g.us', body: '/pkr' });
  assert.equal(repo.groups.get('G1@g.us').currency, 'pkr');
  assert.equal(repo.groups.get('G1@g.us').total, 500);
});

test('/null resets a labeled group back to unset and excludes it from future broadcasts', async () => {
  const repo = fakeRepo({ 'G1@g.us': { currency: 'pkr', active: true, total: 50 } });
  const { handler } = harness({ repo });
  const text = await send(handler, { from: 'G1@g.us', body: '/null' });
  assert.equal(text, '✅ Currency reset — this group is now unset');
  assert.equal(repo.groups.get('G1@g.us').currency, null);
  assert.equal(repo.groups.get('G1@g.us').total, 50, '/null must never touch the running total');
  assert.deepEqual(await repo.listGroupIdsByCurrency('pkr'), []);
});

test('/null tolerates mixed case and extra whitespace, and ignores anything attached', async () => {
  const repo = fakeRepo({ 'G1@g.us': { currency: 'usdt', active: true, total: 0 } });
  const { handler } = harness({ repo });
  assert.equal(await send(handler, { from: 'G1@g.us', body: '  /NULL  ' }), '✅ Currency reset — this group is now unset');
  assert.equal(repo.groups.get('G1@g.us').currency, null);
});

test('/null is admin-gated and a non-admin leaves the currency unchanged', async () => {
  const repo = fakeRepo({ 'G1@g.us': { currency: 'pkr', active: true, total: 0 } });
  const { handler } = harness({ repo, admins: ['999'] });
  const text = await send(handler, { from: 'G1@g.us', author: '1@c.us', body: '/null' });
  assert.equal(text, '❌ This command is restricted to administrators.');
  assert.equal(repo.groups.get('G1@g.us').currency, 'pkr');
});

test('/nullify and other attached text are not recognized as /null', async () => {
  const repo = fakeRepo({ 'G1@g.us': { currency: 'pkr', active: true, total: 0 } });
  const { handler } = harness({ repo });
  assert.equal(await send(handler, { from: 'G1@g.us', body: '/nullify' }), null);
  assert.equal(await send(handler, { from: 'G1@g.us', body: '/null extra' }), null);
  assert.equal(repo.groups.get('G1@g.us').currency, 'pkr');
});

test('unrelated text is not recognized at all: /usd, bare "pkr", "/pkrhello"', async () => {
  const { handler, repo } = harness();
  for (const body of ['/usd', 'pkr', '/pkrhello', '/usdtoffer']) {
    const text = await send(handler, { from: 'G1@g.us', body });
    assert.equal(text, null, `expected no reply for ${JSON.stringify(body)}`);
  }
  assert.equal(repo.groups.has('G1@g.us'), false);
});

// --- /account parsing --------------------------------------------------------

test('/account parsing: bare, with message, with currency prefix, and "pkroffer" is not the keyword', async () => {
  const repo = fakeRepo({
    'A@g.us': { currency: 'pkr', active: true, total: 10 },
    'B@g.us': { currency: 'usdt', active: true, total: 20 }
  });
  const { handler, sent } = harness({ repo });

  const usage = await send(handler, { from: CONTROL, body: '/account' });
  assert.match(usage, /^Usage: \/account/);
  assert.equal(sent.length, 0);

  const offerText = await send(handler, { from: CONTROL, body: '/account pkroffer now' });
  assert.match(offerText, /✅ Account details sent to 2 groups\.$/);
  assert.ok(sent.some((s) => s.text.startsWith('pkroffer now\n\n')), 'treated "pkroffer" as plain message text, not the pkr keyword');
});

// --- Admin gating ------------------------------------------------------------

test('non-admin gets the standard restricted reply on bare form; nothing changes', async () => {
  const { handler, repo } = harness({ admins: ['999'] });
  const text = await send(handler, { from: 'G1@g.us', author: '1@c.us', body: '/pkr' });
  assert.equal(text, '❌ This command is restricted to administrators.');
  assert.equal(repo.groups.has('G1@g.us'), false);
});

test('non-admin gets the standard restricted reply on a broadcast form sent from the control group', async () => {
  const repo = fakeRepo({ 'G1@g.us': { currency: 'pkr', active: true, total: 1 } });
  const { handler, sent } = harness({ admins: ['999'], repo });
  const text = await send(handler, { from: CONTROL, author: '1@c.us', body: '/pkr hello' });
  assert.equal(text, '❌ This command is restricted to administrators.');
  assert.equal(sent.length, 0);
});

// --- Control-group restriction -----------------------------------------------

test('broadcast forms are ignored entirely outside the control group, even for an admin', async () => {
  const repo = fakeRepo({ 'G1@g.us': { currency: 'pkr', active: true, total: 1 } });
  const { handler, sent } = harness({ repo });
  const text = await send(handler, { from: 'SOME-OTHER-GROUP@g.us', body: '/pkr hello everyone' });
  assert.equal(text, null);
  assert.equal(sent.length, 0);
});

test('a broadcast never re-sends into the control group itself, even if it is also labeled and active', async () => {
  const repo = fakeRepo({
    [CONTROL]: { currency: 'pkr', active: true, total: 1 },
    'G1@g.us': { currency: 'pkr', active: true, total: 2 }
  });
  const { handler, sent } = harness({ repo });
  const text = await send(handler, { from: CONTROL, body: '/pkr hello' });
  assert.match(text, /✅ Broadcast sent to 1 PKR group\.$/);
  assert.deepEqual(sent.map((s) => s.to), ['G1@g.us']);
});

// --- Targeting correctness ---------------------------------------------------

test('/pkr and /usdt broadcasts reach only their own currency-labeled active groups; unset groups never receive anything', async () => {
  const repo = fakeRepo({
    'PKR1@g.us': { currency: 'pkr', active: true, total: 1 },
    'PKR2@g.us': { currency: 'pkr', active: true, total: 2 },
    'USDT1@g.us': { currency: 'usdt', active: true, total: 3 },
    'DISABLED@g.us': { currency: 'pkr', active: false, total: 4 },
    'UNSET@g.us': { currency: null, active: true, total: 5 }
  });
  const { handler, sent } = harness({ repo });

  const pkrReply = await send(handler, { from: CONTROL, body: '/pkr special offer' });
  assert.match(pkrReply, /✅ Broadcast sent to 2 PKR groups\.$/);
  assert.deepEqual(sent.map((s) => s.to).sort(), ['PKR1@g.us', 'PKR2@g.us']);
  assert.ok(sent.every((s) => s.text === 'special offer'));

  sent.length = 0;
  const usdtReply = await send(handler, { from: CONTROL, body: '/usdt special offer' });
  assert.match(usdtReply, /✅ Broadcast sent to 1 USDT group\.$/);
  assert.deepEqual(sent.map((s) => s.to), ['USDT1@g.us']);
});

test('/account reaches every labeled active group regardless of currency; /account pkr and /account usdt restrict to one', async () => {
  const repo = fakeRepo({
    'PKR1@g.us': { currency: 'pkr', active: true, total: 100 },
    'USDT1@g.us': { currency: 'usdt', active: true, total: 200 },
    'DISABLED@g.us': { currency: 'pkr', active: false, total: 300 },
    'UNSET@g.us': { currency: null, active: true, total: 400 }
  });
  const { handler, sent } = harness({ repo });

  const allReply = await send(handler, { from: CONTROL, body: '/account hi' });
  assert.match(allReply, /✅ Account details sent to 2 groups\.$/);
  assert.deepEqual(sent.map((s) => s.to).sort(), ['PKR1@g.us', 'USDT1@g.us']);
  assert.ok(sent.find((s) => s.to === 'PKR1@g.us').text.endsWith('Your pending balance: 100'));
  assert.ok(sent.find((s) => s.to === 'USDT1@g.us').text.endsWith('Your pending balance: 200'));

  sent.length = 0;
  const pkrOnly = await send(handler, { from: CONTROL, body: '/account pkr hi' });
  assert.match(pkrOnly, /✅ Account details sent to 1 group\.$/);
  assert.deepEqual(sent.map((s) => s.to), ['PKR1@g.us']);
});

// --- Section 4: fresh balance read, not an upfront snapshot ------------------

test('each /account message uses the balance read at send time, not a snapshot from before the broadcast started', async () => {
  const repo = fakeRepo({
    'FIRST@g.us': { currency: 'pkr', active: true, total: 100 },
    'SECOND@g.us': { currency: 'pkr', active: true, total: 200 }
  });
  const { handler, sent } = harness({
    repo,
    // Mutate the second group's balance exactly during the delay BETWEEN the
    // two sends (there is no delay before the first send, so this only fires once).
    sleep: async () => { repo.groups.get('SECOND@g.us').total = 999; }
  });
  const reply = await send(handler, { from: CONTROL, body: '/account hi' });
  assert.match(reply, /✅ Account details sent to 2 groups\.$/);
  const toFirst = sent.find((s) => s.to === 'FIRST@g.us');
  const toSecond = sent.find((s) => s.to === 'SECOND@g.us');
  assert.ok(toFirst.text.endsWith('Your pending balance: 100'));
  assert.ok(toSecond.text.endsWith('Your pending balance: 999'), 'must reflect the NEW value, not the 200 that existed when the broadcast started');
});

test('delay happens between sends but never before the first', async () => {
  const repo = fakeRepo({
    'G1@g.us': { currency: 'pkr', active: true, total: 1 },
    'G2@g.us': { currency: 'pkr', active: true, total: 2 },
    'G3@g.us': { currency: 'pkr', active: true, total: 3 }
  });
  const { handler, sleepCalls } = harness({ repo });
  await send(handler, { from: CONTROL, body: '/pkr hi' });
  assert.equal(sleepCalls.length, 2, 'two delays for three sends (never before the first)');
});

// --- Failure isolation --------------------------------------------------------

test('a failing send to one group is logged and does not stop the rest; the count reflects only successes', async () => {
  const repo = fakeRepo({
    'GOOD1@g.us': { currency: 'pkr', active: true, total: 1 },
    'BAD@g.us': { currency: 'pkr', active: true, total: 2 },
    'GOOD2@g.us': { currency: 'pkr', active: true, total: 3 }
  });
  const errors = [];
  const client = {
    async sendMessage(to, text) {
      if (to === 'BAD@g.us') throw new Error('offline');
      return { to, text };
    }
  };
  const handler = createCalculationHandler({
    logger: { error: (...args) => errors.push(args), info() {}, warn() {} },
    client,
    calculationRepository: repo,
    isAdmin: makeIsAdmin(['1']),
    currencyBroadcastGroupId: CONTROL,
    broadcastDelayMinSeconds: 10,
    broadcastDelayMaxSeconds: 10,
    sleep: async () => {},
    random: () => 0
  });
  const text = await send(handler, { from: CONTROL, body: '/pkr hi' });
  assert.match(text, /✅ Broadcast sent to 2 PKR groups\.$/);
  assert.equal(errors.length, 1);
});
