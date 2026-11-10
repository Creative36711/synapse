"""Small JSON bridge from the isolated gdtoolkit parser to the Node checker."""

import ast
import json
import re
import sys
from gdtoolkit.parser import parser

DISPLAY_PROPERTIES = {"text", "tooltip_text", "placeholder_text", "window_title", "title"}
OUTPUT_CALLS = {"set_text", "print", "printerr", "push_error", "push_warning"}
LOCALIZATION_CALLS = {"tr", "t", "translate", "localize", "_translate_text"}
TECHNICAL_CODE = re.compile(r"^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+$")


def rule(node):
    if getattr(node, "data", None) is None:
        return None
    return str(node.data)


def token_value(node):
    return str(node) if getattr(node, "type", None) is not None else None


def member_path(node):
    """Return (root, last member) for a parsed GDScript property path."""
    if token_value(node) is not None:
        value = token_value(node)
        return value, value
    if rule(node) == "getattr" and len(node.children) >= 3:
        root, _ = member_path(node.children[0])
        last = token_value(node.children[-1])
        return root, last
    return None, None


def visible(text: str) -> bool:
    return text.strip() != ""


def string_value(node):
    if rule(node) != "string" or not node.children:
        return None
    raw = token_value(node.children[0])
    if raw is None:
        return None
    try:
        decoded = ast.literal_eval(raw)
        return decoded if isinstance(decoded, str) else str(decoded)
    except (SyntaxError, ValueError):
        if raw.startswith('"""') or raw.startswith("'''"):
            return raw[3:-3]
        if raw[:1] in ('"', "'") and raw[-1:] == raw[:1]:
            return raw[1:-1]
        return raw


def chr_value(call):
    if rule(call) != "getattr_call" or len(call.children) < 2:
        return None
    root, name = member_path(call.children[0])
    if root != "String" or name != "chr":
        return None
    argument = call.children[1]
    raw = token_value(argument)
    if raw is None or getattr(argument, "type", None) != "NUMBER":
        return None
    try:
        return chr(int(raw.replace("_", ""), 0))
    except (ValueError, OverflowError):
        return None


def localized_call(node):
    node_rule = rule(node)
    if node_rule == "standalone_call" and node.children:
        return token_value(node.children[0]) in LOCALIZATION_CALLS
    if node_rule == "getattr_call" and node.children:
        root, name = member_path(node.children[0])
        return name in LOCALIZATION_CALLS or (root == "TranslationServer" and name == "translate")
    return False


def has_static_visible_text(node, ignore_technical=False):
    """Detect visible constant strings, including literal String.chr concatenations."""
    if localized_call(node):
        return False

    literal = string_value(node)
    if literal is not None:
        if not visible(literal):
            return False
        return not (ignore_technical and TECHNICAL_CODE.fullmatch(literal.strip()))

    generated = chr_value(node)
    if generated is not None:
        return visible(generated)

    if rule(node) == "arith_expr":
        # GDScript's '+' concatenation keeps the component expressions in order.
        return any(has_static_visible_text(child, ignore_technical) for child in node.children)

    if rule(node) in {"standalone_call", "getattr_call"}:
        # Evaluate only the actual arguments; the callee name is not output text.
        return any(has_static_visible_text(child, ignore_technical) for child in node.children[1:])

    if getattr(node, "children", None) is not None:
        return any(has_static_visible_text(child, ignore_technical) for child in node.children)
    return False


def call_name(node):
    if rule(node) == "standalone_call" and node.children:
        value = token_value(node.children[0])
        return value, value
    if rule(node) == "getattr_call" and node.children:
        return member_path(node.children[0])
    return None, None


def line_of(node):
    return int(getattr(getattr(node, "meta", None), "line", 1) or 1)


def analyze(source):
    tree = parser.parse(source, gather_metadata=True)
    assignments = []
    calls = []

    for node in tree.find_data("assnmnt_expr"):
        if len(node.children) < 3:
            continue
        target, operator, expression = node.children[:3]
        _, property_name = member_path(target)
        if property_name in DISPLAY_PROPERTIES:
            assignments.append({
                "line": line_of(node),
                "property": property_name,
                "operator": token_value(operator),
                "hasStaticVisibleText": has_static_visible_text(expression),
            })

    for node in tree.iter_subtrees_topdown():
        if rule(node) not in {"standalone_call", "getattr_call"}:
            continue
        root, name = call_name(node)
        if name not in OUTPUT_CALLS:
            continue
        arguments = node.children[1:]
        first_argument_has_text = bool(arguments) and has_static_visible_text(arguments[0], ignore_technical=True)
        if first_argument_has_text:
            calls.append({"line": line_of(node), "mechanism": name})

    return {"assignments": assignments, "calls": calls}


def main() -> int:
    payload = json.load(sys.stdin)
    results = []
    for item in payload.get("files", []):
        path = item["file"]
        try:
            results.append({"file": path, **analyze(item["source"])})
        except Exception as error:  # parser errors must never become a clean scan
            line = getattr(error, "line", None)
            column = getattr(error, "column", None)
            results.append({
                "file": path,
                "error": str(error),
                "line": line,
                "column": column,
            })
    json.dump({"version": "4.5.0", "files": results}, sys.stdout)
    sys.stdout.write("\n")
    return 0 if all("error" not in result for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
