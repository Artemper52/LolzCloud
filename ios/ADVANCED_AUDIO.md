# Нативный аудиопроцессор — кандидат 0.1.3

Опубликованные IPA, simulator ZIP и проверки 0.1.2 сохранены. Этот документ описывает новые исходники; успешную сборку Apple SDK и прохождение новых hosted XCTest нужно подтверждать отдельным CI-отчётом.

AVPlayer, AVAudioSession, очередь, системные кнопки и обработка прерываний остаются владельцами воспроизведения. `MTAudioProcessingTap` обрабатывает декодированный PCM как импортированных файлов, так и сетевого/сохранённого MP3. Дополнительный HTML audio или AVAudioEngine не запускается.

## Обработка

Порядок: нормализация → пять полос EQ → автоматический запас громкости/preamp → параллельные dry/reverb/echo → стереосвязанный limiter. Общий bypass возвращает конечный исходный PCM без изменения. Переходы EQ, preamp, reverb и echo сглаживаются за 25 мс.

- EQ: 60/230/910/3600/14000 Гц, ±12 dB. Preamp: −12…0 dB; дополнительно вычитается максимальное усиление полосы. Ненулевая полоса выше доступной частоты источника даёт честный `unsupported`.
- Echo: 280 мс, wet = amount × 0.6, feedback = amount × 0.55; amount 0…0.8.
- Reverb: четыре damped comb и два allpass на канал, разные задержки стереоканалов, расчётное затухание около 1.2 с; dry/wet соответствует диапазону PWA. Это алгоритмический ревербератор, а не побитовая копия convolution-импульса браузера.
- Нормализация: K-weighting, блоки 400 мс, абсолютный порог −70 и относительный gate, до 1500 блоков истории. Цель −14, ограничение изменения ±8 dB и скорость 1 dB/с после измерения первых трёх секунд. Отключение плавно возвращает gain к 0 dB. Тишина не усиливается. Сертификация LUFS не заявляется.
- Limiter: стереосвязанный, мгновенное ограничение текущего отсчёта, release 160 мс, потолок −3 dBFS и конечная защита от NaN/Inf. Он не имеет lookahead и не заявлен как true-peak limiter.

Буферы выделяются только в prepare и освобождаются в unprepare/finalize. Audio process не выделяет память, не ждёт locks, не вызывает Swift/ARC и не логирует. Echo/reverb используют ограниченные кольца с epoch tags: seek/discontinuity сбрасывает историю без очистки большого массива на render thread. Нормализация и короткие диагностические окна имеют фиксированный размер. Поддерживаются mono/stereo PCM, 8…384 kHz; адаптер переводит допустимые Float32/64 и Int16/32 в ядро.

Новый трек и discontinuity сбрасывают delay/loudness историю. Обычное изменение EQ не сбрасывает накопленную нормализацию. Хвост эффектов обрабатывается, пока AVPlayer отдаёт PCM; он не продлевает duration и не задерживает переход очереди после настоящего EOF.

## Протокол PWA

```json
{"action":"effects","clientId":"<document UUID>","requestId":1,"revision":2,"config":{"enabled":true,"gains":[0,0,0,0,0],"preampDb":0,"reverb":0.3,"echo":0.2,"normalization":true}}
```

`revision` относится только к настройкам. Effects не увеличивает playback request, не отменяет подготовку выбранного трека и не снимает паузу. Native принимает только текущие client/request и возвращает именно владельца последнего принятого effects-сообщения. Повтор тех же настроек с новым текущим request не сбрасывает DSP.

Принимаются только exact legacy-3 поля (`enabled/gains/preampDb`) либо все шесть полей. Legacy preferences мигрируют с нулевыми дополнительными эффектами. Старый клиент получает false для advanced capabilities. Новый клиент сначала отправляет legacy-3, видит `effectsSchema:2`, затем отправляет full-6 с новым settings revision. Отсутствующие/лишние поля, числовые boolean и неограниченные/nonfinite значения отклоняются.

Событие `effects` содержит `config`, `revision`, `effectsSchema`, `capabilities`, `state`, `appliedRevision`, `processedFrames`, `sampleRate`, `channels` и exact FX client/request. Advanced capabilities становятся true только для full-6 и подготовленного поддержанного ядра. `applied` требует реально обработанные PCM frames и соответствующий C revision; сохранённая настройка сама по себе не является применением. Дополнительные метрики: `peakDb`, `reductionDb` и `normalization:{key,enabled,measured,loudness,gainDb,targetDb,processedFrames}`. Gain этой метрики не является отдельной командой воспроизведения.

## Очередь ссылок и сохранение профиля

`capabilities` с exact transport tag сообщает `catalogReferences:1`, `profileExport:1`, `effectsSchema:2`. Запрос capabilities не меняет playback intent.

Явная catalog-запись содержит `source:'catalog'`, пустой `audioUrl`, numeric ID либо `ref:` + canonical SoundCloud URL. Native разрешает только выбранную запись через фиксированный HTTPS metadata endpoint, затем использует существующую signed prepare/load цепочку. Результат проверяется по ID/канонической ссылке, origin/MIME/размеру; redirects и cookie/credential storage отключены. Generation/cancellation не позволяют позднему ответу переключить другой выбор. Локальная запись никогда не переходит в этот путь. Дубликаты сохраняют индекс конкретного вхождения.

При разрешении `selection` содержит `previousId`, `index` и проверенный новый `track`. PWA должна проверять exact intent и исходное вхождение перед заменой. Устаревший snapshot после foreground не возвращает native current к первому дубликату и не стирает уже разрешённые метаданные.

Экспорт вызывается только явной командой `exportProfile:{json,filename,operationId}` под текущим tag. Native проверяет UTF-8 лимит 750000 bytes, PC v1 формат, безопасное имя и UUID операции; файл передаётся настоящему UIActivityViewController. `profileExport` возвращает captured client/request, operationId и `sharing/shared/cancelled/error`. `shared` означает успешное завершение системного share sheet, а не независимую проверку записи в выбранном облачном хранилище.

## Независимый pitch

`pitch:false`. [AVPlayerItem.audioTimePitchAlgorithm](https://developer.apple.com/documentation/avfoundation/avplayeritem/audiotimepitchalgorithm) выбирает алгоритм для scaled edits. [AVAudioUnitTimePitch](https://developer.apple.com/documentation/avfaudio/avaudiounittimeeffect) предоставляет независимые rate/pitch, но его встраивание в tap требует отдельного pull/render адаптера и доказанной обработки latency, seek и EOF. [Apple требует поглощать задержку процессора внутри tap](https://developer.apple.com/documentation/mediatoolbox/mtaudioprocessingtapprocesscallback). Эта работа не подменяется ползунком скорости.
