# GameSpec 1.0

Описание игры: кто она, какая версия, с какой сцены начинается, какие модули подключает и какие
локали поставляет. Машинная схема — [`schema/gamespec.schema.json`](../../schema/gamespec.schema.json)
(JSON Schema 2020-12), примеры — [`schema/examples/gamespec/`](../../schema/examples/gamespec/).

Файл игры (условное имя `game.yaml`; конкретное имя каталога игры определяет K-3) — данные, а не
код. Схема самодостаточна: внешних `$ref` нет, проверка офлайн (INV-1).

## Минимальный валидный пример

```yaml
specVersion: "1.0"
game:
  id: "example.minimal"
  version: "0.1.0"
  titleKey: "game.example_minimal.title"
entry:
  scene: "scene.main-menu"
```

`modules` и `locales` можно опустить. Значения по умолчанию (`modules: []`, локали — `en`) —
аннотации контракта; подставляет их загрузчик/валидатор K-3, а не JSON Schema.

## Полный валидный пример

```yaml
specVersion: "1.0"
game:
  id: "synapse.demo.garden"
  version: "1.2.3"
  titleKey: "game.synapse_demo_garden.title"
  descriptionKey: "game.synapse_demo_garden.description"
entry:
  scene: "scene.garden.title-screen"
modules:
  - id: "synapse.core.platformer"
    version: "^1.2.0"
  - id: "synapse.core.ui"
    version: ">=1.0.0 <2.0.0"
    optional: false
locales:
  default: "en"
  supported: ["en", "ru", "de"]
entities:
  - id: "entity.garden.player"
    properties:
      max_health: 100
      walk_speed: 3.5
      can_dash: false
      nameKey: "game.synapse_demo_garden.entity_player.name"
```

## Поля

| Поле | Тип | Обязательно | Правило | Код ошибки |
|---|---|---|---|---|
| `specVersion` | string | да | ровно `"1.0"` — версия контракта | `field.enum` |
| `game` | object | да | блок идентичности, только описанные поля | `field.required`, `field.unknown` |
| `game.id` | string | да | смысловой ID игры: 2–5 сегментов через точку, нижний регистр | `field.pattern` |
| `game.version` | string | да | SemVer 2.0.0 без ведущих нулей | `field.pattern` |
| `game.titleKey` | string | да | ключ каталога перевода, не текст | `field.pattern` |
| `game.descriptionKey` | string | нет | ключ каталога перевода | `field.pattern` |
| `entry` | object | да | точка входа | `field.required` |
| `entry.scene` | string | да | смысловой ID сцены с префиксом `scene.` | `field.pattern` |
| `modules` | array | нет | ссылки на модули; по умолчанию `[]` | `field.type` |
| `modules[].id` | string | да | смысловой ID модуля: 3–6 сегментов | `field.pattern` |
| `modules[].version` | string | да | диапазон версий (грамматика — в [`module-manifest.md`](module-manifest.md)) | `field.pattern` |
| `modules[].optional` | boolean | нет | необязательная зависимость, по умолчанию `false` | `field.type` |
| `locales` | object | нет | набор локалей игры | `field.type` |
| `locales.default` | string | да (если есть `locales`) | локаль из набора §9, по умолчанию `en` | `field.enum` |
| `locales.supported` | array | да (если есть `locales`) | непустой список локалей без повторов | `field.enum`, `field.unique` |
| `entities` | array | нет | определения сущностей, по умолчанию `[]` | `field.type` |
| `entities[].id` | string | да | смысловой ID сущности с префиксом `entity.` | `field.pattern` |
| `entities[].properties` | object | да | свойства экземпляра, только примитивы | `field.type` |

Любое поле вне таблицы — `field.unknown`: контракт не расширяется на месте.

## Смысловые ID, а не пути к файлам (INV-3)

Контракт адресует логику смысловыми ID: `example.minimal`, `synapse.core.ui`, `scene.main-menu`.
Путь вида `res://levels/menu.tscn` в GameSpec не пишется — иначе переименование файла ломает
контракт, а игра начинает зависеть от структуры каталогов ассетов.

| Значение | Грамматика | Валидно | Невалидно |
|---|---|---|---|
| ID игры | `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,4}$` | `example.minimal`, `synapse.demo.garden` | `Example Minimal`, `game` |
| ID модуля | `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){2,5}$` | `synapse.core.ui` | `synapse`, `Synapse.Core.UI` |
| ID сцены | `^scene(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$` | `scene.main-menu`, `scene.garden.title-screen` | `main-menu`, `res://levels/menu.tscn` |
| ID сущности | `^entity(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$` | `entity.player`, `entity.ui.hud` | `player`, `res://actors/player.tscn` |
| Ключ каталога | `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$` | `game.example_minimal.title` | `Заголовок игры`, `game..title` |
| Версия | SemVer 2.0.0 | `0.1.0`, `1.2.3-rc.1` | `0.1`, `v1.2.3` |

Границы смысловых ID — часть контракта: `scene.` в `entry.scene` гарантирует, что автор не вставит
сюда путь к ассету, а `provides.scenes` модуля отвечает тем же словарём (см.
[`module-manifest.md`](module-manifest.md)).

## `entities`: определение, а не экземпляр

`entities` описывает, **что** существует в игре и с какими начальными свойствами создаётся
экземпляр. Это часть описания игры, а не сейв и не рантайм-состояние:

- `id` — смысловой ID сущности по грамматике смысловых ID с префиксом `entity.` (INV-3): имя файла,
  узла или ассета сюда не пишется;
- `properties` — только примитивы: строка, число, булево, `null`. Вложенный объект или массив —
  `field.type`: это уже структура изменяемого состояния;
- полей `state`, `save`, `runtime` нет и не будет — определение неизменяемо (INV-4). Экземпляр
  создаётся из определения, а его изменяемые значения живут в рантайме и сейвах;
- пользовательский текст свойством не хранится: видимое игроку имя — ключ каталога (INV-9), см.
  [`localization.md`](localization.md). Ключ каталога описывает текст, а не состояние экземпляра:
  состояние в ключах не дублируется.

Пример выше показывает оба случая: числа и булево — данные, `nameKey` — ключ каталога, а не строка
интерфейса.

## Чего в GameSpec принципиально нет

- **Состояния экземпляра** (`state`, `save`, `runtime`) — определения неизменяемы (INV-4). Прогресс
  игрока живёт в рантайме и сейвах, а не в описании игры.
- **Жанра** (`genre`, `template`) — ядро не ветвится по жанру (INV-7). Жанр — это набор модулей и
  контент, а не поле контракта.
- **Пользовательского текста** — только ключи каталога (`titleKey`, `descriptionKey`), см.
  [`localization.md`](localization.md).
- **Путей к ассетам** — только смысловые ID (INV-3).

## Пример ошибки

Файл [`schema/examples/gamespec/invalid/unknown-field.yaml`](../../schema/examples/gamespec/invalid/unknown-field.yaml):

```yaml
specVersion: "1.0"
game:
  id: "example.minimal"
  version: "0.1.0"
  titleKey: "game.example_minimal.title"
  genre: "platformer"
entry:
  scene: "scene.main-menu"
```

Диагностика (машинная часть; текст подставит каталог):

```json
{
  "code": "field.unknown",
  "params": {
    "path": "/game/genre",
    "expected": "поле из контракта GameSpec 1.0",
    "actual": "genre"
  },
  "catalogKey": "errors.field.unknown"
}
```

Полный набор примеров задан в
[`schema/examples/gamespec/cases.json`](../../schema/examples/gamespec/cases.json): для каждого
невалидного файла указан код и путь. Проверка (`npm run check:contracts`) сверяет именно их.

## Что проверяет K-2, а что нет

**K-2 (структура, эта карточка):** обязательные поля, типы, закрытые наборы, грамматики, повторы,
лишние поля, чтение YAML.

**K-3 (семантика, следующая карточка):** что `locales.default` входит в `supported`; что ключи
`titleKey`/`descriptionKey` существуют для каждой объявленной локали (`locale.key.missing`); что
`entry.scene` непустой по смыслу; что ресурсы сцен из манифестов существуют и не дублируются
(`scene.resource.missing`, `scene.duplicate`).

**K-4 (резолвинг):** что `modules[].id` разрешается в доступный модуль, версии удовлетворяют
диапазонам, граф без циклов, `entry.scene` предоставлена одним из подключённых модулей
(`ref.unresolved`).

Ни один из этих шагов K-2 не выполняет и не имитирует.
