# LolzCloud для iPhone и iPad

Нативный клиент 0.1.2/build 3 собран Xcode 26.3 с SDK 26.2; минимум — iOS/iPadOS 16.4. В [GitHub Actions](https://github.com/Artemper52/LolzCloud/actions/runs/43637460798) прошли simulator build, device archive и по 7 hosted XCTest без ошибок и пропусков на iPhone 16 и iPad Pro 11-inch M4 Simulator (arm64, iOS 26.2). Физическое устройство, блокировка экрана, внешний Documents Provider/picker и личный вход остаются непроверенными. Для установки на телефон нужна собственная подпись Apple.

Готовый вариант установки сейчас — [веб-приложение LolzCloud](https://lolzcloud.com/app/) через Safari → «Поделиться» → «На экран Домой». Его возможности и проверки описываются отдельно от этого проекта.

Для разработчиков подготовлены [неподписанный IPA для устройства](https://lolzcloud.com/downloads/LolzCloud-iOS-0.1.2-unsigned.ipa) и [приложение для симулятора](https://lolzcloud.com/downloads/LolzCloud-iOS-0.1.2-simulator.zip). IPA требует собственной подписи и provisioning Apple; обычное скачивание файла не устанавливает приложение на iPhone. ZIP предназначен для iOS Simulator на Mac, содержит arm64 и x86_64. Хеши, состав и runtime-результаты: [verification-0.1.2.json](verification-0.1.2.json). Опубликованные ранее артефакты 0.1.1 сохранены без изменений.

## Что реализовано в исходниках

- AVPlayer и аудиосессия `.playback`, системные Play/Pause/Next/Previous/seek, metadata Now Playing и background audio mode.
- Нативная очередь до 200 записей, repeat/shuffle и история переходов. Системный Next и окончание записи обрабатываются без выполнения JavaScript в фоне. При возврате экран получает фактически выбранную запись, затем состояние плеера.
- Подготовка холодного трека только через выданную LolzCloud подписанную ссылку: общий предел 125 секунд, до 10 секунд на запрос, ограниченные повторы, отмена при pause/смене трека. Готовая запись, запущенная экраном, не проходит повторное долгое ожидание.
- Скорость 0.5–2× сохраняется для следующего запуска и меняется в паузе без включения звука. Таймер сна: 15/30/45/60 минут или выключение; истечение ставит нативный плеер на паузу.
- Настоящий нативный EQ: 60/230/910/3600/14000 Гц, диапазон −12…+12 дБ, preamp −12…0 дБ и bypass. `AVAudioMix`/`MTAudioProcessingTap` обрабатывает PCM сохранённых MP3 и импортированных файлов внутри того же AVPlayer. C callback использует ограниченную lock-free передачу настроек, плавную смену коэффициентов, автоматический headroom и защиту конечных сэмплов. Изменение настроек не меняет playback intent, не отменяет prepare и не запускает паузу; «applied» требует реально обработанных кадров нужной ревизии. Поддерживаются mono/stereo LPCM Float32/64 и signed Int16/32 в формате, который выдаёт tap; неподдерживаемый формат или ненулевая полоса выше Nyquist дают честный `unsupported` с исходным звуком. Reverb, echo, LUFS-нормализация и независимый pitch в этой нативной версии возвращают `capabilities=false`.
- Проверенные MP3 сохраняются в собственном Application Support: максимум 20 МБ на файл и 256 МБ суммарно. Обрыв записи индекса не блокирует повторную загрузку из-за оставшегося файла. Незавершённый временный файл очищается, истечение разрешённого iOS фонового времени отменяет соответствующую задачу.
- Импорт собственных аудиофайлов через UIDocumentPicker: до 20 выбранных файлов за раз, до 20 000 000 байт на файл и общий предел 256 МиБ. Допускаются MP3, M4A, AAC, WAV, AIFF/AIF, CAF и FLAC; перед сохранением исходники проверяют AVURLAsset на воспроизводимость, наличие аудиодорожки и длительность до суток. Конкретный формат должен поддерживаться iOS. Координированное чтение security-scoped URL и копирование выполняются вне MainActor; оригинал не изменяется.
- Локальная запись получает `source: local`, UUID и собственное внутреннее имя. JavaScript получает пустой `audioUrl`, а путь и расширение внутреннего файла остаются в нативном реестре. Локальный файл никогда не направляется в сетевой prepare. Локальные и сетевые записи используют общие queue/repeat/shuffle/seek и системные команды. Журнал восстанавливает индекс после прерванного импорта; повторы одной записи в очереди различаются по проверенному индексу.
- Команды экрана и ответы плеера связаны `clientId` документа и `requestId` пользовательского выбора. Старый ответ не может отменить более новый запуск; после перезагрузки страницы прежний клиент не перезаписывает новый. Системные Next/Previous сохраняют действующий тег и работают с нативной очередью.
- Вход через ручное подтверждение кода в браузере. Приложение проверяет grant через собственный HTTPS API и проверяет сохранение Secure/HttpOnly cookie в WKHTTPCookieStore. Отмена и устаревшие задачи не подтверждают успешный вход. Форумные или браузерные cookies не импортируются.
- Мост доступен только главному документу доверенного `/app` на HTTPS `lolzcloud.com` с обычным портом. Провайдерные iframe его команды выполнять не могут. Авторизационные запросы и загрузки не следуют перенаправлениям.

Фоновая подготовка дополнительно ограничивается временем, которое выделяет iOS. Если система его завершит до готовности записи, приложение предлагает вернуться и продолжить. Не заявляется бесконечная работа загрузок в фоне.

## Проверки и сборка

Для 0.1.2 прошли 45 Swift/C policy-тестов на Linux и macOS, настоящая сборка Apple SDK 26.2 и generic-device archive коммита `fa2d421bfaeaf9e734e9eaab0c899465ac21b189`. Чистые тесты проверяют пять частотных характеристик, preamp, bypass, NaN/Infinity, stereo, конкурентную передачу настроек, ограничения файлов и восстановление. Они дополняются настоящими hosted XCTest: по 7/7 на iPhone и iPad Simulator, без skipped.

Два новых runtime-теста измеряют PCM настоящего AVPlayer tap: −6 дБ preamp на genuine cached MP3 и изменение отношения спектральной энергии WAV 910/6000 Гц более чем в 2.5 раза. Проверены pause/FX без autoplay, pending seek, смена FX-ревизии и владельца. Остальные пять методов проверяют импорт/AVAsset, transport, смешанную очередь с дублями, удалённый локальный файл и HTTPS WKWebView bridge. WebView реального AppShell подключён к UIWindow: проверены ширина публичной PWA, видимая кнопка и снят XCTest snapshot на обеих моделях. Это отдельные testable-сборки тех же production Swift/C-файлов, а не переупаковка скачиваемого IPA.

Текущий отчёт: [verification-0.1.2.json](verification-0.1.2.json), копия для репозитория — [docs/ios-runtime-0.1.2-verification.json](../docs/ios-runtime-0.1.2-verification.json). В нём сохранены исходный source-CI сбой Telegram cache/Blob и первый SDK26-прогон: пять прежних тестов прошли на обеих моделях, два новых остановились на нулевой метрике последнего PCM-буфера. Метрика исправлена на энергию стабильных кадров с reset при изменениях/discontinuity; обязательные проверки реального сигнала и DSP не ослаблялись. Исторические отчёты 0.1.0/0.1.1 и [успешный runtime 0.1.1](../docs/ios-runtime-0.1.1-verification.json) сохранены отдельно.

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
