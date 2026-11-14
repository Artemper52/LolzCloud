# Linux 0.9.15: сборки и фактическая проверка

14 ноября 2026 года. Подготовлены три артефакта; после фиксации следующих сумм они не пересобирались. [Полный JSON](linux-verification-0.9.15/linux-verification.json), [машинные metadata](linux-verification-0.9.15/artifact-metadata.json).

| Файл | Байт | SHA-256 |
| --- | ---: | --- |
| `LolzCloud-0.9.15-linux-x64.AppImage` | 147454456 | `ab81a437bc6fe8960268efee47ab2b8e213fbee5d6549a9998e44c528824a4e4` |
| `LolzCloud-0.9.15-linux-x64.tar.gz` | 160305565 | `c64f12d871e8b88c9c74d4a5577dab20ec6f5c69c39a8fea9e973422c3104a1c` |
| `LolzCloud-0.9.15-linux-arm64.tar.gz` | 159401586 | `d87f345e78e3892ad8392bb1ce36f15c4d887e6ab60cc97d1c6053e9cee3a4ba` |

В этой сборке AppImage подготовлен для x64; ARM64 предоставлен в tar.gz. Наличие ARM64 AppImage этим отчётом не заявляется. Публикация зеркала и GitHub выполняется отдельно от сборки; приведённые metadata сами по себе не подтверждают публикацию файлов.

## Среда и сборка

Linux x86_64, обычный пользователь `lolzcloud-build`, Node.js **24.22.2** для сборки, Electron **45.2.1** с встроенным Node.js **24.22.1**. Использован зафиксированный source snapshot 0.9.15 с SHA-256 `c5d17cc0ac63d119d7e66b7776b13c1ad0ec99e218807d008a44dd247bf47c7a`.

Начальный `npm ci` завершился EUSAGE, потому что архив ещё не был распакован: в cwd отсутствовали и package.json, и lockfile. После проверки ZIP paths и распаковки от build-user штатный `npm ci` прошёл; lockfile не исправлялся и зависимости не обновлялись. Сборки выполнены штатными `build-linux.cjs`, `build-appimage.cjs` и `LOLZCLOUD_BUILD_ARCH=arm64`. Исходники приложения и общие build scripts в этом Linux-проходе не изменялись.

## Что проверено

| Проверка | Результат |
| --- | --- |
| Запуск x64 packaged binary под Xvfb/D-Bus | PASS: native renderer, binary fetch/streams, session cookies и сохранённые bookmarks через штатный `--self-test` |
| Та же AppImage через extract-and-run | PASS |
| Та же AppImage обычным FUSE-запуском после установки build-host зависимости fuse3 | PASS; артефакт не изменялся |
| Настоящий разблокированный GNOME Keyring / libsecret | PASS: выбран `gnome_libsecret`, зашифрованный round-trip, отсутствие plaintext в ciphertext |
| Sandbox | Не отключался; отдельный native renderer сообщил `sandboxed: true`, `/proc` подтвердил Seccomp 2 |
| Оба tar.gz | Electron и FFmpeg имеют правильные ELF machine: x64 — 62, ARM64 — 183; executable mode 0755, корень архива 0755, app.asar присутствует |

Проверка keyring выполнялась отдельным небольшим Electron-приложением той же версии в том же изолированном графическом/D-Bus окружении: [JSON](linux-verification-0.9.15/keyring-verification.json). Штатный packaged self-test сам не проверяет safeStorage напрямую. Передавался только выбор `gnome-libsecret`; `--no-sandbox` и `basic_text` не применялись. Все профили имели проверенный временный путь `/tmp/LolzCloud-self-test-*` и удалялись после завершения. Использовались синтетические значения, личные аккаунты не открывались.

**ARM64 проверен статически, на ARM64-устройстве не запускался.** Linux smoke не равен проверке всех дистрибутивов, Wayland-композиторов, аудиоустройств, Discord или личного OAuth. Общее поведение desktop music проверено отдельно в [аудите desktop 0.9.15](desktop-music-audit-0.9.15.md); его Windows UI-результаты не выдаются за Linux device QA. [Системные зависимости и обычный запуск](linux.md).

После этого smoke-прохода выполнены и [три настоящих Linux software-audio/player/YouTube UI набора](linux-runtime-0.9.15.md). Они имеют отдельные новые JSON, logs и снимки, не заменяют исходные proof и сохраняют ограничения по физическому аудио, ARM64 и личному OAuth.
