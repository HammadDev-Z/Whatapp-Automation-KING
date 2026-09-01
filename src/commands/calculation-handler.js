'use strict';

// Standalone WhatsApp message handler for the calculation feature. It is
// registered as an ADDITIONAL `message` listener and never touches the existing
// command flow: it only ever replies when the whole message is a valid
// arithmetic expression (see ./calculator). Every other message is ignored.
//
// Running "All Total" is kept in memory per chat (keyed by message.from), which
// matches how the rest of the bot keeps chat state (e.g. the group rate limiter).
// When a calculation brings a chat's All Total to exactly 0 it is announced as
// cleared and the chat's total resets, so the next calculation starts fresh.

const { calculate, formatNumber } = require('../services/calculator');
const { serializeMessageId } = require('./message-handler');

const HEADER = '‎👑ᴋɪɴɢᵝᵒˢˢ GAMING';
const START_LINE = '🎉 Start To Work 🎉';
const CLEARED_LINE = '✅ Thanks! All clear\nGop Gop';
const STATUS_TITLE = '📊 Groups Status';
const STATUS_COMMAND = '/calculate';
const DEDUPE_LIMIT = 500;

function createCalculationHandler({ logger, client, adminGroupId } = {}) {
  const totalsByChat = new Map();
  const processedMessageIds = new Set();

  // `/calculate` — only answered inside the configured admin/status group. Reports
  // the current stored All Total for every group that has calculation data, using
  // the group's live WhatsApp name (falling back to its ID if unavailable).
  async function respondWithGroupsStatus(message) {
    if (!adminGroupId || message.from !== adminGroupId) return;
    const lines = [];
    for (const [groupId, total] of totalsByChat) {
      let name = groupId;
      try {
        const chat = client && (await client.getChatById(groupId));
        if (chat && chat.name) name = chat.name;
      } catch (error) {
        logger?.warn?.('Calculation status: group name lookup failed', { groupId, error });
      }
      lines.push(`${name} : ${formatNumber(total)}`);
    }
    await message.reply(`${HEADER}\n\n${STATUS_TITLE}\n\n${lines.join('\n')}`);
    logger?.info?.('Calculation status handled', { chatId: message.from, groups: lines.length });
  }

  return async function handleCalculation(message) {
    try {
      if (!message || message.fromMe || typeof message.body !== 'string') return;

      if (message.body.trim().toLowerCase() === STATUS_COMMAND) {
        await respondWithGroupsStatus(message);
        return;
      }

      const parsed = calculate(message.body);
      if (!parsed) return;

      const messageId = serializeMessageId(message.id);
      if (messageId) {
        if (processedMessageIds.has(messageId)) return;
        processedMessageIds.add(messageId);
        if (processedMessageIds.size > DEDUPE_LIMIT) {
          processedMessageIds.delete(processedMessageIds.values().next().value);
        }
      }

      const chatId = message.from;
      const previousTotal = totalsByChat.get(chatId) || 0;
      let allTotal = Number((previousTotal + parsed.value).toFixed(10));
      if (Object.is(allTotal, -0)) allTotal = 0;
      const cleared = allTotal === 0;

      // A bare number is echoed exactly as received; an expression shows "① expr=result".
      const curDisplay = parsed.bare ? parsed.expr : formatNumber(parsed.value);
      const calcLine = parsed.bare ? parsed.expr : `① ${parsed.expr}=${curDisplay}`;
      const allDisplay = cleared ? '0.0' : formatNumber(allTotal);

      if (cleared) totalsByChat.delete(chatId);
      else totalsByChat.set(chatId, allTotal);

      let body = `${HEADER}\n\n${START_LINE}\n${calcLine}\nCur Total: ${curDisplay}\n\nAll Total:${allDisplay}`;
      if (cleared) body += `\n\n${CLEARED_LINE}`;

      await message.reply(body);
      logger?.info?.('Calculation handled', { chatId, messageId, cleared });
    } catch (error) {
      logger?.error?.('Calculation handling failed', { error });
    }
  };
}

module.exports = { createCalculationHandler };
