'use strict';

// Per-category low-stock thresholds. After a successful code delivery the bot
// checks the remaining unused stock for that category and, if it has dropped
// BELOW the threshold, posts one alert to LOW_STOCK_ALERT_GROUP_ID.
// Categories not listed here never trigger an alert.
const LOW_STOCK_THRESHOLDS = {
  '830': 10,
  '2320': 10,
  '5150': 10,
  '13k': 4,
  '27k': 2,
  '56k': 2
};

function lowStockThreshold(category) {
  return Object.prototype.hasOwnProperty.call(LOW_STOCK_THRESHOLDS, category)
    ? LOW_STOCK_THRESHOLDS[category]
    : null;
}

function isLowStock(remaining, category) {
  const threshold = lowStockThreshold(category);
  return threshold !== null && remaining < threshold;
}

function lowStockAlertMessage(category, remaining, threshold) {
  return `‎👑ᴋɪɴɢᵝᵒˢˢ GAMING\n\n⚠️ Low stock alert\n${category}: ${remaining} codes left (threshold ${threshold})`;
}

module.exports = { LOW_STOCK_THRESHOLDS, lowStockThreshold, isLowStock, lowStockAlertMessage };
