'use strict';
class TelegramError extends Error {
  constructor(method, data = {}) {
    super(`Telegram ${method}: ${String(data.description || 'request failed').replace(/\b\d{6,}:[\w-]+/g, '[token]').slice(0, 240)}`);
    this.code = Number(data.error_code) || 502;
    this.retryAfter = Math.min(300, Number(data.parameters?.retry_after) || 0);
  }
}
class TelegramApi {
  constructor(token, fetcher = fetch) {
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token || '')) throw Error('Invalid Telegram bot token configuration');
    this.token = token; this.fetcher = fetcher;
  }
  async call(method, payload = {}, { timeout = 25000, signal } = {}) {
    if (!/^[a-zA-Z]{3,45}$/.test(method)) throw Error('Invalid Telegram method');
    const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    let response;
    try {
      response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', redirect: 'error', signal: deadline,
        ...(payload instanceof FormData ? { body: payload } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      });
    } catch { throw new TelegramError(method, { description: 'network timeout or connection failure' }); }
    let data; try { data = await response.json(); } catch { throw new TelegramError(method); }
    if (!data.ok) throw new TelegramError(method, data);
    return data.result;
  }
}
module.exports = { TelegramApi, TelegramError };
