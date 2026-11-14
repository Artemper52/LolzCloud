# Проверки Android

Для исправлений по пользовательскому видео в 0.1.1 добавлены `run-video-fixes.cjs` и `run-video-layout.cjs`: реальный IME-поиск, диалоги, восстановление состояния и 360 dp/200% шрифт. Они выполняются после сборки test APK, только на изолированном эмуляторе. WebRenderingInstrumentation отдельно проверяет реальные HTTPS-страницы входа, перенаправления, AssetManager и восстановление ошибки. Основной и configuration runners выбирают APK из актуального `version.json`; installer/update fixtures ниже относятся к исторической паре 0.1.0 → 0.1.1 и требуют обновления fixture-версий для последующих прогонов.

Тесты используют отдельный APK, platform `Instrumentation` и настоящий системный Storage Access Framework. AndroidX, тестовый вход и подмена рабочей библиотеки не используются. Приложение для телефона не содержит тестовых данных или instrumentation-классов.

Сначала собери основное приложение и запусти один Android-эмулятор. Нужны JDK, SDK из `android/tools/build.cjs` и существующая зависимость проекта `ffmpeg-static`. Затем из корня репозитория:

```powershell
node android/tests/build-instrumentation.cjs
node android/tests/run-instrumentation.cjs
```

Тестовый APK подписывается тем же локальным development-ключом, что и основное приложение. Runner отказывается запускаться на физическом телефоне. Он импортирует четыре сгенерированных MP3 через системный проводник, импортирует LRC, проверяет native воспроизведение и MediaSession, а затем выполняет `force-stop`, установку основного APK поверх текущего (`install -r`) и проверяет сохранение данных и прав SAF. Звуковые фикстуры содержат тишину и ID3 с пометкой «демо»; проверка не оценивает слышимое качество звука.

В библиотеке эмулятора остаются реальные импорты из DocumentsProvider тестового APK: они подходят для воспроизводимых скриншотов. Удаление тестового APK удалит источник этих файлов. Пользовательские данные в APK для установки отсутствуют.

Машинный результат записывается в `android/output/android-verification.json`. В проверенном запуске выполнено 26 проверок приложения и восстановления состояния. Чистый LRC-парсер дополнительно проверяется без Android:

```powershell
javac -encoding UTF-8 -d android/build/lrc-tests android/app/src/main/java/com/lolzcloud/mobile/LrcParser.java android/tests/LrcParserTest.java
java -cp android/build/lrc-tests LrcParserTest
```

Для проверки `UpdateManager.validateApk` подготовь в `android/build/update-fixtures/valid/` APK версии `0.1.1`, code `2` с основным development-сертификатом и в `android/build/update-fixtures/invalid/` такой же APK с другим сертификатом. Имя обоих файлов — `LolzCloud-Android-0.1.1.apk`. Повтори сборку тестового APK и запусти:

```powershell
node android/tests/build-instrumentation.cjs
node android/tests/run-instrumentation.cjs --with-updates
```

Дополнительные четыре проверки отвергают текущую версию, принимают более новую версию с правильным сертификатом, отвергают другой сертификат и повреждённый файл. Они только вызывают валидатор; APK версии `0.1.1` не устанавливается. `--updates-only` выполняет только эти проверки и добавляет результат к существующему отчёту. Загрузка опубликованного релиза и сетевые ошибки проверяются отдельно от локальных APK-фикстур.

Отдельная проверка настоящего системного установщика выполняется только на `emulator-5554`:

```powershell
node android/tests/build-instrumentation.cjs
node android/tests/run-installer.cjs
```

Runner устанавливает текущее приложение `0.1.0` поверх существующего, запускает phase `installer` и использует подписанный APK `0.1.1` только как обновление для осмотра. Проверяются отказ без разрешения источника, открытие системных Settings и сохранение pending-состояния, выдача APK через ограниченный read-only ContentProvider, запрет других путей/записи, продолжение после разрешения и настоящий диалог Package Installer с `LolzCloud` и кнопками Cancel/Update. Тест нажимает Cancel; новая версия не устанавливается. Затем проверяются сохранение версии `0.1.0`, библиотеки и темы. Итог: `android/output/android-installer-verification.json`, 15 проверок и отдельно подтверждённое возвращение разрешения установки в `deny`.

Разрешение меняется через app-op только для тестового приложения на этом эмуляторе. Отзыв `REQUEST_INSTALL_PACKAGES` Android может сопровождать завершением процесса приложения, поэтому возврат в `deny` выполняет внешний runner после получения отчёта instrumentation. Физические телефоны и сеть эта проверка не использует.

Проверка пересоздания экрана при открытом системном выборе LRC:

```powershell
node android/tests/build-instrumentation.cjs
node android/tests/run-configuration.cjs
```

Она очищает текст только первого тестового трека, открывает настоящий системный выбор LRC, пересоздаёт `MainActivity`, подтверждает создание нового экземпляра при открытом проводнике и выбирает файл. Шесть проверок подтверждают сохранение текста для прежнего трека и неизменность очереди. Отдельный результат с SHA-256 проверенного APK — `android/output/android-configuration-verification.json`. Проверки по искусственно составленному `Bundle` не используются.
# Android social/offline regression

`node android/tests/run-social-native.cjs` runs `SocialAndroidInstrumentation` only on the isolated `emulator-5554`. Build/install the current production APK first, then build the separate instrumentation APK with `node android/tests/build-instrumentation.cjs`. The runner temporarily grants POST_NOTIFICATIONS for native delivery checks and restores the original grant after the report. It never installs a production APK itself.

The suite uses real private files, MediaPlayer, Activity navigation, Android NotificationManager and system DocumentsUI. A separate image-only DocumentsProvider supplies an 8×8 PNG, leaving the four audio fixture IDs unchanged. Successful upload goes through a real input tap, ACTION_OPEN_DOCUMENT selection, production ValueCallback, FileReader and Canvas; it checks the generated RGBA pixel rather than substituting an input file or callback. Native file/content access settings remain unchanged.

An explicitly isolated form on the trusted own HTTPS origin avoids requiring a personal account; startup auth JavaScript is disabled only for loading that fixture, then reenabled for FileReader/Canvas. The production WebViewClient/WebChromeClient stay installed. Social notification events are declared synthetic fixtures, not proof of a real user's login or server profile mutation. First baseline, dedup/read/expiry/disabled preferences, foreground notifications, global unread badge, search focus/cursor and notification click to the review page are checked against the actual Android UI/runtime. Native notification cancellation uses bounded convergence because it is asynchronous.

The suite also loads the actual social.js from the APK over an explicitly declared own-origin room UI fixture and presses real system Back. First Back must close the drawer while retaining the same room Activity, WebView, URL and connected player DOM. Second Back follows normal navigation. A standalone social page must exit without a close()/Back loop. `node android/tests/run-social-native.cjs --back-only` isolates these checks without replacing the full report.

For 0.1.4, separate phases are also available: `--without-picker` (offline/notifications/Back), `--upload-only` (system image selection/callback/Canvas) and `--roles-only` (actual bundled role UI/CSS with declared GET-only profiles). They write separate reports. The 0.1.4 results are 50/23/13/17 PASS respectively; the combined whole-run still stopped at PNG selection and is explicitly recorded as failed, rather than reported as 71 PASS. Phase startup checks overlap. [Exact results and the DocumentsUI harness gap](../../docs/android/social-regression-0.1.4.md).

For 0.1.5/code6, the complete sequential run passed 71 checks on the installed APK SHA `ee61577bcf8b45650fad41a76715d3b532012cc949289a61dbb2adfc41db72d0`. The test harness now selects the observed PNG tile using Android's real touchscreen input when the accessible ancestor has no click action, and starts MainActivity through its actual launcher intent so notification task/Back setup matches normal launch. Production code is unchanged. Two failed intermediate runs are retained separately. Set `LOLZCLOUD_SOCIAL_NATIVE_OUTPUT` to a fresh directory to preserve historical failed JSON. [Full proof and limits](../../docs/android/social-full-0.1.5.md).

Output: `android/output/android-social-native-verification.json`. APK 0.1.3/code4 SHA `e5fb9fe5bd07bc5889ab3cb69ffcbfdc482440998c3b8533d108f9bf81781d77` passed 71 checks on Android 15/API 35 x86_64 on 2026-11-14. It retains the 70 checks passed by 0.1.2 and adds a readiness check for the isolated startup fixture. The separate `android/output/android-social-back-verification.json` passed 17 checks (including two shared startup checks). The installed base.apk SHA was independently checked against the production artifact. Copies are in [verification-0.1.3](../../docs/android/verification-0.1.3/). This does not replace checks on a real phone, actual Bluetooth/calls or personal SoundCloud/Lolzteam accounts.

# Native account pairing regression 0.1.3

`node android/tests/run-login.cjs` installs only the separate test APK and runs `LoginInstrumentation` on the isolated `emulator-5554`. The production APK must already be installed. On the same 0.1.3/code4 artifact above, 55 checks passed: 32 declared bounded protocol/controller fixtures, 22 actual native UI/lifecycle checks and one emulator guard. The real unauthenticated start API creates a pending pair; no personal sign-in or approval is performed. The whole `/connect?code=...` browser intent is intercepted before authentication UI opens.

The suite verifies strict grant/session JSON, wrong-origin URLs, expiry/rate-limit/redirect errors, private pending restore, explicit expiry renewal, actual Activity recreation, hardware Back, cancellation, no stale callback login loop, no fabricated cookie and explicit retry. It snapshots/restores existing pending preferences. Separate host tests cover 52 account policy cases and 12 delayed-cookie ownership/rollback cases, including cancellation before the setter callback and preservation of a newer committed account.

Report: `android/output/android-account-login-verification.json`, with a documentation copy [here](../../docs/android/verification-0.1.3/android-account-login-verification.json). The test does not claim a real account's approve → connected-session end-to-end login. [Protocol and limits](../../docs/android/account-login.md).

# Native automatic lyrics regression 0.1.4

`node android/tests/run-lyrics-policy.cjs` runs host metadata/LRC/provider behavior tests. Set `LOLZCLOUD_JSON_JAR` to a test-only org.json JAR (or use the documented D-toolchain location); production uses Android's built-in org.json. `--live` also performs one real anonymous LRCLIB metadata lookup and prints only found/synced/line-count values. It never prints source song text. Results: `android/output/android-lyrics-policy-verification.json`.

After root builds/installs the production APK and the separate test APK, `node android/tests/run-lyrics.cjs` exercises the real native lyrics screen and MediaPlayer on emulator-5554. Declared bounded provider responses cover loading, source errors/Retry, empty results, genuine line timestamps, real touch seek/highlight, mismatched-duration plain text, manual metadata, persistent separate cache, imported LRC priority and stale request cancellation. The same suite checks that a filtered empty catalogue page retains next-page navigation. It preserves native library preferences and does not authenticate any account. Reports/screenshots go to D; the JSON copy is `android/output/android-lyrics-verification.json`. [Implementation and limits](../../docs/android/lyrics-0.1.4.md).

