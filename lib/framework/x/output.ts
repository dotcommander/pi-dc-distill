/**
 * Output — public re-export of the sanctioned house-style block builder at
 * `../lib/output-block`.
 *
 * @module dc-framework/x/output
 */

export { Block, HOUSE_BLOCK_TYPE } from "../lib/output-block.ts";
export type {
  BlockSpec,
  BlockField,
  RecordBlock,
  RailBlock,
  BannerBlock,
  RailBlockBlock,
  DividerBlock,
  MermaidBlock,
  MarkdownBlock,
  ImageBlock,
  RawBlock,
  StackBlock,
  BlockEmitCustomOptions,
} from "../lib/output-block.ts";
