'use strict';
// Deliberately restricted to the task emulator. Never mutate a personal phone's library or permissions.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const reportDirectory = process.env.LOLZCLOUD_SOCIAL_NATIVE_OUTPUT || path.join(project, 'output');
const adb = path.join(process.env.ANDROID_HOME || 'D:/LolzCloud-Android-Toolchain/sdk', 'platform-tools', 'adb.exe');
const serial = 'emulator-5554';
const backOnly=process.argv.includes('--back-only');
const rolesOnly=process.argv.includes('--roles-only');
const uploadOnly=process.argv.includes('--upload-only');
const withoutPicker=process.argv.includes('--without-picker');
function run(args, options={}) {
  const result = spawnSync(adb, ['-s', serial, ...args], { encoding: 'utf8', windowsHide: true, timeout: 150000, maxBuffer: 2*1024*1024, ...options });
  if (result.error || result.status) throw result.error || new Error(result.stdout + result.stderr);
  return result.stdout;
}
if (run(['shell','getprop','ro.kernel.qemu']).trim() !== '1') throw new Error('Only emulator-5554 is allowed.');
const before = run(['shell','dumpsys','package','com.lolzcloud.mobile']);
const permissionGranted = /android\.permission\.POST_NOTIFICATIONS: granted=true/.test(before);
const version = JSON.parse(fs.readFileSync(path.join(project,'version.json'),'utf8'));
const apk = path.join(project,'output','LolzCloud-Android-'+version.versionName+'.apk');
try {
  run(['shell','pm','grant','com.lolzcloud.mobile','android.permission.POST_NOTIFICATIONS']);
  console.log(run(['install','-r',path.join(project,'build','instrumentation','LolzCloud-core-tests.apk')]).trim());
  const output = run(['shell','am','instrument','-w',...(rolesOnly?['-e','phase','roles']:uploadOnly?['-e','phase','upload']:withoutPicker?['-e','phase','without-picker']:backOnly?['-e','phase','back']:[]),'com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.SocialAndroidInstrumentation']);
  const start=output.indexOf('{'),end=output.lastIndexOf('}');
  if(start<0||end<start)throw new Error(output);
  const report=JSON.parse(output.slice(start,end+1));
  report.generatedAt=new Date().toISOString();
  report.emulator=serial;
  report.androidApi=run(['shell','getprop','ro.build.version.sdk']).trim();
  report.androidVersion=run(['shell','getprop','ro.build.version.release']).trim();
  report.deviceModel=run(['shell','getprop','ro.product.model']).trim();
  report.apk=path.basename(apk);
  report.apkSha256=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
  report.scope=rolesOnly?'Declared own-origin role profiles rendered with the actual bundled social.js/css in Android WebView; real touch open/Cancel, GET-only fixtures, no personal login or role grant.':uploadOnly?'Actual system DocumentsUI → read-only PNG test provider → production ValueCallback → FileReader/Canvas; isolated own-origin form, no personal login or server upload.':'Real private offline storage/MediaPlayer and real Android NotificationManager; social events are isolated fixtures, not a personal-account login.';
  fs.mkdirSync(reportDirectory,{recursive:true});
  fs.writeFileSync(path.join(reportDirectory,rolesOnly?'android-social-roles-verification.json':uploadOnly?'android-social-upload-verification.json':withoutPicker?'android-social-core-verification.json':backOnly?'android-social-back-verification.json':'android-social-native-verification.json'),JSON.stringify(report,null,2)+'\n');
  if(report.status!=='passed')throw new Error(JSON.stringify(report,null,2));
  console.log('PASS: '+report.checks.length+' native offline/social behavior checks.');
} finally {
  // Revoking permission can terminate the app; do it only after instrumentation/report completion.
  if(!permissionGranted)run(['shell','pm','revoke','com.lolzcloud.mobile','android.permission.POST_NOTIFICATIONS']);
}
