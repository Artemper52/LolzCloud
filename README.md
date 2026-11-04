<p align="center">
  <img src="source/app/lib/assets/logo.svg" width="88" alt="LolzCloud">
</p>

<h1 align="center">LolzCloud</h1>

<p align="center">Твоя музыка из SoundCloud. Твой ритм. Твоя компания.</p>

<p align="center">
  <a href="https://lolzcloud.com">Сайт</a> ·
  <a href="https://github.com/Artemper52/LolzCloud/releases">Скачать</a> ·
  <a href="https://github.com/Artemper52/LolzCloud/issues">Обратная связь</a> ·
  <a href="https://t.me/artemper_lzt">Telegram</a>
</p>

Открытый настольный плеер для **Windows и Linux**. SoundCloud, персональные рекомендации, синхронный текст и совместное прослушивание в одном приложении.

![Моя волна в LolzCloud](docs/images/wave.png)

*Интерфейс на демонстрационных данных.*

## Возможности

- **Моя волна** — подбор по лайкам и прослушиваниям, настроение и музыкальные запросы. Без повторов в течение 24 часов.
- **Текст песни** — подсветка строк и слов, автопрокрутка, переход по нажатию и несколько источников.
- **Мини-плеер** — музыка и текст поверх окон, лайки, повтор и громкость.
- **Звук** — Speed Up, Slowed, Reverb, Bass Boost, эквалайзер и личные пресеты.
- **Lolzteam и Discord** — текущий трек, прогресс и кнопки твоих профилей.
- **Слушать вместе** — комнаты на lolzcloud.com со входом через Lolzteam.
- **MP3** — сохранение доступных полных треков в отдельную папку.

## Установка

Готовые сборки — в [Releases](https://github.com/Artemper52/LolzCloud/releases). Распакуй всю папку приложения; на Windows запусти `LolzCloud.exe`.

Linux: сборки **x64 и ARM64** для современных дистрибутивов с glibc. [Форматы, запуск и системные зависимости →](docs/linux.md)

## Из исходников

Нужны **Node.js 24 LTS** и npm.

```sh
npm ci
npm start
```

```sh
npm run build         # сборка для текущей платформы
npm run build:linux   # Linux-пакет
```

[Разработка](CONTRIBUTING.md) · [Использование и аккаунты](docs/usage.md) · [Текст](docs/lyrics.md) · [Моя волна](docs/wave.md) · [Сервер комнат](server/README.md)

## Автор

**Artemper** — [@Artemper52](https://github.com/Artemper52) · [@artemper_lzt](https://t.me/artemper_lzt) · [Lolzteam](https://lolz.team/members/6277567/).

Код распространяется по [лицензии MIT](LICENSE). Авторство исходных компонентов и их лицензии сохранены в [Third-party notices](THIRD_PARTY_NOTICES.md). LolzCloud — независимый проект, не официальный клиент SoundCloud, Lolzteam или Discord.
