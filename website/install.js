(() => { 'use strict'; const config = window.LOLZCLOUD_SITE; for (const link of document.querySelectorAll('[data-file]')) if (config[link.dataset.file]) link.href = config[link.dataset.file]; })();
