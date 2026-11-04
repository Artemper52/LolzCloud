(() => {
  'use strict';
  function update(root = document) {
    const controls = root.matches?.('input[type=range]') ? [root] : root.querySelectorAll('input[type=range]');
    for (const input of controls) {
      const min = Number(input.min) || 0, max = Number(input.max) || 100, value = Number(input.value) || 0;
      const percent = Math.max(0, Math.min(100, (value - min) / (max - min || 1) * 100)) + '%';
      if (input.style.getPropertyValue('--range-percent') !== percent) input.style.setProperty('--range-percent', percent);
    }
  }
  window.LolzCloudRanges = { update };
  document.addEventListener('input', event => { if (event.target.matches('input[type=range]')) update(event.target); });
  update();
})();
