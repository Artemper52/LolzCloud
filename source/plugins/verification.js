(() => {
  'use strict';
  if (window.__lolzcloudVerificationObserver) return;
  window.__lolzcloudVerificationObserver = true;
  let previous = null, scheduled = false;
  function inspect() {
    scheduled = false;
    const heading = [document.title, ...Array.from(document.querySelectorAll('h1,h2,[role=heading]')).slice(0, 12).map(node => node.textContent)].join(' ');
    const form = document.querySelector('#challenge-form, #px-captcha, .px-captcha-container, [data-testid="verification-challenge"]');
    const active = /verification required|verify (?:that )?you(?: are|'re) human|security verification|проверка безопасности|подтвердите.{0,12}человек/i.test(heading)
      || !!form && form.getBoundingClientRect().height > 0;
    if (active !== previous) {
      previous = active;
      console.log('LolzCloudReceive|Verification|' + JSON.stringify({ active }));
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(inspect, 300);
  }
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', inspect, { once: true });
  inspect();
})();
