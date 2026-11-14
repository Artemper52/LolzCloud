(() => {
  'use strict';
  const config = window.LOLZCLOUD_SITE;
  const demos = {
    wave: { image: '/assets/wave.png', title: 'Следующий любимый трек — где-то рядом.', description: 'Настроение, знакомое и новое. Без повторов за сутки.', alt: 'Моя волна в LolzCloud: персональный микс и настройки рекомендаций' },
    lyrics: { image: '/assets/lyrics.png', title: 'Не теряй ни строчки.', description: 'Плавное следование, подсветка и быстрый переход к нужному моменту песни.', alt: 'Экран текста LolzCloud с подсветкой текущей строки' },
    sound: { image: '/assets/sound.png', title: 'Звучит так, как хочется тебе.', description: 'Готовые пресеты, скорость, бас, пространство и автоматическое приглушение.', alt: 'Звуковые пресеты и настройки эффектов в LolzCloud' },
    mini: { image: '/assets/mini.png', title: 'Мини-плеер поверх других окон.', description: 'Перемещай, оценивай треки и следи за текстом, пока занимаешься своим.', alt: 'Мини-плеер LolzCloud с текстом песни и управлением музыкой' }
  };
  const el = id => document.getElementById(id), tabs = [...document.querySelectorAll('[data-demo]')];
  let selected = 'wave', change = 0;
  function select(key) {
    if (!demos[key]) return;
    selected = key; const demo = demos[key], token = ++change;
    tabs.forEach(button => { const active = button.dataset.demo === key; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
    el('demo-panel').setAttribute('aria-labelledby', 'tab-' + key);
    el('demo-panel').dataset.screen = key;
    el('demo-title').textContent = demo.title; el('demo-description').textContent = demo.description;
    el('screen-open').dataset.lightbox = key; el('screen-open').setAttribute('aria-label', 'Увеличить: ' + demo.alt);
    const image = new Image(); image.onload = () => { if (token !== change) return; el('demo-image').src = demo.image; el('demo-image').alt = demo.alt; };
    image.src = demo.image;
  }
  for (const button of tabs) {
    button.addEventListener('click', () => select(button.dataset.demo));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const at = tabs.indexOf(button), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next].dataset.demo); tabs[next].focus();
    });
  }
  const lightbox = el('lightbox');
  function openImage(key) {
    const demo = demos[key]; if (!demo) return;
    el('lightbox-image').src = demo.image; el('lightbox-image').alt = demo.alt; el('lightbox-caption').textContent = demo.title;
    if (!lightbox.open) lightbox.showModal();
  }
  document.querySelectorAll('[data-lightbox]').forEach(button => button.addEventListener('click', () => openImage(button.dataset.lightbox)));
  el('demo-zoom').addEventListener('click', () => openImage(selected));
  lightbox.addEventListener('click', event => { if (event.target === lightbox) { const bounds = lightbox.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) lightbox.close(); } });
  document.querySelectorAll('[data-release]').forEach(node => { node.textContent = 'Версия ' + config.version; });
  document.querySelectorAll('[data-download]').forEach(node => { node.href = config.download; });
  for (const [attribute, key] of [['data-portable', 'portable'], ['data-legacy', 'legacy'], ['data-legacy-portable', 'legacyPortable']]) document.querySelectorAll('[' + attribute + ']').forEach(node => { node.href = config[key]; });
  document.querySelectorAll('[data-linux-x64]').forEach(node => { node.href = config.linuxX64; });
  document.querySelectorAll('[data-linux-arm64]').forEach(node => { node.href = config.linuxArm64; });
  for (const [attribute,key] of [['data-android','android'],['data-ios','ios'],['data-linux-x64-tar','linuxX64Tar'],['data-source-archive','sourceArchive']]) document.querySelectorAll('['+attribute+']').forEach(node=>{node.href=config[key];});
  document.querySelectorAll('[data-android-version]').forEach(node=>{node.textContent=config.androidVersion;});
  const platform=/iPhone|iPad|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?'ios':/Android/.test(navigator.userAgent)?'android':/Linux/.test(navigator.platform)?'linux':'windows';
  const recommended=document.querySelector('[data-platform-card='+platform+']');
  if(recommended){recommended.classList.add('recommended');recommended.parentElement.prepend(recommended);}
  document.querySelectorAll('[data-source]').forEach(node => { node.href = config.source; });
  if (config.size) document.querySelectorAll('[data-size]').forEach(node => { node.textContent = ' · ' + config.size; });
  document.querySelectorAll('[data-contact]').forEach(node => { const url = config[node.dataset.contact]; if (url) node.href = url; });
  if (config.forumTopic && /^https:\/\/(?:lolz\.team|lolz\.live|zelenka\.guru)\/threads\/\d+\/?$/.test(config.forumTopic)) { el('forum-topic').href = config.forumTopic; el('forum-topic').hidden = false; }
})();
