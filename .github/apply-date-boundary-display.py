from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    file_path.write_text(content.replace(old, new, 1), encoding="utf-8")
    print(f"updated {path}")


replace_once(
    "frontend/src/App.tsx",
    '  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;\n',
    '  return Number.isFinite(latest) ? new Date(latest - 1).toISOString() : null;\n',
)

replace_once(
    "frontend/src/App.tsx",
    '''        tools, tokens, and value remain whole-session totals. Session window in the
        expanded details is first-to-last recorded activity, includes idle gaps, and
        is not intended for billing.
''',
    '''        tools, tokens, and value remain whole-session totals. Session window in the
        expanded details is the full first-to-last session envelope, includes idle
        gaps, and is not intended for billing.
''',
)

replace_once(
    "frontend/src/App.tsx",
    '                    title="Execution excludes idle time; session window is first to last recorded activity and includes idle gaps."\n',
    '                    title="Execution excludes idle time; session window is the full first-to-last session envelope and includes idle gaps."\n',
)
