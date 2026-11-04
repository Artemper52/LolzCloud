(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1)), error = new URLSearchParams(location.search).get('error');
  history.replaceState(null, '', location.pathname);
  const status = document.getElementById('status'), token = params.get('access_token'), state = params.get('state');
  if (error || !token || !state) { status.textContent = 'Вход не подтверждён. Вернись ко входу и повтори попытку.'; return; }
  fetch('/api/auth/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token, state }), credentials: 'same-origin' })
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); location.replace(data.next || '/rooms'); })
    .catch(error => { status.textContent = error.message || 'Не удалось подтвердить вход. Попробуй ещё раз.'; });
})();
