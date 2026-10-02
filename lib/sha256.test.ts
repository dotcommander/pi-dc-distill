import { expect, test } from "bun:test";
import { sha256Hex } from "./sha256.ts";

test("SHA-256 preserves full string and Buffer digests", () => {
  expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256Hex("😀é\ud800")).toBe(sha256Hex(Buffer.from("😀é\ud800", "utf8")));
  expect(sha256Hex(Buffer.from([0, 255, 128]))).toHaveLength(64);
});
