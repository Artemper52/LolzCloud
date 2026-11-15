# LolzCloud для iPhone и iPad

Исходники 0.1.5/build 6 собраны Xcode 26.3 с SDK 26.2; минимум — iOS/iPadOS 16.4. В [GitHub Actions](https://github.com/Artemper52/LolzCloud/actions/runs/43722084582) прошли simulator build, device archive и по 17 hosted XCTest без ошибок и пропусков на iPhone 16 и iPad Pro 11-inch M4 Simulator (arm64, iOS 26.2). Реальный AVPlayer PCM подтвердил независимую высоту тона при темпе 0.75×/1.5×, прежнее сохранение высоты, DSP и очередь. Физическое устройство, блокировка экрана, внешний Documents Provider/picker и личный вход остаются непроверенными. Для установки на телефон нужна собственная подпись Apple.

Готовый вариант установки сейчас — [веб-приложение LolzCloud](https://lolzcloud.com/app/) через Safari → «Поделиться» → «На экран Домой». Его возможности и проверки описываются отдельно от этого проекта.

Состав сборок и результаты 0.1.5: [verification-0.1.5.json](verification-0.1.5.json). IPA требует собственной подписи и provisioning Apple; обычное скачивание файла не устанавливает приложение на iPhone. Simulator ZIP предназначен для Xcode на Mac. Предыдущие опубликованные [IPA 0.1.4](https://lolzcloud.com/downloads/LolzCloud-iOS-0.1.4-unsigned.ipa), [симулятор 0.1.4](https://lolzcloud.com/downloads/LolzCloud-iOS-0.1.4-simulator.zip), [исходники 0.1.4](https://lolzcloud.com/downloads/LolzCloud-iOS-0.1.4-source.zip) и [отчёт 0.1.4](verification-0.1.4.json) сохранены, как и более ранняя история.

## Что реализовано в исходниках

- AVPlayer и аудиосессия `.playback`, системные Play/Pause/Next/Previous/seek, metadata Now Playing и background audio mode.
- Нативная очередь до 200 записей, repeat/shuffle и история переходов. Системный Next и окончание записи обрабатываются без выполнения JavaScript в фоне. При возврате экран получает фактически выбранную запись, затем состояние плеера.
- Импортированные catalog references разрешаются только при выборе записи: numeric ID через фиксированный HTTPS metadata endpoint, ссылка SoundCloud — по проверенной канонической ссылке. Затем применяется существующая signed prepare/load цепочка. Поздний ответ не переключает новый выбор; повторный snapshot сохраняет разрешённые метаданные и конкретный индекс дубликата. Сохранение reference в офлайн также сначала разрешает реальную запись.
- Подготовка холодного трека только через выданную LolzCloud подписанную ссылку: общий предел 125 секунд, до 10 секунд на запрос, ограниченные повторы, отмена при pause/смене трека. Готовая запись, запущенная экраном, не проходит повторное долгое ожидание.
- Скорость 0.5–2× и выбор сохранения высоты сохраняются нативно для следующего запуска. `AVPlayerItem.audioTimePitchAlgorithm` выбирает spectral или varispeed для настоящего воспроизведения, включая локальные файлы. Изменение в паузе не включает звук и не сбрасывает позицию/очередь; отдельная ревизия настроек не меняет transport intent. Прежний протокол: [PRESERVES_PITCH.md](PRESERVES_PITCH.md). Независимый pitch 0.5–2× работает отдельно от EQ в C PCM tap; его изменение не включает сохранённые эффекты. Протокол и измеренные частоты: [INDEPENDENT_PITCH.md](INDEPENDENT_PITCH.md). Таймер сна: 15/30/45/60 минут или выключение; истечение ставит нативный плеер на паузу.
- Настоящий нативный EQ: 60/230/910/3600/14000 Гц, диапазон −12…+12 дБ, preamp −12…0 дБ и bypass. `AVAudioMix`/`MTAudioProcessingTap` обрабатывает PCM сохранённых MP3 и импортированных файлов внутри того же AVPlayer. C callback использует ограниченную lock-free передачу настроек, плавную смену коэффициентов, автоматический headroom и защиту конечных сэмплов. Изменение настроек не меняет playback intent, не отменяет prepare и не запускает звук в паузе; «applied» требует реально обработанных кадров нужной ревизии. Поддерживаются mono/stereo LPCM Float32/64 и signed Int16/32 в формате, который выдаёт tap; неподдерживаемый формат или ненулевая полоса выше Nyquist дают честный `unsupported` с исходным звуком.
- Нативные echo 280 мс, алгоритмический reverb и K-weighted gated normalization работают в том же C PCM tap. Normalization ограничена ±8 дБ и меняется плавно, limiter ограничивает конечные сэмплы. Буферы выделяются в prepare, render не выделяет память и не вызывает Swift. Объявление `effectsSchema:2` сохраняет совместимость опубликованного старого интерфейса; `maxEffectsSchema:3` позволяет новому интерфейсу передать pitch. ACK возвращает ровно принятую форму из 3/6/7 полей. Возможности подтверждаются подготовленным процессором и реальными кадрами нужной ревизии. Сертификация LUFS/true-peak не заявляется. Параметры эффектов: [ADVANCED_AUDIO.md](ADVANCED_AUDIO.md).
- Проверенные MP3 сохраняются в собственном Application Support: максимум 20 МБ на файл и 256 МБ суммарно. Обрыв записи индекса не блокирует повторную загрузку из-за оставшегося файла. Незавершённый временный файл очищается, истечение разрешённого iOS фонового времени отменяет соответствующую задачу.
- Импорт собственных аудиофайлов через UIDocumentPicker: до 20 выбранных файлов за раз, до 20 000 000 байт на файл и общий предел 256 МиБ. Допускаются MP3, M4A, AAC, WAV, AIFF/AIF, CAF и FLAC; перед сохранением исходники проверяют AVURLAsset на воспроизводимость, наличие аудиодорожки и длительность до суток. Конкретный формат должен поддерживаться iOS. Координированное чтение security-scoped URL и копирование выполняются вне MainActor; оригинал не изменяется.
- Локальная запись получает `source: local`, UUID и собственное внутреннее имя. JavaScript получает пустой `audioUrl`, а путь и расширение внутреннего файла остаются в нативном реестре. Локальный файл никогда не направляется в сетевой prepare. Локальные и сетевые записи используют общие queue/repeat/shuffle/seek и системные команды. Журнал восстанавливает индекс после прерванного импорта; повторы одной записи в очереди различаются по проверенному индексу.
- Команды экрана и ответы плеера связаны `clientId` документа и `requestId` пользовательского выбора. Старый ответ не может отменить более новый запуск; после перезагрузки страницы прежний клиент не перезаписывает новый. Системные Next/Previous сохраняют действующий тег и работают с нативной очередью.
- Вход через ручное подтверждение кода в браузере. Приложение проверяет grant через собственный HTTPS API и проверяет сохранение Secure/HttpOnly cookie в WKHTTPCookieStore. Отмена и устаревшие задачи не подтверждают успешный вход. Форумные или браузерные cookies не импортируются.
- Мост доступен только главному документу доверенного `/app` на HTTPS `lolzcloud.com` с обычным портом. Провайдерные iframe его команды выполнять не могут. Авторизационные запросы и загрузки не следуют перенаправлениям.
- Экспорт переносимого PC v1 профиля открывает настоящий UIActivityViewController с проверенным UTF-8 JSON-файлом до 750000 байт. Имя и UUID операции ограничены; iPad использует popover anchor. События сохраняют исходный client/request. Системный `shared` означает завершение share sheet, а не независимую проверку файла у выбранного provider.

Фоновая подготовка дополнительно ограничивается временем, которое выделяет iOS. Если система его завершит до готовности записи, приложение предлагает вернуться и продолжить. Не заявляется бесконечная работа загрузок в фоне.

## Проверки и сборка

Для 0.1.5 прошли 84 Swift/C policy-теста на Linux и macOS, сборка Apple SDK 26.2 и generic-device archive коммита `f7a58a94841f7709388ad003ea40f092f0625d79`. Все 84 прошли Linux AddressSanitizer с `detect_leaks=0`; отдельный C probe прошёл ASAN/LSan, 24 спектральных случая и проверку отсутствия выделений памяти при render. Проверены schema3/миграция, независимый pitch, RMS, stereo, exact timeline/reset/EOF, прежние DSP, очереди, catalog, файлы и восстановление. Hosted XCTest: по 17/17 на iPhone и iPad Simulator, без skipped.

Runtime измеряет PCM настоящего AVPlayer tap: 14 сочетаний источника/темпа/независимого pitch на каждое семейство и 10 прежних rate/preserve измерений. Частота, RMS и реальное продвижение проверяются с прежними допусками; окно привязано только к началу входного сигнала, поскольку AVPlayer добавляет padding. Совпадение начального и конечного маркеров с входным PCM подтверждает компенсацию задержки. Прежние EQ/preamp/echo/reverb/normalization, pause/rate/FX без autoplay, pending preparation/seek, ревизии и очередь с дублями также прошли. MP3 seeded в собственном кеше; это не тест HTTPS-загрузки или личного аккаунта. Реальный AppShell/WKWebView и UIKit share sheet с iPad anchor проверены прежними тестами; пользовательский Cancel и сохранение у внешнего provider не проверялись, очистка программная. Testable-сборки используют те же 13 production Swift/C-файлов, что и проверенные SDK-артефакты.

Отчёт 0.1.5: [verification-0.1.5.json](verification-0.1.5.json), копия — [docs/ios-runtime-0.1.5-verification.json](../docs/ios-runtime-0.1.5-verification.json). Первый прогон выявил C-дефект при новом source Start крупнее lookahead; регрессия воспроизвела отказ и проверила исправление. Второй прогон восстановил PCM, но выявил предположение абсолютного tap zero и запрет честного prefetched ACK в паузе. Третий прогон изменил только измерительный fixture: исходные длина окна, частотные/RMS допуски и сроки сохранены; получены 17/17 на обоих Simulator.

История [0.1.4](verification-0.1.4.json) сохранена: первый прогон дал iPad 14/14 и iPhone 13/14 с readiness timeout; после test-only pause вместо повторных OS-session teardown — по 14/14. Production и частотные пороги оставались прежними, точная причина того таймаута не установлена.

История [0.1.3](verification-0.1.3.json) сохранена: первый прогон дал по 10/11 из-за предположения абсолютного PCM clock в reverb fixture, после привязки к измеренному импульсу — по 11/11, затем UIKit-тест завершил по 12/12 без изменения production DSP. [0.1.2](verification-0.1.2.json) и [0.1.1](verification-0.1.1.json) остаются отдельными отчётами.

```sh
swift test --package-path ios
swift ios/tools/CheckProject.swift
```

На Mac с установленным Xcode:

```sh
node ios/tools/build.cjs
```

Скрипт генерирует проект, запускает policy tests и вызывает `xcodebuild` для симулятора и неподписанного device archive. Workflow `.github/workflows/ios.yml` успешно выполнил эти шаги на macOS. Для установки нативной сборки на iPhone/iPad потребуется собственная подпись Apple. Неподписанный архив не является готовым способом установки на телефон.

Следующий этап — тесты на устройстве: личный browser pairing без автоматизации, блокировка экрана, Next холодного трека, звонки/наушники, таймер сна, выбор файла у iCloud/другого provider, отмена picker, реальная проверка длительности и декодирования каждого формата, удаление и повторное сохранение аудио.

## Документация Apple

- [WKHTTPCookieStore](https://developer.apple.com/documentation/webkit/wkhttpcookiestore)
- [AVPlayer.defaultRate, iOS 16+](https://developer.apple.com/documentation/avfoundation/avplayer/defaultrate)
- [Настройка фонового воспроизведения](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback)
- [Ограниченное время фоновых задач](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)
- [URLSession download delegate и прогресс](https://developer.apple.com/documentation/foundation/urlsessiondownloaddelegate)
- [Системный выбор документов](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)
- [Координация чтения файлов](https://developer.apple.com/documentation/foundation/nsfilecoordinator)
- [Асинхронное чтение AVAsset](https://developer.apple.com/documentation/avfoundation/loading-media-data-asynchronously)
- [AVAudioMix и audioTapProcessor](https://developer.apple.com/documentation/avfoundation/avmutableaudiomixinputparameters)
- [Правила realtime process callback](https://developer.apple.com/documentation/mediatoolbox/mtaudioprocessingtapprocesscallback)
- [Prepare/unprepare и формат PCM](https://developer.apple.com/documentation/mediatoolbox/mtaudioprocessingtappreparecallback)
