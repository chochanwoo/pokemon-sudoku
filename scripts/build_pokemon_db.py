#!/usr/bin/env python3
"""
Build a Pokemon reference database from PokeAPI.

Outputs:
  data/cache/pokeapi/      Raw API JSON cache for repeatable rebuilds
  data/source/*.csv        Human-readable source tables
  data/build/pokemon.db    SQLite database for game/runtime use

This script intentionally uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache" / "pokeapi"
SOURCE_DIR = DATA_DIR / "source"
BUILD_DIR = DATA_DIR / "build"
DB_PATH = BUILD_DIR / "pokemon.db"

BASE_URL = "https://pokeapi.co/api/v2"
USER_AGENT = "PokemonFanGameDbBuilder/1.0 (+local codex workspace)"

LIST_ENDPOINTS = [
    "generation",
    "version-group",
    "type",
    "stat",
    "gender",
    "pokemon-species",
    "pokemon",
    "move",
    "ability",
    "machine",
]


def api_url(endpoint: str, resource_id: str | int | None = None) -> str:
    if resource_id is None:
        return f"{BASE_URL}/{endpoint}?limit=100000&offset=0"
    return f"{BASE_URL}/{endpoint}/{resource_id}"


def ensure_dirs() -> None:
    for path in (CACHE_DIR, SOURCE_DIR, BUILD_DIR):
        path.mkdir(parents=True, exist_ok=True)


def cache_path_for_url(url: str) -> Path:
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 3 and parts[0] == "api" and parts[1] == "v2":
        endpoint = parts[2]
        resource = parts[3] if len(parts) > 3 else "_list"
    else:
        endpoint = "misc"
        resource = re.sub(r"[^A-Za-z0-9_.-]+", "_", url)
    return CACHE_DIR / endpoint / f"{resource}.json"


def fetch_json(url: str, *, refresh: bool = False) -> dict[str, Any]:
    path = cache_path_for_url(url)
    if path.exists() and not refresh:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    path.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            tmp_path = path.with_suffix(".tmp")
            with tmp_path.open("w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
            os.replace(tmp_path, path)
            return data
        except HTTPError as exc:
            last_error = exc
            if exc.code == 429:
                time.sleep(2 + attempt * 2)
            elif exc.code >= 500:
                time.sleep(1 + attempt)
            else:
                raise
        except (URLError, TimeoutError) as exc:
            last_error = exc
            time.sleep(1 + attempt)
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def fetch_list(endpoint: str, *, refresh: bool = False) -> list[dict[str, str]]:
    data = fetch_json(api_url(endpoint), refresh=refresh)
    return data["results"]


def fetch_many(
    resources: list[dict[str, str]],
    *,
    refresh: bool,
    workers: int,
    label: str,
) -> list[dict[str, Any]]:
    total = len(resources)
    output: list[dict[str, Any]] = []
    if total == 0:
        return output

    print(f"Fetching {label}: {total} resources", flush=True)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(fetch_json, resource["url"], refresh=refresh): resource
            for resource in resources
        }
        done = 0
        for future in as_completed(futures):
            output.append(future.result())
            done += 1
            if done == total or done % 100 == 0:
                print(f"  {label}: {done}/{total}", flush=True)
    return output


def resource_id(resource: dict[str, Any] | None) -> int | None:
    if not resource:
        return None
    url = resource.get("url")
    if not url:
        return None
    parts = [p for p in urlparse(url).path.split("/") if p]
    if not parts:
        return None
    try:
        return int(parts[-1])
    except ValueError:
        return None


def resource_key(resource: dict[str, Any] | None) -> str | None:
    if not resource:
        return None
    return resource.get("name")


def localized_name(
    names: list[dict[str, Any]] | None,
    lang: str,
    fallback_lang: str = "en",
    fallback: str = "",
) -> str:
    if not names:
        return fallback
    for entry in names:
        if entry.get("language", {}).get("name") == lang:
            return entry.get("name", fallback)
    for entry in names:
        if entry.get("language", {}).get("name") == fallback_lang:
            return entry.get("name", fallback)
    return names[0].get("name", fallback)


def effect_entry(
    entries: list[dict[str, Any]] | None,
    lang: str = "en",
    key: str = "short_effect",
) -> str:
    if not entries:
        return ""
    for entry in entries:
        if entry.get("language", {}).get("name") == lang:
            return entry.get(key) or entry.get("effect") or ""
    return entries[0].get(key) or entries[0].get("effect") or ""


def csv_scalar(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float, str)):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({name: csv_scalar(row.get(name)) for name in fieldnames})


def one_or_none(mapping: dict[int, dict[str, Any]], item_id: int | None) -> dict[str, Any] | None:
    if item_id is None:
        return None
    return mapping.get(item_id)


def gender_ratios(gender_rate: int | None) -> tuple[float | None, float | None, str]:
    if gender_rate is None or gender_rate < 0:
        return None, None, "genderless"
    female = gender_rate / 8 * 100
    male = 100 - female
    return male, female, f"male {male:g}% / female {female:g}%"


def national_dex_number(species: dict[str, Any]) -> int:
    for entry in species.get("pokedex_numbers", []):
        if entry.get("pokedex", {}).get("name") == "national":
            return entry.get("entry_number")
    return species["id"]


def extract_stats(pokemon: dict[str, Any]) -> dict[str, int | None]:
    output = {
        "hp": None,
        "attack": None,
        "defense": None,
        "special_attack": None,
        "special_defense": None,
        "speed": None,
    }
    aliases = {
        "hp": "hp",
        "attack": "attack",
        "defense": "defense",
        "special-attack": "special_attack",
        "special-defense": "special_defense",
        "speed": "speed",
    }
    for item in pokemon.get("stats", []):
        key = item.get("stat", {}).get("name")
        if key in aliases:
            output[aliases[key]] = item.get("base_stat")
    return output


def clean_effect_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("$effect_chance", "{effect_chance}")).strip()


def flatten_evolution_chains(chains: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def collect(chain_id: int, node: dict[str, Any], depth: int) -> None:
        from_species = node.get("species")
        from_id = resource_id(from_species)
        from_key = resource_key(from_species)
        for child in node.get("evolves_to", []):
            to_species = child.get("species")
            to_id = resource_id(to_species)
            to_key = resource_key(to_species)
            details = child.get("evolution_details") or [{}]
            for detail in details:
                rows.append(
                    {
                        "chain_id": chain_id,
                        "depth": depth,
                        "from_species_id": from_id,
                        "from_species_key": from_key,
                        "to_species_id": to_id,
                        "to_species_key": to_key,
                        "trigger": resource_key(detail.get("trigger")),
                        "item_id": resource_id(detail.get("item")),
                        "item_key": resource_key(detail.get("item")),
                        "gender_id": detail.get("gender"),
                        "held_item_id": resource_id(detail.get("held_item")),
                        "held_item_key": resource_key(detail.get("held_item")),
                        "known_move_id": resource_id(detail.get("known_move")),
                        "known_move_key": resource_key(detail.get("known_move")),
                        "known_move_type_id": resource_id(detail.get("known_move_type")),
                        "known_move_type_key": resource_key(detail.get("known_move_type")),
                        "location_key": resource_key(detail.get("location")),
                        "min_level": detail.get("min_level"),
                        "min_happiness": detail.get("min_happiness"),
                        "min_beauty": detail.get("min_beauty"),
                        "min_affection": detail.get("min_affection"),
                        "needs_overworld_rain": detail.get("needs_overworld_rain"),
                        "party_species_id": resource_id(detail.get("party_species")),
                        "party_species_key": resource_key(detail.get("party_species")),
                        "party_type_id": resource_id(detail.get("party_type")),
                        "party_type_key": resource_key(detail.get("party_type")),
                        "relative_physical_stats": detail.get("relative_physical_stats"),
                        "time_of_day": detail.get("time_of_day"),
                        "trade_species_id": resource_id(detail.get("trade_species")),
                        "trade_species_key": resource_key(detail.get("trade_species")),
                        "turn_upside_down": detail.get("turn_upside_down"),
                        "raw_conditions_json": detail,
                    }
                )
            collect(chain_id, child, depth + 1)

    for chain in chains:
        collect(chain["id"], chain["chain"], 1)
    rows.sort(key=lambda r: (r["chain_id"], r["depth"], r["from_species_id"] or 0, r["to_species_id"] or 0))
    return rows


def build_evolution_summary(row: dict[str, Any]) -> str:
    parts = [row.get("trigger") or "unknown"]
    for key in [
        "min_level",
        "item_key",
        "held_item_key",
        "known_move_key",
        "known_move_type_key",
        "location_key",
        "min_happiness",
        "min_beauty",
        "min_affection",
        "party_species_key",
        "party_type_key",
        "relative_physical_stats",
        "time_of_day",
        "trade_species_key",
    ]:
        value = row.get(key)
        if value not in (None, ""):
            parts.append(f"{key}={value}")
    if row.get("needs_overworld_rain"):
        parts.append("rain=true")
    if row.get("turn_upside_down"):
        parts.append("upside_down=true")
    return ", ".join(str(part) for part in parts)


def build_rows(
    data: dict[str, list[dict[str, Any]]],
    *,
    fetched_at: str,
) -> dict[str, list[dict[str, Any]]]:
    generations = sorted(data["generation"], key=lambda x: x["id"])
    version_groups = sorted(data["version-group"], key=lambda x: x["id"])
    types = sorted(data["type"], key=lambda x: x["id"])
    stats = sorted(data["stat"], key=lambda x: x["id"])
    genders = sorted(data["gender"], key=lambda x: x["id"])
    species = sorted(data["pokemon-species"], key=lambda x: x["id"])
    pokemon = sorted(data["pokemon"], key=lambda x: x["id"])
    moves = sorted(data["move"], key=lambda x: x["id"])
    abilities = sorted(data["ability"], key=lambda x: x["id"])
    machines = sorted(data["machine"], key=lambda x: x["id"])
    forms = sorted(data.get("pokemon-form", []), key=lambda x: x["id"])
    items = sorted(data.get("item", []), key=lambda x: x["id"])
    evolution_chains = sorted(data.get("evolution-chain", []), key=lambda x: x["id"])

    species_by_id = {item["id"]: item for item in species}
    pokemon_by_id = {item["id"]: item for item in pokemon}
    moves_by_id = {item["id"]: item for item in moves}
    abilities_by_id = {item["id"]: item for item in abilities}
    types_by_id = {item["id"]: item for item in types}
    items_by_id = {item["id"]: item for item in items}
    generation_id_by_key = {item["name"]: item["id"] for item in generations}

    generation_rows = [
        {
            "id": item["id"],
            "key": item["name"],
            "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
            "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
            "main_region_key": resource_key(item.get("main_region")),
        }
        for item in generations
    ]

    version_group_rows = [
        {
            "id": item["id"],
            "key": item["name"],
            "order_index": item.get("order"),
            "generation_id": resource_id(item.get("generation")),
            "generation_key": resource_key(item.get("generation")),
        }
        for item in version_groups
    ]

    type_rows = [
        {
            "id": item["id"],
            "key": item["name"],
            "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
            "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
            "generation_id": resource_id(item.get("generation")),
        }
        for item in types
    ]

    type_effectiveness_rows: list[dict[str, Any]] = []
    type_ids = [item["id"] for item in types]
    for attack in types:
        multipliers = {defense_id: 1.0 for defense_id in type_ids}
        rel = attack.get("damage_relations", {})
        for item in rel.get("no_damage_to", []):
            rid = resource_id(item)
            if rid in multipliers:
                multipliers[rid] = 0.0
        for item in rel.get("half_damage_to", []):
            rid = resource_id(item)
            if rid in multipliers:
                multipliers[rid] = 0.5
        for item in rel.get("double_damage_to", []):
            rid = resource_id(item)
            if rid in multipliers:
                multipliers[rid] = 2.0
        for defense_id, multiplier in sorted(multipliers.items()):
            type_effectiveness_rows.append(
                {
                    "attacking_type_id": attack["id"],
                    "attacking_type_key": attack["name"],
                    "defending_type_id": defense_id,
                    "defending_type_key": types_by_id[defense_id]["name"],
                    "multiplier": multiplier,
                }
            )

    stat_rows = [
        {
            "id": item["id"],
            "key": item["name"],
            "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
            "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
            "is_battle_only": item.get("is_battle_only"),
        }
        for item in stats
    ]

    gender_rows = [
        {
            "id": item["id"],
            "key": item["name"],
            "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
            "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
        }
        for item in genders
    ]

    species_rows: list[dict[str, Any]] = []
    for item in species:
        male, female, gender_text = gender_ratios(item.get("gender_rate"))
        species_rows.append(
            {
                "id": item["id"],
                "key": item["name"],
                "national_dex_number": national_dex_number(item),
                "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
                "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
                "genus_en": localized_name(item.get("genera"), "en"),
                "genus_ko": localized_name(item.get("genera"), "ko"),
                "generation_id": resource_id(item.get("generation")),
                "generation_key": resource_key(item.get("generation")),
                "evolution_chain_id": resource_id(item.get("evolution_chain")),
                "evolves_from_species_id": resource_id(item.get("evolves_from_species")),
                "evolves_from_species_key": resource_key(item.get("evolves_from_species")),
                "gender_rate": item.get("gender_rate"),
                "male_ratio": male,
                "female_ratio": female,
                "gender_text": gender_text,
                "capture_rate": item.get("capture_rate"),
                "base_happiness": item.get("base_happiness"),
                "hatch_counter": item.get("hatch_counter"),
                "growth_rate": resource_key(item.get("growth_rate")),
                "color": resource_key(item.get("color")),
                "shape": resource_key(item.get("shape")),
                "habitat": resource_key(item.get("habitat")),
                "is_baby": item.get("is_baby"),
                "is_legendary": item.get("is_legendary"),
                "is_mythical": item.get("is_mythical"),
                "has_gender_differences": item.get("has_gender_differences"),
                "forms_switchable": item.get("forms_switchable"),
                "egg_groups": "|".join(resource_key(group) or "" for group in item.get("egg_groups", [])),
            }
        )

    species_row_by_id = {row["id"]: row for row in species_rows}

    pokemon_rows: list[dict[str, Any]] = []
    pokemon_type_rows: list[dict[str, Any]] = []
    pokemon_ability_rows: list[dict[str, Any]] = []
    learnset_rows: list[dict[str, Any]] = []
    for item in pokemon:
        sid = resource_id(item.get("species"))
        species_item = species_by_id.get(sid) if sid else None
        stats_values = extract_stats(item)
        row = {
            "id": item["id"],
            "key": item["name"],
            "species_id": sid,
            "species_key": resource_key(item.get("species")),
            "national_dex_number": national_dex_number(species_item) if species_item else None,
            "name_en": localized_name(species_item.get("names") if species_item else None, "en", fallback=item["name"]),
            "name_ko": localized_name(species_item.get("names") if species_item else None, "ko", fallback=item["name"]),
            "is_default": item.get("is_default"),
            "sort_order": item.get("order"),
            "height_dm": item.get("height"),
            "weight_hg": item.get("weight"),
            "base_experience": item.get("base_experience"),
            "sprite_front_default": item.get("sprites", {}).get("front_default"),
            **stats_values,
        }
        row["base_stat_total"] = sum(value or 0 for value in stats_values.values())
        pokemon_rows.append(row)

        for type_entry in item.get("types", []):
            pokemon_type_rows.append(
                {
                    "pokemon_id": item["id"],
                    "pokemon_key": item["name"],
                    "type_id": resource_id(type_entry.get("type")),
                    "type_key": resource_key(type_entry.get("type")),
                    "slot": type_entry.get("slot"),
                }
            )

        for ability_entry in item.get("abilities", []):
            ability_id = resource_id(ability_entry.get("ability"))
            pokemon_ability_rows.append(
                {
                    "pokemon_id": item["id"],
                    "pokemon_key": item["name"],
                    "ability_id": ability_id,
                    "ability_key": resource_key(ability_entry.get("ability")),
                    "slot": ability_entry.get("slot"),
                    "is_hidden": ability_entry.get("is_hidden"),
                }
            )

        for move_entry in item.get("moves", []):
            move_id = resource_id(move_entry.get("move"))
            for detail in move_entry.get("version_group_details", []):
                learnset_rows.append(
                    {
                        "pokemon_id": item["id"],
                        "pokemon_key": item["name"],
                        "species_id": sid,
                        "species_key": resource_key(item.get("species")),
                        "move_id": move_id,
                        "move_key": resource_key(move_entry.get("move")),
                        "version_group_id": resource_id(detail.get("version_group")),
                        "version_group_key": resource_key(detail.get("version_group")),
                        "learn_method": resource_key(detail.get("move_learn_method")),
                        "level": detail.get("level_learned_at"),
                        "order_index": None,
                    }
                )

    learnset_rows.sort(
        key=lambda r: (
            r["pokemon_id"] or 0,
            r["version_group_id"] or 0,
            r["learn_method"] or "",
            r["level"] or 0,
            r["move_id"] or 0,
        )
    )
    for idx, row in enumerate(learnset_rows, start=1):
        row["id"] = idx

    form_rows = []
    for item in forms:
        pid = resource_id(item.get("pokemon"))
        pokemon_item = pokemon_by_id.get(pid) if pid else None
        sid = resource_id(pokemon_item.get("species")) if pokemon_item else None
        form_rows.append(
            {
                "id": item["id"],
                "key": item["name"],
                "pokemon_id": pid,
                "pokemon_key": resource_key(item.get("pokemon")),
                "species_id": sid,
                "form_key": item.get("form_name"),
                "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
                "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
                "form_name_en": localized_name(item.get("form_names"), "en", fallback=item.get("form_name") or ""),
                "form_name_ko": localized_name(item.get("form_names"), "ko", fallback=item.get("form_name") or ""),
                "is_default": item.get("is_default"),
                "is_battle_only": item.get("is_battle_only"),
                "is_mega": item.get("is_mega"),
                "form_order": item.get("form_order"),
                "sort_order": item.get("order"),
            }
        )

    ability_rows = [
        {
            "id": item["id"],
            "key": item["name"],
            "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
            "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
            "generation_id": resource_id(item.get("generation")),
            "is_main_series": item.get("is_main_series"),
            "effect_short_en": clean_effect_text(effect_entry(item.get("effect_entries"), "en", "short_effect")),
        }
        for item in abilities
    ]

    move_rows = []
    for item in moves:
        meta = item.get("meta") or {}
        move_rows.append(
            {
                "id": item["id"],
                "key": item["name"],
                "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
                "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
                "type_id": resource_id(item.get("type")),
                "type_key": resource_key(item.get("type")),
                "damage_class": resource_key(item.get("damage_class")),
                "power": item.get("power"),
                "accuracy": item.get("accuracy"),
                "pp": item.get("pp"),
                "priority": item.get("priority"),
                "effect_chance": item.get("effect_chance"),
                "target": resource_key(item.get("target")),
                "generation_id": resource_id(item.get("generation")),
                "generation_key": resource_key(item.get("generation")),
                "contest_type": resource_key(item.get("contest_type")),
                "meta_ailment": resource_key(meta.get("ailment")),
                "meta_category": resource_key(meta.get("category")),
                "meta_min_hits": meta.get("min_hits"),
                "meta_max_hits": meta.get("max_hits"),
                "meta_min_turns": meta.get("min_turns"),
                "meta_max_turns": meta.get("max_turns"),
                "meta_drain": meta.get("drain"),
                "meta_healing": meta.get("healing"),
                "meta_crit_rate": meta.get("crit_rate"),
                "meta_ailment_chance": meta.get("ailment_chance"),
                "meta_flinch_chance": meta.get("flinch_chance"),
                "meta_stat_chance": meta.get("stat_chance"),
                "effect_short_en": clean_effect_text(effect_entry(item.get("effect_entries"), "en", "short_effect")),
            }
        )

    machine_rows = []
    for item in machines:
        item_id = resource_id(item.get("item"))
        move_id = resource_id(item.get("move"))
        item_detail = one_or_none(items_by_id, item_id)
        move_detail = one_or_none(moves_by_id, move_id)
        machine_rows.append(
            {
                "id": item["id"],
                "item_id": item_id,
                "item_key": resource_key(item.get("item")),
                "item_name_en": localized_name(item_detail.get("names") if item_detail else None, "en", fallback=resource_key(item.get("item")) or ""),
                "item_name_ko": localized_name(item_detail.get("names") if item_detail else None, "ko", fallback=resource_key(item.get("item")) or ""),
                "move_id": move_id,
                "move_key": resource_key(item.get("move")),
                "move_name_en": localized_name(move_detail.get("names") if move_detail else None, "en", fallback=resource_key(item.get("move")) or ""),
                "move_name_ko": localized_name(move_detail.get("names") if move_detail else None, "ko", fallback=resource_key(item.get("move")) or ""),
                "version_group_id": resource_id(item.get("version_group")),
                "version_group_key": resource_key(item.get("version_group")),
            }
        )

    evolution_rows = flatten_evolution_chains(evolution_chains)
    move_ids_by_key = {item["name"]: item["id"] for item in moves}
    type_ids_by_key = {item["name"]: item["id"] for item in types}
    item_ids_by_key = {item["name"]: item["id"] for item in items}
    for idx, row in enumerate(evolution_rows, start=1):
        row["id"] = idx
        row["summary"] = build_evolution_summary(row)
        for key_name in ("item", "held_item"):
            item_key = row.get(f"{key_name}_key")
            if item_key and not row.get(f"{key_name}_id"):
                row[f"{key_name}_id"] = item_ids_by_key.get(item_key)
        if row.get("known_move_key") and not row.get("known_move_id"):
            row["known_move_id"] = move_ids_by_key.get(row["known_move_key"])
        if row.get("known_move_type_key") and not row.get("known_move_type_id"):
            row["known_move_type_id"] = type_ids_by_key.get(row["known_move_type_key"])

    item_rows = [
        {
            "id": item["id"],
            "key": item["name"],
            "name_en": localized_name(item.get("names"), "en", fallback=item["name"]),
            "name_ko": localized_name(item.get("names"), "ko", fallback=item["name"]),
            "category": resource_key(item.get("category")),
            "cost": item.get("cost"),
            "fling_power": item.get("fling_power"),
            "fling_effect": resource_key(item.get("fling_effect")),
        }
        for item in items
    ]

    types_by_pokemon: dict[int, list[str]] = {}
    for row in pokemon_type_rows:
        types_by_pokemon.setdefault(row["pokemon_id"], []).append(row["type_key"])

    abilities_by_pokemon: dict[int, list[str]] = {}
    for row in pokemon_ability_rows:
        label = row["ability_key"] or ""
        if row.get("is_hidden"):
            label += " (hidden)"
        abilities_by_pokemon.setdefault(row["pokemon_id"], []).append(label)

    evolutions_from_species: dict[int, list[str]] = {}
    for row in evolution_rows:
        from_id = row.get("from_species_id")
        if from_id:
            evolutions_from_species.setdefault(from_id, []).append(
                f"{row.get('to_species_key')} [{row.get('summary')}]"
            )

    version_group_order_by_id = {
        row["id"]: row.get("order_index") if row.get("order_index") is not None else row["id"]
        for row in version_group_rows
    }
    latest_learnset_version: dict[tuple[int, str], tuple[int, int]] = {}
    for row in learnset_rows:
        key = (row["pokemon_id"], row.get("learn_method") or "unknown")
        version_group_id = row.get("version_group_id") or 0
        version_order = version_group_order_by_id.get(version_group_id, version_group_id)
        current = latest_learnset_version.get(key)
        if current is None or (version_order, version_group_id) > current:
            latest_learnset_version[key] = (version_order, version_group_id)

    version_group_key_by_id = {row["id"]: row["key"] for row in version_group_rows}
    learnset_summary: dict[tuple[int, str], list[str]] = {}
    for row in learnset_rows:
        method = row.get("learn_method") or "unknown"
        latest_pair = latest_learnset_version.get((row["pokemon_id"], method))
        latest_for_method = latest_pair[1] if latest_pair else None
        if latest_for_method and row.get("version_group_id") != latest_for_method:
            continue
        move = moves_by_id.get(row.get("move_id") or -1)
        move_name = localized_name(move.get("names") if move else None, "ko", fallback=row.get("move_key") or "")
        if method == "level-up":
            label = f"{row.get('level')}: {move_name}"
        else:
            label = move_name
        learnset_summary.setdefault((row["pokemon_id"], method), []).append(label)

    catalog_rows: list[dict[str, Any]] = []
    for row in pokemon_rows:
        pid = row["id"]
        evolution_labels = sorted(set(evolutions_from_species.get(row["species_id"], [])))
        catalog_rows.append(
            {
                "national_dex_number": row["national_dex_number"],
                "pokemon_id": pid,
                "species_key": row["species_key"],
                "pokemon_key": row["key"],
                "name_ko": row["name_ko"],
                "name_en": row["name_en"],
                "types": "|".join(types_by_pokemon.get(pid, [])),
                "abilities": "|".join(abilities_by_pokemon.get(pid, [])),
                "gender_text": species_row_by_id.get(row["species_id"], {}).get("gender_text", ""),
                "hp": row["hp"],
                "attack": row["attack"],
                "defense": row["defense"],
                "special_attack": row["special_attack"],
                "special_defense": row["special_defense"],
                "speed": row["speed"],
                "base_stat_total": row["base_stat_total"],
                "level_up_version_group": version_group_key_by_id.get(
                    latest_learnset_version.get((pid, "level-up"), (None, None))[1]
                ),
                "latest_level_up_moves": " | ".join(learnset_summary.get((pid, "level-up"), [])),
                "machine_version_group": version_group_key_by_id.get(
                    latest_learnset_version.get((pid, "machine"), (None, None))[1]
                ),
                "latest_machine_moves": " | ".join(learnset_summary.get((pid, "machine"), [])),
                "tutor_version_group": version_group_key_by_id.get(
                    latest_learnset_version.get((pid, "tutor"), (None, None))[1]
                ),
                "latest_tutor_moves": " | ".join(learnset_summary.get((pid, "tutor"), [])),
                "evolutions_from_here": " | ".join(evolution_labels),
            }
        )

    metadata_rows = [
        {"key": "source", "value": "PokeAPI v2"},
        {"key": "source_url", "value": BASE_URL},
        {"key": "fetched_at_utc", "value": fetched_at},
        {"key": "pokemon_count", "value": str(len(pokemon_rows))},
        {"key": "species_count", "value": str(len(species_rows))},
        {"key": "move_count", "value": str(len(move_rows))},
        {"key": "ability_count", "value": str(len(ability_rows))},
        {"key": "evolution_count", "value": str(len(evolution_rows))},
        {"key": "machine_count", "value": str(len(machine_rows))},
        {"key": "note", "value": "SQLite is generated from CSV/source rows; rebuild with scripts/build_pokemon_db.py."},
    ]

    return {
        "metadata": metadata_rows,
        "generations": generation_rows,
        "version_groups": version_group_rows,
        "types": type_rows,
        "type_effectiveness": type_effectiveness_rows,
        "stats": stat_rows,
        "genders": gender_rows,
        "pokemon_species": species_rows,
        "pokemon": pokemon_rows,
        "pokemon_forms": form_rows,
        "pokemon_types": pokemon_type_rows,
        "abilities": ability_rows,
        "pokemon_abilities": pokemon_ability_rows,
        "moves": move_rows,
        "pokemon_learnsets": learnset_rows,
        "machines": machine_rows,
        "items": item_rows,
        "evolutions": evolution_rows,
        "pokemon_catalog": catalog_rows,
    }


CSV_FIELDS: dict[str, list[str]] = {
    "metadata": ["key", "value"],
    "generations": ["id", "key", "name_en", "name_ko", "main_region_key"],
    "version_groups": ["id", "key", "order_index", "generation_id", "generation_key"],
    "types": ["id", "key", "name_en", "name_ko", "generation_id"],
    "type_effectiveness": [
        "attacking_type_id",
        "attacking_type_key",
        "defending_type_id",
        "defending_type_key",
        "multiplier",
    ],
    "stats": ["id", "key", "name_en", "name_ko", "is_battle_only"],
    "genders": ["id", "key", "name_en", "name_ko"],
    "pokemon_species": [
        "id",
        "key",
        "national_dex_number",
        "name_en",
        "name_ko",
        "genus_en",
        "genus_ko",
        "generation_id",
        "generation_key",
        "evolution_chain_id",
        "evolves_from_species_id",
        "evolves_from_species_key",
        "gender_rate",
        "male_ratio",
        "female_ratio",
        "gender_text",
        "capture_rate",
        "base_happiness",
        "hatch_counter",
        "growth_rate",
        "color",
        "shape",
        "habitat",
        "is_baby",
        "is_legendary",
        "is_mythical",
        "has_gender_differences",
        "forms_switchable",
        "egg_groups",
    ],
    "pokemon": [
        "id",
        "key",
        "species_id",
        "species_key",
        "national_dex_number",
        "name_en",
        "name_ko",
        "is_default",
        "sort_order",
        "height_dm",
        "weight_hg",
        "base_experience",
        "hp",
        "attack",
        "defense",
        "special_attack",
        "special_defense",
        "speed",
        "base_stat_total",
        "sprite_front_default",
    ],
    "pokemon_forms": [
        "id",
        "key",
        "pokemon_id",
        "pokemon_key",
        "species_id",
        "form_key",
        "name_en",
        "name_ko",
        "form_name_en",
        "form_name_ko",
        "is_default",
        "is_battle_only",
        "is_mega",
        "form_order",
        "sort_order",
    ],
    "pokemon_types": ["pokemon_id", "pokemon_key", "type_id", "type_key", "slot"],
    "abilities": [
        "id",
        "key",
        "name_en",
        "name_ko",
        "generation_id",
        "is_main_series",
        "effect_short_en",
    ],
    "pokemon_abilities": ["pokemon_id", "pokemon_key", "ability_id", "ability_key", "slot", "is_hidden"],
    "moves": [
        "id",
        "key",
        "name_en",
        "name_ko",
        "type_id",
        "type_key",
        "damage_class",
        "power",
        "accuracy",
        "pp",
        "priority",
        "effect_chance",
        "target",
        "generation_id",
        "generation_key",
        "contest_type",
        "meta_ailment",
        "meta_category",
        "meta_min_hits",
        "meta_max_hits",
        "meta_min_turns",
        "meta_max_turns",
        "meta_drain",
        "meta_healing",
        "meta_crit_rate",
        "meta_ailment_chance",
        "meta_flinch_chance",
        "meta_stat_chance",
        "effect_short_en",
    ],
    "pokemon_learnsets": [
        "id",
        "pokemon_id",
        "pokemon_key",
        "species_id",
        "species_key",
        "move_id",
        "move_key",
        "version_group_id",
        "version_group_key",
        "learn_method",
        "level",
        "order_index",
    ],
    "machines": [
        "id",
        "item_id",
        "item_key",
        "item_name_en",
        "item_name_ko",
        "move_id",
        "move_key",
        "move_name_en",
        "move_name_ko",
        "version_group_id",
        "version_group_key",
    ],
    "items": ["id", "key", "name_en", "name_ko", "category", "cost", "fling_power", "fling_effect"],
    "evolutions": [
        "id",
        "chain_id",
        "depth",
        "from_species_id",
        "from_species_key",
        "to_species_id",
        "to_species_key",
        "trigger",
        "summary",
        "item_id",
        "item_key",
        "gender_id",
        "held_item_id",
        "held_item_key",
        "known_move_id",
        "known_move_key",
        "known_move_type_id",
        "known_move_type_key",
        "location_key",
        "min_level",
        "min_happiness",
        "min_beauty",
        "min_affection",
        "needs_overworld_rain",
        "party_species_id",
        "party_species_key",
        "party_type_id",
        "party_type_key",
        "relative_physical_stats",
        "time_of_day",
        "trade_species_id",
        "trade_species_key",
        "turn_upside_down",
        "raw_conditions_json",
    ],
    "pokemon_catalog": [
        "national_dex_number",
        "pokemon_id",
        "species_key",
        "pokemon_key",
        "name_ko",
        "name_en",
        "types",
        "abilities",
        "gender_text",
        "hp",
        "attack",
        "defense",
        "special_attack",
        "special_defense",
        "speed",
        "base_stat_total",
        "level_up_version_group",
        "latest_level_up_moves",
        "machine_version_group",
        "latest_machine_moves",
        "tutor_version_group",
        "latest_tutor_moves",
        "evolutions_from_here",
    ],
}


CREATE_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE generations (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT,
  name_ko TEXT,
  main_region_key TEXT
);

CREATE TABLE version_groups (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  order_index INTEGER,
  generation_id INTEGER,
  generation_key TEXT,
  FOREIGN KEY (generation_id) REFERENCES generations(id)
);

CREATE TABLE types (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT,
  name_ko TEXT,
  generation_id INTEGER,
  FOREIGN KEY (generation_id) REFERENCES generations(id)
);

CREATE TABLE type_effectiveness (
  attacking_type_id INTEGER NOT NULL,
  attacking_type_key TEXT NOT NULL,
  defending_type_id INTEGER NOT NULL,
  defending_type_key TEXT NOT NULL,
  multiplier REAL NOT NULL,
  PRIMARY KEY (attacking_type_id, defending_type_id),
  FOREIGN KEY (attacking_type_id) REFERENCES types(id),
  FOREIGN KEY (defending_type_id) REFERENCES types(id)
);

CREATE TABLE stats (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT,
  name_ko TEXT,
  is_battle_only INTEGER
);

CREATE TABLE genders (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT,
  name_ko TEXT
);

CREATE TABLE pokemon_species (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  national_dex_number INTEGER,
  name_en TEXT,
  name_ko TEXT,
  genus_en TEXT,
  genus_ko TEXT,
  generation_id INTEGER,
  generation_key TEXT,
  evolution_chain_id INTEGER,
  evolves_from_species_id INTEGER,
  evolves_from_species_key TEXT,
  gender_rate INTEGER,
  male_ratio REAL,
  female_ratio REAL,
  gender_text TEXT,
  capture_rate INTEGER,
  base_happiness INTEGER,
  hatch_counter INTEGER,
  growth_rate TEXT,
  color TEXT,
  shape TEXT,
  habitat TEXT,
  is_baby INTEGER,
  is_legendary INTEGER,
  is_mythical INTEGER,
  has_gender_differences INTEGER,
  forms_switchable INTEGER,
  egg_groups TEXT,
  FOREIGN KEY (generation_id) REFERENCES generations(id),
  FOREIGN KEY (evolves_from_species_id) REFERENCES pokemon_species(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE pokemon (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  species_id INTEGER NOT NULL,
  species_key TEXT NOT NULL,
  national_dex_number INTEGER,
  name_en TEXT,
  name_ko TEXT,
  is_default INTEGER,
  sort_order INTEGER,
  height_dm INTEGER,
  weight_hg INTEGER,
  base_experience INTEGER,
  hp INTEGER,
  attack INTEGER,
  defense INTEGER,
  special_attack INTEGER,
  special_defense INTEGER,
  speed INTEGER,
  base_stat_total INTEGER,
  sprite_front_default TEXT,
  FOREIGN KEY (species_id) REFERENCES pokemon_species(id)
);

CREATE TABLE pokemon_forms (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  pokemon_id INTEGER,
  pokemon_key TEXT,
  species_id INTEGER,
  form_key TEXT,
  name_en TEXT,
  name_ko TEXT,
  form_name_en TEXT,
  form_name_ko TEXT,
  is_default INTEGER,
  is_battle_only INTEGER,
  is_mega INTEGER,
  form_order INTEGER,
  sort_order INTEGER,
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (species_id) REFERENCES pokemon_species(id)
);

CREATE TABLE pokemon_types (
  pokemon_id INTEGER NOT NULL,
  pokemon_key TEXT NOT NULL,
  type_id INTEGER NOT NULL,
  type_key TEXT NOT NULL,
  slot INTEGER NOT NULL,
  PRIMARY KEY (pokemon_id, slot),
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (type_id) REFERENCES types(id)
);

CREATE TABLE abilities (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT,
  name_ko TEXT,
  generation_id INTEGER,
  is_main_series INTEGER,
  effect_short_en TEXT,
  FOREIGN KEY (generation_id) REFERENCES generations(id)
);

CREATE TABLE pokemon_abilities (
  pokemon_id INTEGER NOT NULL,
  pokemon_key TEXT NOT NULL,
  ability_id INTEGER NOT NULL,
  ability_key TEXT NOT NULL,
  slot INTEGER NOT NULL,
  is_hidden INTEGER,
  PRIMARY KEY (pokemon_id, slot, ability_id),
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (ability_id) REFERENCES abilities(id)
);

CREATE TABLE moves (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT,
  name_ko TEXT,
  type_id INTEGER,
  type_key TEXT,
  damage_class TEXT,
  power INTEGER,
  accuracy INTEGER,
  pp INTEGER,
  priority INTEGER,
  effect_chance INTEGER,
  target TEXT,
  generation_id INTEGER,
  generation_key TEXT,
  contest_type TEXT,
  meta_ailment TEXT,
  meta_category TEXT,
  meta_min_hits INTEGER,
  meta_max_hits INTEGER,
  meta_min_turns INTEGER,
  meta_max_turns INTEGER,
  meta_drain INTEGER,
  meta_healing INTEGER,
  meta_crit_rate INTEGER,
  meta_ailment_chance INTEGER,
  meta_flinch_chance INTEGER,
  meta_stat_chance INTEGER,
  effect_short_en TEXT,
  FOREIGN KEY (type_id) REFERENCES types(id),
  FOREIGN KEY (generation_id) REFERENCES generations(id)
);

CREATE TABLE pokemon_learnsets (
  id INTEGER PRIMARY KEY,
  pokemon_id INTEGER NOT NULL,
  pokemon_key TEXT NOT NULL,
  species_id INTEGER,
  species_key TEXT,
  move_id INTEGER NOT NULL,
  move_key TEXT NOT NULL,
  version_group_id INTEGER NOT NULL,
  version_group_key TEXT NOT NULL,
  learn_method TEXT NOT NULL,
  level INTEGER,
  order_index INTEGER,
  FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
  FOREIGN KEY (species_id) REFERENCES pokemon_species(id),
  FOREIGN KEY (move_id) REFERENCES moves(id),
  FOREIGN KEY (version_group_id) REFERENCES version_groups(id)
);

CREATE TABLE machines (
  id INTEGER PRIMARY KEY,
  item_id INTEGER,
  item_key TEXT,
  item_name_en TEXT,
  item_name_ko TEXT,
  move_id INTEGER,
  move_key TEXT,
  move_name_en TEXT,
  move_name_ko TEXT,
  version_group_id INTEGER,
  version_group_key TEXT,
  FOREIGN KEY (move_id) REFERENCES moves(id),
  FOREIGN KEY (version_group_id) REFERENCES version_groups(id)
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT,
  name_ko TEXT,
  category TEXT,
  cost INTEGER,
  fling_power INTEGER,
  fling_effect TEXT
);

CREATE TABLE evolutions (
  id INTEGER PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  depth INTEGER NOT NULL,
  from_species_id INTEGER,
  from_species_key TEXT,
  to_species_id INTEGER NOT NULL,
  to_species_key TEXT NOT NULL,
  trigger TEXT,
  summary TEXT,
  item_id INTEGER,
  item_key TEXT,
  gender_id INTEGER,
  held_item_id INTEGER,
  held_item_key TEXT,
  known_move_id INTEGER,
  known_move_key TEXT,
  known_move_type_id INTEGER,
  known_move_type_key TEXT,
  location_key TEXT,
  min_level INTEGER,
  min_happiness INTEGER,
  min_beauty INTEGER,
  min_affection INTEGER,
  needs_overworld_rain INTEGER,
  party_species_id INTEGER,
  party_species_key TEXT,
  party_type_id INTEGER,
  party_type_key TEXT,
  relative_physical_stats INTEGER,
  time_of_day TEXT,
  trade_species_id INTEGER,
  trade_species_key TEXT,
  turn_upside_down INTEGER,
  raw_conditions_json TEXT,
  FOREIGN KEY (from_species_id) REFERENCES pokemon_species(id),
  FOREIGN KEY (to_species_id) REFERENCES pokemon_species(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (held_item_id) REFERENCES items(id),
  FOREIGN KEY (known_move_id) REFERENCES moves(id),
  FOREIGN KEY (known_move_type_id) REFERENCES types(id),
  FOREIGN KEY (party_species_id) REFERENCES pokemon_species(id),
  FOREIGN KEY (party_type_id) REFERENCES types(id),
  FOREIGN KEY (trade_species_id) REFERENCES pokemon_species(id)
);

CREATE INDEX idx_pokemon_species_id ON pokemon(species_id);
CREATE INDEX idx_pokemon_types_type ON pokemon_types(type_id);
CREATE INDEX idx_pokemon_abilities_ability ON pokemon_abilities(ability_id);
CREATE INDEX idx_moves_type ON moves(type_id);
CREATE INDEX idx_learnsets_pokemon ON pokemon_learnsets(pokemon_id);
CREATE INDEX idx_learnsets_move ON pokemon_learnsets(move_id);
CREATE INDEX idx_learnsets_method_version ON pokemon_learnsets(learn_method, version_group_id);
CREATE INDEX idx_evolutions_from ON evolutions(from_species_id);
CREATE INDEX idx_evolutions_to ON evolutions(to_species_id);

CREATE VIEW pokemon_catalog AS
SELECT
  p.national_dex_number,
  p.id AS pokemon_id,
  p.key AS pokemon_key,
  p.name_ko,
  p.name_en,
  GROUP_CONCAT(t.key, '|') AS types,
  p.hp,
  p.attack,
  p.defense,
  p.special_attack,
  p.special_defense,
  p.speed,
  p.base_stat_total,
  s.gender_text,
  s.growth_rate
FROM pokemon p
JOIN pokemon_species s ON s.id = p.species_id
LEFT JOIN pokemon_types pt ON pt.pokemon_id = p.id
LEFT JOIN types t ON t.id = pt.type_id
GROUP BY p.id;

CREATE VIEW level_up_moves AS
SELECT
  l.pokemon_id,
  l.pokemon_key,
  p.name_ko AS pokemon_name_ko,
  l.version_group_key,
  l.level,
  l.move_id,
  l.move_key,
  m.name_ko AS move_name_ko,
  m.type_key,
  m.damage_class,
  m.power,
  m.accuracy,
  m.pp
FROM pokemon_learnsets l
JOIN pokemon p ON p.id = l.pokemon_id
JOIN moves m ON m.id = l.move_id
WHERE l.learn_method = 'level-up'
ORDER BY l.pokemon_id, l.version_group_id, l.level, l.move_id;

CREATE VIEW machine_moves AS
SELECT
  l.pokemon_id,
  l.pokemon_key,
  p.name_ko AS pokemon_name_ko,
  l.version_group_key,
  l.move_id,
  l.move_key,
  m.name_ko AS move_name_ko,
  m.type_key,
  m.damage_class,
  m.power,
  m.accuracy,
  m.pp
FROM pokemon_learnsets l
JOIN pokemon p ON p.id = l.pokemon_id
JOIN moves m ON m.id = l.move_id
WHERE l.learn_method = 'machine'
ORDER BY l.pokemon_id, l.version_group_id, l.move_id;

CREATE VIEW tutor_moves AS
SELECT
  l.pokemon_id,
  l.pokemon_key,
  p.name_ko AS pokemon_name_ko,
  l.version_group_key,
  l.move_id,
  l.move_key,
  m.name_ko AS move_name_ko,
  m.type_key,
  m.damage_class,
  m.power,
  m.accuracy,
  m.pp
FROM pokemon_learnsets l
JOIN pokemon p ON p.id = l.pokemon_id
JOIN moves m ON m.id = l.move_id
WHERE l.learn_method = 'tutor'
ORDER BY l.pokemon_id, l.version_group_id, l.move_id;
"""


def db_value(value: Any) -> Any:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return value


def write_sqlite(rows_by_table: dict[str, list[dict[str, Any]]]) -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(CREATE_SQL)
        conn.execute("PRAGMA defer_foreign_keys = ON")
        for table, rows in rows_by_table.items():
            if table == "pokemon_catalog":
                continue
            if not rows:
                continue
            print(f"  inserting {table}: {len(rows)} rows", flush=True)
            fields = CSV_FIELDS[table]
            placeholders = ", ".join("?" for _ in fields)
            columns = ", ".join(fields)
            values = [[db_value(row.get(field)) for field in fields] for row in rows]
            conn.executemany(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", values)
        conn.commit()
        conn.execute("PRAGMA optimize")
    finally:
        conn.close()


def write_outputs(rows_by_table: dict[str, list[dict[str, Any]]]) -> None:
    for table, fields in CSV_FIELDS.items():
        write_csv(SOURCE_DIR / f"{table}.csv", fields, rows_by_table.get(table, []))
    (BUILD_DIR / "schema.sql").write_text(CREATE_SQL.strip() + "\n", encoding="utf-8")
    write_sqlite(rows_by_table)


def collect_required_item_urls(
    machines: list[dict[str, Any]],
    evolution_chains: list[dict[str, Any]],
) -> list[dict[str, str]]:
    seen: dict[int, dict[str, str]] = {}

    def add(resource: dict[str, Any] | None) -> None:
        rid = resource_id(resource)
        url = resource.get("url") if resource else None
        name = resource.get("name") if resource else None
        if rid and url and name:
            seen[rid] = {"name": name, "url": url}

    for machine in machines:
        add(machine.get("item"))

    def visit(node: dict[str, Any]) -> None:
        for child in node.get("evolves_to", []):
            for detail in child.get("evolution_details") or []:
                add(detail.get("item"))
                add(detail.get("held_item"))
            visit(child)

    for chain in evolution_chains:
        visit(chain["chain"])
    return [seen[item_id] for item_id in sorted(seen)]


def collect_form_urls(pokemon: list[dict[str, Any]]) -> list[dict[str, str]]:
    seen: dict[int, dict[str, str]] = {}
    for mon in pokemon:
        for form in mon.get("forms", []):
            rid = resource_id(form)
            if rid and form.get("url") and form.get("name"):
                seen[rid] = {"name": form["name"], "url": form["url"]}
    return [seen[item_id] for item_id in sorted(seen)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Pokemon CSV files and SQLite DB from PokeAPI.")
    parser.add_argument("--refresh", action="store_true", help="Ignore local API cache and redownload data.")
    parser.add_argument("--workers", type=int, default=16, help="Concurrent API downloads.")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Development-only limit for species/pokemon/move/ability detail downloads.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ensure_dirs()
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    print("Loading PokeAPI resource lists...", flush=True)
    lists = {endpoint: fetch_list(endpoint, refresh=args.refresh) for endpoint in LIST_ENDPOINTS}

    if args.limit:
        for endpoint in ("pokemon-species", "pokemon", "move", "ability", "machine"):
            lists[endpoint] = lists[endpoint][: args.limit]

    data: dict[str, list[dict[str, Any]]] = {}
    for endpoint in LIST_ENDPOINTS:
        data[endpoint] = fetch_many(
            lists[endpoint],
            refresh=args.refresh,
            workers=args.workers,
            label=endpoint,
        )

    species_chains: dict[int, dict[str, str]] = {}
    for species in data["pokemon-species"]:
        chain = species.get("evolution_chain")
        rid = resource_id(chain)
        if rid and chain.get("url"):
            species_chains[rid] = {"name": str(rid), "url": chain["url"]}
    data["evolution-chain"] = fetch_many(
        [species_chains[rid] for rid in sorted(species_chains)],
        refresh=args.refresh,
        workers=args.workers,
        label="evolution-chain",
    )

    form_urls = collect_form_urls(data["pokemon"])
    data["pokemon-form"] = fetch_many(
        form_urls,
        refresh=args.refresh,
        workers=args.workers,
        label="pokemon-form",
    )

    item_urls = collect_required_item_urls(data["machine"], data["evolution-chain"])
    data["item"] = fetch_many(
        item_urls,
        refresh=args.refresh,
        workers=args.workers,
        label="item",
    )

    print("Transforming data...", flush=True)
    rows_by_table = build_rows(data, fetched_at=fetched_at)

    print("Writing CSV files and SQLite database...", flush=True)
    write_outputs(rows_by_table)

    print("Done.", flush=True)
    print(f"  CSV dir: {SOURCE_DIR}", flush=True)
    print(f"  SQLite:  {DB_PATH}", flush=True)
    for key in ("pokemon", "pokemon_species", "moves", "pokemon_learnsets", "evolutions", "machines"):
        print(f"  {key}: {len(rows_by_table.get(key, []))}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
