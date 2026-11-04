# Discord в общей сборке

Вся сборка LolzCloud использует один публичный Application ID из `config/app.json`. Сейчас указан `1567292690197119026`. Пользователи запускают свой настольный Discord и слушают музыку; отдельные приложения или токены им не нужны. Активность каждого пользователя отправляется в его локальный Discord.

Для своей версии проекта один раз замени `discordApplicationId` в этом файле конфигурации и выполни `npm run build`. Это публичный ID приложения, не Bot Token и не Client Secret. Конфигурация входит в исходники и готовую сборку. В интерфейсе конечного пользователя поля ID нет.

Для локальной разработки можно переопределить ID через `LOLZCLOUD_DISCORD_APPLICATION_ID`.

Логотип приложения: `source/app/lib/assets/logo.png`; редактируемый оригинал: `source/app/lib/assets/logo.svg`.

Кнопки профилей в Rich Presence видны другим пользователям. Discord скрывает их при просмотре собственной активности. [Официальная документация](https://github.com/discord/discord-api-docs/blob/main/developers/discord-social-sdk/development-guides/setting-rich-presence.mdx).
