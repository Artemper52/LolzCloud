# Платформы LolzCloud: 0.9.15-r2 / Android 0.1.5 / веб 0.9.17

14 ноября 2026 года. Матрица дополнена результатами ревизии исходников r2; настольные бинарные файлы 0.9.15 и Android APK 0.1.5 не заменяются. Сервер/PWA развиваются отдельно как 0.9.17. Это матрица реализованных возможностей и фактических проверок, а не заявление о полной одинаковости клиентов. «Есть» означает наличие реализации; уровень проверки указан отдельно. Внешние сервисы могут ограничивать конкретную запись или требовать подтверждённый вход. [Сводка r2 и статус публикации](releases/0.9.15-r2.md).

## Клиенты и границы выпуска

| Клиент | Что подготовлено | Что фактически подтверждено |
| --- | --- | --- |
| Windows desktop 0.9.15 | Electron-клиент, опубликованные Setup/portable | [Desktop music UI](desktop-music-audit-0.9.15.md), установка 0.9.14→0.9.15, [публичные суммы](releases/public-0.9.15.json); для r2 — 345 Node tests: 343 общих + 2 проверки версии iOS |
| Linux 0.9.15 | x64 AppImage и tar.gz; ARM64 tar.gz | [x64 запуск/keyring/sandbox](linux-verification-0.9.15.md), [3 software-audio/player/YT UI набора](linux-runtime-0.9.15.md), 343 общих теста в Ubuntu CI и отдельный повтор 17 update tests на Linux; ARM64 статически, DAC не проверен |
| Android 0.1.5 / code6 | Тот же подписанный APK, min API 26; нативный личный аудиоплеер | [Полный 71 social/offline сценарий](android/social-full-0.1.5.md); ранее [20 audio / 58 catalog / 29 lyrics / 50 social core и 11 exact assets](android/fixes-0.1.5.md). Наборы пересекаются; Android 15 / API 35 emulator, не физический телефон |
| iPhone/iPad PWA | Общий веб-клиент `/app/`, устанавливаемый средствами браузера | [65 общих browser checks и 17 повторных import checks](ios-pwa-native-intent.md); отдельно IDB 5, lyrics 8, pairing 13, policy 10. Физический Safari и iOS background не проверены |
| Native iOS 0.1.1 | SwiftUI/WKWebView, AVPlayer, локальные файлы; simulator build и неподписанная device-сборка | [34 Swift policy/filesystem tests](../ios/verification-0.1.1.json), [успешный Apple SDK CI](https://github.com/Artemper52/LolzCloud/actions/runs/43617605003) на `4def8a9f69c612f7a319f47830bb66d1e8f007b1`; физические iPhone/iPad, подпись и распространение pending |

## Функции

| Возможность | Windows | Linux | Android | iOS PWA | Native iOS 0.1.1: SDK build, device QA pending |
| --- | --- | --- | --- | --- | --- |
| Личный поиск и музыка SoundCloud | Есть | Общий desktop-код | Native search + MediaPlayer, без browser fallback | Серверный поиск + HTMLAudio | Общий UI + AVPlayer bridge в коде |
| Личный источник YouTube Music | Отдельный sandbox guest | Общий desktop-код | Отдельный WebView | Отдельный личный источник не заявлен | Не заявлен |
| Локальные файлы | Импорт файлов | Импорт файлов | Системный SAF, persisted URI | MP3/WAV/M4A/FLAC через реальный браузерный decoder и IndexedDB | UIDocumentPicker, security-scoped copy, AVAsset validation в коде; device QA pending |
| Скачивание и офлайн | Downloader + FFmpeg | Целевой Linux FFmpeg | Проверенный private file, единая identity с очередью/лайком | MP3 в IndexedDB: 20 МБ на файл, 256 МБ общий лимит | Код native download до 20 МБ; device QA pending |
| Очередь, repeat/shuffle, любимое | Есть | Общий desktop-код | Есть, сохранение очереди/позиции | Есть, локальное состояние браузера | Native queue в коде, общий UI; device QA pending |
| Текст песни и seek по строке | Есть | Общий desktop-код | LRCLIB + импорт TXT/LRC | LRCLIB + собственный TXT/LRC с отдельным приоритетным кэшем | Общий UI с TXT/LRC и native seek-контракт в коде |
| Скорость, таймер сна, закладки | Есть | Общий desktop-код | Есть | Реализованы; подробности и QA в [PWA](ios-pwa.md) | Rate/sleep в Swift; bookmarks через общий UI; native device QA pending |
| EQ и расширенные звуковые эффекты | WebAudio/desktop-инструменты | Общий аудиодвижок | Framework effects, зависят от устройства | Полный desktop DSP не заявлен | Полный desktop DSP не заявлен |
| Комнаты, чат, очередь комнаты, DJ/host | Общий room client | Тот же client | Общий client в OnlineActivity | Постоянный room iframe | Общий WKWebView UI в source; runtime pending |
| Профиль, друзья, приглашения, роли | Общий server/social client | Тот же client | Bundled shared client | Тот же client | Общий web UI в source; runtime pending |
| Подключение Lolz-аккаунта | Browser/device pairing | Pairing + настоящий keyring для хранения | Native device-pair login | Device-pairing + HttpOnly cookie | Account/WK cookie flow в source; runtime pending |
| Фон и системные команды | Работа desktop-процесса, мини-плеер | Зависит также от окружения рабочего стола | Foreground Service + MediaSession; Home проверен | Ограничения браузера; физический iOS background не подтверждён | AVAudioSession/remote commands в source; runtime pending |
| Forum music status, Discord RPC, desktop studio | Desktop-интеграции | Общий код; стороннее приглушение только Windows | Полная desktop parity не заявлена | Не заявлены | Не заявлены |

Локальные загрузки, история, закладки и избранное не обещают автоматическую синхронизацию между устройствами. Общие профиль, роли, друзья и приглашения используют серверную identity. Наличие нативного каталога не означает вход в SoundCloud-аккаунт или доступ ко всем его закрытым записям.

## Что доказывают общие проверки

В [room-прогоне 0.9.15](platforms-0.9.15/rooms-ui-results.json) участвовали host и два guest-клиента. **12 сценариев PASS**: права listener/DJ, chat и сохранение draft/focus, локальная громкость, queue-next ровно один раз, pause/live, смена SoundCloud/YouTube, handoff, SSE reconnect, ширины 360/420 px. HTTP, SSE, sessions и UI настоящие; SoundCloud/YouTube SDK — детерминированные fixtures. Это проверка трёх клиентов, не трёх физических Android/iOS/Linux устройств и не измерение звукового рассогласования на телефонах.

Умеренное тестовое отклонение 0,7 с восстановилось за 2453 мс, крупное 9 с — за 576 мс; это наблюдения данного прогона, не гарантированная задержка любого внешнего сервиса. Наличие одинаковых 11 assets в APK подтверждает упаковку общего клиента, но не заменяет эти UI/HTTP проверки.

PWA проверен в Chromium с настоящими HTMLAudio/MP3, HTTP, IndexedDB и service worker. После защиты native client/request полный набор прошёл 65 проверок, включая delayed selection/playback, pause/resume, повторные записи в очереди и worker v1→v3; [отчёт](ios-pwa-native-intent.md). На том же worker повторно прошли 17 проверок импорта MP3/WAV/M4A/FLAC и TXT/LRC. Отдельно сохранены 5 проверок заблокированной миграции IDB, 8 точечных lyrics checks и 10 policy tests: [scope импорта](ios-pwa-imports.md). 13 отдельных сценариев device pairing подтверждают установку собственного HttpOnly cookie; подтверждение кода в них выполняет контролируемая фикстура. Наборы проверяют частично одинаковые функции и не складываются в число уникальных пользовательских сценариев.

Native iOS 0.1.1 прошёл 34 policy/filesystem tests и Linux syntax parse четырёх файлов. Покрыты собственный реестр локальных файлов, квота, восстановление индекса, смешанная очередь, повторные экземпляры трека и client/request generation. Затем [реальный macOS CI с Apple SDK](https://github.com/Artemper52/LolzCloud/actions/runs/43617605003) на `4def8a9f69c612f7a319f47830bb66d1e8f007b1` успешно выполнил Swift tests, сборку для generic iOS Simulator и Release archive для generic iOS device с `CODE_SIGNING_ALLOWED=NO`. Вложенные артефакты проверены отдельно: device arm64 и simulator arm64+x86_64, версия 0.1.1/build2, минимум iOS 16.4, семейства iPhone/iPad. Использованы Xcode 16.4 и SDK 18.5. Это проверка типов, компоновки и структуры артефактов, а не запуск приложения или аудио на iPhone/iPad. [Нативный README](../ios/README.md) содержит отдельные сведения об артефактах и установке.

Android полный 71-check прогон прошёл на неизменном опубликованном APK SHA-256 `ee61577bcf8b45650fad41a76715d3b532012cc949289a61dbb2adfc41db72d0`: настоящий SAF image picker/callback, MediaPlayer, NotificationManager и переходы приложения. Социальные события и вход — объявленные fixtures; реальная личная авторизация не заявляется. Он дополняет, а не заменяет и не суммируется с прежними 20/58/29/50. В audio-audit вызовы audio focus внедрялись тестом; физические наушники, звонки и конкуренция с другим аудиоприложением не проверялись.

Для r2 в Windows прошли 345 Node tests: 343 общих и 2 проверки версии iOS. Ubuntu CI подтвердил все 343 общих; целевые 17 update tests дополнительно повторены на настоящем Linux после исправления переносимости тестового пути. Эти 17 входят в общий набор и не добавляются к нему. Продуктовый код обновлятора этим исправлением не менялся.

## Что ещё не завершено

- **Native iOS:** Apple SDK build уже прошёл. Остаются provisioning/Apple Developer, подпись для установки, физические iPhone/iPad и проверка AVPlayer, lockscreen, фонового режима, файловых providers и личного входа. Неподписанная CI-сборка не означает доступную установку или выпуск в App Store/TestFlight.
- **macOS desktop:** цель сборщика существует, но `.app`/DMG этого выпуска, macOS GUI, codesign и notarization здесь не проверены.
- **Linux ARM64:** архив собран и проверен по ELF/правам, но не запускался на ARM64. Для Linux нет обещания любого дистрибутива, Wayland-композитора или аудиоустройства.
- **GitHub и исходники:** ветка `codex/recover-platforms-0.9.15` и успешный CI commit подтверждены; это уже не неподтверждённый push. Итоговые source-архивы `LolzCloud-0.9.15-r2-source.zip` и native iOS 0.1.1, release tag и GitHub Release пока ожидают отдельной проверки публикации. Не следует считать наличие ветки или CI-артефакта опубликованным релизом.
- **Личные аккаунты и физические устройства:** автоматические fixtures и изолированные профили не подтверждают personal OAuth, все региональные записи и мобильные ограничения каждой ОС.

[Сайт загрузок проверен отдельно](website-0.9.15-qa.md): 20 browser checks на 360/390/1440 px и iPhone-порядок рекомендаций. Проверены интерфейс и целевые адреса ссылок; публичные файлы и GitHub assets проверяются при публикации отдельно.
