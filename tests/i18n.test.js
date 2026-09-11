import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import english from "../web/src/locales/en.js";
import { englishName } from "../web/src/pokemon-names.js";
import {
  t,
  setLanguage,
  getLanguage,
  pokemonName,
  typeName,
  locale,
} from "../web/src/i18n.js";
import { searchForms, dailyTarget } from "../web/src/similarity-engine.js";
import { searchPokemon } from "../web/src/engine.js";
import { isPlayableForm } from "../web/src/form-policy.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const data = JSON.parse(read("../web/public/pokemantle.json"));
const catalog = JSON.parse(read("../web/public/catalog.json"));

test("Korean is the default; language switching interpolates repeated values without changing data", () => {
  assert.equal(getLanguage(), "ko");
  assert.equal(t("{size} 곱하기 {size}", { size: 4 }), "4 곱하기 4");
  const before = JSON.stringify(data.pokemon);
  assert.equal(setLanguage("en"), true);
  assert.equal(locale(), "en-US");
  assert.equal(t("{size} 곱하기 {size}", { size: 6 }), "6 by 6");
  assert.equal(t("{count}칸 남았어요", { count: 0 }), "Cells left: 0");
  assert.equal(pokemonName(data.pokemon[0]), "Bulbasaur");
  assert.equal(typeName({ key: "fire", name: "불꽃" }), "Fire");
  assert.equal(dailyTarget(data, "2026-09-10"), 10316);
  assert.equal(setLanguage("en"), false);
  assert.equal(setLanguage("fr"), false);
  assert.equal(getLanguage(), "en");
  assert.equal(t("unknown"), "unknown");
  assert.equal(JSON.stringify(data.pokemon), before);
  setLanguage("ko");
  assert.equal(pokemonName(data.pokemon[0]), "이상해씨");
  assert.equal(typeName({ key: "fire", name: "불꽃" }), "불꽃");
});

test("translations preserve placeholders and cover literal UI message keys", () => {
  const params = (text) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [source, translated] of Object.entries(english)) {
    assert.ok(translated && !/[가-힣]/.test(translated), source);
    assert.deepEqual(params(translated), params(source), source);
  }
  for (const file of [
    "main.js",
    "home.js",
    "pokemantle.js",
    "pokeclue.js",
    "site-brand.js",
    "trainer-results.js",
  ]) {
    const source = read(`../web/src/${file}`);
    for (const [, key] of source.matchAll(
      /\b(?:t|tr|initLanguage)\("([^"\n]+)"/g,
    )) {
      if (/[가-힣]/.test(key))
        assert.ok(Object.hasOwn(english, key), `${file}: ${key}`);
    }
  }
});

test("every form has a distinct English name and only playable forms are searchable", () => {
  const names = new Set();
  for (const p of data.pokemon) {
    const name = englishName(p);
    assert.ok(name && !/[가-힣]/.test(name), p.key);
    assert.ok(!names.has(name), `${p.key}: ${name}`);
    names.add(name);
    assert.equal(
      searchForms(data.pokemon, name).some((result) => result.id === p.id),
      isPlayableForm(p),
      name,
    );
  }
  const byKey = new Map(data.pokemon.map((p) => [p.key, p]));
  for (const [key, name] of [
    ["vulpix-alola", "Alolan Vulpix"],
    ["necrozma-ultra", "Ultra Necrozma"],
    ["mr-mime-galar", "Galarian Mr. Mime"],
    ["tauros-paldea-combat-breed", "Paldean Tauros (Combat Breed)"],
    ["type-null", "Type: Null"],
    ["farfetchd", "Farfetch'd"],
  ])
    assert.equal(englishName(byKey.get(key)), name);
});

test("both games keep Korean and English search independent of selected language", () => {
  for (const lang of ["en", "ko"]) {
    setLanguage(lang);
    for (const query of ["Alolan Vulpix", "알로라 식스테일", "37"])
      assert.ok(
        searchForms(data.pokemon, query).some((p) => p.key === "vulpix-alola"),
      );
    for (const query of ["Bulbasaur", "이상해씨", "1"])
      assert.ok(searchPokemon(catalog.pokemon, query).some((p) => p.id === 1));
    for (const p of catalog.pokemon)
      assert.ok(
        searchPokemon(catalog.pokemon, englishName(p)).some(
          (result) => result.id === p.id,
        ),
        p.key,
      );
  }
});
