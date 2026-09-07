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
const { serializeMessageId, resolveSender } = require('./message-handler');

const HEADER = '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING';
const START_LINE = '🎉 Start To Work 🎉';
const CLEARED_LINE = '✅ Thanks! All clear\nGop Gop';
const STATUS_TITLE = '📊 Groups Status';
// Tolerate surrounding whitespace / bidi marks (WhatsApp adds them) / any case.
const STATUS_PATTERN = /^[\s\u200e\u200f]*\/calculate[\s\u200e\u200f]*$/i;
const ADMIN_ONLY_REPLY = '❌ This command is restricted to administrators.';
// /setname <name>   |   /setname <id>@g.us <name>  (remote form only from the report group)
const SETNAME_PATTERN = /^\/setname\s+(?:(\S+@g\.us)\s+)?(.+?)\s*$/i;

function createCalculationHandler({ logger, client, adminGroupId, calculationRepository, isAdmin } = {}) {
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
