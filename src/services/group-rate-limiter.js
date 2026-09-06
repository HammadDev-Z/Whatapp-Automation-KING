'use strict';

class GroupRateLimiter {
  constructor({ limit, windowMs, now = () => Date.now() }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.groups = new Map();
  }

  consume(groupId) {
    const now = this.now();
    const recent = (this.groups.get(groupId) || []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.groups.set(groupId, recent);
      return false;
    }
    recent.push(now);
    this.groups.set(groupId, recent);
    return true;
  }
}

module.exports = { GroupRateLimiter };
