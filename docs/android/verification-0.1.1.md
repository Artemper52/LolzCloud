# Android 0.1.1: исправления пользовательского видео

12 ноября 2026 года. Файл: `android/output/LolzCloud-Android-0.1.1.apk`, versionCode `2`, пакет `com.lolzcloud.mobile`, Android 8+. SHA-256: `3cea67b5187b01a61ab0c2271b5c76de54566c06edca1d282d4feb52b84ff1d5`.

Сохранён сертификат предыдущей версии: `84305e6af2473179b6e124a1822eb82c0343e9bba0b5480cd5a91ecc0dceaa44`. Подписи v2/v3 проверены. Это локальная сборка разработки для установки поверх 0.1.0; публикации в магазине или GitHub не выполнялось.

## Исправления

- SoundCloud начинается с полной публичной страницы в Custom Tab или системном браузере. Поиск, Google и callback больше не делятся между WebView и браузером. Частичные OAuth URL перезапускаются с безопасной исходной страницы. YouTube Music при необходимости Google-входа также начинает в браузере весь сценарий.
- Поиск явно выбирает SoundCloud, YouTube Music или свою библиотеку. Выбор не открывает сайт; кнопка и IME Search выполняют один запрос. Кириллица кодируется в URL, пустой запрос остаётся с ошибкой. Смена трека и пересоздание Activity сохраняют запрос; смена трека сохраняет также фокус и выделение.
- Приглашение, пульт и прямой аудиопоток используют URI-клавиатуру. Неверный ввод сохраняется, ошибка расположена под полем и объявляется accessibility live region. Проверяются точные room/remote пути. Диалоги используют тему приложения и внутреннюю прокрутку.
- Убрана декоративная иллюстрация комнат и повторная инструкция. Веб-заголовок отражает фактический переход на вход.
- Исправлена Windows-упаковка assets: AAPT2 записывал обратные слеши, Android AssetManager не находил CSS/JS и возвращался `text/plain 503`. Каталог теперь добавляет Java jar с каноническими ZIP-путями. Проверка читает сырые имена ZIP, которые прежний reader скрывал нормализацией.
- Исправлено исчезновение native HTTP-ошибки после позднего `onPageStarted`. Ошибка сохраняется для той же навигации; Retry, новая цель и Back явно начинают новую попытку.

## Фактическая проверка

Изолированный Android 15/API 35 x86_64, WebView `124.0.6367.219`. Тестовые классы, MP3 с тишиной и DocumentsProvider находятся в отдельном test APK и не входят в приложение для телефона.

| Проверка | Результат и подтверждение |
| --- | --- |
| Native поиск и диалоги | [21 проверка](verification-0.1.1-native.json), включая реальный accessibility IME Enter, кириллический запрос, правильный browser intent, YTM URL, локальную выдачу, фактический Next очереди во время ввода и настоящее пересоздание Activity |
| Узкий экран и крупный шрифт | [8 проверок](verification-0.1.1-layout.json): 360 dp, Paper, fontScale 2.0; настоящий TYPE_INPUT_METHOD window остаётся видимым после анимации, действия доступны; исходные density/fontScale восстановлены |
| Настоящие HTTPS-страницы | [4/4 маршрута](verification-0.1.1-webview.json): `/login`, `/rooms`, `/remote/<id>`, `/connect` завершаются на читаемом входе с 240 CSS rules, правильным native заголовком и пустым console error list. WebViewClient не заменялся |
| HTTP-ошибка и Retry | В том же WebView-отчёте: публичный URL действительно возвращает 404; native ошибка сохраняется после complete +400 мс; кнопка Retry запускает новую загрузку и возвращает устойчивое состояние ошибки |
| Assets внутри APK | [8 файлов](verification-0.1.1-assets.json): канонические сырые ZIP-пути и точное совпадение байтов; на Android AssetManager видит их, CSS отдаётся как `text/css 200` |
| Политики URL и навигации | 58 whole-flow/latch, 59 room routing/auth и 19 invitation/remote cases прошли; API и OAuth не перехватываются локальными HTML |

Переход **0.1.0 → 0.1.1** проверен на [первом кандидате](verification-0.1.1-upgrade-candidate.json). После косметики диалогов и исправления error/retry финальный APK установлен поверх кандидата; [итоговая проверка](verification-0.1.1-native.json) подтверждает полное совпадение preferences и SAF read grants до/после. Код библиотеки и её формат не менялись. Не удаляй приложение между установками.

## Скриншоты и ограничения

[Галерея реальных экранов](screenshots-0.1.1/index.html). При 200% шрифте большая кнопка поиска достигается вертикальной прокруткой; IME Search остаётся доступен на клавиатуре. Снимки прямой аудиоссылки и приглашения повторены после завершения анимации IME.

Без личных аккаунтов не проверялись успешный Google/SoundCloud login, авторизация Lolzteam и управление настоящим пользовательским компьютером. Проверены начало браузерного сценария и сохранение полного публичного URL. Нативного SoundCloud-аккаунта, синхронизации его библиотеки и native streaming пока нет: собственного OAuth-клиента нет. Custom Tabs используют состояние браузера; это не перенос cookies в нативный плеер. [Chrome Custom Tabs](https://developer.chrome.com/docs/android/custom-tabs), [SoundCloud OAuth](https://developers.soundcloud.com/docs/api/guide).

Проверки MediaPlayer/MediaSession, установщика и серверной синхронизации комнат ранее описаны в [историческом отчёте 0.1.0](verification.md) и [комнатном прогоне](../rooms-comfort.md). В этом исправлении аудиоядро и серверный протокол не менялись; повторная полная проверка на физических телефонах не заявляется.

## Воспроизведение проверки

`node android/tools/build.cjs`, `node android/tests/verify-room-assets.cjs`, `node android/tests/build-instrumentation.cjs`, затем `node android/tests/run-video-fixes.cjs` и `node android/tests/run-video-layout.cjs` на отдельном эмуляторе. Web rendering: `adb shell am instrument -w -e label verified com.lolzcloud.mobile.test/com.lolzcloud.mobile.test.WebRenderingInstrumentation`.

Для локальной среды SDK, android/build, dist и node_modules сохранены на D через junction с прежними путями workspace: переполнение C больше не требует удаления артефактов или зависимостей.
