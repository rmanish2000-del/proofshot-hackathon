import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalJson, sha256Hex } from "../src/util.ts";

test("canonicalJson sorts keys at every depth, so key order never changes the bytes", () => {
  const a = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } };
  const b = { a: { c: "x", d: [3, { y: 2, z: 1 }] }, b: 1 };
  assert.equal(canonicalJson(a), '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("canonicalJson keeps array order and encodes scalars as JSON does", () => {
  assert.equal(canonicalJson([2, 1]), "[2,1]");
  assert.equal(canonicalJson({ s: 'q"\n', t: true, n: null, f: 0.5 }), '{"f":0.5,"n":null,"s":"q\\"\\n","t":true}');
});

test("canonicalJson rejects non-finite numbers instead of writing null", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalJson({ x: [bad] }), /non-finite number at \$\.x\[0\]/);
  }
});

test("canonicalJson rejects values JSON cannot hold, and class instances", () => {
  for (const bad of [undefined, () => 1, Symbol("s"), 1n, [undefined], new Date(0), new Map(), new Uint8Array(2)]) {
    assert.throws(() => canonicalJson(bad), TypeError);
  }
});

test("an undefined property is left out, so a value and its JSON round trip hash the same", () => {
  const value = { a: 1, gone: undefined };
  assert.equal(canonicalJson(value), canonicalJson(JSON.parse(JSON.stringify(value))));
  assert.equal(canonicalJson(Object.assign(Object.create(null), { k: 1 })), '{"k":1}');
});

test("sha256Hex gives the standard digest for text and bytes", () => {
  const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(sha256Hex("abc"), abc);
  assert.equal(sha256Hex(new TextEncoder().encode("abc")), abc);
});
