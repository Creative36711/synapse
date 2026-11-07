# SYN-2 · S-3 — проверочный отчёт

**Результат:** реализация и автоматические проверки пройдены; вся проверенная версия кода привязана к одному SHA: `ce777ba379bddd15247e7d213cbd12613038e250`. PR пока не смержен.

## Реализовано

- Реестр runtime-сцен собирается как копия базовой карты `SceneRegistry.SCENES` плюс `sceneEntries` выбранных и разрешённых модулей. `game/runtime/scene_registry.gd` остался неизменённой базовой картой ядра.
- Resolver проверяет фактические core+module scene IDs, вычисляет `expected` по собранным записям, проверяет принадлежность `sceneEntries.id` к `provides.scenes`, уникальность ID и наличие файла ресурса `res://…tscn`. Дубликаты не разрешаются правилом «последний выиграл»; диагностика включает code и params.
- GameSpec `entities` передаются в runtime как экземпляры; свойства каждого экземпляра deep-copy исходного определения. Снимок state содержит entity ID и свойства. Мутируемое поле `state` в определении проверено как `definition.state.forbidden`.
- Добавлены тесты resolver, публичного CLI, forbidden state и независимости экземпляров.

## Проверки

Все тесты запускались на исходном коде SHA `ce777ba`; команды, полный вывод и коды возврата сохранены в соседних `*.log`.

| Проверка | Результат |
|---|---:|
| `node tests/contracts/check-contracts.mjs` | rc=0; 6 файлов, 93/93 |
| `node --test tests/contracts/*.test.mjs` | rc=0; 93/93 |
| `env PATH=/tmp/synapse-godot/bin:$PATH node --test tests/validation/*.test.mjs` | rc=0; 16/16 |
| `env PATH=/tmp/synapse-godot/bin:$PATH GODOT_BIN=/tmp/synapse-godot/bin/godot node --test tests/modules/*.test.mjs` | rc=0; 17/17 |
| `env PATH=/tmp/synapse-godot/bin:$PATH GODOT_BIN=/tmp/synapse-godot/bin/godot node --test tests/runtime/*.test.mjs` | rc=0; 1/1 |
| `env PATH=/tmp/synapse-godot/bin:$PATH GODOT_BIN=/tmp/synapse-godot/bin/godot node --test tests/cli/run.test.mjs` | rc=0; 12/12 |
| `node --test tests/i18n/*.test.mjs` | rc=0; 18/18 |
| `node tools/i18n/check.mjs` | rc=0; все 8 локалей 17/17 |
| `node tools/i18n/no-literals.mjs` | rc=0; 15 файлов, 0 пользовательских литералов |
| `python3 -B tests/deps/test_vendor.py` | rc=0; 8/8 |
| Godot headless editor import | rc=0; Godot 4.7.2 |
| `node --check` для всех изменённых JS и JS-тестов | rc=0 |
| `git diff --check` | rc=0 |
| Публичные Godot CLI `validate`, `resolve`, `run` для `examples/minimal.game.yaml` | все rc=0; `run` обработал 1 кадр |

PNG smoke-test: `minimal.png`, 960×540, SHA-256 `d26499b79fd2daea08c90a6c0d5d08441260078fa96d0445aaece2352aeacbca`. Изображение открыто и визуально проверено: тёмный минималистичный экран меню с бирюзовым квадратным значком, горизонтальными полосами и кнопкой воспроизведения. Состояние: `minimal.state.json`.

Поиск по `game/runtime` не обнаружил module IDs, `sceneEntries`, `provides.sceneEntries` или `moduleId`; scene ID литералы в runtime — только `scene.main-menu` и `scene.state-motion` в базовой карте. Скоуп-поиск cortex-ссылок/зависимостей пустой (grep rc=1 — совпадений нет). Изменений в запрещённых каталогах нет.

## Ограничение acceptance

**Новые локализованные тексты для `scene.entry.unknown`, `scene.duplicate` и `scene.resource.missing` отсутствуют во всех `locales/*.json`; при таком состоянии `message` для этих новых ключей не формируется.** Каталоги `locales/**` не менялись, поскольку они явно исключены из этого scope, а локализация новых кодов отнесена к отдельной карточке. Код и params диагностик покрыты тестами, но критерий «локализованный текст» этим PR не закрывается. Поэтому общий `check=1`, несмотря на зелёные команды выше; перед полной приёмкой требуется отдельное решение/карточка по локализациям.

## Допущение

**Допущение:** точечные изменения в `game/validation/validator.mjs` разрешены, чтобы прокинуть базовые core scene IDs от Godot CLI в Node-валидатор и проверить `entry.scene` относительно фактически собранного реестра; без этого невозможно корректно вычислить `expected` и закрыть N-3 без хардкода.

## Артефакты

- `acceptance-status.tsv` — краткая сводка статусов.
- `test-*.log`, `check-contracts.log`, `i18n-*.log`, `minimal-*.log`, `godot-editor.*.log`, `node-check.log`, `diff-check.log`, `scope-check.log`, `d022-search.log`, `runtime-search.log`, `core-scene-search.log`, `localization-gap.log` — команды/выводы проверок.
- `minimal.png`, `minimal.state.json` — smoke-test run.
- `source-proof.log` — проверенный исходный SHA и чистота tracked worktree.
