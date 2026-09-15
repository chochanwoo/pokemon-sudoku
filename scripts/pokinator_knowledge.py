"""Compile reviewed, scoped franchise facts into the local question matrix."""

from urllib.parse import urlparse


def compile_knowledge(data, rows, species_keys):
    if data.get("version") != 1 or data.get("formPolicy") != "species-not-evolution-family":
        raise ValueError("Unsupported knowledge policy")
    sources, scopes = data["sources"], data["scopes"]
    for url in sources.values():
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError(f"Invalid knowledge source: {url}")
    questions = {q["id"]: q for q in data["questions"]}
    if len(questions) != len(data["questions"]):
        raise ValueError("Duplicate knowledge question")
    known_species = set(species_keys.values())
    parents = {key: set(q.get("parents", [])) for key, q in questions.items()}
    resolved, visiting = {}, set()

    def resolve(key):
        if key not in questions or key in visiting:
            raise ValueError(f"Missing or cyclic knowledge reference: {key}")
        if key in resolved:
            return resolved[key]
        visiting.add(key)
        q = questions[key]
        yes, unknown, refs = set(q.get("yes", [])), set(q.get("unknown", [])), set(q.get("sources", []))
        if yes & unknown or (yes | unknown) - known_species or refs - sources.keys():
            raise ValueError(f"Invalid knowledge facts or sources: {key}")
        if q.get("includes"):
            if yes or unknown:
                raise ValueError(f"Union question cannot override facts: {key}")
            for child in q["includes"]:
                child_yes, child_unknown, child_refs = resolve(child)
                yes |= child_yes
                unknown |= child_unknown
                refs |= child_refs
                parents[child].add(key)
            unknown -= yes
        if not yes or not refs:
            raise ValueError(f"Knowledge question needs positive facts and sources: {key}")
        visiting.remove(key)
        resolved[key] = yes, unknown, refs
        return resolved[key]

    for key in questions:
        resolve(key)

    visited = set()

    def validate_parents(key):
        if key not in questions or key in visiting:
            raise ValueError(f"Missing or cyclic knowledge parent: {key}")
        if key in visited:
            return
        visiting.add(key)
        yes, unknown, _ = resolved[key]
        for parent in parents[key]:
            validate_parents(parent)
            parent_yes, parent_unknown, _ = resolved[parent]
            # Both child=yes -> parent=yes and parent=no -> child=no must hold.
            if (questions[key]["group"] != questions[parent]["group"] or
                    not yes <= parent_yes or not (yes | unknown) <= (parent_yes | parent_unknown)):
                raise ValueError(f"Invalid knowledge implication: {key} -> {parent}")
        visiting.remove(key)
        visited.add(key)

    output = []
    form_note = {"ko": "메가·리전폼은 원본 종 기준이에요.",
                 "en": "Use the original species for Mega and regional forms."}
    for key, q in questions.items():
        validate_parents(key)
        scope = q.get("note") or scopes.get(q.get("scope"))
        if not scope or any(not q.get(lang) or not scope.get(lang) for lang in ("ko", "en")):
            raise ValueError(f"Missing bilingual question or scope: {key}")
        if q["group"] not in {"movies", "anime", "trainers", "culture-games", "stories"}:
            raise ValueError(f"Invalid knowledge group: {key}")
        if q.get("specificity", "broad") not in {"broad", "focused", "signature"}:
            raise ValueError(f"Invalid knowledge specificity: {key}")
        if not isinstance(q.get("retired", False), bool):
            raise ValueError(f"Invalid retired question flag: {key}")
        yes, unknown, refs = resolved[key]
        values = "".join("1" if species_keys[p["speciesId"]] in yes else
                         "?" if species_keys[p["speciesId"]] in unknown else "0" for p in rows)
        if "0" not in values or "1" not in values:
            raise ValueError(f"Knowledge question cannot distinguish candidates: {key}")
        output.append({"id": key, "ko": q["ko"], "en": q["en"], "group": q["group"],
                       "values": values, "ease": 1.25, "error": .14, "after": q.get("after", 0),
                       "expert": False, "contextual": True, "parents": sorted(parents[key]),
                       "specificity": q.get("specificity", "broad"), "retired": q.get("retired", False),
                       "note": {lang: f"{scope[lang]} {form_note[lang]}" for lang in ("ko", "en")},
                       "sources": [sources[ref] for ref in sorted(refs)]})
    return output
