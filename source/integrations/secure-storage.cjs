'use strict';
function storageAvailable(storage, platform = process.platform) {
  if (!storage?.isEncryptionAvailable()) return false;
  // Chromium's basic_text backend uses a fixed password, not the desktop keyring.
  if (platform === 'linux') {
    try { if (!storage.getSelectedStorageBackend || ['basic_text', 'unknown'].includes(storage.getSelectedStorageBackend())) return false; }
    catch { return false; }
  }
  return true;
}
module.exports = { storageAvailable };
