'use strict';

// Standalone WhatsApp message handler for the calculator feature. It is
// registered as an ADDITIONAL `message` listener and never touches the existing
// command flow: it only ever replies when the whole message is a valid
// arithmetic expression (see ./calculator). Every other message is ignored.
//
// Running balances live in Postgres (see CalculationRepository) so they survive
// restarts and keep a full audit trail. Message-id dedup happens inside that
// repository's DB transaction, so a replayed WhatsApp message never double-counts.
// When a calculation brings a group's balance to exactly 0 it is announced as
// cleared; the balance simply stays at 0 and the next calculation builds on it.

const { calculate, formatNumber } = require('../services/calculator');
const { serializeMessageId, resolveSender, randomDelayMs } = require('./message-handler');

const HEADER = '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING';
const START_LINE = '🎉 Start To Work 🎉';
const CLEARED_LINE = '✅ Thanks! All clear\nGop Gop';
const STATUS_TITLE = '📊 Groups Status';
// Tolerate surrounding whitespace / bidi marks (WhatsApp adds them) / any case.
const STATUS_PATTERN = /^[\s\u200e\u200f]*\/calculate[\s\u200e\u200f]*$/i;
const ADMIN_ONLY_REPLY = '❌ This command is restricted to administrators.';
// /setname <name>   |   /setname <id>@g.us <name>  (remote form only from the report group)
const SETNAME_PATTERN = /^\/setname\s+(?:(\S+@g\.us)\s+)?(.+?)\s*$/i;
const CURRENCY_LABELS = { pkr: 'PKR', usdt: 'USDT' };
// /pkr | /usdt  — bare (group 2 absent) sets the group's currency; with a
// trailing message it's the broadcast form. "/pkrhello" matches neither: the
// trailing anchor needs whitespace-or-end right after the word, so it's left
// unrecognized, exactly like any other malformed command.
const CURRENCY_COMMAND_PATTERN = /^[\s\u200e\u200f]*\/(pkr|usdt)(?:[\s\u200e\u200f]+(.+))?[\s\u200e\u200f]*$/is;
// /account [pkr|usdt] <message> — the optional currency token requires a word
// boundary right after it, so "/account pkroffer" fails that token match and
// falls through to being parsed as a plain message ("pkroffer...").
const ACCOUNT_PATTERN = /^[\s\u200e\u200f]*\/account(?:[\s\u200e\u200f]+(pkr|usdt)\b)?(?:[\s\u200e\u200f]+(.+))?[\s\u200e\u200f]*$/is;

function pluralize(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function createCalculationHandler({
  logger, client, adminGroupId, calculationRepository, isAdmin,
  currencyBroadcastGroupId = '', broadcastDelayMinSeconds = 10, broadcastDelayMaxSeconds = 15,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random
} = {}) {
  // Shared by the flat /pkr,/usdt broadcasts and the personalized /account
  // one so the "wait between sends, never before the first" pacing isn't
  // duplicated. `send(groupId)` is called fresh for each recipient — any
  // balance read it does happens at that moment, never from an earlier
  // snapshot taken before the broadcast's delays ran.
  async function broadcastWithPacing(groupIds, send) {
    let sent = 0;
    for (let index = 0; index < groupIds.length; index += 1) {
      if (index > 0) await sleep(randomDelayMs(broadcastDelayMinSeconds, broadcastDelayMaxSeconds, random));
      try {
        await send(groupIds[index]);
        sent += 1;
      } catch (error) {
        logger?.error?.('Broadcast send failed', { groupId: groupIds[index], error });
      }
    }
    return sent;
  }

  async function checkAdmin(message) {
    return Boolean(await Promise.resolve(isAdmin ? isAdmin(await resolveSender(message)) : false));
  }

  // /pkr | /usdt — bare form labels the current group; with a trailing
  // message it's the flat broadcast form, restricted to the control group.
  async function handleCurrencyCommand(message, currency, broadcastText) {
    const label = CURRENCY_LABELS[currency];
    if (broadcastText) {
      if (!currencyBroadcastGroupId || message.from !== currencyBroadcastGroupId) return; // wrong group: silent, like a malformed command
      if (!(await checkAdmin(message))) { await message.reply(ADMIN_ONLY_REPLY); return; }
      const groupIds = (await calculationRepository.listGroupIdsByCurrency(currency))
        .filter((groupId) => groupId !== currencyBroadcastGroupId);
      const sent = await broadcastWithPacing(groupIds, (groupId) => client.sendMessage(groupId, broadcastText));
      await message.reply(`✅ Broadcast sent to ${pluralize(sent, `${label} group`)}.`);
      logger?.info?.('Currency broadcast sent', { currency, targeted: groupIds.length, sent });
      return;
    }
    if (!(await checkAdmin(message))) { await message.reply(ADMIN_ONLY_REPLY); return; }
    await calculationRepository.setCurrency(message.from, currency);
    await message.reply(`✅ Currency set to ${label}`);
    logger?.info?.('Group currency set', { groupId: message.from, currency });
  }

  // /account [pkr|usdt] <message> — always a broadcast, restricted to the
  // control group; appends each recipient's own CURRENT balance, read fresh
  // right before that recipient's send (see broadcastWithPacing above).
  async function handleAccount(message, currencyToken, rawText) {
    if (!currencyBroadcastGroupId || message.from !== currencyBroadcastGroupId) return;
    if (!(await checkAdmin(message))) { await message.reply(ADMIN_ONLY_REPLY); return; }
    const text = (rawText || '').trim();
    if (!text) {
      await message.reply('Usage: /account <message>   (or  /account pkr <message>  /  /account usdt <message>)');
      return;
    }
    const currency = currencyToken ? currencyToken.toLowerCase() : null;
    const groupIds = (await calculationRepository.listGroupIdsByCurrency(currency))
      .filter((groupId) => groupId !== currencyBroadcastGroupId);
    const sent = await broadcastWithPacing(groupIds, async (groupId) => {
      const total = await calculationRepository.getCurrentTotal(groupId);
      const amount = formatNumber(Number(total ?? 0));
      await client.sendMessage(groupId, `${text}\n\nYour pending balance: ${amount}`);
    });
    await message.reply(`✅ Account details sent to ${pluralize(sent, 'group')}.`);
    logger?.info?.('Account broadcast sent', { currency, targeted: groupIds.length, sent });
  }
  // `/setname` — admin-only, gated exactly like /groupid, /stock, /status
  // (same injected `isAdmin` registry check + shared `resolveSender`).
  async function handleSetName(message, targetArg, nameArg) {
    const allowed = await Promise.resolve(isAdmin ? isAdmin(await resolveSender(message)) : false);
    if (!allowed) { await message.reply(ADMIN_ONLY_REPLY); return; }

    let targetGroupId = message.from;
    if (targetArg && targetArg !== message.from) {
      if (!adminGroupId || message.from !== adminGroupId) {
        await message.reply('❌ Naming another group by ID is only allowed from the report group.');
        return;
      }
      targetGroupId = targetArg;
    }
    const displayName = (nameArg || '').trim().slice(0, 100);
    if (!displayName) {
      await message.reply('Usage: /setname <name>   (or  /setname <id>@g.us <name>  from the report group)');
      return;
    }
    await calculationRepository.setGroupName(targetGroupId, displayName);
    await message.reply(`${HEADER}\n\n✅ Saved: ${targetGroupId} → ${displayName}`);
    logger?.info?.('Calculation group name saved', { chatId: message.from, targetGroupId });
  }

  // Is this chat allowed to run `/calculate`? The env-var report group OR any
  // active row in calculate_access_groups. A DB error here (e.g. the table was
  // never migrated) is logged loudly and treated as "not allowed" rather than
  // silently killing the command.
  async function calculateAllowed(chatId) {
    if (adminGroupId && chatId === adminGroupId) return true;
    try {
      return await calculationRepository.isCalculateAllowed(chatId);
    } catch (error) {
      logger?.error?.('/calculate access check failed — is the calculate_access_groups table migrated?', { chatId, error });
      return false;
    }
  }

  // `/calculate` — answered only from the report group or a verified access group.
  // Reports the current stored balance for every active group plus a grand total,
  // using the group's saved name (see /setname), then its live WhatsApp name, then its ID.
  async function respondWithGroupsStatus(message) {
    const chatId = message.from;
    const allowed = await calculateAllowed(chatId);
    logger?.info?.('/calculate requested', { chatId, allowed });
    if (!allowed) return;
    const { rows, grandTotal } = await calculationRepository.calculateReport();
    const lines = [];
    for (const row of rows) {
      let name = row.group_name;
      if (!name) {
        name = row.group_id;
        try {
          const chat = client && (await client.getChatById(row.group_id));
          if (chat && chat.name) name = chat.name;
        } catch (error) {
          logger?.warn?.('Calculation status: group name lookup failed', { groupId: row.group_id, error });
        }
      }
      lines.push(`${name} : ${formatNumber(Number(row.current_total))}`);
    }
    lines.push(`Grand Total: ${grandTotal}`);
    await message.reply(`${HEADER}\n\n${STATUS_TITLE}\n\n${lines.join('\n')}`);
    logger?.info?.('Calculation status handled', { chatId: message.from, groups: rows.length });
  }

  return async function handleCalculation(message) {
    try {
      if (!message || message.fromMe || typeof message.body !== 'string') return;

      const trimmed = message.body.trim();
      if (STATUS_PATTERN.test(message.body)) {
        await respondWithGroupsStatus(message);
        return;
      }
      if (/^\/setname\b/i.test(trimmed)) {
        const match = trimmed.match(SETNAME_PATTERN);
        await handleSetName(message, match ? match[1] || null : null, match ? match[2] : null);
        return;
      }
      const currencyMatch = message.body.match(CURRENCY_COMMAND_PATTERN);
      if (currencyMatch) {
        const currency = currencyMatch[1].toLowerCase();
        const broadcastText = currencyMatch[2] ? currencyMatch[2].trim() : '';
        await handleCurrencyCommand(message, currency, broadcastText);
        return;
      }
      const accountMatch = message.body.match(ACCOUNT_PATTERN);
      if (accountMatch) {
        await handleAccount(message, accountMatch[1] || null, accountMatch[2] || '');
        return;
      }

      const parsed = calculate(message.body);
      if (!parsed) return;

      const result = await calculationRepository.recordCalculation({
        groupId: message.from,
        messageId: serializeMessageId(message.id) || null,
        sender: message.author || message.from,
        expression: parsed.expr,
        calculationType: parsed.bare ? 'bare' : 'expression',
        amount: parsed.value
      });
      if (result.duplicate) return;

      let allTotal = Number(result.balanceAfter);
      if (Object.is(allTotal, -0)) allTotal = 0;
      const cleared = allTotal === 0;

      // A bare number is echoed exactly as received; an expression shows "① expr=result".
      const curDisplay = parsed.bare ? parsed.expr : formatNumber(parsed.value);
      const calcLine = parsed.bare ? parsed.expr : `① ${parsed.expr}=${curDisplay}`;
      const allDisplay = cleared ? '0.0' : formatNumber(allTotal);

      let body = `${HEADER}\n\n${START_LINE}\n${calcLine}\nCur Total: ${curDisplay}\n\nAll Total:${allDisplay}`;
      if (cleared) body += `\n\n${CLEARED_LINE}`;

      await message.reply(body);
      logger?.info?.('Calculation handled', { chatId: message.from, cleared });
    } catch (error) {
      logger?.error?.('Calculation handling failed', { error });
    }
  };
}

module.exports = { createCalculationHandler };
