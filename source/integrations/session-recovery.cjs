'use strict';
const path = require('node:path');
const { importFromInstalled } = require('./session-import.cjs');
async function recoverPreviousSession({ app, target, saved, importPrevious = importFromInstalled }) {
  await saved.start();
  // Recover the app's own old profile automatically, never an unrelated browser
  // profile or an explicitly signed-out account. Test/preview profiles stay isolated.
  if (!saved.canRecoverLegacy() || path.resolve(app.getPath('userData')) !== path.resolve(app.getPath('appData'), 'LolzCloud')) return;
  try { await importPrevious(app, target); await saved.acceptImported(); saved.source = 'previous-version'; }
  catch { /* No usable old installation: proceed to the browser account picker. */ }
}
module.exports = { recoverPreviousSession };
