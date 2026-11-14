'use strict';
const jump=process.env.LOLZCLOUD_DEPLOY_SSH_JUMP||'';
if(jump&&!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(jump))throw Error('Use a configured SSH jump host alias');
const port=process.env.LOLZCLOUD_DEPLOY_FORWARD_PORT||'',keyAlias=process.env.LOLZCLOUD_DEPLOY_HOSTKEY_ALIAS||'';
if(port&&(!/^\d{1,5}$/.test(port)||+port<1||+port>65535||!keyAlias||!/^[a-zA-Z0-9.-]+$/.test(keyAlias)||jump))throw Error('Use one verified local SSH forward or one jump host');
module.exports={jumpOptions:['-o','IdentitiesOnly=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',...(port?['-o','HostName=127.0.0.1','-o','Port='+port,'-o','HostKeyAlias='+keyAlias]:jump?['-J',jump]:[])]};
