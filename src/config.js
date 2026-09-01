'use strict';

require('dotenv').config();

function number(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function loadConfig() {
  const config = {
    env: process.env.NODE_ENV || 'development',
    port: number('PORT', 3000),
    databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/whatsapp_codes',
    whatsappClientId: process.env.WHATSAPP_CLIENT_ID || 'code-distribution-bot',
    calculateAdminGroupId: (process.env.CALCULATE_ADMIN_GROUP_ID || '').trim(),
    adminNumbers: process.env.ADMIN_NUMBERS || '',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    sessionSecret: process.env.SESSION_SECRET || '',
    groupRateLimit: number('GROUP_RATE_LIMIT', 5),
    groupRateWindowMinutes: number('GROUP_RATE_WINDOW_MINUTES', 10),
    maxCsvSizeMb: number('MAX_CSV_SIZE_MB', 5),
    maxCodesPerRequest: number('MAX_CODES_PER_REQUEST', 50),
    tagResponseDelayMinSeconds: number('TAG_RESPONSE_DELAY_MIN_SECONDS', 5),
    tagResponseDelayMaxSeconds: number('TAG_RESPONSE_DELAY_MAX_SECONDS', 10),
    reconnectDelayMs: number('WHATSAPP_RECONNECT_DELAY_MS', 10000)
  };
  if (config.tagResponseDelayMaxSeconds < config.tagResponseDelayMinSeconds) {
    throw new Error('TAG_RESPONSE_DELAY_MAX_SECONDS must be greater than or equal to TAG_RESPONSE_DELAY_MIN_SECONDS');
  }
  if (config.env === 'production' && (!config.adminPassword || config.adminPassword.includes('replace-'))) {
    throw new Error('A strong ADMIN_PASSWORD is required in production');
  }
  if (config.env === 'production' && config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters in production');
  }
  return config;
}

module.exports = { loadConfig };
