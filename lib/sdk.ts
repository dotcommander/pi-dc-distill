/**
 * Pi SDK re-export — the single new-style import target for product code.
 *
 * Everything product files previously imported through the vendored
 * framework's Pi adapter resolves here. Support modules import
 * the SDK packages directly; this module exists for product consumers so the
 * SDK boundary stays one import wide.
 *
 * @module lib/sdk
 */

export * from "@earendil-works/pi-coding-agent";
