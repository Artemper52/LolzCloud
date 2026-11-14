# Android social regression 0.1.4

Проверен установленный APK `0.1.4`, code `5`, SHA-256 `4e4758653fdc547a28688d8cd3760c21a62d6abaef84b8cce00ba1ce2961308d`, Android 15/API 35, изолированный `emulator-5554`, 14 ноября 2026 года. Приложение не пересобиралось и данные не удалялись; менялся только отдельный test APK. Личный аккаунт, настоящий вход и выдача серверных ролей не использовались.

| Прогон | Результат | Отчёт |
| --- | --- | --- |
| `--without-picker`: офлайн-файлы, MediaPlayer, social → room, настоящие системные уведомления и Back | 50 PASS | [core](verification-0.1.4/android-social-core-verification.json) |
| `--upload-only`: системный JPEG/PNG-picker и полный callback/bytes path | 23 PASS | [upload](verification-0.1.4/android-social-upload-verification.json) |
| `--roles-only`: owner/tester в фактических bundled social.js/css | 13 PASS | [roles](verification-0.1.4/android-social-roles-verification.json) |
| `--back-only`: системный Back закрывает drawer и сохраняет комнату | 17 PASS | [Back](verification-0.1.4/android-social-back-verification.json) |
| Общий последовательный прогон | Остановился на check 33, выборе PNG в DocumentsUI | [неуспешный whole-run](verification-0.1.4/android-social-full-harness-failed.json) |

Проверки выполнялись по отдельным phase; их числа пересекаются, поэтому они не складываются в один успешный whole-run. Полный прогон из 71 проверки на этой версии не заявляется.

В первом picker failure before/after кадры показали открытый drawer «Open from»: одноимённый toolbar title был принят за пункт LolzCloud images, а нажатие по устаревшим координатам PNG открыло Downloads. В test harness добавлены отдельный выбор drawer row, ожидание его закрытия и диагностические снимки. Последующий общий прогон всё ещё остановился на выборе файла; оставшаяся причина combined-run failure не установлена. По этой гипотезе production-код или разрешения WebView не менялись.

Отдельный upload-прогон действительно прошёл `ACTION_OPEN_DOCUMENT` → тестовый DocumentsProvider → production `ValueCallback<Uri[]>` → `input.files` → `FileReader`/Canvas. Выбран PNG размером 108 байт, 8×8, с точным RGBA `[85,170,119,255]`. Provider сообщил `image/png`, flags `0`, существующий файл; logcat подтвердил настоящий `openDocument` в режиме `r`. URI и callback не подставлялись. Cancel, уничтожение Activity и отказ запросу из provider iframe также прошли. Это проверка транспорта изображения через Android, а не загрузка фото в реальный авторизованный профиль на сервере.

Role phase использует объявленные профили и настоящие JS/CSS из APK. CSS загружается через собственный `/cloud/social.css`; CSP `style-src 'self'` сохранена. Подтверждены видимые и оформленные owner/tester badges, отдельный форумный титул, фильтр роли с неподходящим `source`, открытие редактора реальным касанием WebView, его Cancel и отсутствие кнопки самостоятельного изменения ролей на своём профиле. Fixture делает только GET; PUT и личная авторизация не выполняются.

Исторические успешные результаты 0.1.3 сохранены отдельно в [verification-0.1.3](verification-0.1.3/). Прогон повторяется командой `node android/tests/run-social-native.cjs` с соответствующим phase-флагом после установки production APK и сборки test APK; runner восстанавливает исходное разрешение уведомлений.
