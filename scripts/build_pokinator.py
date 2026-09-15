"""Build a small question matrix from the read-only Pokemon master database."""

from collections import Counter
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import sqlite3

if __package__:
    from .pokinator_knowledge import compile_knowledge
else:
    from pokinator_knowledge import compile_knowledge

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "web" / "public"
CACHE = ROOT / "data" / "cache" / "pokeapi" / "pokemon-form"
REGIONS = {"alola": ("알로라", "Alolan"), "galar": ("가라르", "Galarian"),
           "hisui": ("히스이", "Hisuian"), "paldea": ("팔데아", "Paldean")}
COLORS = {"black": "검정", "blue": "파랑", "brown": "갈색", "gray": "회색",
          "green": "초록", "pink": "분홍", "purple": "보라", "red": "빨강",
          "white": "흰색", "yellow": "노랑"}
# Main-series first partners, including Let's Go, and fossil restoration species.
# https://pokemonletsgo.pokemon.com/en-us/story/
# https://www.pokemon.com/us/pokemon-news/fossil-pokemon-take-over-pokemon-gos-2023-adventure-week
# https://www.pokemon.com/uk/pokedex/dracovish
STARTERS = {1, 4, 7, 25, 133, 152, 155, 158, 252, 255, 258, 387, 390, 393,
            495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912}
FOSSILS = {138, 140, 142, 345, 347, 408, 410, 564, 566, 696, 698, 880, 881, 882, 883}
COMPATIBLE_DATA_VERSIONS = ["dd9a765f728dfe67", "4934f47e1cf1f700", "3ab0d55d49a841dc", "89201605a43b72b1"]
DEBUT_GAMES = {
    "red-green-japan": ("포켓몬스터 레드/그린", "Pokemon Red/Blue"),
    "gold-silver": ("포켓몬스터 금/은", "Pokemon Gold/Silver"),
    "ruby-sapphire": ("포켓몬스터 루비/사파이어", "Pokemon Ruby/Sapphire"),
    "diamond-pearl": ("포켓몬스터 다이아몬드/펄", "Pokemon Diamond/Pearl"),
    "black-white": ("포켓몬스터 블랙/화이트", "Pokemon Black/White"),
    "x-y": ("포켓몬스터 X/Y", "Pokemon X/Y"),
    "sun-moon": ("포켓몬스터 썬/문", "Pokemon Sun/Moon"),
    "ultra-sun-ultra-moon": ("포켓몬스터 울트라썬/울트라문", "Pokemon Ultra Sun/Ultra Moon"),
    "lets-go-pikachu-lets-go-eevee": ("포켓몬 GO·레츠고! 피카츄/이브이", "Pokemon GO / Let's Go Pikachu/Eevee"),
    "sword-shield": ("포켓몬스터 소드/실드", "Pokemon Sword/Shield"),
    "legends-arceus": ("포켓몬 레전드 아르세우스", "Pokemon Legends: Arceus"),
    "scarlet-violet": ("포켓몬스터 스칼렛/바이올렛", "Pokemon Scarlet/Violet"),
}


def candidate_kind(form, pokemon):
    if form["is_mega"]:
        return "mega"
    # Regional battle transformations and Totem/event variants are not new answers.
    parts = form["key"].split("-")
    if (form["is_default"] and not form["is_battle_only"]
            and not {"totem", "cap"}.intersection(parts)
            and any(region in parts for region in REGIONS)):
        return "regional"
    if form["is_default"] and pokemon["is_default"]:
        return "base"
    return None


def build():
    catalog = json.loads((PUBLIC / "pokemantle.json").read_text(encoding="utf-8"))
    clues = json.loads((PUBLIC / "pokeclue.json").read_text(encoding="utf-8"))
    if clues["catalogVersion"] != catalog["version"]:
        raise ValueError("Clues and catalog must use the same version")
    clue_by_id = {p["id"]: p for p in clues["pokemon"]}
    family_by_species = {p["speciesId"]: p["family"] for p in clues["pokemon"]}
    family_sizes = Counter(family_by_species.values())
    starter_families = {family_by_species[s] for s in STARTERS}
    fossil_families = {family_by_species[s] for s in FOSSILS}
    with sqlite3.connect(f"file:{(ROOT / 'data/build/pokemon.db').as_posix()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        species = {r["id"]: dict(r) for r in db.execute("SELECT * FROM pokemon_species")}
        pokemon = {r["id"]: dict(r) for r in db.execute("SELECT * FROM pokemon")}
        forms = {r["id"]: dict(r) for r in db.execute("SELECT * FROM pokemon_forms")}
    base_forms = {f["species_id"]: f for f in forms.values()
                  if candidate_kind(f, pokemon[f["pokemon_id"]]) == "base"}

    @lru_cache(None)
    def debut(form_id):
        form = forms[form_id]
        raw = json.loads((CACHE / f"{form_id}.json").read_text(encoding="utf-8"))
        if raw.get("id") != form_id or raw.get("name") != form["key"]:
            raise ValueError(f"Mismatched debut metadata: {form_id}")
        version = raw["version_group"]["name"]
        # Invisible evolution-pattern tags must not change the species' debut.
        version = {414: "diamond-pearl", 664: "x-y", 665: "x-y"}.get(form["species_id"], version)
        if version in {"the-teal-mask", "the-indigo-disk"}:
            version = "scarlet-violet"
        if version not in DEBUT_GAMES:
            raise ValueError(f"Missing debut question: {version}")
        return version

    type_ids = {t["key"]: t["id"] for t in catalog["types"]}

    @lru_cache(None)
    def past_types(pokemon_id, current):
        raw = json.loads((CACHE.parent / "pokemon" / f"{pokemon_id}.json").read_text(encoding="utf-8"))
        if raw.get("id") != pokemon_id:
            raise ValueError(f"Mismatched type history: {pokemon_id}")
        history = raw.get("past_types", [])
        if not history:
            return list(current)
        oldest = min(history, key=lambda h: int(h["generation"]["url"].rstrip("/").rsplit("/", 1)[-1]))
        return [type_ids[t["type"]["name"]] for t in oldest["types"]]

    rows, traits = [], []
    for entry in catalog["pokemon"]:
        form, p, s = forms[entry["id"]], pokemon[entry["pokemonId"]], species[entry["speciesId"]]
        kind = candidate_kind(form, p)
        if not kind:
            continue
        clue = clue_by_id[entry["id"]]
        region = next((r for r in REGIONS if r in entry["key"].split("-")), None)
        rows.append({"id": entry["id"], "speciesId": s["id"], "kind": kind,
                     "key": s["key"] if kind == "base" else entry["key"],
                     "name": s["name_ko"] if kind == "base" else entry["name"],
                     "english": s["name_en"] if kind == "base" else None})
        # Species-level appearance is not reliable for regional or Mega forms.
        traits.append({"kind": kind, "region": region, "types": entry["types"],
                       "pastTypes": past_types(entry["pokemonId"], tuple(entry["types"])),
                       "debut": debut(base_forms[s["id"]]["id"] if kind == "mega" else form["id"]),
                       "stage": clue["stage"],
                       "standalone": family_sizes[clue["family"]] == 1,
                       "starter": clue["family"] in starter_families,
                       "fossil": clue["family"] in fossil_families,
                       "rare": bool(s["is_legendary"] or s["is_mythical"]),
                       "mythical": bool(s["is_mythical"]), "baby": bool(s["is_baby"]),
                       "gender": s["gender_rate"], "bst": p["base_stat_total"] or None,
                       "height": p["height_dm"] or None, "weight": p["weight_hg"] or None,
                       "physical": p["attack"] > p["special_attack"] if p["attack"] and p["special_attack"] else None,
                       "speed": p["speed"] or None,
                       "color": s["color"] if kind == "base" else None,
                       "shape": s["shape"] if kind == "base" else None,
                       "abilities": [a["id"] for a in clue["abilities"]] or None,
                       "eggs": clue["eggGroups"] or None})
    base = [p["speciesId"] for p in rows if p["kind"] == "base"]
    if len(base) != len(species) or set(base) != set(species):
        raise ValueError("Every species must have exactly one base representative")
    questions = []

    def add(key, ko, en, group, predicate, ease=1.0, error=.05, after=0, expert=False, note=None):
        values = [predicate(p) for p in traits]
        if True not in values or False not in values:
            return
        historical = [predicate({**p, "types": p["pastTypes"]}) for p in traits] if group == "type" else None
        questions.append({"id": key, "ko": ko, "en": en, "group": group,
                          "ease": ease, "error": error, "after": after, "expert": expert,
                          **({"note": note} if note else {}),
                          **({"pastValues": "".join("1" if v else "0" for v in historical)} if historical is not None else {}),
                          "values": "".join("?" if v is None else "1" if v else "0" for v in values)})

    add("mega", "생각한 모습이 메가진화한 모습인가요?", "Are you thinking of a Mega Evolution?", "form", lambda p: p["kind"] == "mega", 1.3, .03)
    add("regional", "알로라·가라르·히스이·팔데아의 리전폼인가요?", "Is it an Alolan, Galarian, Hisuian or Paldean regional form?", "form", lambda p: p["kind"] == "regional", 1.2, .04)
    for region, (ko, en) in REGIONS.items():
        add(f"region-{region}", f"{ko}의 리전폼인가요?", f"Is it a {en} regional form?", "form", lambda p, r=region: p["region"] == r)
    add("dual-type", "타입을 두 가지 가지고 있나요?", "Does it have two types?", "type", lambda p: len(p["types"]) == 2, 1.25, .12)
    for item in catalog["types"]:
        add(f"type-{item['id']}", f"{item['name']} 타입이 포함되어 있나요?", f"Is {item['key'].title()} one of its types?", "type", lambda p, n=item["id"]: n in p["types"], 1.15, .12)
    add("rare", "전설의 포켓몬이나 환상의 포켓몬인가요?", "Is it a Legendary or Mythical Pokemon?", "rarity", lambda p: p["rare"], 1.2)
    add("mythical", "환상의 포켓몬인가요?", "Is it a Mythical Pokemon?", "rarity", lambda p: p["mythical"])
    add("evolved", "진화체인가요?", "Is it an evolved Pokemon?", "evolution", lambda p: p["stage"] > 1, 1.05, .09,
        note={"ko": "메가진화는 진화 단계로 세지 않아요.", "en": "Mega Evolution does not count as an evolution stage."})
    add("third-stage", "진화 계열의 세 번째 단계인가요?", "Is it the third stage of its evolution line?", "evolution", lambda p: p["stage"] >= 3, .75, .1, 4)
    add("baby", "베이비 포켓몬인가요?", "Is it a baby Pokemon?", "evolution", lambda p: p["baby"], .9, .07)
    add("standalone", "진화 계열이 없는 단독 포켓몬인가요?", "Is it a standalone Pokemon with no evolution relatives?", "evolution", lambda p: p["standalone"], 1.05, .09,
        note={"ko": "메가진화와 폼체인지는 제외해요.", "en": "Do not count Mega Evolutions or form changes."})
    add("starter-family", "스타팅 포켓몬의 진화 계열인가요?", "Does it belong to a first-partner Pokemon's evolution family?", "recognition", lambda p: p["starter"], 1.1, .09,
        note={"ko": "피카츄·이브이의 계열과 리전폼·메가진화도 포함해요.", "en": "Includes the Pikachu and Eevee families, regional forms and Mega Evolutions."})
    add("fossil-family", "화석에서 복원되는 포켓몬의 진화 계열인가요?", "Does it belong to a fossil Pokemon's evolution family?", "recognition", lambda p: p["fossil"], 1.0, .08,
        note={"ko": "화석에서 복원된 포켓몬과 그 진화체를 포함해요.", "en": "Includes restored fossil Pokemon and their evolutions."})
    for version, (ko, en) in DEBUT_GAMES.items():
        dlc = version in {"sword-shield", "scarlet-violet"}
        add(f"debut-{version}", f"{ko}에서 최초로 등장했나요?",
            f"Did it first appear in {en}?", "generation", lambda p, v=version: p["debut"] == v, .95, .1,
            note={"ko": ("추가 콘텐츠 포함 · " if dlc else "") + "메가진화는 원본 포켓몬 기준이에요.",
                  "en": ("Includes DLC. " if dlc else "") + "Use the original Pokemon for Mega Evolutions."})
    for color, ko in COLORS.items():
        add(f"color-{color}", f"몸의 주된 색이 {ko} 계열인가요?", f"Is its main body color {color}?", "appearance", lambda p, c=color: None if p["color"] is None else p["color"] == c, .95, .17)
    for key, ko, en, shapes in [
        ("four-legs", "네 발로 서 있는 형태인가요?", "Does it have a four-legged body shape?", {"quadruped"}),
        ("two-legs", "두 발로 서고 팔도 있는 형태인가요?", "Does it stand on two legs and have arms?", {"upright", "humanoid"}),
        ("wings", "날개가 있는 체형인가요?", "Does it have a winged body shape?", {"wings", "bug-wings"}),
        ("serpentine", "뱀처럼 길쭉한 체형인가요?", "Does it have a long, serpentine body?", {"squiggle"}),
        ("fins", "물고기처럼 지느러미가 있는 체형인가요?", "Does it have a fish-like body with fins?", {"fish"}),
        ("many-legs", "다리가 네 개보다 많은 체형인가요?", "Does its body have more than four legs?", {"armor", "tentacles"}),
    ]:
        add(key, ko, en, "appearance", lambda p, s=shapes: None if p["shape"] is None else p["shape"] in s, 1.0, .14)
    add("genderless", "성별이 없는 포켓몬인가요?", "Is it genderless?", "biology", lambda p: p["gender"] < 0, .8, .08, 4)
    add("one-gender", "수컷만 또는 암컷만 존재하나요?", "Does it exist only as male or only as female?", "biology", lambda p: p["gender"] in [0, 8], .7, .08, 4)
    for value in [5, 10, 20, 40]:
        add(f"height-{value}", f"도감상 키가 {value / 10:g}m 이상인가요?", f"Is its Pokedex height at least {value / 10:g} m?", "size", lambda p, v=value: None if p["height"] is None else p["height"] >= v, .6, .12, 16, True)
    for value in [100, 500, 1000, 3000]:
        add(f"weight-{value}", f"도감상 몸무게가 {value / 10:g}kg 이상인가요?", f"Is its Pokedex weight at least {value / 10:g} kg?", "size", lambda p, v=value: None if p["weight"] is None else p["weight"] >= v, .5, .12, 16, True)
    for value in [300, 450, 550, 600]:
        add(f"bst-{value}", f"종족값 합계가 {value} 이상인가요?", f"Is its base stat total at least {value}?", "stats", lambda p, v=value: None if p["bst"] is None else p["bst"] >= v, .5, .08, 7)
    add("physical", "공격 종족값이 특수공격보다 높은가요?", "Is its base Attack higher than its base Special Attack?", "stats", lambda p: p["physical"], .55, .1, 7)
    add("fast", "스피드 종족값이 100 이상인가요?", "Is its base Speed at least 100?", "stats", lambda p: None if p["speed"] is None else p["speed"] >= 100, .5, .1, 7)
    for group in clues["eggGroups"]:
        add(f"egg-{group['key']}", f"알 그룹에 '{group['name']}'이 포함되나요?", f"Does it belong to the {group['english']} Egg Group?", "eggs", lambda p, k=group["key"]: None if p["eggs"] is None else k in p["eggs"], .35, .08, 16, True)
    for ability in clues["abilities"]:
        count = sum(ability["id"] in (p["abilities"] or []) for p in traits)
        if count < 4:
            continue
        add(f"ability-{ability['id']}", f"숨겨진 특성을 포함해 '{ability['name']}' 특성을 가질 수 있나요?", f"Can it have {ability['english']}, including as a Hidden Ability?", "abilities", lambda p, n=ability["id"]: None if p["abilities"] is None else n in p["abilities"], .4, .07, 9)
    knowledge = json.loads((ROOT / "data/pokinator-knowledge.json").read_text(encoding="utf-8"))
    questions.extend(compile_knowledge(knowledge, rows, {key: s["key"] for key, s in species.items()}))
    data = {"version": "pokinator-v2", "policy": "base-regional-mega-v1", "catalogVersion": catalog["version"],
            "compatibleDataVersions": COMPATIBLE_DATA_VERSIONS,
            "pokemon": rows, "questions": questions, "counts": dict(Counter(p["kind"] for p in rows))}
    data["dataVersion"] = hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    return data


if __name__ == "__main__":
    data = build()
    (PUBLIC / "pokinator.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Pokinator: {len(data['pokemon'])} candidates, {len(data['questions'])} questions; {data['counts']}")
