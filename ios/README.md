# LolzCloud для iPhone и iPad

Нативный клиент 0.1.1 собран с Apple SDK: Xcode 16.4, iOS SDK 18.5, версия приложения 0.1.1/build 2. Минимальная версия — iOS/iPadOS 16.4. Сборка симулятора и архив для устройства прошли в [GitHub Actions](https://github.com/Artemper52/LolzCloud/actions/runs/43617605003). Запуск на физическом устройстве, воспроизведение при блокировке, picker и личный вход ещё не проверены. Для установки на телефон нужна подпись Apple.

Готовый вариант установки сейчас — [веб-приложение LolzCloud](https://lolzcloud.com/app/) через Safari → «Поделиться» → «На экран Домой». Его возможности и проверки описываются отдельно от этого проекта.

Для разработчиков доступны [неподписанный IPA для устройства](https://lolzcloud.com/downloads/LolzCloud-iOS-0.1.1-unsigned.ipa) и [приложение для симулятора](https://lolzcloud.com/downloads/LolzCloud-iOS-0.1.1-simulator.zip). IPA требует собственной подписи и provisioning Apple; обычное скачивание файла не устанавливает приложение на iPhone. ZIP предназначен для iOS Simulator на Mac, содержит arm64 и x86_64. Хеши и состав: [проверка Apple SDK-артефактов](../docs/ios-sdk-0.1.1-verification.json).

## Что реализовано в исходниках

- AVPlayer и аудиосессия `.playback`, системные Play/Pause/Next/Previous/seek, metadata Now Playing и background audio mode.
- Нативная очередь до 200 записей, repeat/shuffle и история переходов. Системный Next и окончание записи обрабатываются без выполнения JavaScript в фоне. При возврате экран получает фактически выбранную запись, затем состояние плеера.
- Подготовка холодного трека только через выданную LolzCloud подписанную ссылку: общий предел 125 секунд, до 10 секунд на запрос, ограниченные повторы, отмена при pause/смене трека. Готовая запись, запущенная экраном, не проходит повторное долгое ожидание.
- Скорость 0.5–2× сохраняется для следующего запуска и меняется в паузе без включения звука. Таймер сна: 15/30/45/60 минут или выключение; истечение ставит нативный плеер на паузу.
- Проверенные MP3 сохраняются в собственном Application Support: максимум 20 МБ на файл и 256 МБ суммарно. Обрыв записи индекса не блокирует повторную загрузку из-за оставшегося файла. Незавершённый временный файл очищается, истечение разрешённого iOS фонового времени отменяет соответствующую задачу.
- Импорт собственных аудиофайлов через UIDocumentPicker: до 20 выбранных файлов за раз, до 20 000 000 байт на файл и общий предел 256 МиБ. Допускаются MP3, M4A, AAC, WAV, AIFF/AIF, CAF и FLAC; перед сохранением исходники проверяют AVURLAsset на воспроизводимость, наличие аудиодорожки и длительность до суток. Конкретный формат должен поддерживаться iOS. Координированное чтение security-scoped URL и копирование выполняются вне MainActor; оригинал не изменяется.
- Локальная запись получает `source: local`, UUID и собственное внутреннее имя. JavaScript получает пустой `audioUrl`, а путь и расширение внутреннего файла остаются в нативном реестре. Локальный файл никогда не направляется в сетевой prepare. Локальные и сетевые записи используют общие queue/repeat/shuffle/seek и системные команды. Журнал восстанавливает индекс после прерванного импорта; повторы одной записи в очереди различаются по проверенному индексу.
- Команды экрана и ответы плеера связаны `clientId` документа и `requestId` пользовательского выбора. Старый ответ не может отменить более новый запуск; после перезагрузки страницы прежний клиент не перезаписывает новый. Системные Next/Previous сохраняют действующий тег и работают с нативной очередью.
- Вход через ручное подтверждение кода в браузере. Приложение проверяет grant через собственный HTTPS API и проверяет сохранение Secure/HttpOnly cookie в WKHTTPCookieStore. Отмена и устаревшие задачи не подтверждают успешный вход. Форумные или браузерные cookies не импортируются.
- Мост доступен только главному документу доверенного `/app` на HTTPS `lolzcloud.com` с обычным портом. Провайдерные iframe его команды выполнять не могут. Авторизационные запросы и загрузки не следуют перенаправлениям.

Фоновая подготовка дополнительно ограничивается временем, которое выделяет iOS. Если система его завершит до готовности записи, приложение предлагает вернуться и продолжить. Не заявляется бесконечная работа загрузок в фоне.

## Проверки и сборка

На Linux в `swift:6.2.1-bookworm` выполнены Swift policy tests, синтаксическая проверка четырёх Swift-файлов и разбор PBX/Info.plist/shared scheme. Дополнительно реальный macOS workflow успешно собрал приложение симулятора и generic-device archive коммита `4def8a9f69c612f7a319f47830bb66d1e8f007b1` с Apple SDK.

Для исходников 0.1.1 прошли 34 Swift/Foundation проверки и 2 Node-проверки версии артефактов, в том числе 34 policy-теста на macOS без ошибок. Текущий отчёт: `verification.json`; отдельный SDK-отчёт: `verification-sdk-0.1.1.json`. Исторические Linux-only `verification-0.1.1.json` и результат 0.1.0 сохранены отдельно. Foundation-тесты файлов проверяют копирование, пути, лимиты и восстановление; это не тест декодирования аудио AVFoundation на устройстве.

Дополнительно [прошли 5 hosted XCTest в настоящем iOS Simulator](https://github.com/Artemper52/LolzCloud/actions/runs/43627918673): импорт WAV и реальный AVAsset, прогресс/pause/seek/rate AVPlayer, естественные переходы смешанной очереди с дублями, отказ для удалённого локального файла и HTTPS WKWebView bridge с проверкой client/request, iframe и страницы вне `/app`. Окружение — iPhone 16 arm64, iOS Simulator 26.2, Xcode 16.4 / SDK 18.5. Это отдельная testable-сборка тех же четырёх production Swift-файлов; опубликованные IPA/ZIP не заменялись. [Runtime-отчёт](../docs/ios-runtime-0.1.1-verification.json) сохраняет и первый прогон: 4 теста прошли, пятый остановился на ошибочном ожидании защищённой `/social`; после исправления только теста все 5 прошли. Реальный внешний Documents Provider/picker, физическое устройство и личный вход остаются непроверенными.

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
