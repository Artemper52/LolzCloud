# Linux 0.9.16: сборка и проверка

Собраны новые Linux-артефакты из замороженного `build-input.zip`, SHA-256 `2c6a0959e41fc455046d4419598543c09ee6ce48b6dfda0aad586366d8440213`. Рабочий каталог — `/opt/lolzcloud-builds/release-0.9.16`; прежний выпуск 0.9.15 не изменялся. Сборка выполнялась пользователем `lolzcloud-build` с Node 24.22.2, Electron 45.2.1. Lockfile эквивалентен 0.9.15, кроме корневой версии; зависимости и vendor cache скопированы отдельно, без ссылки на изменяемый старый каталог.

| Файл | Размер, байт | SHA-256 |
| --- | ---: | --- |
| `LolzCloud-0.9.16-linux-x64.AppImage` | 147454456 | `3242003d61d123325a9b2b16445e12fe2bc1b17933233e6d0ecdb5855fea5301` |
| `LolzCloud-0.9.16-linux-x64.tar.gz` | 160316724 | `3c4474d060a3da39e5711924da9f520f4db55b0bc4a38806c7ffb91693fec88a` |
| `LolzCloud-0.9.16-linux-arm64.tar.gz` | 159409566 | `6e8b8e2418a3d0a77148b43553e14ee3f5feb4cf124b1e702fdb87d09b3bbef9` |

Все три файла находятся в `dist/` нового рабочего каталога. После фиксации этих сумм они не пересобирались и не заменялись. Публикацию выполняет координатор отдельно; этот отчёт подтверждает сборку и QA.

Исходный ZIP сохранён в `.build/build-input.zip`; проверены SHA-256 и безопасные пути записей перед извлечением. В ASAR x64, ARM64 и AppDir подтверждены **148 побайтно совпадающих runtime-файлов**, включая четыре файла desktop bridge и общий room client. Ещё три записи проверены как штатные результаты сборки: packager удаляет из корневого `package.json` только `private/scripts/devDependencies/overrides`, сохраняя остальные поля; оба helper ZIP имеют точно те же имена и байты вложенных файлов, хотя контейнерные байты после генерации на Linux отличаются. Необъяснённых расхождений нет. [Подробная provenance](linux-verification-0.9.16/artifact-verification.json), [входные хэши](linux-verification-0.9.16/input-runtime-sha256.json), [содержимое helper ZIP](linux-verification-0.9.16/generated-equivalence.json).

В обоих tar.gz проверены безопасные пути, целевая архитектура ELF и исполняемые права `0755` приложения, sandbox helper и FFmpeg: x64 `e_machine=62`, ARM64 `183`. x64-архив извлечён в отдельный каталог; его ASAR совпал с упакованным исходным ASAR. [Проверка архивов](linux-verification-0.9.16/archive-verification.json).

Фактический x64 QA прошёл под Xvfb/D-Bus обычным пользователем UID 986:

- Запуск приложения из извлечённого x64 tar.gz: packaged self-test подтвердил Electron 45.2.1/Node 24.22.1, binary fetch/streams, session cookies, bookmarks и настоящий renderer.
- Обычный запуск AppImage через FUSE с тем же packaged self-test. Режим `--appimage-extract-and-run` не требовался для этого финального запуска.
- Настоящий GNOME keyring: backend `gnome_libsecret`, encrypt/decrypt round trip; тестовый секрет не сохранялся открытым. Renderer sandbox включён, `Seccomp=2`, флага `--no-sandbox` нет. Использовались только собственные временные профили, без личных аккаунтов.
- **22 новых Linux room UI checks**: настоящий DOM/mouse input, HTTP/SSE, роли и lease; owner PC→phone, DJ conflict/retry, live role changes, атомарный выбор конкретного queue ID и следующий трек, blocked source и Retry, сохранение черновика, размеры 360/420/1366 px. Каталог и музыкальные SDK — явно объявленные детерминированные fixtures. Проверялся dev Electron на том же замороженном исходном дереве, побайтно связанном с packaged ASAR; это не загрузка harness в fused release executable.

[Итоговый machine JSON](linux-verification-0.9.16/verification.json), [runtime](linux-verification-0.9.16/runtime-verification.json), [22 сценария](linux-verification-0.9.16/rooms-mobile-results.json). Логи packaged/FUSE self-test и фактические Linux UI PNG сохранены в той же папке. Старые три audio/player/YouTube UI набора 0.9.15 здесь повторно не запускались и не выдаются за новые результаты.

Первый проход сборки остановился на отсутствующем unpacked FFmpeg: временный каталог был ошибочно помещён внутрь скрытой `.build`, а существующий ASAR unpack glob проверяет абсолютные пути без `dot:true`. Повтор выполнен с собственным `/tmp/LolzCloud-packager-0.9.16-*` вне входного дерева. Продуктовые файлы и build scripts для этого не менялись; неудачный промежуточный результат не публиковался, FFmpeg не копировался вручную в обход ASAR metadata.

ARM64 подтверждён статически и не запускался на ARM64-устройстве. Физический DAC, настоящий внешний SoundCloud/YouTube SDK, личный OAuth и любой Linux-дистрибутив/Wayland-композитор этим прогоном не проверены. Статическая сборка ARM64, Chromium fixtures и запуск x64 в Xvfb не означают полный паритет всех физических платформ.
