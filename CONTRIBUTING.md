# Как вносить изменения

Правила работы с кодом — в [`AGENTS.md`](AGENTS.md), карта проекта — в [`docs/PROJECT-MAP.md`](docs/PROJECT-MAP.md).

## Чек-лист пулл-реквеста

- [ ] Проверки проходят: `npm run typecheck && npm test && npm run lint && node scripts/brand-check.mjs`.
- [ ] Новый тест-файл добавлен в `scripts.test` в `package.json`.
- [ ] **В этом же PR обновлены** [`docs/PROJECT-MAP.md`](docs/PROJECT-MAP.md) (если появились, переехали или исчезли модули), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) и [`docs/DECISIONS.md`](docs/DECISIONS.md) (если меняется устройство или принято решение), [`docs/CHANGELOG.md`](docs/CHANGELOG.md) (запись о новой версии).
- [ ] Секретов нет нигде, кроме `.env` на NAS: ни в коде, ни в образе, ни в compose, ни в документах.
- [ ] Нет личных имён, настоящих адресов (для примеров — `pora.example.synology.me`), IP-адресов и портов домашней сети.
- [ ] Нет названий других приложений-планировщиков.
- [ ] Для изменений интерфейса приложены скриншоты «до» и «после».
- [ ] Если менялась схема базы, в [`docs/SYNOLOGY.md`](docs/SYNOLOGY.md) описаны обновление и откат (при необходимости — скрипт `scripts/db-downgrade-*.mjs`).

Слияние в `main` — только после явного согласия владельца. После слияния CI сам публикует образ в GHCR, а обновление на NAS делается вручную.
