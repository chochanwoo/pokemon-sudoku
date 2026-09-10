"""Build a reproducible, offline Pokemon similarity game from the master DB."""

import base64
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".tools" / "semantic"))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
import numpy as np
from PIL import Image

PUBLIC = ROOT / "web" / "public"
CACHE = ROOT / "data" / "cache" / "pokeapi"
MODEL = "sentence-transformers/all-MiniLM-L6-v2"
SIMILARITY_VERSION = "similarity-v2"
WEIGHTS = {"types": 25, "evolution": 20, "classification": 15, "motifs": 10,
           "stats": 10, "moves": 7, "description": 5, "abilities": 5,
           "eggGroups": 2, "body": 1}
TRAITS = json.loads((Path(__file__).with_name("pokemantle_traits.json")).read_text(encoding="utf-8"))
MOTIF_PATTERNS = {tag: re.compile(r"\b(?:" + "|".join(re.escape(term) for term in terms) + r")\b", re.I)
                  for tag, terms in TRAITS["motifs"].items()}
# Explicit release order: database IDs are not chronological.
VERSIONS = ["mega-dimension", "legends-za", "scarlet-violet", "legends-arceus",
            "brilliant-diamond-shining-pearl", "sword-shield",
            "lets-go-pikachu-lets-go-eevee", "ultra-sun-ultra-moon", "sun-moon",
            "omega-ruby-alpha-sapphire", "x-y", "black-2-white-2", "black-white",
            "heartgold-soulsilver", "platinum", "diamond-pearl", "emerald",
            "firered-leafgreen", "ruby-sapphire", "crystal", "gold-silver",
            "yellow", "red-blue", "champions"]
FORM_LABELS = {
    "alola": "알로라", "galar": "가라르", "hisui": "히스이", "paldea": "팔데아",
    "paldea-combat-breed": "팔데아 · 컴뱃종", "paldea-blaze-breed": "팔데아 · 블레이즈종",
    "paldea-aqua-breed": "팔데아 · 워터종", "mega": "메가", "mega-x": "메가 X",
    "mega-y": "메가 Y", "mega-z": "메가 Z", "gmax": "거다이맥스",
}


def cached(kind, identifier):
    return json.loads((CACHE / kind / f"{identifier}.json").read_text(encoding="utf-8"))


def form_label(form):
    key = form["form_key"] or ""
    if key in FORM_LABELS:
        return FORM_LABELS[key]
    korean = form["form_name_ko"] or ""
    if re.search("[가-힣]", korean):
        return korean
    if not key:
        return ""
    return form["form_name_en"] or key.replace("-", " ")


def descriptions(raw):
    seen = set()
    texts = []
    for entry in reversed(raw.get("flavor_text_entries", [])):
        if entry["language"]["name"] != "en":
            continue
        text = " ".join(entry["flavor_text"].split())
        if text.lower() not in seen:
            seen.add(text.lower())
            texts.append(text)
        if len(texts) == 3:
            break
    return texts


def jaccard_matrix(sets, rarity=False, reference=None):
    vocabulary = sorted(set().union(*sets))
    index = {value: i for i, value in enumerate(vocabulary)}
    matrix = np.zeros((len(sets), len(vocabulary)), dtype=np.float32)
    for row, values in enumerate(sets):
        for value in values:
            matrix[row, index[value]] = 1
    weights = np.ones(len(vocabulary), dtype=np.float32)
    if rarity:
        reference = reference or sets
        frequency = Counter(value for values in reference for value in values)
        weights = np.array([min(4, 1 + np.log((1 + len(reference)) / (1 + frequency[v])))
                            for v in vocabulary], dtype=np.float32)
    intersection = (matrix * weights) @ matrix.T
    total = (matrix * weights).sum(axis=1)
    union = total[:, None] + total[None, :] - intersection
    score = np.divide(intersection, union, out=np.zeros_like(union), where=union > 0)
    valid = (matrix.sum(axis=1) > 0)
    return score, valid[:, None] & valid[None, :]


def classification_for(species):
    if species["is_mythical"]:
        return "mythical"
    if species["key"] in TRAITS["majorLegendarySpecies"]:
        return "major-legendary"
    return "legendary" if species["is_legendary"] else "ordinary"


def motif_tags(text):
    return {tag for tag, pattern in MOTIF_PATTERNS.items() if pattern.search(text)}


def type_matrix(sets):
    score, valid = jaccard_matrix(sets)
    return np.where(score == 1, 1, np.where(score > 0, .6, 0)).astype(np.float32), valid


def classification_matrix(classes):
    classes = np.array(classes)
    special = classes != "ordinary"
    valid = special[:, None] | special[None, :]
    score = np.where(classes[:, None] == classes[None, :], 1., 0.)
    legendary = np.isin(classes, ["legendary", "major-legendary"])
    score = np.maximum(score, .65 * (legendary[:, None] & legendary[None, :]))
    score = np.maximum(score, .35 * (special[:, None] & special[None, :]))
    # Ordinary status alone is not evidence of similarity, nor a missing match.
    return (score * valid).astype(np.float32), valid


def stat_matrix(values):
    stats = np.array(values, dtype=np.float32)
    total = stats.sum(axis=1)
    power = np.exp(-np.abs(np.log(total[:, None] / total[None, :])) / .5)
    proportions = stats / total[:, None]
    role = np.exp(-np.mean(np.abs(proportions[:, None] - proportions[None, :]), axis=2) / .08)
    return (power + role) / 2


def load_data():
    with sqlite3.connect(f"file:{(ROOT / 'data/build/pokemon.db').as_posix()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        pokemon = {r["id"]: dict(r) for r in db.execute("SELECT * FROM pokemon")}
        species = {r["id"]: dict(r) for r in db.execute("SELECT * FROM pokemon_species")}
        forms = [dict(r) for r in db.execute("SELECT * FROM pokemon_forms ORDER BY id")]
        abilities = defaultdict(set)
        for row in db.execute("SELECT pokemon_id,ability_id FROM pokemon_abilities"):
            abilities[row[0]].add(row[1])
        moves = defaultdict(lambda: defaultdict(set))
        for row in db.execute("SELECT pokemon_id,version_group_key,move_id FROM pokemon_learnsets"):
            moves[row[0]][row[1]].add(row[2])
        types = [dict(r) for r in db.execute("SELECT id,key,name_ko AS name FROM types WHERE id<=18 ORDER BY id")]
    by_key = {p["key"]: p for p in pokemon.values()}
    default_forms = {f["pokemon_id"]: f for f in reversed(forms) if f["is_default"]}
    default = {p["species_id"]: p for p in pokemon.values() if p["is_default"]}
    selected_moves = {}
    for pid, versions in moves.items():
        version = next((v for v in VERSIONS if v in versions), None)
        if version:
            selected_moves[pid] = (versions[version], version, "own")
    for p in pokemon.values():
        if p["id"] in selected_moves:
            continue
        if "-mega" in p["key"] or p["key"].endswith("-gmax"):
            base_key = re.sub(r"-(mega(?:-[xyz])?|gmax)$", "", p["key"])
            base = by_key.get(base_key, default[p["species_id"]])
            if base["id"] in selected_moves:
                inherited, version, _ = selected_moves[base["id"]]
                selected_moves[p["id"]] = (inherited, version, "battle-form-base")
    raw_species = {sid: cached("pokemon-species", sid) for sid in species}
    unknown = set(TRAITS["majorLegendarySpecies"]) - {s["key"] for s in species.values()}
    if unknown:
        raise ValueError(f"Unknown classification species: {sorted(unknown)}")
    entries, profiles, features, sources = [], [], [], []
    for form in forms:
        p = pokemon[form["pokemon_id"]]
        s = species[p["species_id"]]
        raw = cached("pokemon-form", form["id"])
        label = form_label(form)
        parent_key = re.sub(r"-(mega(?:-[xyz])?|gmax)$", "", p["key"])
        if parent_key != p["key"] and parent_key in by_key:
            parent_form = default_forms.get(by_key[parent_key]["id"])
            parent_label = form_label(parent_form) if parent_form else ""
            if parent_label and parent_label not in label:
                label = f"{parent_label} · {label}"
        for region in ["alola", "galar", "hisui", "paldea"]:
            if region in form["key"].split("-") and FORM_LABELS[region] not in label:
                label = f"{FORM_LABELS[region]} · {label}"
        name = f"{s['name_ko']} ({label})" if label else s["name_ko"]
        type_ids = sorted(int(t["type"]["url"].rstrip("/").split("/")[-1]) for t in raw["types"])
        texts = descriptions(raw)
        source = "form" if texts else "species"
        texts = texts or descriptions(raw_species[s["id"]])
        classification = classification_for(s)
        # Regional/battle-form text takes precedence over species-wide lore.
        motifs = motif_tags(" ".join(texts))
        profile = " ".join(texts)
        # Names are search keys, not semantic evidence.
        for name_to_remove in [s["name_en"], s["key"], p["key"]]:
            profile = re.sub(re.escape(name_to_remove), "this creature", profile, flags=re.I)
        profile += f" Classification: {s['genus_en']}. Form: {form['form_key'] or 'ordinary'}."
        if s["shape"]:
            profile += f" Body shape: {s['shape']}."
        if p["is_default"] and s["color"]:
            profile += f" Main color: {s['color']}."
        profiles.append(profile)
        url = raw["sprites"].get("front_default")
        if not url and form["is_default"]:
            pokemon_raw = cached("pokemon", p["id"])
            url = pokemon_raw.get("sprites", {}).get("other", {}).get("official-artwork", {}).get("front_default")
        sources.append(url)
        learnt, version, move_source = selected_moves.get(p["id"], (set(), None, "missing"))
        entries.append({"id": form["id"], "pokemonId": p["id"], "speciesId": s["id"],
                        "key": form["key"], "name": name, "baseName": s["name_ko"],
                        "form": label, "english": form["key"].replace("-", " "),
                        "aliases": list(filter(None, [form["name_ko"], form["name_en"],
                                        form["form_name_ko"], label + s["name_ko"]])),
                        "types": type_ids, "moveVersion": version, "moveSource": move_source,
                        "descriptionSource": source if texts else "metadata",
                        "classification": classification, "motifs": sorted(motifs)})
        features.append({"types": set(type_ids), "abilities": abilities[p["id"]], "moves": learnt,
                         "eggGroups": set(filter(None, (s["egg_groups"] or "").split("|"))) - {"no-eggs", "ditto"},
                         "stats": [p[k] for k in ["hp", "attack", "defense", "special_attack", "special_defense", "speed"]],
                         "body": [p["height_dm"], p["weight_hg"]], "species": s["id"],
                         "classification": classification, "motifs": motifs, "hasDescription": bool(texts)})
    counts = Counter(e["name"] for e in entries)
    for entry in entries:
        if counts[entry["name"]] > 1:
            entry["name"] += f" [{entry['key']}]"
    return entries, profiles, features, sources, types, species, selected_moves


def semantic_matrix(profiles):
    from fastembed import TextEmbedding
    digest = hashlib.sha256((MODEL + json.dumps(profiles)).encode()).hexdigest()[:16]
    directory = ROOT / ".tools" / "embeddings"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{digest}.npy"
    if path.exists():
        vectors = np.load(path)
    else:
        print(f"Embedding {len(profiles)} profiles with {MODEL}", flush=True)
        model = TextEmbedding(model_name=MODEL, cache_dir=str(directory / "models"), threads=4)
        vectors = np.array(list(model.embed(profiles, batch_size=32)), dtype=np.float32)
        np.save(path, vectors)
    vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-8)
    return np.clip(vectors @ vectors.T, 0, 1)


def calculate(features, profiles, species, selected_moves):
    n = len(features)
    components = {"description": semantic_matrix(profiles)}
    masks = {}
    components["types"], masks["types"] = type_matrix([f["types"] for f in features])
    components["classification"], masks["classification"] = classification_matrix([f["classification"] for f in features])
    for key in ["abilities", "moves", "eggGroups", "motifs"]:
        components[key], masks[key] = jaccard_matrix(
            [f[key] for f in features], rarity=key == "moves",
            reference=[v[0] for v in selected_moves.values()] if key == "moves" else None)
    has_description = np.array([f["hasDescription"] for f in features])
    masks["motifs"] = has_description[:, None] & has_description[None, :]
    components["stats"] = stat_matrix([f["stats"] for f in features])
    body = np.array([f["body"] for f in features], dtype=np.float32)
    valid_body = np.all(body > 0, axis=1)
    logs = np.log(np.maximum(body, 1))
    components["body"] = np.exp(-np.mean(np.abs(logs[:, None] - logs[None, :]), axis=2))
    masks["body"] = valid_body[:, None] & valid_body[None, :]
    ancestors = {}
    for sid in species:
        path = {}
        current = sid
        while current and current not in path:
            path[current] = len(path)
            current = species[current]["evolves_from_species_id"]
        ancestors[sid] = path
    evolution = np.zeros((n, n), dtype=np.float32)
    for i, a in enumerate(features):
        ap = ancestors[a["species"]]
        for j in range(i, n):
            bp = ancestors[features[j]["species"]]
            common = ap.keys() & bp.keys()
            if common:
                distance = min(ap[k] + bp[k] for k in common)
                evolution[i, j] = evolution[j, i] = .78 ** distance
    components["evolution"] = evolution
    if set(components) != set(WEIGHTS) or sum(WEIGHTS.values()) != 100:
        raise ValueError("Every weighted feature must be calculated, with weights totaling 100")
    total, denominator = np.zeros((n, n), dtype=np.float32), np.zeros((n, n), dtype=np.float32)
    for key, weight in WEIGHTS.items():
        mask = masks.get(key, np.ones((n, n), dtype=bool))
        total += weight * components[key] * mask
        denominator += weight * mask
    raw = total / denominator
    if not np.all(np.isfinite(raw)):
        raise ValueError("Non-finite similarity score")
    # Matrix multiplication may differ by a final float bit across the diagonal.
    scores = np.minimum(np.rint((raw + raw.T) / 2 * 10000), 9990).astype("<u2")
    np.fill_diagonal(scores, 10000)
    assert np.array_equal(scores, scores.T)
    assert np.count_nonzero(scores == 10000) == n
    return scores


def sprite_bytes(url):
    if not url:
        return None
    directory = ROOT / ".tools" / "pokemantle-sprites"
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / (hashlib.sha256(url.encode()).hexdigest() + ".png")
    if destination.exists():
        return destination.read_bytes()
    match = re.search(r"/sprites/pokemon/(\d+)\.png$", url)
    existing = PUBLIC / "sprites" / f"{match[1]}.png" if match else None
    if existing and existing.exists():
        return existing.read_bytes()
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "PokemonSimilarityBuilder/1.0"})
            with urllib.request.urlopen(request, timeout=25) as response:
                data = response.read()
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
            destination.write_bytes(data)
            return data
        except Exception as error:
            if attempt == 2:
                print(f"Sprite unavailable: {url}: {error}", flush=True)
                return None
            time.sleep(attempt + 1)


def main():
    entries, profiles, features, sources, types, species, moves = load_data()
    print(f"Loaded {len(entries)} distinct forms", flush=True)
    scores = calculate(features, profiles, species, moves)
    print("Downloading and bundling local sprites", flush=True)
    unique_sources = list(dict.fromkeys(sources))
    with ThreadPoolExecutor(max_workers=12) as executor:
        image_data = dict(zip(unique_sources, executor.map(sprite_bytes, unique_sources)))
    images = {}
    missing = []
    for entry, url in zip(entries, sources):
        data = image_data[url]
        if data:
            key = hashlib.sha256(data).hexdigest()[:16]
            images[key] = "data:image/png;base64," + base64.b64encode(data).decode()
            entry["image"] = key
        else:
            entry["image"] = None
            missing.append(entry["key"])
    binary = scores.tobytes()
    # Answer scheduling and saved guess IDs remain compatible when only scores change.
    data = {"version": "pokemantle-v1", "similarityVersion": SIMILARITY_VERSION,
            "traitsVersion": TRAITS["version"], "model": MODEL, "weights": WEIGHTS,
            "matrixSha256": hashlib.sha256(binary).hexdigest(), "types": types,
            "pokemon": entries, "images": images, "missingImages": missing}
    (PUBLIC / "pokemantle.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PUBLIC / "pokemantle-scores.bin").write_bytes(binary)
    reports = []
    for key in ["pikachu", "vulpix", "vulpix-alola", "charizard", "charizard-mega-x",
                "tauros-paldea-aqua-breed", "necrozma-ultra", "latios", "mewtwo", "bulbasaur", "magikarp", "eevee"]:
        index = next(i for i, p in enumerate(entries) if p["key"] == key)
        closest = np.argsort(-scores[index].astype(int), kind="stable")[1:11]
        reports.append({"pokemon": entries[index]["name"], "neighbors": [{"name": entries[j]["name"], "score": int(scores[index, j]) / 100} for j in closest]})
    (ROOT / ".preview").mkdir(exist_ok=True)
    (ROOT / ".preview" / "similarity-report.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Built {len(entries)} forms; scores {len(binary):,} bytes; {len(missing)} missing sprites", flush=True)


if __name__ == "__main__":
    main()
