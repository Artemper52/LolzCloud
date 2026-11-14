# Android 0.1.7: эффекты, моменты и таймер личной музыки

APK 0.1.7/code 8 собрана координатором и проверена на выделенном Android API 35 AVD. SHA-256: `ca58d0d794f47858e055cbe5ae76921dcd12c50380588719e0d402028304000f`, до/после проверок не менялась. Опубликованный APK 0.1.6 не перезаписывался; публикация новой версии — отдельный этап координатора. Проверки и результаты 0.1.5/0.1.6 остаются отдельной историей.

Исправлены подтверждённые ошибки:

- Bass Boost раньше показывал сохранённый запрос как фактические 0–100%, не учитывая фиксированную силу или округление устройства. Теперь регулируемый эффект читает реальное значение; фиксированный даёт переключатель. Потеря управления/отсутствие эффекта не показывается как успешное применение. Это соответствует различию `getStrengthSupported` и `getRoundedStrength` в [Android API](https://developer.android.com/reference/android/media/audiofx/BassBoost).
- Сброс EQ раньше обходил только полосы текущего engine. Если аудиосессии не было, старые `eq_*` оставались и возвращались на следующем треке. Сброс теперь очищает все сохранённые числовые полосы, отключает живой EQ и сохраняет bypass для новых сессий. Старые установки без нового ключа продолжают читать прежние настройки. Сбрасываются также speed/pitch, bass, reverb и loudness; очередь, громкость и таймер сохраняются.
- Кнопки «Обычная скорость», Slowed и Speed up изменяют темп/тон, сохраняя отдельные настройки баса и EQ. Полный сброс остаётся отдельным действием. Полосы и их фактические частоты/диапазоны зависят от устройства; частоты переводятся из milliHertz, уровни из millibels по [Equalizer API](https://developer.android.com/reference/android/media/audiofx/Equalizer).
- Переход к моменту раньше заменял очередь одним треком, запускал его независимо от паузы и спустя 100 мс перематывал mutable `player`. При быстром Next позиция могла попасть в другой трек. Теперь один service-вызов сохраняет очередь и play/pause intent: текущая запись только перематывается; уже стоящая в очереди выбирает текущее или первое существующее вхождение; отсутствующая добавляется в конец, что подписано в интерфейсе. Позиция задаётся до load generation и применяется существующим `onPrepared` только своему MediaPlayer. Отложенного callback больше нет.
- Сохранение момента повторно проверяет track ID при нажатии, если меню открыли до смены записи. Новые моменты дедуплицируются в пределах 500 мс и ограничены 100 на трек; прежние большие массивы не обрезаются. Есть удаление отдельного момента. Старый формат массива миллисекунд сохранён.
- Таймер раньше существовал только в памяти процесса. Теперь сохранён ограниченный wall-clock deadline; пока процесс жив, используется monotonic clock. Новая Service восстанавливает остаток без autoplay; истёкший/некорректный deadline очищается. В UI остаются 15/30/45/60 минут и отмена, service-запрос ограничен сутками. Остаток обновляется и округляется вверх без краткого показа 16 минут для выбора 15.

Эффекты и этот таймер относятся к нативному плееру файлов/каталога SoundCloud. Они не управляют аудио комнат и отдельного YouTube Music WebView; эта граница подписана на экране. Нормализация LUFS, echo, общий WebView DSP и единый переносимый профиль этим кандидатом не добавлены. Наличие LoudnessEnhancer не означает LUFS-нормализацию.

Для будущего общего EQ согласован желаемый формат `{enabled,gains:[5],preampDb}`: центры 60/230/910/3600/14000 Hz, gain −12…+12 dB, preamp −12…0 dB. Это пока предложение адаптера Android, а не новый portable/cloud schema. Android hardware band count и фильтры отличаются; понадобятся отображение кривой по log-frequency, clamp/readback каждой реальной полосы и явное `native-band-approximation` capability. Нельзя переносить raw `eq_0…N` как частоты, выдавать Android BassBoost per-mille за dB или обещать идентичный PCM-ответ WebAudio/AVPlayer. Локальный export/import Android v1 и авторизация/облачный профиль не менялись.

Выполнено:

- Полная компиляция 31 Java-файла, включая generated R, с Java 8 и Android SDK 36; APK этим агентом не собиралась.
- 17 pure JVM behavior checks production Bass policy: округление, фиксированная сила без фиктивного strength setter, lost control, rejected enable, released/invalid driver и очистка старых полос без engine.
- 14 pure JVM sleep checks: два вида часов, восстановление остатка, expiry/cancel, предел суток, переполнение и округление UI.
- Новый `AudioComfortInstrumentation`: **25 actual checks PASS** на настоящих MediaPlayer/AudioEffect readback/SharedPreferences/MainActivity и Service recreation с тремя сгенерированными 30-секундными silent WAV. Проверены queue/pause/append, production bookmark-click→rapid Next без чужой позиции, reset, сохранённый deadline/expiry, отсутствие autoplay и восстановление исходных prefs.
- Эмулятор предоставил пять настоящих native EQ-полос: первая 60 Hz, команда +600 millibels подтверждена `getBandLevel`; Bass Boost с регулируемой силой вернул фактические 333. Подтверждён bypass живого EQ после сброса. Это чтение параметров Android AudioEffect, не измерение частотного/акустического ответа физического устройства.
- Связанные регрессии на той же APK: **20 audio-audit**, **58 real-public catalog/offline/Retry**, **50 social core/offline/NotificationManager** — PASS. В audio-audit focus callbacks вводятся тестом в реальный сервис; это явно отмечено в JSON. В social используются изолированные API fixtures без личного входа. Сценарии пересекаются, поэтому числа приведены отдельно.

[Итоговый runtime summary](verification-0.1.7/runtime-summary.json), [25 actual checks](verification-0.1.7/android-audio-comfort-verification.json), [20 audio-audit](verification-0.1.7/android-audio-audit-verification.json), [58 catalog](verification-0.1.7/android-catalog-verification.json), [50 social core](verification-0.1.7/android-social-core-verification.json), [host policy results](verification-0.1.7/audio-settings-policy-verification.json) и [compile/source hashes](verification-0.1.7/audio-settings-source-freeze.json). Физический телефон, WebView-room timer и process-kill lifecycle не проверялись. Собственный AVD после QA остановлен; исходные настройки восстановлены.

Первый прогон сохранён отдельно как [раннее наблюдение capabilities](verification-0.1.7/audio-comfort-initial-early-snapshot.json). Тест увидел `prepared=true` до завершения того же `onPrepared`, который создаёт AudioEffects; поэтому слишком рано записал unavailable. Добавлен только test-side main-looper barrier, после чего повторный полный AudioComfort подтвердил реальные EQ/Bass. Production source и APK между прогонами не менялись.

Снимки настоящей APK: [эффекты](verification-0.1.7/audio-effects.png), [моменты](verification-0.1.7/bookmarks.png). Названия `Moment A/B/C` на них принадлежат сгенерированным тестовым WAV и не добавляются в пользовательскую библиотеку после восстановления prefs.

Запуск после того, как координатор установит точную новую APK на собственный AVD:

```powershell
node android/tests/run-audio-comfort.cjs --expected-version 0.1.7 --expected-code 8 --expected-sha <SHA256_новой_APK> --output D:/LolzCloud-Android-Toolchain/audio-settings-0.1.7/runtime
```

Runner требует уже запущенный явно принадлежащий задаче эмулятор, проверяет version/SHA до и после, устанавливает только test APK и использует nonce против старого отчёта. Production install/build/start эмулятора выполняет координатор. `node android/tests/run-audio-settings-policy.cjs` повторяет только host-проверки, без Android-устройства.
