# Linux 0.9.18: предварительная сборка до исправлений

Этот кандидат не публиковался. Исходный build root сохранён как `/opt/lolzcloud-builds/release-0.9.18-pre-bound-fix`; итоговый отчёт — [linux-verification-0.9.18.md](linux-verification-0.9.18.md).

В новом каталоге `/opt/lolzcloud-builds/release-0.9.18` собраны три артефакта из закреплённого `build-input.zip`: 22810392 байта, SHA-256 `84105ceeb8a09f3b3af508ca4bf4e790c32455ca5dfcecfd40388a76189fc88f`. Старые каталоги и опубликованные артефакты 0.9.17 не изменялись. Это отчёт сборки и QA; публикацию выполняет координатор отдельно.

| Артефакт в `release-0.9.18/dist/` | Размер, байт | SHA-256 |
| --- | ---: | --- |
| `LolzCloud-0.9.18-linux-x64.AppImage` | 147466744 | `6d66cdca82e826205097a30f6cad8f5f70d6deafb6f510526f00a8a63a116c28` |
| `LolzCloud-0.9.18-linux-x64.tar.gz` | 160327312 | `63a2d756c1d7f905cd43b3bbbb84501999cbedb506ad50fc771dd35abb5212ef` |
| `LolzCloud-0.9.18-linux-arm64.tar.gz` | 159410537 | `93ee94587fafcca301d328d9bdecc2811723d43698f683051bc0367c4208d7d4` |

Архив передан через прямой SSH stdin и записан новым файлом только после проверки размера и SHA-256. До извлечения проверены сырые ZIP-имена, отсутствие дубликатов, ссылок, абсолютных и обходных путей. Lockfile отличается от 0.9.17 только корневой версией, объявления зависимостей совпадают. После этой проверки зависимости и проверенный Linux vendor cache скопированы в новый каталог; старое дерево не служило изменяемым выходом. Сборки выполнены UID 986 `lolzcloud-build`, Node 24.22.2, Electron 45.2.1, с отдельным `/tmp/LolzCloud-packager-0.9.18-*`.

Каждый ASAR x64, ARM64 и AppDir сопоставлен со **153 входными runtime-записями**: 150 совпадают побайтно, включая обновлённые sound settings, preamp, portable profile и Linux updater. Ещё три различия объяснены штатным удалением служебных полей корневого `package.json` и регенерацией двух helper ZIP при полностью одинаковых именах и байтах вложенных файлов. Необъяснённых расхождений нет. [Provenance](linux-verification-0.9.18-pre-bound-fix/linux-artifact-verification.json), [входные SHA](linux-verification-0.9.18-pre-bound-fix/input-runtime-sha256.json), [helper ZIP](linux-verification-0.9.18-pre-bound-fix/generated-equivalence.json).

Оба tar.gz проверены на безопасные пути и ссылки. Для приложения, `chrome-sandbox` и FFmpeg подтверждены исполняемые права и правильная ELF-архитектура: x64 e_machine 62, ARM64 183. ASAR извлечённого x64 tar совпадает с упакованным входом. [Проверка архивов](linux-verification-0.9.18-pre-bound-fix/archive-verification.json).

Реальные native-проверки x64 прошли в Xvfb с отдельным D-Bus и GNOME Keyring. XDG-каталог создан до запуска D-Bus; использованы собственные `/tmp/LolzCloud-self-test-*` профили, удалённые после завершения:

- Распакованный x64 tar.gz прошёл штатный packaged `--self-test`: Electron 45.2.1, Node 24.22.1, настоящий renderer, binary fetch/streams, session cookies и bookmarks.
- AppImage прошёл такой же self-test через обычный FUSE, без extract-and-run.
- Настоящий `gnome_libsecret` подтвердил encrypt/decrypt round trip. Renderer работал с sandbox и Seccomp 2; `--no-sandbox` не использовался.
- Общий `node --test --test-reporter=tap tests/*.test.cjs` на точном входном дереве прошёл **431 PASS, 0 FAIL, 0 SKIP**. Все 22 Linux updater/helper сценария действительно выполнены в отдельном owned fixture-каталоге, включая компилируемые ELF-fixtures и замены/откаты. Их имена дополнительно сопоставлены с успешными строками TAP. [Полный TAP](linux-verification-0.9.18-pre-bound-fix/linux-full-node.tap).

[Сводный JSON](linux-verification-0.9.18-pre-bound-fix/linux-verification.json), [native runtime](linux-verification-0.9.18-pre-bound-fix/runtime-verification.json), [keyring/sandbox](linux-verification-0.9.18-pre-bound-fix/keyring-verification.json), [FUSE self-test](linux-verification-0.9.18-pre-bound-fix/appimage-mounted-self-test.log), [tar self-test](linux-verification-0.9.18-pre-bound-fix/packaged-tar-self-test.log).

ARM64 проверен статически, без запуска на ARM64-устройстве. Физический DAC, Wayland, личные аккаунты и внешний музыкальный SDK не использовались. Предыдущие полные музыкальные UI suites здесь повторно не запускались и не выдаются за новые результаты Linux. Production-код, PWA freeze, пользовательские установки и серверный deploy этой задачей не менялись.
