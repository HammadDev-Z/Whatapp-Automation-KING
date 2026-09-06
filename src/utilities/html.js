'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function layout(title, content, csrfToken = '') {
  const navigation = csrfToken ? `<header><a class="brand" href="/dashboard"><span class="brand-mark">W</span><span><strong>CHAINCODE</strong><small>WHATSAPP DISTRIBUTION</small></span></a><nav><a href="/dashboard">Inventory</a><a href="/dashboard/codes">Lifecycle</a><a href="/dashboard/groups">Groups</a><a href="/dashboard/calculations">Calculations</a><a href="/dashboard/admins">Admins</a><a href="/dashboard/audit">Ledger</a><a href="/dashboard/usage">Usage</a><a href="/dashboard/failed">Alerts</a><form method="post" action="/logout" class="inline"><input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}"><button class="nav-button">Disconnect</button></form></nav></header>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)} · ChainCode</title><link rel="stylesheet" href="/styles.css"></head><body>${navigation}<main>${content}</main><footer><span>CHAINCODE CONTROL PLANE</span><span>SECURE · TRACEABLE · TRANSACTIONAL</span></footer></body></html>`;
}

module.exports = { escapeHtml, layout };
