'use strict';
const config = require('../../config/app.json');
const validApplicationId = value => typeof value === 'string' && /^[1-9]\d{16,21}$/.test(value);
function discordApplicationId() {
  const value = process.env.LOLZCLOUD_DISCORD_APPLICATION_ID || config.discordApplicationId || '';
  return validApplicationId(value) ? value : '';
}
module.exports = { discordApplicationId, validApplicationId };
