/**
 * Args — public re-export of the kernel-private parser at `../lib/_args`.
 *
 * The Command kernel facade consumes `_args` directly; this x/ facade is the
 * documented public surface for extensions that want to invoke the tokenizer
 * outside of a Command handler context.
 *
 * @module dc-framework/x/args
 */

export { Args } from "../lib/_args.ts";
export type { FlagDef, ParseOptions, ParseResult } from "../lib/_args.ts";
