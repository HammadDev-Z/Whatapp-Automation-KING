'use strict';

const CATEGORY_PATTERN = /^[a-z0-9_-]+$/;

function normalizeCategory(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized && CATEGORY_PATTERN.test(normalized) ? normalized : null;
}

function normalizePhone(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value).split('@')[0];
  return raw.replace(/\D/g, '').replace(/^00/, '');
}

module.exports = { CATEGORY_PATTERN, normalizeCategory, normalizePhone };
