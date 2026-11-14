# Платформы LolzCloud: состояние 0.9.15 / Android 0.1.5

14 ноября 2026 года. Это матрица реализованных возможностей и фактических проверок, а не заявление о полной одинаковости клиентов. «Есть» означает наличие реализации; уровень проверки указан отдельно. Внешние сервисы могут ограничивать конкретную запись или требовать подтверждённый вход.

## Клиенты и границы выпуска

| Клиент | Что подготовлено | Что фактически подтверждено |
| --- | --- | --- |
| Windows desktop 0.9.15 | Electron-клиент, опубликованные Setup/portable | [Desktop music UI/Node проверки](desktop-music-audit-0.9.15.md), реальная изолированная установка 0.9.14→0.9.15 и [публичные контрольные суммы](releases/public-0.9.15.json) |
| Linux 0.9.15 | x64 AppImage и tar.gz; ARM64 tar.gz | [x64 запуск/keyring/sandbox](linux-verification-0.9.15.md) и [3 Linux software-audio/player/YT UI набора](linux-runtime-0.9.15.md); ARM64 статически, DAC не проверен |
| Android 0.1.5 / code6 | Подписанный APK, min API 26; нативный личный аудиоплеер | [20 новых / 58 catalog / 29 lyrics / 50 social core и 11 exact assets](android/fixes-0.1.5.md), Android 15 / API 35 emulator; публичный манифест подтверждён |
| iPhone/iPad PWA | Общий веб-клиент `/app/`, устанавливаемый средствами браузера | [Повторный browser прогон, импорт аудио/TXT/LRC, worker upgrade и IndexedDB migration](ios-pwa-imports.md); физический Safari и iOS background не проверены |
| Native iOS 0.1.1 | SwiftUI/WKWebView shell, AVPlayer, локальные файлы и системные media controls в исходниках | [34 Swift policy/filesystem tests и parse 4 файлов](../ios/verification-0.1.1.json); Xcode/iOS SDK build, подпись IPA, AVPlayer на устройстве и TestFlight проверяются отдельно |

## Функции

| Возможность | Windows | Linux | Android | iOS PWA | Native iOS source |
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

PWA проверен в Chromium с настоящими HTMLAudio/MP3, HTTP, IndexedDB и service worker. После добавления файлов полный браузерный набор повторно пройден, отдельно проверены импорт MP3/WAV/M4A/FLAC и TXT/LRC, переход worker v1 на новую оболочку, сохранение старой библиотеки и закрытие позднего соединения после заблокированной миграции. [Числа, отчёты и границы проверки](ios-pwa-imports.md). 13 отдельных сценариев device pairing подтверждают установку собственного HttpOnly cookie; подтверждение кода в них выполняет контролируемая фикстура.

Native iOS 0.1.1 прошёл 34 pure-policy/filesystem tests в Swift 6.2.1 под Linux и syntax parse 4 Swift-файлов. Покрыты собственный реестр локальных файлов, квота, восстановление индекса, смешанная очередь, повторные экземпляры трека и client/request generation. Этот parse не использует Apple SDK. [Точный scope и текущий статус сборки](../ios/README.md) сохранены отдельно от браузерного PWA QA. Самостоятельный Mac CI запускается через `.github/workflows/ios.yml` с конкретной ревизией исходников.

## Что ещё не завершено

- **Native iOS:** нужен Mac с Xcode/iOS SDK, реальная сборка и подпись, provisioning/Apple Developer, проверка на iPhone/iPad. IPA и App Store/TestFlight выпуск не заявляются наличием Swift-файлов или успешных pure-policy tests.
- **macOS desktop:** цель сборщика существует, но `.app`/DMG этого выпуска, macOS GUI, codesign и notarization здесь не проверены.
- **Linux ARM64:** архив собран и проверен по ELF/правам, но не запускался на ARM64. Для Linux нет обещания любого дистрибутива, Wayland-композитора или аудиоустройства.
- **GitHub:** актуальный source commit/tag и GitHub Release — отдельные действия. Права пользовательской учётной записи на push и завершение публикации текущих исходников требуют подтверждения координатора. Публичный APK-манифест или файлы на сайте не доказывают успешный GitHub push.
- **Личные аккаунты и физические устройства:** автоматические fixtures и изолированные профили не подтверждают personal OAuth, все региональные записи и мобильные ограничения каждой ОС.

[Сайт загрузок проверен отдельно](website-0.9.15-qa.md): 20 browser checks на 360/390/1440 px и iPhone-порядок рекомендаций. Проверены интерфейс и целевые адреса ссылок; публичные файлы и GitHub assets проверяются при публикации отдельно.
