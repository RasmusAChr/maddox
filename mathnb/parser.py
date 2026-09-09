import re


class Assignment:
    def __init__(self, name, expr_text):
        self.name = name
        self.expr_text = expr_text


class Expression:
    def __init__(self, text):
        self.text = text


_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def classify(cell_text):
    text = cell_text.strip()
    if ":=" in text:
        name, expr_text = text.split(":=", 1)
        name = name.strip()
        if not _IDENTIFIER.fullmatch(name):
            raise ValueError(f"Invalid assignment target: {name!r}")
        return Assignment(name, expr_text.strip())
    return Expression(_wrap_bare_equations(text))


def _wrap_bare_equations(text):
    replacements = _find_bare_equations(text)
    if not replacements:
        return text
    pieces = []
    cursor = 0
    for start, end, lhs, rhs in replacements:
        pieces.append(text[cursor:start])
        # Preserve any leading whitespace within the segment
        seg_text = text[start:end]
        leading_ws_count = len(seg_text) - len(seg_text.lstrip())
        leading_ws = seg_text[:leading_ws_count]
        pieces.append(leading_ws)
        pieces.append(f"Eq({lhs}, {rhs})")
        cursor = end
    pieces.append(text[cursor:])
    return "".join(pieces)


def _find_bare_equations(text):
    """Find each bare '=' (not :=, <=, >=, !=, ==) and the boundaries of
    the argument/segment it sits in (bounded by the nearest enclosing
    '(', '[', ',', or start/end of string at the same nesting depth)."""
    depth = 0
    seg_start_stack = [0]
    replacements = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in "([":
            depth += 1
            seg_start_stack.append(i + 1)
            i += 1
            continue
        if ch in ")]":
            depth -= 1
            seg_start_stack.pop()
            i += 1
            continue
        if ch == ",":
            seg_start_stack[-1] = i + 1
            i += 1
            continue
        if ch == "=":
            prev_ch = text[i - 1] if i > 0 else ""
            next_ch = text[i + 1] if i + 1 < n else ""
            if prev_ch in "<>=!" or next_ch == "=":
                i += 2 if next_ch == "=" else 1
                continue
            seg_start = seg_start_stack[-1]
            j = i + 1
            d = depth
            while j < n:
                c = text[j]
                if c in "([":
                    d += 1
                elif c in ")]":
                    if d == depth:
                        break
                    d -= 1
                elif c == "," and d == depth:
                    break
                j += 1
            seg_end = j
            lhs = text[seg_start:i].strip()
            rhs = text[i + 1:seg_end].strip()
            replacements.append((seg_start, seg_end, lhs, rhs))
            i = seg_end
            continue
        i += 1
    return replacements
