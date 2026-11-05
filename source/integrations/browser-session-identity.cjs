'use strict';
const crypto = require('node:crypto'), fs = require('node:fs');
const { storageAvailable } = require('./secure-storage.cjs');
const { writeJson } = require('./durable-json.cjs');

// This installation's signing key lets an already paired browser recognize the
// app after its loopback port changes. A random local web page is never trusted.
function createBrowserIdentity({ filename, safeStorage } = {}) {
  let privateKey, persistent = false;
  if (filename && fs.existsSync(filename)) {
    try {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (saved.version !== 1 || !storageAvailable(safeStorage)) throw Error();
      privateKey = crypto.createPrivateKey(safeStorage.decryptString(Buffer.from(saved.encryptedKey, 'base64')));
      if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw Error();
      persistent = true;
    } catch { privateKey = null; /* Preserve an unreadable saved identity for recovery. */ }
  }
  if (!privateKey) {
    privateKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    if (filename && !fs.existsSync(filename) && storageAvailable(safeStorage)) {
      try {
        const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        writeJson(filename, { version: 1, encryptedKey: safeStorage.encryptString(pem).toString('base64') });
        persistent = true;
      } catch { /* A one-use pairing still works without an OS keyring. */ }
    }
  }
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  const fingerprint = crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
  const pairingCode = fingerprint.slice(0, 16).toUpperCase().match(/.{4}/g).join(' ');
  return { publicKey, pairingCode, persistent, sign(payload) { return crypto.sign('sha256', Buffer.from(payload), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64'); } };
}
function signTransfer(identity, context, expiresAt) {
  const request = { format: 'lolzcloud-browser-request', version: 1, id: context.id, key: context.key.toString('base64'), receiver: context.url + 'receive', expiresAt, publicKey: identity.publicKey };
  return { ...request, signature: identity.sign(JSON.stringify(request)) };
}
module.exports = { createBrowserIdentity, signTransfer };
