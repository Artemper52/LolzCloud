'use strict';
// Only app-owned static UI is bundled. API/auth requests and player SDKs remain genuine HTTPS.
const fs = require('node:fs');
const path = require('node:path');
const android = path.resolve(__dirname, '..');
const repository = path.resolve(android, '..');
const files = [
  ['server/public/room.html', 'room.html'],
  ['server/public/room.css', 'room.css'],
  ['server/public/room.js', 'room.js'],
  ['server/public/room-sync.js', 'room-sync.js'],
  ['server/public/room-players.js', 'room-players.js'],
  ['server/public/media-source.js', 'media-source.js'],
  ['server/public/site.js', 'site.js'],
  ['server/public/social.html', 'social.html'],
  ['server/public/social.js', 'social.js'],
  ['server/public/social.css', 'social.css'],
  ['source/app/lib/assets/logo.svg', 'logo.svg']
];
function syncRoomAssets() {
  const destination = path.join(android, 'app/src/main/assets/room-client');
  fs.mkdirSync(destination, { recursive: true });
  for (const [source, name] of files) fs.copyFileSync(path.join(repository, source), path.join(destination, name));
  return files.length;
}
module.exports = { syncRoomAssets, files };
if (require.main === module) console.log('Bundled room interface: ' + syncRoomAssets() + ' app-owned assets');
