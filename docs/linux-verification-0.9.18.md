# Linux 0.9.18: сборка и проверка

В новом каталоге `/opt/lolzcloud-builds/release-0.9.18` собраны три артефакта из закреплённого `build-input.zip`: 22882353 байта, SHA-256 `d255f320d880cd386114890ef90bca554f6fa2820b5cb02a8b3836159332a412`. Исходный кандидат до исправлений сохранён как `/opt/lolzcloud-builds/release-0.9.18-pre-bound-fix`; эта сборка r2 включает исправления лимита профиля и CORS-intent. Старые каталоги и опубликованные артефакты 0.9.17 не изменялись. Это отчёт сборки и QA; публикацию выполняет координатор отдельно.

| Артефакт в `release-0.9.18/dist/` | Размер, байт | SHA-256 |
| --- | ---: | --- |
| `LolzCloud-0.9.18-linux-x64.AppImage` | 147466744 | `97a30c5dbdf55bd4bad473e91b872e443a3b3a9f437c2749a593b0915ee4446e` |
| `LolzCloud-0.9.18-linux-x64.tar.gz` | 160326261 | `3c52fcf8e08accd900fce6d28a9eba3ac91b93f51b3882668d9f6703d8206350` |
| `LolzCloud-0.9.18-linux-arm64.tar.gz` | 159411491 | `3796a4484fd55e5f3483100ec2888a8d58f5edb12a4d2d3ba5223bbbb12e982e` |

Архив передан через прямой SSH stdin и записан новым файлом только после проверки размера и SHA-256. До извлечения проверены сырые ZIP-имена, отсутствие дубликатов, ссылок, абсолютных и обходных путей. Lockfile отличается от 0.9.17 только корневой версией, объявления зависимостей совпадают. После этой проверки зависимости и проверенный Linux vendor cache скопированы в новый каталог; старое дерево не служило изменяемым выходом. Сборки выполнены UID 986 `lolzcloud-build`, Node 24.22.2, Electron 45.2.1, с отдельным `/tmp/LolzCloud-packager-0.9.18-*`.

Каждый ASAR x64, ARM64 и AppDir сопоставлен со **153 входными runtime-записями**: 150 совпадают побайтно, включая обновлённые sound settings, preamp, portable profile и Linux updater. Ещё три различия объяснены штатным удалением служебных полей корневого `package.json` и регенерацией двух helper ZIP при полностью одинаковых именах и байтах вложенных файлов. Необъяснённых расхождений нет. [Provenance](linux-verification-0.9.18/linux-artifact-verification.json), [входные SHA](linux-verification-0.9.18/input-runtime-sha256.json), [helper ZIP](linux-verification-0.9.18/generated-equivalence.json).

Оба tar.gz проверены на безопасные пути и ссылки. Для приложения, `chrome-sandbox` и FFmpeg подтверждены исполняемые права и правильная ELF-архитектура: x64 e_machine 62, ARM64 183. ASAR извлечённого x64 tar совпадает с упакованным входом. [Проверка архивов](linux-verification-0.9.18/archive-verification.json).

Реальные native-проверки x64 прошли в Xvfb с отдельным D-Bus и GNOME Keyring. XDG-каталог создан до запуска D-Bus; использованы собственные `/tmp/LolzCloud-self-test-*` профили, удалённые после завершения:

- Распакованный x64 tar.gz прошёл штатный packaged `--self-test`: Electron 45.2.1, Node 24.22.1, настоящий renderer, binary fetch/streams, session cookies и bookmarks.
- AppImage прошёл такой же self-test через обычный FUSE, без extract-and-run.
- Настоящий `gnome_libsecret` подтвердил encrypt/decrypt round trip. Renderer работал с sandbox и Seccomp 2; `--no-sandbox` не использовался.
- Общий `node --test --test-reporter=tap tests/*.test.cjs` на точном входном дереве прошёл **445 PASS, 0 FAIL, 0 SKIP**. Все 22 Linux updater/helper сценария действительно выполнены в отдельном owned fixture-каталоге, включая компилируемые ELF-fixtures и замены/откаты. Их имена дополнительно сопоставлены с успешными строками TAP. [Полный TAP](linux-verification-0.9.18/linux-full-node.tap).

[Сводный JSON](linux-verification-0.9.18/linux-verification.json), [native runtime](linux-verification-0.9.18/runtime-verification.json), [keyring/sandbox](linux-verification-0.9.18/keyring-verification.json), [FUSE self-test](linux-verification-0.9.18/appimage-mounted-self-test.log), [tar self-test](linux-verification-0.9.18/packaged-tar-self-test.log).

ARM64 проверен статически, без запуска на ARM64-устройстве. Физический DAC, Wayland, личные аккаунты и внешний музыкальный SDK не использовались. Предыдущие полные музыкальные UI suites здесь повторно не запускались и не выдаются за новые результаты Linux. Linux-сборка не меняла production-код, пользовательские установки и серверный deploy. Позднее точечное исправление PWA-дубликатов проверяется отдельно и не входит в 153 desktop runtime-файла. Проверки 445 относятся именно к закреплённому r2 input.
