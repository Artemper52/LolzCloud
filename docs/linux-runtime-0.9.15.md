# Linux 0.9.15: аудиодвижок и интерфейс плеера

Дополнительная проверка 14 ноября 2026 года, после [сборки и smoke-проверки Linux](linux-verification-0.9.15.md). Прежние отчёты и три выпущенных артефакта сохранены: после этого прогона их SHA-256 повторно совпали с первоначальными значениями. Product source и test source не исправлялись; тесты запущены как есть.

## Связь с выпущенной сборкой

До запуска побайтно сопоставлены **141 выбранный runtime-файл**: текущие desktop integrations, plugins, host JS/CSS/templates, preloads, общий room-client и session-transfer client, публичная конфигурация. Все SHA совпали между текущим репозиторием, frozen Linux source snapshot и immutable x64 `app.asar`. Статические картинки, зависимости и платформенные бинарные файлы в это число не включены.

ASAR SHA-256: `e0910015fb83dd3eda1becd4bc167d9b1318a97332c18d67c156a5265939e247`. [Список файлов и сравнение](linux-runtime-0.9.15/desktop-source-verification.json).

Наборы запускают frozen source через development Electron **45.2.1**, совпадающий с версией packaged runtime; они не загружают произвольный тестовый entrypoint в fused release binary. Сам packaged binary и AppImage уже прошли отдельный `--self-test`, включая FUSE и extract-and-run. Эти два вида проверки не смешиваются.

## Среда

Linux x64, обычный `lolzcloud-build`, Xvfb X11 1366×768, отдельный D-Bus и разблокированный GNOME Keyring. Каждый runner создал собственный профиль с проверяемым `LolzCloud-*` префиксом в `os.tmpdir()` и удалил его после завершения. Личные профили и аккаунты не использовались; рабочие сервисы и release files не менялись.

Глобальный `--no-sandbox` не применялся. Удалённые provider guests сохраняли sandbox и изоляцию Node, как в приложении. Привилегированный локальный host использует обычную для продукта конфигурацию. Отдельный native probe подтвердил `gnome_libsecret`, encrypt/decrypt round-trip, sandboxed renderer и Seccomp 2: [JSON](linux-runtime-0.9.15/keyring-verification.json), [вывод](linux-runtime-0.9.15/keyring-probe.txt).

## Результат

| Штатный runner | Результат | Что проверено |
| --- | --- | --- |
| `tools/test-audio.cjs` | PASS | Реальный OfflineAudioContext/AudioWorklet: цифровой limiter ceiling и bypass, плавное приглушение/восстановление, отсутствие скачков и изменения user volume, tempo, reverb/echo/bass, повторное подключение существующего SDK graph |
| `tools/test-player-ui.cjs` | PASS | Общий SoundCloud/YouTube footer и mini, настоящее HTMLMediaElement seek/repeat/DSP, локальный WAV и offline UI, lyric seek, bookmarks, Voicetag; room host/listener bridge и handoff без двух звуков; social overlays сохраняют room guest, звук и chat draft |
| `tools/test-youtube-ui.cjs` | PASS | Production IPC и общие hitboxes на 100/125%, фактический video playbackRate/EQ graph, Voicetag поверх играющего media, общий/mini player, видимые full/mini lyrics и seek по строке |

В player-набор вошли отдельные listener, YouTube host и SoundCloud host проходы навигации по 13 панелям, включая Esc, закрытие/повторное открытие и сохранение draft/audio/lease. Это три успешных Linux-набора, а не повторная маркировка старого Windows-прогона.

[Сводный JSON](linux-runtime-0.9.15/linux-runtime-verification.json) · [exit codes и длительность](linux-runtime-0.9.15/suite-results.json) · [audio stdout](linux-runtime-0.9.15/audio.txt) · [player stdout](linux-runtime-0.9.15/player.txt) · [YouTube stdout](linux-runtime-0.9.15/youtube.txt).

Контрольные снимки сделаны настоящим Linux Chromium: [локальная музыка](linux-runtime-0.9.15/player-offline-linux.png), [YouTube controls](linux-runtime-0.9.15/youtube-player-linux.png). На них намеренно видны тестовые записи и страницы fixtures.

## Границы проверки

Источники — сгенерированные WAV/MP3 и синтетические страницы SoundCloud/YouTube. Используются настоящие Chromium media elements, Web Audio и application IPC; HTTP/SSE комнат обслуживает изолированный fixture server. Это не личный вход или воспроизведение любой внешней записи.

Проверено программное аудио и Xvfb UI. **Физический DAC, слышимый звук, микрофон, аппаратные media keys, реальное стороннее приложение для ducking, Wayland и ARM64 runtime не проверялись.** Платформенное приглушение других приложений на Linux не заявляется; DSP ducking внутри собственного графа проверен отдельно. Эти результаты не превращают static-only ARM64 proof в native ARM64 запуск и не измеряют общий CPU/батарею.
