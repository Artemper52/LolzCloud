(async () => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1)), error = new URLSearchParams(location.search).get('error');
  history.replaceState(null, '', location.pathname);
  const status = document.getElementById('status'), token = params.get('access_token'), state = params.get('state');
  if (error || !token || !state) { status.textContent = 'Вход не подтверждён. Вернись ко входу и повтори попытку.'; return; }
  status.textContent = 'Проверяем твой профиль…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch('/api/auth/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, state }), credentials: 'same-origin', signal: controller.signal,
    });
    const data = await response.json();
    if (response.ok) location.replace(data.next || '/rooms');
    else status.textContent = data.error || 'Не удалось подтвердить вход. Попробуй ещё раз.';
  } catch {
    status.textContent = controller.signal.aborted
      ? 'Сервер долго отвечает. Вернись ко входу и попробуй снова.'
      : 'Нет связи с LolzCloud. Проверь интернет и открой вход заново.';
  } finally { clearTimeout(timeout); }
})();
