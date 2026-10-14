"use strict";
// Run with: node --test deploy/wake-proxy/server.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildMagicPacket } = require("./server.js");

test("magic packet is 102 bytes starting with six 0xff", () => {
  const p = buildMagicPacket("01:02:03:04:05:06");
  assert.equal(p.length, 102);
  assert.deepEqual([...p.subarray(0, 6)], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
});

test("the MAC is repeated 16 times after the header", () => {
  const p = buildMagicPacket("aa:bb:cc:dd:ee:ff");
  const mac = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
  for (let i = 1; i <= 16; i++) {
    assert.deepEqual([...p.subarray(i * 6, i * 6 + 6)], mac, `repetition ${i}`);
  }
});

test("accepts hyphen-separated MACs", () => {
  assert.deepEqual(buildMagicPacket("AA-BB-CC-DD-EE-FF"), buildMagicPacket("aa:bb:cc:dd:ee:ff"));
});

test("rejects malformed MACs", () => {
  assert.throws(() => buildMagicPacket("nope"));
  assert.throws(() => buildMagicPacket("aa:bb:cc:dd:ee"));
  assert.throws(() => buildMagicPacket("aa:bb:cc:dd:ee:gg"));
});
