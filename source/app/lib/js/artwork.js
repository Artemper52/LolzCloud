(() => {
  const requests = new WeakMap();
  window.lolzArtwork = (image, value, ambient = null) => {
    const url = typeof value === 'string' && /^https:\/\//.test(value) ? value : '';
    if (image.dataset.artwork === url) return;
    image.dataset.artwork = url; image.hidden = true; image.style.opacity = '0'; image.removeAttribute('src');
    if (ambient) ambient.style.backgroundImage = '';
    const request = {}; requests.set(image, request);
    if (!url) return;
    const probe = new Image();
    probe.onload = () => {
      if (requests.get(image) !== request) return;
      image.src = url; image.hidden = false;
      requestAnimationFrame(() => { if (requests.get(image) === request) image.style.opacity = '1'; });
      if (ambient) ambient.style.backgroundImage = 'url(' + JSON.stringify(url) + ')';
    };
    probe.onerror = () => { if (requests.get(image) === request) { image.hidden = true; image.removeAttribute('src'); } };
    probe.src = url;
  };
})();
