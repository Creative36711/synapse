# Манифест модуля 1.0

Модуль ядра заявляет о себе манифестом: идентичность и версия, требования к среде, зависимости,
конфликты, что он предоставляет сборке. Машинная схема —
[`schema/module-manifest.schema.json`](../../schema/module-manifest.schema.json) (JSON Schema 2020-12),
примеры — [`schema/examples/module-manifest/`](../../schema/examples/module-manifest/).

## Минимальный валидный пример

```yaml
specVersion: "1.0"
module:
  id: "synapse.core.ui"
  version: "1.0.0"
  titleKey: "module.synapse_core_ui.title"
requires:
  spec: "1.0"
  engine: ">=4.7.0 <5.0.0"
provides:
  scenes: ["scene.main-menu"]
```

## Полный валидный пример

```yaml
specVersion: "1.0"
module:
  id: "synapse.core.platformer"
  version: "1.4.2"
  titleKey: "module.synapse_core_platformer.title"
  descriptionKey: "module.synapse_core_platformer.description"
requires:
  spec: "1.0"
  engine: ">=4.7.0 <5.0.0"
dependencies:
  - id: "synapse.core.physics"
    version: "^1.2.0"
  - id: "synapse.core.audio"
    version: ">=1.0.0 <2.0.0"
    optional: true
conflicts:
  - id: "synapse.legacy.platformer"
    version: "*"
    reasonKey: "module.synapse_core_platformer.conflict.legacy"
provides:
  scenes: ["scene.platformer.level", "scene.platformer.pause"]
  sceneEntries:
    - id: "scene.platformer.level"
      resource: "res://modules/platformer/scenes/level.tscn"
    - id: "scene.platformer.pause"
      resource: "res://modules/platformer/scenes/pause.tscn"
  locales: ["en", "ru"]
```

## Поля

| Поле | Тип | Обязательно | Правило | Код ошибки |
|---|---|---|---|---|
| `specVersion` | string | да | ровно `"1.0"` | `field.enum` |
| `module` | object | да | идентичность модуля | `field.required` |
| `module.id` | string | да | 3–6 сегментов через точку, нижний регистр | `field.pattern` |
| `module.version` | string | да | SemVer 2.0.0 | `field.pattern` |
| `module.titleKey` | string | да | ключ каталога перевода | `field.pattern` |
| `module.descriptionKey` | string | нет | ключ каталога перевода | `field.pattern` |
| `requires` | object | да | совместимость со средой | `field.required` |
| `requires.spec` | string | да | версия контракта, `"1.0"` | `field.enum` |
| `requires.engine` | string | да | диапазон версий движка (`versionRange`) | `field.pattern` |
| `dependencies` | array | нет | зависимости модуля, по умолчанию `[]` | `field.type` |
| `dependencies[].id` | string | да | смысловой ID модуля | `field.pattern` |
| `dependencies[].version` | string | да | диапазон версий (`versionRange`) | `field.pattern` |
| `dependencies[].optional` | boolean | нет | по умолчанию `false` | `field.type` |
| `conflicts` | array | нет | явные конфликты, по умолчанию `[]` | `field.type` |
| `conflicts[].id` | string | да | смысловой ID конфликтующего модуля | `field.pattern` |
| `conflicts[].version` | string | да | диапазон, в котором конфликт действует | `field.pattern` |
| `conflicts[].reasonKey` | string | да | ключ каталога с причиной конфликта | `field.required` |
| `provides` | object | да | что модуль добавляет сборке | `field.required` |
| `provides.scenes` | array | да | смысловые ID сцен без повторов | `field.unique`, `field.pattern` |
| `provides.sceneEntries` | array | нет | связь смыслового ID сцены с ресурсом, по умолчанию `[]` | `field.type`, `field.unique` |
| `provides.sceneEntries[].id` | string | да | смысловой ID сцены, обязан входить в `provides.scenes` | `field.pattern`, `scene.entry.unknown` |
| `provides.sceneEntries[].resource` | string | да | `res://…tscn`, без `..` и абсолютных путей; файл обязан существовать | `field.pattern`, `scene.resource.missing` |
| `provides.locales` | array | нет | локали, которые поставляет модуль | `field.enum`, `field.unique` |

## Диапазон версий (`versionRange`)

Диапазон — строка, а не число и не массив. Грамматика фиксируется здесь; **разрешение** диапазона
(выбор конкретной версии) — задача резолвера K-4.

```
range      := "*" | "^" semver | "~" semver | semver | comparator (" " comparator)*
comparator := (">=" | ">" | "<=" | "<" | "=") semver
semver     := MAJOR "." MINOR "." PATCH ["-" prerelease]
```

| Значение | Валидно | Смысл (для K-4) |
|---|---|---|
| `*` | да | любая версия |
| `^1.2.0` | да | совместимое изменение в рамках major `1` |
| `~1.2.0` | да | патч-обновления в рамках minor `1.2` |
| `1.2.0` | да | ровно эта версия |
| `>=1.0.0 <2.0.0` | да | список компараторов через пробел |
| `version 4` | **нет** | `field.pattern` по `/requires/engine` |
| `>= 1.0.0` | **нет** | пробел между оператором и версией запрещён: одна форма записи |
| `1.2` | **нет** | не SemVer |
| `>=1.0.0, <2.0.0` | **нет** | запятые не входят в грамматику |

Диапазоны не «примерно совместимы»: у них ровно одна запись, чтобы автор и валидатор понимали
строку одинаково.

## Зависимости и конфликты

- **`dependencies`** — что модулю нужно, чтобы выполнить свою работу. `optional: true` означает, что
  отсутствие зависимости не ошибка; решение о предупреждении принимает K-4 и фиксирует отдельным
  кодом, а не молчанием.
- **`conflicts`** — что нельзя загружать вместе с этим модулем. Конфликт обязан нести `reasonKey`:
  пользователю показывают текст из каталога, а не «модули несовместимы» из кода (INV-9).
- Модуль, зависящий сам от себя, — вырожденный цикл; его тоже ловит K-4.

## Цикл зависимостей — ошибка (INV-5)

Цикл не «предупреждение, которое можно проигнорировать» и не «порядок загрузки решит проблему».
Контракт фиксирует диагностику: код `module.dependency.cycle`, стадия `resolution`, карточка K-4.

Пример статической иллюстрации (не вывод резолвера — K-2 граф не обходит):

```
a: a → b → c → a
```

```json
{
  "code": "module.dependency.cycle",
  "params": {
    "path": "/dependencies",
    "expected": "ациклический граф зависимостей",
    "actual": "synapse.core.a -> synapse.core.b -> synapse.core.c -> synapse.core.a",
    "cycle": ["synapse.core.a", "synapse.core.b", "synapse.core.c", "synapse.core.a"]
  },
  "catalogKey": "errors.module.dependency.cycle"
}
```

`cycle` начинается и заканчивается одним и тем же ID: замыкание видно без догадок. `path` указывает
на объявление, с которого начат обход.

## `provides`: словарь сборки

`provides.scenes`, `provides.sceneEntries` и `provides.locales` — обещание модуля. По этому списку
K-4 отвечает на вопрос «существует ли `entry.scene` игры» и «есть ли локаль, которую игра объявила».
Если сцену не предоставил ни один модуль — `ref.unresolved` с `extraParams.refKind = "scene"`.

### Сцена: смысловой ID и ресурс

`provides.sceneEntries` — аддитивное дополнение к `provides.scenes`, а не замена: `scenes` остаётся
списком смысловых ID, которым игра адресует логику (INV-3), а `sceneEntries` связывает такой ID с
файлом сцены движка. Правила:

- `id` каждой записи обязан входить в `provides.scenes` этого же манифеста — иначе
  `scene.entry.unknown`: связь ведёт в никуда;
- один и тот же `id` не может быть сопоставлен ресурсу дважды — ни внутри манифеста, ни между
  модулями сборки (`scene.duplicate`); последняя запись не выигрывает;
- `resource` — только `res://…tscn`: без `..`, без абсолютных путей и без других расширений;
- файл ресурса обязан существовать в сборке (`scene.resource.missing`); проверка файловая и офлайн —
  без сети, без импорта ассетов и без запуска движка;
- экземпляр сцены, её узлы и состояние в манифест не попадают: здесь определение, а не экземпляр
  (INV-4).

Для автора игры это выглядит так: [`scene-binding.md`](scene-binding.md). Эталонные фикстуры
валидного и невалидного ввода — [`schema/examples/scene-binding/`](../../schema/examples/scene-binding/).

## Примеры ошибок

| Файл | Что не так | Код | Путь |
|---|---|---|---|
| `invalid/unknown-field.yaml` | лишний блок `runtime` (состояние в определении, INV-4) | `field.unknown` | `/runtime` |
| `invalid/wrong-type.yaml` | `dependencies` — строка вместо массива | `field.type` | `/dependencies` |
| `invalid/missing-requires.yaml` | нет блока `requires` | `field.required` | `/requires` |
| `invalid/bad-module-id.yaml` | ID из одного сегмента | `field.pattern` | `/module/id` |
| `invalid/bad-range.yaml` | `engine: "version 4"` | `field.pattern` | `/requires/engine` |
| `invalid/bad-spec-version.yaml` | `specVersion: "2.0"` | `field.enum` | `/specVersion` |
| `invalid/duplicate-scene.yaml` | одна сцена объявлена дважды | `field.unique` | `/provides/scenes` |
| `invalid/conflict-without-reason.yaml` | конфликт без `reasonKey` | `field.required` | `/conflicts/0/reasonKey` |
| `invalid/scene-entry-unknown-field.yaml` | лишнее поле в записи о сцене | `field.unknown` | `/provides/sceneEntries/0/preload` |
| `invalid/scene-entry-missing-resource.yaml` | запись о сцене без `resource` | `field.required` | `/provides/sceneEntries/0/resource` |
| `invalid/scene-resource-absolute.yaml` | абсолютный путь вместо `res://` | `field.pattern` | `/provides/sceneEntries/0/resource` |
| `invalid/scene-resource-dotdot.yaml` | `..` в пути ресурса | `field.pattern` | `/provides/sceneEntries/0/resource` |
| `invalid/scene-resource-not-tscn.yaml` | ресурс не `.tscn` | `field.pattern` | `/provides/sceneEntries/0/resource` |
| `invalid/duplicate-scene-entry.yaml` | одна и та же запись о сцене дважды | `field.unique` | `/provides/sceneEntries` |

Все они лежат в `schema/examples/module-manifest/invalid/` и перечислены в
[`cases.json`](../../schema/examples/module-manifest/cases.json); проверка сверяет код и путь.

## Границы

**K-2:** структура манифеста, грамматики, закрытые поля. **K-3:** семантика ключей каталога,
согласованность локалей модуля с игрой и связь сцен с ресурсами (`scene.entry.unknown`,
`scene.duplicate`, `scene.resource.missing`). **K-4:** разрешение версий
(`module.version.unsatisfied`), отсутствующие зависимости (`module.dependency.missing`), циклы
(`module.dependency.cycle`), сработавшие конфликты (`module.conflict`), неразрешённые ссылки
(`ref.unresolved`). Резолвер в K-2 не реализуется.
