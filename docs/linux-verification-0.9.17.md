# Linux 0.9.17: сборка и проверка

Собраны x64 AppImage, x64 tar.gz и ARM64 tar.gz из зафиксированного `build-input.zip`: размер 22280545 байт, SHA-256 `0233aa31985a2e535d00c9514ba32281fa9106d35538a15699966a8ec1907882`. Новый рабочий каталог — `/opt/lolzcloud-builds/release-0.9.17`; опубликованные исходники и артефакты 0.9.15/0.9.16 не изменялись. Публикацию выполняет координатор отдельно.

| Артефакт | Размер, байт | SHA-256 |
| --- | ---: | --- |
| `LolzCloud-0.9.17-linux-x64.AppImage` | 147458552 | `71c958c6cacd3bb168968ad904f5214c5b2c84f67a6cf2908db2f2f64fc030e5` |
| `LolzCloud-0.9.17-linux-x64.tar.gz` | 160328836 | `6fe82c8c70d56bbca4dc4c8db9edf6c310cefa56219f45ce0429707faa319ee5` |
| `LolzCloud-0.9.17-linux-arm64.tar.gz` | 159410384 | `49792539bbc8cac1f9d7bce8685f31ce5fb9a86e2f2ec5ce6bdb981b9e0e6f4b` |

Сборка выполнена обычным пользователем `lolzcloud-build`, UID 986, с Node 24.22.2 и Electron 45.2.1. До извлечения ZIP проверены исходная сумма, сырые имена записей, отсутствие повторов, абсолютных/обходных путей и ссылок. Lockfile отличается от 0.9.16 только корневой версией, объявления зависимостей идентичны. Зависимости и проверенный vendor cache скопированы в новый каталог; старое дерево не использовалось как изменяемый выход. Packager работал в отдельном `/tmp/LolzCloud-packager-0.9.17-*`, чтобы путь скрытой `.build` не нарушал unpack FFmpeg.

Для каждого ASAR x64/ARM64/AppDir сверены **153 входные runtime-записи**: 150 совпали побайтно. Ещё три объяснены: packager удаляет только штатные служебные поля корневого `package.json`, а два helper ZIP регенерируют контейнер при полностью одинаковых именах и байтах вложенных файлов. Необъяснённых расхождений нет. Исправленный Linux updater и shell helper входят в эту сверку. [Provenance](./linux-verification-0.9.17/linux-artifact-verification.json), [входные SHA](./linux-verification-0.9.17/input-runtime-sha256.json), [helper ZIP](./linux-verification-0.9.17/generated-equivalence.json).

Оба tar.gz проверены на безопасные пути и ссылки. Для приложения, `chrome-sandbox` и FFmpeg подтверждены правильные ELF-архитектуры и исполняемые права: x64 e_machine 62, ARM64 183. Извлечённый x64 ASAR совпал с упакованным входным ASAR. [Отчёт архивов](./linux-verification-0.9.17/archive-verification.json).

Реальные native-проверки x64 прошли в Xvfb с отдельным D-Bus и тестовым GNOME Keyring. Временный XDG-каталог создан **до** старта D-Bus. Использованы только собственные `/tmp/LolzCloud-self-test-*` профили, удалённые после завершения:

- Распакованный x64 tar.gz: штатный packaged `--self-test` подтвердил Electron 45.2.1, Node 24.22.1, настоящий renderer, binary fetch/streams, session cookies и bookmarks.
- Настоящий AppImage запущен обычным FUSE с тем же packaged self-test; режим extract-and-run для этого запуска не применялся.
- Системный `gnome_libsecret`: encrypt/decrypt round trip; sandboxed renderer, Seccomp 2; `--no-sandbox` отсутствует. Личные аккаунты и сохранённые пользовательские профили не использовались.
- Общий `node --test tests/*.test.cjs` на точном входном дереве: **388 PASS, 0 FAIL, 0 SKIP**. Все 22 Linux updater/helper сценария действительно выполнены с отдельным owned fixture-каталогом, включая компилируемые ELF-fixtures; на Windows они частично пропускаются. [Полный TAP](./linux-verification-0.9.17/linux-full-node.tap).

[Сводный JSON](./linux-verification-0.9.17/linux-verification.json), [native runtime](./linux-verification-0.9.17/runtime-verification.json), [keyring/sandbox](./linux-verification-0.9.17/keyring-verification.json), [FUSE self-test](./linux-verification-0.9.17/appimage-mounted-self-test.log), [tar self-test](./linux-verification-0.9.17/packaged-tar-self-test.log). Отдельная проверка механизма замены/отката AppImage описана в [linux-appimage-updates.md](./linux-appimage-updates.md).

ARM64 подтверждён статически, без запуска на ARM64-устройстве. Физический DAC, Wayland, реальный внешний музыкальный SDK и личный OAuth не проверялись. Полные предыдущие Electron music/provider UI suites здесь повторно не запускались и не выдаются за новые результаты. Этот отчёт подтверждает сборку и QA, а не установку в личный клиент или публикацию файлов.
