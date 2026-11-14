# Платформы LolzCloud: desktop 0.9.17 candidate / Android 0.1.7 / native iOS 0.1.2

Срез 14 ноября 2026 года. **Общий выпуск 0.9.17 ещё не опубликован.** Таблица различает сборку, фактические проверки и распространение. Android 0.1.7 и server/PWA 0.9.19 уже выложены отдельно; новые desktop/Linux/native iOS файлы прошли сборку и QA, но их общая публикация ещё ожидается. [Кандидат выпуска](releases/0.9.17.md).

## Версии и доступность

| Клиент | Последняя подтверждённая публикация | Новый кандидат и его проверка |
| --- | --- | --- |
| Windows desktop | 0.9.16, modern и legacy; [публичный manifest](https://lolzcloud.com/downloads/update.json) и [release receipt](releases/public-0.9.16.json) | 0.9.17: modern/legacy собраны, native self-tests, 32 exact-ASAR checks, настоящая установка 16→17 с сохранением профиля и low-disk guard — [PASS](releases/0.9.17/windows-verification.json); общая публикация pending |
| Linux | 0.9.16: x64 AppImage/tar.gz и ARM64 tar.gz | 0.9.17: [три артефакта собраны, 153 записи provenance, native x64/keyring/sandbox и 388 Node PASS](linux-verification-0.9.17.md); [updater 22 Linux + 5 genuine AppImage checks](linux-appimage-updates.md). ARM64 static only; публикация pending |
| Android | **0.1.7/code8 опубликован**, [manifest](https://lolzcloud.com/downloads/android-update.json); прежняя 0.1.6 сохранена | SHA `ca58d0d794f47858e055cbe5ae76921dcd12c50380588719e0d402028304000f`, прежний сертификат `84305e6a…`; [25/20/58/50 actual checks](android/audio-comfort-0.1.7.md) на той же APK |
| Сервер и iPhone/iPad PWA | Ревизия 0.9.18 входила в опубликованный выпуск 0.9.16 | **0.9.19 уже deployed:** [live health](https://lolzcloud.com/api/health), [PWA](https://lolzcloud.com/app/); [25 публичных проверок ресурсов/каталога/MP3/текста](releases/0.9.17/public-app-music.json) прошли без повторных попыток |
| Native iOS | 0.1.1/build2: неподписанная IPA и simulator ZIP в [release v0.9.16](https://github.com/Artemper52/LolzCloud/releases/tag/v0.9.16) | 0.1.2/build3: [45 policy + Apple SDK compile/archive + 7/7 на каждом из двух Simulator PASS](ios-runtime-0.1.2-verification.json). Device arm64, simulator arm64/x86_64, min16.4; unsigned-артефакты 0.1.2 ещё не опубликованы |

Read-only HTTP-проверка в 20:28–20:30 UTC подтвердила desktop manifests 0.9.16, GitHub latest `v0.9.16` и live backend 0.9.19. После отдельной публикации Android повторный GET в 20:43 UTC подтвердил 0.1.7/code8 и точный SHA `ca58d0…`. Исторический [receipt выпуска 0.9.16](releases/public-0.9.16.json) фиксирует прежние Android 0.1.6/backend 0.9.18. В [GitHub main/package.json](https://github.com/Artemper52/LolzCloud/blob/main/package.json) в проверенном срезе по-прежнему версия 0.9.12; наличие новой release-ветки, CI или asset не означает обновление `main`.

## Функции и различия

«Есть» означает реализацию в указанном клиенте, а не испытание всех устройств или одинаковую обработку PCM.

| Возможность | Windows / Linux desktop | Android 0.1.7 | iOS PWA / web 0.9.19 | Native iOS 0.1.2 candidate |
| --- | --- | --- | --- | --- |
| Личный поиск и музыка SoundCloud | Desktop-плеер и общий каталог | Native search/MediaPlayer, без browser fallback | Каталог + существующий HTMLAudio | Общий UI + AVPlayer |
| Личный YouTube Music | Отдельный sandbox guest | Отдельный WebView | Отдельный личный источник не заявлен | Не заявлен |
| Локальные файлы | Импорт файлов, FFmpeg | Системный SAF и persisted content URI | MP3/WAV/M4A/FLAC, реальный browser decoder и IndexedDB | UIDocumentPicker → private copy/AVAsset; личные внешние providers не проверены |
| Скачивание / офлайн | Downloader и целевой FFmpeg | Private file, сохранение track ID/likes/queue | Явное сохранение Blob в IndexedDB; до 20 МБ на файл, 256 МБ всего | App-owned local/download registry; до 20 МБ на файл, 256 МБ всего |
| Очередь / repeat / shuffle / любимое | Есть | Есть; поколение источника защищает prepare/seek/Next | Есть; отдельные вхождения повторяющегося трека | Native queue с точным index и tagged bridge |
| Тексты / свой TXT-LRC / seek | Есть | LRCLIB, свой TXT/LRC | Строгое сопоставление и приоритет своего текста | Общий UI, native seek |
| Скорость / pitch | Desktop audio tools | Раздельные speed/pitch; обычный темп сохраняет EQ/bass | Скорость есть; независимый pitch не заявлен | Скорость AVPlayer; независимый pitch capability отсутствует |
| Закладки | Есть | Сохраняют pause и очередь; отсутствующий трек явно добавляется в конец | Есть, по треку/позиции | Общий UI с native seek; физический QA pending |
| Таймер сна | Есть | Deadline сохраняется; restore не включает музыку; **только native MediaPlayer** | Сохранённый deadline; браузерный background ограничен | Native timer + общий UI; физический background pending |
| EQ / уровень до обработки | Desktop WebAudio/DSP | Настоящие аппаратные полосы/readback, зависят от устройства; общий 5-band portable adapter ещё не добавлен | EQ 60/230/910/3600/14000 Hz, ±12 dB; preamp −12…0 dB | Настоящий AVPlayer tap EQ/preamp; MP3/WAV PCM runtime подтверждён в Simulator |
| Reverb / echo / нормализация | Desktop DSP | Framework Bass/Reverb/Loudness по capabilities; LoudnessEnhancer **не** LUFS-normalizer; echo не добавлен | Convolution reverb, echo, K-weighted leveling и sample-peak limiter; не сертифицированный LUFS/true-peak | Capabilities false: reverb/echo/normalization/pitch не поддерживаются |
| Комнаты / чат / очередь / host-DJ | Общий room client | Общий client в OnlineActivity | Постоянный room iframe | Общий WKWebView client |
| Профили / друзья / приглашения | Общий server/social UI | Тот же bundled UI + native notifications | Тот же server/social UI | Общий web UI; native physical notifications не заявлены |
| Lolz-вход | Device pairing, системное хранилище | Native device-pair flow | HttpOnly session/device pairing | Account/WK cookie flow; personal OAuth не проверен |
| Фон / системные кнопки | Desktop-процесс; ОС и аудиосессия влияют | Foreground Service / MediaSession | Браузерные ограничения, physical Safari background pending | AVAudioSession/remote commands; физический lockscreen/interruption pending |
| Forum status / Discord / desktop studio | Desktop-интеграции; OS-specific возможности различаются | Полная desktop parity не заявлена | Не заявлены | Не заявлены |

Личные эффекты PWA/Android не подключаются к аудио комнаты или YouTube Music WebView. Новые Android raw `eq_0…N` не считаются переносимыми частотами. Общие профили/друзья используют серверную identity, но очередь, файлы, закладки и все DSP-настройки не обещают автоматическую облачную синхронизацию. Desktop encrypted portable profile и Android profile v1 остаются разными форматами.

## Что проверено

**Комнаты уже опубликованного 0.9.16** остаются прежними: компактный плеер над чатом, музыка/очередь/участники в панели, явный перенос пульта owner PC→phone, DJ занимает свободный пульт, listener предлагает трек по политике. Выбранная запись очереди запускается атомарно по queue ID; остальные и повторы URL сохраняются. Проверка синхронизации каждые пять секунд и защита от двойного Next сохранены. [22 mobile / 24 UX / 12 room scenarios](rooms-mobile-0.9.18.md), [desktop bridge](rooms-desktop-0.9.16.md), Android 1.6 real WebView 13 + Back 17 — прежние отдельные доказательства, не новые тесты 0.9.17. HTTP/SSE/UI реальные, внешние SC/YT SDK — объявленные fixtures. Акустическая синхронизация физических устройств не измерялась.

**Android 0.1.7:** [25 новых comfort checks](android/verification-0.1.7/android-audio-comfort-verification.json), [20 audio-audit](android/verification-0.1.7/android-audio-audit-verification.json), [58 catalog/offline](android/verification-0.1.7/android-catalog-verification.json), [50 social core](android/verification-0.1.7/android-social-core-verification.json), плюс 31 pure JVM check. API35 AVD, настоящий MediaPlayer и EQ/Bass readback; настройки восстановлены, APK до/после одна. Focus callbacks в audio-audit вводились тестом, social API — изолированные fixtures. Нет физического телефона, акустического EQ-замера или process-kill теста.

**PWA:** [35 DSP/UI + 66 общих + 17 imports + 11 queue-selection + 19 policy/core/static](ios-pwa-effects.md). Всего 148 проверок в частично пересекающихся наборах, не 148 независимых пользовательских функций. Реальные OfflineAudioContext/AudioWorklet PCM, HTMLMediaElement/MP3, IndexedDB Blob и scoped worker v4; native ACK-сценарии здесь только bridge fixtures. Физические Safari/iPhone/iPad не испытаны.

**Общие исходники:** [финальный Node Windows log](releases/0.9.17/node-tests-windows-final.txt) — 388 зарегистрировано, 372 PASS, 16 Linux-specific skipped, 0 failures. На Linux [тот же полный набор](linux-verification-0.9.17/linux-full-node.tap) выполнил все 388, без skips. Результаты двух ОС не суммируются. [42 targeted shared-audio tests](releases/0.9.17/shared-audio-tests.txt) включают lease открытого MP3 при eviction, ограничение квоты конкурентных конверсий, HEAD/Range/disconnect cleanup и существующие music/Telegram проверки; они пересекаются с общим набором.

**Linux updater:** [22/22 на настоящем Linux, UID986, без skips](linux-appimage-updates/verification.json); отдельно пять проверок транзакции на копиях неизменных AppImage 0.9.15→0.9.16 с настоящим native self-test, Xvfb/D-Bus/keyring. Родитель транзакции — собственный `sleep`; это ещё не испытание GUI упакованного 0.9.17. Старому Linux 0.9.16 понадобится один ручной переход на новую версию; tar.gz остаётся ручным. ARM64/Wayland/физический звук не испытаны.

**Native iOS candidate:** [exact-source CI `fa2d421b…`](https://github.com/Artemper52/LolzCloud/actions/runs/43637460798) прошёл 45 policy tests, Xcode26.3/SDK26.2 build/archive и **7/7 с нулём skips на каждом** iPhone16 и M4 iPad Pro11 arm64 Simulator/iOS26.2. Настоящий AVPlayer tap подтвердил preamp −6 dB по RMS декодированного cached MP3 и отношение спектральных поправок 910/6000 Hz >2.5 на WAV; проверены pause/seek во время tap setup и attached WKWebView viewport/контролы/snapshot. [JSON](ios-runtime-0.1.2-verification.json) сохраняет прежние неудачные RMS-прогоны отдельно: они исправлены накоплением измеренной steady PCM energy, не удалением обязательных DSP assertions. Это не физический iPhone/iPad и не personal OAuth.

## Доступ на iPhone и оставшиеся границы

У владельца проекта нет Apple Developer Program. Он нужен для штатного распространения нативного приложения через TestFlight/App Store и связанных сертификатов/provisioning; для бесплатной PWA в Safari не нужен. Xcode с бесплатным Apple Account позволяет личное тестирование с ограничениями и периодической переподписью. Поэтому unsigned IPA — артефакт сборки, а не готовая установка на любой iPhone. [Официальное объяснение Apple](https://developer.apple.com/help/account/basics/about-your-developer-account/).

Linux ARM64 по-прежнему имеет static ELF/permissions proof, без ARM64 runtime; новый x64 0.9.17 прошёл packaged/FUSE self-tests, keyring/sandbox. Прежние music/provider UI suites не выдаются за новые прогоны. macOS desktop `.app`/DMG, codesign/notarization и реальный macOS GUI здесь не подтверждены. Физический Android/iOS, сторонние file providers, personal OAuth, региональная доступность всех внешних записей и одинаковые advanced DSP на всех платформах остаются отдельными задачами. Общий tag/release 0.9.17 и публичный platform inventory всё ещё ожидают отдельной проверки публикации.
