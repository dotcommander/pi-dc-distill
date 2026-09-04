/**
 * Testing — public re-export of stub context helpers at `../lib/_stub-ctx`.
 *
 * @module dc-framework/x/testing
 */

import { restoreAll } from "../lib/_fake.ts";
import { boot, __resetForTest } from "../lib/_app.ts";

export { createStubCtx, simulate } from "../lib/_stub-ctx.ts";
export type { CallRecord, StubCtx } from "../lib/_stub-ctx.ts";

export const Fake = { restoreAll };
export const bootAppForTest = boot;
export const resetAppForTest = __resetForTest;
export type { Matcher } from "../lib/_fake.ts";
export type { NotifyFake } from "../lib/notify.ts";
export type { ToolFake } from "../lib/tool.ts";
export type { StatusFake } from "../lib/status.ts";
export type { CommandFake } from "../lib/command.ts";
export type { LoaderFake } from "../lib/loader.ts";
