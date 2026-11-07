# Коды ошибок и контракт диагностики

Ошибка ядра — это **код плюс параметры**, а не готовая фраза. Машинная часть одинакова для всех
локалей и стабильна между версиями; текст для человека берётся из каталога перевода по `catalogKey`.
Реестр — [`schema/error-registry.json`](../../schema/error-registry.json), его схема —
[`schema/error-registry.schema.json`](../../schema/error-registry.schema.json).

## Формат

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

- `code` — стабильный идентификатор из реестра, никогда не переводится;
- `params` — данные для подстановки; базовые три обязательны всегда (INV-6);
- `catalogKey` — строго `errors.<code>`, единственный путь к тексту (INV-9);
- локаль меняет только текст, но не `code`, не `params` и не результат проверки (INV-10).

### Базовые параметры (INV-6)

| Параметр | Смысл | Пример |
|---|---|---|
| `path` | JSON Pointer к месту в документе; для отсутствующего обязательного поля и для лишнего ключа — путь к имени ключа; `/` — корень | `/conflicts/0/reasonKey` |
| `expected` | что контракт ожидал: значение, тип, грамматика, набор | `строка SemVer 2.0.0` |
| `actual` | что реально пришло: значение или его тип | `0.1` |

Порядок `path`, `expected`, `actual` фиксирован: реестр и тест проверяют именно его. Дополнительные
параметры (`extraParams`) добавляются после базовых и не могут дублировать их имена.

## Реестр

| `code` | `stage` | `implementedIn` | params | `catalogKey` | когда |
|---|---|---|---|---|---|
| `field.unknown` | structural | K-2 | path, expected, actual | `errors.field.unknown` | лишнее поле в определении |
| `field.required` | structural | K-2 | path, expected, actual | `errors.field.required` | нет обязательного поля |
| `field.type` | structural | K-2 | path, expected, actual | `errors.field.type` | неверный тип значения |
| `field.enum` | structural | K-2 | path, expected, actual | `errors.field.enum` | значение вне закрытого набора |
| `field.pattern` | structural | K-2 | path, expected, actual | `errors.field.pattern` | не соответствует грамматике |
| `field.unique` | structural | K-2 | path, expected, actual | `errors.field.unique` | повтор в массиве без повторов |
| `yaml.duplicate-key` | structural | K-2 | path, expected, actual, key, line | `errors.yaml.duplicate-key` | повтор ключа в YAML |
| `yaml.syntax` | structural | K-2 | path, expected, actual, line, column | `errors.yaml.syntax` | файл не разбирается как YAML 1.2 |
| `definition.state.forbidden` | semantic | K-3 | path, expected, actual, field | `errors.definition.state.forbidden` | попытка хранить состояние экземпляра |
| `locale.key.missing` | semantic | K-3 | path, expected, actual, locale, catalog | `errors.locale.key.missing` | нет ключа каталога для локали |
| `module.duplicate` | semantic | K-3 | path, expected, actual, moduleId | `errors.module.duplicate` | один ID модуля объявлен дважды |
| `scene.entry.unknown` | semantic | K-3 | path, expected, actual, sceneId, moduleId | `errors.scene.entry.unknown` | запись `sceneEntries` не входит в `provides.scenes` |
| `scene.duplicate` | semantic | K-3 | path, expected, actual, sceneId, modules | `errors.scene.duplicate` | один ID сцены сопоставлен ресурсу дважды |
| `scene.resource.missing` | semantic | K-3 | path, expected, actual, sceneId, resource | `errors.scene.resource.missing` | ресурса `res://…tscn` из `sceneEntries` нет |
| `spec.file.missing` | semantic | K-3 | path, expected, actual, file | `errors.spec.file.missing` | файл спецификации не читается |
| `runtime.engine.missing` | semantic | K-3 | path, expected, actual, engine | `errors.runtime.engine.missing` | движок `run` недоступен |
| `cli.dependency.node-missing` | semantic | K-3 | path, expected, actual, dependency, requiredVersion | `errors.cli.dependency.node-missing` | нет Node.js, проверка не выполнена |
| `module.dependency.missing` | resolution | K-4 | path, expected, actual, requiredBy, constraint | `errors.module.dependency.missing` | обязательная зависимость не найдена |
| `module.dependency.cycle` | resolution | K-4 | path, expected, actual, cycle | `errors.module.dependency.cycle` | цикл в графе зависимостей (INV-5) |
| `module.version.unsatisfied` | resolution | K-4 | path, expected, actual, constraint, available | `errors.module.version.unsatisfied` | нет версии под диапазон |
| `module.conflict` | resolution | K-4 | path, expected, actual, conflictId, constraint | `errors.module.conflict` | сработал объявленный конфликт |
| `ref.unresolved` | resolution | K-4 | path, expected, actual, refKind, providedBy | `errors.ref.unresolved` | смысловой ID никем не предоставлен |

Каждая строка этой таблицы сверяется с реестром автоматически: код без строки и строка без кода —
провал `npm run check:contracts`.

## Стадии

- **structural** — форма документа: поля, типы, шаблоны, повторы, разбор YAML. Реализовано в K-2
  (схемы + правила чтения).
- **semantic** — то, что требует не только формы: существование файлов и ресурсов, смысл уже
  разобранного документа, доступность окружения проверки. Сюда входят ключи каталога, согласованность
  локалей, отсутствие состояния в определении, связь сцены с ресурсом (`scene.*`), читаемость файла
  спецификации (`spec.file.missing`) и наличие того, чем выполняется проверка
  (`runtime.engine.missing`, `cli.dependency.node-missing`). K-3.
- **resolution** — граф модулей: версии, зависимости, конфликты, циклы, ссылки. K-4.

`implementedIn` — карточка, где проверка появляется. Значение определяется стадией:
`structural → K-2`, `semantic → K-3`, `resolution → K-4`.

Стадии ровно три, и четвёртой контракт не вводит: отсутствие движка или Node.js — не «стадия
рантайма», а предусловие проверки, поэтому такие коды живут в `semantic`. Если появится отдельная
стадия `runtime`, меняется только поле `stage` (и вместе с ним `implementedIn`) — один код, одна
строка, см. [`../decisions/SYN-2.md`](../decisions/SYN-2.md).

## Тексты новых кодов

`catalogKey` новых кодов выводится из кода (`errors.scene.entry.unknown` и т. д.), но строки в
каталогах `locales/<locale>.json` для них ещё не добавлены: восемь каталогов ведёт карточка
локализации, и дописывать их из контрактной карточки нельзя. До появления текстов диагностика такого
кода рендерится штатным `locale.key.missing`, а сам код и `params` остаются верными. Это известный
долг, а не разрешение писать текст в контракт (INV-9, INV-14).

## Как добавить код

1. Код составной, нижний регистр, через точку: `<область>.<что>` (`field.*`, `yaml.*`, `module.*`).
2. `params` начинаются с `path`, `expected`, `actual`; дополнительные имена — в `extraParams`.
3. `catalogKey` всегда `errors.<code>` — ключ не придумывается отдельно от кода.
4. Стадия и карточка обязательны: код без владельца не попадает в реестр.
5. Код стадии `K-2` обязан иметь хотя бы один пример в `schema/examples/**`: неподтверждённый код не
   отличается от опечатки.
6. Текст ошибки в реестр не пишется. Поля `message`, `text`, `title` запрещены схемой реестра.

## Чего в K-2 нет

Коды `semantic` и `resolution` описаны контрактом, но не реализованы: K-2 не читает каталоги
переводов, не строит граф и не разрешает версии. Статические примеры в `schema/examples/**`
показывают, что структурная схема отсекает описанный ввод, и **не** выдаются за работу валидатора
(K-3) или резолвера (K-4). Например, цикл модулей ловится только в K-4, хотя код диагностики уже
зафиксирован здесь.

## Локаль не меняет проверку (INV-10)

Переключение локали влияет на подставленный текст и только на него: `code`, `params`, `path`,
порядок и состав ошибок остаются прежними, состояние мира не меняется. Поэтому ключи каталога
обязаны существовать для всех восьми локалей, а тесты сравнивают диагностику без учёта текста.
