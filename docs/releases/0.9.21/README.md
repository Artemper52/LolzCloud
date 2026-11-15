# Выпуск 0.9.21 опубликован

[GitHub](https://github.com/Artemper52/LolzCloud/releases/tag/v0.9.21), [файлы на сайте](https://lolzcloud.com/install.html), [сводка](../public-0.9.21.json).

Windows/Linux 0.9.21; Android 0.1.11/code 12; нативный iOS 0.1.6/build 7 без подписи Apple; PWA/backend 0.9.24, SW9. Все 22 официальных файла и 22 GitHub-копии проверены полным чтением и SHA256. Tag указывает на точный commit `7577990efd3f9987321cadae68098096c6f95029`, архив содержит 1438 raw Git файлов без overlays.

Точный исходный код прошёл 564/564 Node-теста на Linux без skips. Нативный iOS: 102 SDK policy-теста и по 20 hosted Simulator-проверок на iPhone/iPad. Android: 15 suite на одном R4 APK. Финальные проверки сайта: 13 файлов, 29 PWA, 14 Range-ссылок; четыре desktop check-only и два host-Java Android policy сценария обновления без установки. Пределы этих проверок сохранены в JSON.

HEAD, branch и staged contents исходного рабочего дерева сохранились. Ранее root git status обновил stat cache индекса: SHA байтов изменился; обе суммы и причина приведены в git-index-stat-refresh.json. Это не скрывается утверждением о неизменных байтах индекса.

Физические iPhone/iPad/Android/Safari, Windows 7 и ARM64 Linux runtime этими проверками не доказаны. Исторические выпуски и исходный ZIP не менялись.
