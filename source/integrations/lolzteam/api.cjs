'use strict';

const https = require('node:https');
const API_ORIGIN = 'https://api.lolz.team';

class ApiError extends Error {
  constructor(message, status = 0, retryMs = 0) {
    super(message);
    this.status = status;
    this.retryMs = retryMs;
  }
}

function retryDelay(headers, now = Date.now()) {
  const after = headers['retry-after'];
  const seconds = Number(after);
  let delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(after) - now;
  const reset = Number(headers['x-ratelimit-reset']);
  if (Number.isFinite(reset)) delay = Math.max(delay || 0, reset * 1000 - now);
  return Math.max(60_000, Number.isFinite(delay) ? delay : 120_000);
}

function request(method, token, payload, endpoint = '/users/me') {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'LolzCloud/1.0',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = body.length;
    }
    const req = https.request(API_ORIGIN + endpoint, { method, headers }, res => {
      const chunks = [];
      let length = 0;
      res.on('data', chunk => {
        length += chunk.length;
        if (length > 1_048_576) {
          res.destroy(new ApiError('Слишком большой ответ Lolzteam.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', () => finish(new ApiError('Соединение с Lolzteam прервано.')));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status === 429) return finish(new ApiError('Лимит Lolzteam. Повторим после паузы.', status, retryDelay(res.headers)));
        if (status === 401) return finish(new ApiError('Токен недействителен или истёк. Привяжи аккаунт заново.', status));
        if (status === 403) return finish(new ApiError('Нет доступа: нужны права basic, read и post и возможность менять статус.', status));
        if (status === 400 || status === 422) return finish(new ApiError('Lolzteam отклонил статус. Проверь право менять его и длину текста.', status));
        if (status < 200 || status >= 300) return finish(new ApiError(`Lolzteam временно недоступен (HTTP ${status}).`, status));
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!json || typeof json !== 'object' || json.errors || json.error || (json.status && json.status !== 'ok')) {
            return finish(new ApiError('Lolzteam вернул ошибку. Изменение статуса не подтверждено.', 400));
          }
          finish(null, json);
        } catch { finish(new ApiError('Lolzteam вернул некорректный ответ.')); }
      });
    });
    let settled = false;
    const timeout = setTimeout(() => req.destroy(new ApiError('Lolzteam не ответил за 12 секунд.')), 12_000);
    function finish(error, data) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(data);
    }
    req.on('error', error => finish(error instanceof ApiError ? error : new ApiError('Не удалось подключиться к Lolzteam. Проверь интернет.')));
    if (body) req.write(body);
    req.end();
  });
}

function createApi() {
  return {
    async getUser(token) { return (await request('GET', token)).user; },
    async setTitle(token, title) { return request('PUT', token, { user_title: title }); },
    async searchMusic(token) {
      const data = await request('POST', token, { q: 'soundcloud', limit: 20, data_limit: 20 }, '/search/posts');
      const output = [];
      for (const row of data.data || []) {
        const item = row.post || row.thread || row;
        const body = [item.message, item.message_plain_text, item.first_post?.message, item.first_post?.message_plain_text].filter(value => typeof value === 'string').join('\n');
        const urls = [...body.matchAll(/https:\/\/(?:www\.)?soundcloud\.com\/[\w-]+\/(?:sets\/[\w-]+|[\w-]+)/g)].map(match => match[0]);
        const threadId = item.thread_id || row.thread_id;
        if (!Number.isSafeInteger(threadId) || threadId <= 0) continue;
        for (const url of [...new Set(urls)]) output.push({ title: String(item.title || row.title || 'Музыка из сообщества').replace(/<[^>]*>/g, '').slice(0, 100), url, source: `https://lolz.live/threads/${threadId}/` });
      }
      return output.slice(0, 30);
    },
  };
}

module.exports = { API_ORIGIN, ApiError, retryDelay, request, createApi };
