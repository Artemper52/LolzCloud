# Сохранение высоты при изменении темпа — кандидат

Это кандидат 0.1.4/build5 после опубликованной 0.1.3. Опубликованные IPA/simulator ZIP и исторические проверки 0.1.3 не изменены. До нового Apple SDK/runtime прогона спектральная проверка iOS остаётся **pending**.

Apple прямо связывает `AVPlayer.rate` и `AVPlayerItem.audioTimePitchAlgorithm` в [руководстве AVFoundation, раздел Playback](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/AVFoundationPG/Articles/04_MediaCapture.html). [Spectral](https://developer.apple.com/documentation/avfoundation/avaudiotimepitchalgorithm/spectral) сохраняет исходную высоту; [varispeed](https://developer.apple.com/documentation/avfoundation/avaudiotimepitchalgorithm/varispeed) меняет её вместе с темпом. Это выбор алгоритма воспроизведения, а не независимый регулятор pitch. Capability независимого pitch остаётся false.

NativePlayer устанавливает алгоритм до замены AVPlayerItem и сохраняет его при resume, seek, автоматическом Next и выборе точной копии трека в очереди. Настройки темпа 0.5…2 и preservesPitch сохраняются в private UserDefaults; sleep deadline и владелец bridge не сохраняются. Миграционный default true сохраняет прежнее поведение iOS до явного выбора нового клиента. Пауза не снимается; изменение настроек не вызывает play/seek, не меняет PlaybackIntent/generation и не отменяет prepare.

## Bridge

После текущего queue handshake событие `lolzcloud:capabilities` сообщает integer `preservesPitch:1`. В effects-status это тоже integer capability; в playback `preservesPitch` — Boolean выбранной настройки.

```json
{"action":"rate","clientId":"<lowercase document UUID>","requestId":2,"value":1.5,"preservesPitch":true,"revision":3}
```

Rate — отдельный канал настроек с exact текущими client/request. Revision — safe integer ≥1, отдельно от playback и effects. Старшая ревизия принимается; повтор той же ревизии допустим только с теми же настройками. При новом текущем transport request клиент пересылает тот же config/revision; это обновляет владельца ACK без перезапуска звука. Новый document начинает с revision1. Старый ACK не получает новый transport tag автоматически.

Playback возвращает `rate`, Boolean `preservesPitch`, `rateRevision`, `rateAppliedRevision`, `rateState`. Пока новый владелец не прислал настройки, поля ACK ревизии отсутствуют. `rateState:pending` / appliedRevision0 означает, что текущая настройка ещё не звучит, в том числе в паузе. `applied` означает активный AVPlayer с выбранным алгоритмом/темпом, а не анализ высоты произвольной песни. Старые клиенты могут отправлять прежний value-only rate, сохраняя текущий preserve choice, до первого negotiated rate-сообщения своего document.

## Проверка

71 Foundation/C тест прошёл на Linux: прежние 65, пять новых rate-policy и один тест диагностического счётчика PCM. Hosted XCTest добавляют проверку настоящих pause/persistence/seek/duplicate Next, настроек во время pending preparation и trusted WK bridge. Отдельный tone probe проверяет фактическую частоту для local WAV и genuine MP3 в seeded cache при 0.75× и 1.5×. Cached MP3 fixture не заявляется как новая HTTPS download-проверка.

Счётчик crossing снимает PCM **в существующем MTAudioProcessingTap**. [Apple QA1783](https://developer.apple.com/library/archive/qa/qa1783/_index.html) не гарантирует, что PostEffects tap находится после глобального time-pitch AVPlayer. Тест поэтому требует измеренной varispeed частоты baseline×rate и постоянной spectral частоты. Если tap окажется upstream, тест должен оставить trace и завершиться ошибкой; upstream PCM не считается доказательством конечного pitch. Физический iPhone, наушники и пользовательское субъективное качество звука этим не проверены.
