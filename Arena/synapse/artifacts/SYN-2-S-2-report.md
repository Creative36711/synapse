# SYN-2 · S-2 — каталоги UI и диагностик

**Dispatch:** `4116f0cf-5705-8154-80de-cf33e15da5af`

**Run:** `b1974383-1a9b-4c3b-9045-378bc08e5929`

**BASE_SHA:** `835358bfdbd58e88ab16cba588f54eda5a471c72`

**HEAD_SHA (исходный код, на котором выполнены все локальные проверки):** `b1edfcddfb2f8ceb1dadfa6d70373ab1790a231f`

## Итог

Подготовлены и переведены каталоги на все восемь фиксированных локалей. `npm run i18n-check` теперь проверяет полные наборы ключей и placeholders для производственных каталогов и примеров. `i18n-no-literals` покрыт негативными и позитивными фикстурами для всех требуемых UI-полей `.gd` и `.tscn`.

Имена шести новых диагностик сверены с `schema/error-registry.json`; каталоги содержат только их зарегистрированные `errors.<code>` ключи. Тесты подтверждают, что code/params не зависят от локали, а локализуется только message.

## Изменённые и созданные файлы

**Изменены:**
- `locales/en.json`, `locales/ru.json`, `locales/zh-Hans.json`, `locales/ja.json`, `locales/pt-BR.json`, `locales/de.json`, `locales/fr.json`, `locales/ko.json` — шесть зарегистрированных ошибок и шесть `ui.minigame.*` ключей; английские прежние 17 диагностических ключей сохранены.
- `examples/locales/en.json` — добавлены `game.*`, `entity.*` и UI мини-игры.
- `tools/i18n/check.mjs`, `tools/i18n/no-literals.mjs`, `tools/i18n/README.md`.
- `tests/i18n/catalogs.test.mjs`, `tests/i18n/diagnostics.test.mjs`, `tests/i18n/no-literals.test.mjs`.

**Созданы:**
- `examples/locales/ru.json`
- `examples/locales/zh-Hans.json`

`package.json` не менялся: существующая команда `npm run i18n-check` теперь включает проверку placeholder-совместимости production и example каталогов; отдельный `i18n-placeholders` npm script не нужен.

## Проверки и артефакты

Команды и полные выводы сохранены в `S-2-*.log`; все локальные acceptance-команды запускались на одном исходном SHA `b1edfcddfb2f8ceb1dadfa6d70373ab1790a231f`.

| Команда | Код возврата | Результат |
|---|---:|---|
| `npm run i18n-check` | 0 | root: 8×29/29 (en 100%); examples: en/ru/zh-Hans 14/14; placeholders совпадают |
| `npm run i18n-no-literals` | 0 | 15 игровых файлов, 0 литералов |
| `npm run test:i18n` | 0 | 24/24; includes failure and success fixtures |
| `node tests/contracts/check-contracts.mjs` | 0 | 93/93 |
| `node --test tests/contracts/*.test.mjs` | 0 | 93/93 |
| `PATH=/tmp/synapse-godot/bin:$PATH node --test tests/validation/*.test.mjs` | 0 | 16/16 |
| `PATH=/tmp/synapse-godot/bin:$PATH GODOT_BIN=/tmp/synapse-godot/bin/godot node --test tests/modules/*.test.mjs` | 0 | 17/17 |
| `PATH=/tmp/synapse-godot/bin:$PATH GODOT_BIN=/tmp/synapse-godot/bin/godot node --test tests/cli/run.test.mjs` | 0 | 12/12 |
| `python3 -B tests/deps/test_vendor.py` | 0 | 8/8 |
| `node --check` изменённых JS-файлов | 0 | все файлы проходят |
| `git diff --check` | 0 | чисто |
| scope filter относительно предыдущего head `b9a1ca01ff21343ca50512f595041ec247d0b6b9` | 0 | изменения этой карточки только в разрешённых каталогах |
| D-022 URL/dependency поиск | 1 | ожидаемый no-match; нет cortex URL или зависимости |
| GitHub PR check `i18n` | 0 | pass на head `b1edfcddfb2f8ceb1dadfa6d70373ab1790a231f` |

Корневые каталоги теперь содержат 29 ключей: исходный базовый набор из 17 сохранён, плюс все зарегистрированные коды и `ui.*`. Checker запрещает дополнительные/недостающие ключи между локалями и пустые значения. Примеры содержат 14 одинаковых ключей в `en`, `ru`, `zh-Hans`, включая все ветки `ui.*`, `game.*`, `entity.*`.

`test:i18n` проверяет намеренный литерал в отрицательной фикстуре (checker возвращает 1) и локализованные/пустые значения в положительной фикстуре (возвращает 0) для `text`, `tooltip_text`, `placeholder_text`, `window_title`, `title` в `.gd` и `.tscn`.

## PR

PR: [#25](https://github.com/Creative36711/synapse/pull/25), base `main`. Использован уже открытый PR закреплённой ветки: на этой ветке находилась предыдущая S-3 работа; S-2 delta ограничена разрешёнными путями. PR обновлён под S-2/S-3 и проходит GitHub i18n check. Статус слияния фиксируется после выполнения merge.

## Допущение

**Допущение:** поскольку закреплённая ветка уже содержала открытый PR #25 для S-3, S-2 внесён в тот же PR, а не создан второй PR с той же head-веткой в `main`. Для этой карточки изменены только разрешённые пути.
