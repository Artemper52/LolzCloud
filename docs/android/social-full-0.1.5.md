# Полный Android social/offline прогон 0.1.5

14 ноября 2026 года полный последовательный сценарий `SocialAndroidInstrumentation` прошёл **71 проверку** на установленном APK `0.1.5`, code `6`, SHA-256 `ee61577bcf8b45650fad41a76715d3b532012cc949289a61dbb2adfc41db72d0`. Это Android 15/API 35, x86_64, отдельный AVD LolzCloud `emulator-5554`.

Приложение не пересобиралось и не менялось. Установленный `base.apk` выгружен до и после проверки; обе суммы совпали с опубликованным артефактом. Менялся только test APK и его runner. Исходное разрешение `POST_NOTIFICATIONS` было включено и осталось включённым. Физические устройства, личные аккаунты и данные ПК не использовались.

Весь сценарий выполнен одним вызовом без `--without-picker`, `--upload-only` и других phase-флагов. Проверены private offline files, MediaPlayer и сохранение позиции/очереди, переходы social/room, настоящий системный image picker, callback/FileReader/Canvas, NotificationManager, дедупликация и удаление уведомлений, фокус/курсор поиска, открытие уведомления и настоящий Back для общего social drawer поверх комнаты.

## Что мешало полному сценарию

| Прогон | Наблюдение | Результат |
| --- | --- | --- |
| Первоначальный test APK | Прежний сбой выбора PNG воспроизведён на check 33. Плитка видна, доступна и имеет правильные координаты. `ACTION_CLICK` на доступном предке вернул `false`, прежний fallback не завершил выбор. | 32 проверки прошли; исходный неуспешный отчёт сохранён. |
| Настоящий системный `input touchscreen tap` по найденной плитке | DocumentsUI действительно вернул файл. Callback приложения передал PNG в WebView; FileReader и Canvas прочитали 108 байт, 8×8 и точный RGBA `[85,170,119,255]`. Далее тест остановился перед Back: исходный MainActivity не получил фокус после notification task. | 56 проверок прошли; второй неуспешный отчёт также сохранён. |
| Запуск через production launcher intent | Тест начинает задачу через `getLaunchIntentForPackage`, с настоящими `ACTION_MAIN`/launcher semantics. После notification review возвращается в обычную задачу приложения; Back-сценарий выполняется целиком. | **71 PASS** в одном полном прогоне. |

Оба исправления относятся к тестовому сценарию. URI, `ValueCallback`, выбранный файл, FileReader или Canvas не подменялись. Данные картинки приходят из отдельного read-only DocumentsProvider test APK через настоящий `ACTION_OPEN_DOCUMENT`. После выбора остались прежние проверки отмены picker, уничтожения Activity и запрета запроса из provider iframe. Старый неуспешный whole-run 0.1.4 не превращён задним числом в PASS.

## Доказательства

- [Полный 71 PASS](verification-0.1.5/android-social-full71-verification.json).
- [Первая неуспешная попытка: picker](verification-0.1.5/android-social-full71-attempt-1-picker-failed.json).
- [Вторая неуспешная попытка: launcher/task setup](verification-0.1.5/android-social-full71-attempt-2-task-failed.json).
- [APK, разрешение и неизменность прежнего failed JSON](verification-0.1.5/android-social-full71-summary.json).
- [Принадлежность и остановка AVD](verification-0.1.5/android-social-owned-avd-stopped.json).
- [Настоящий экран системного проводника](verification-0.1.5/android-social-saf-provider-grid.png).

Полные временные артефакты находятся в `D:/LolzCloud-Android-Toolchain/android-social-full-0.1.5`, включая отдельные `attempt-2-system-tap` и `attempt-3-launcher`, исходный test APK, логи и обе выгрузки установленного APK. Старый `android/output/android-social-native-verification.json` остался failed и сохранил SHA-256 `b172e8edd99d76d84173615297edb214a38de26cb7870246c1650c87768014bb`.

AVD запущен скрыто этим прогоном: launcher PID `11212`, qemu PID `10500`, имя и command line проверены перед работой и перед остановкой. В 16:18:06 UTC остановлен только этот AVD командой `adb -s emulator-5554 emu kill`; оба принадлежащих ему процесса завершились.

Для нового прогона задай отдельный каталог, чтобы не перезаписывать исторические результаты:

```powershell
$env:LOLZCLOUD_SOCIAL_NATIVE_OUTPUT='D:/LolzCloud-Android-Toolchain/android-social-full-next'
node android/tests/run-social-native.cjs
```

Социальные события и страницы входа в этом тесте — объявленные изолированные fixtures. Результат подтверждает нативный UI/runtime, транспорт изображения и жизненный цикл, а не настоящую авторизацию, мутацию профиля на сервере, доставку сообщения конкретному человеку или поведение физического телефона.
