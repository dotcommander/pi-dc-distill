import type { BlockField, BlockSpec } from "#shrink-framework/x/output";

export const COMPACTION_CARD_TYPE = "dc-shrink-compaction";

export interface CompactionCardDetails {
  tokensBefore?: number;
  tokensAfter?: number;
  apiTokensBefore?: number;
  reductionPct?: number;
  summaryTokens?: number;
  compactor?: string;
  version?: number;
  tier?: number;
  digestScope?: string;
}

type CompactionCardMessage = {
  content: string;
  details?: CompactionCardDetails;
};

function tokenCount(value: number): string {
  return `${value.toLocaleString()} tokens`;
}

function methodLabel(details: CompactionCardDetails): string {
  if (details.compactor !== "dc-shrink") return "Pi compaction";
  const parts = [
    details.version === undefined ? "dc-shrink" : `dc-shrink v${details.version}`,
    "deterministic",
  ];
  if (details.tier !== undefined) parts.push(`tier ${details.tier}`);
  return parts.join(" · ");
}

function overview(details: CompactionCardDetails): BlockSpec {
  const fields: BlockField[] = [];
  if (details.tokensBefore !== undefined) {
    fields.push({
      label: "Before est.",
      value: tokenCount(details.tokensBefore),
    });
  }

  if (
    details.tokensBefore !== undefined
    && details.tokensAfter !== undefined
  ) {
    fields.push({
      label: "Rebuilt est.",
      value: tokenCount(details.tokensAfter),
      tone: "success",
    });
    const removed = Math.max(0, details.tokensBefore - details.tokensAfter);
    const reductionPct = details.reductionPct
      ?? (details.tokensBefore > 0
        ? Math.round((removed / details.tokensBefore) * 100)
        : 0);
    fields.push({
      label: "Reduced",
      value: `${tokenCount(removed)} (${reductionPct}%)`,
      tone: "success",
    });
  }

  if (details.apiTokensBefore !== undefined) {
    fields.push({
      label: "API before",
      value: tokenCount(details.apiTokensBefore),
    });
  }
  if (details.summaryTokens !== undefined) {
    fields.push({
      label: "Summary",
      value: tokenCount(details.summaryTokens),
    });
  }
  fields.push({
    label: "Method",
    value: methodLabel(details),
  });
  if (details.digestScope) {
    fields.push({
      label: "Evidence",
      value: details.digestScope,
    });
  }

  return {
    kind: "record",
    title: "Context compacted",
    glyph: "arrowLoop",
    state: "success",
    fields,
  };
}

export function compactionCardSpec(
  message: CompactionCardMessage,
  expanded: boolean,
): BlockSpec {
  const details = message.details ?? {};
  const summary = message.content.trim();
  const record = overview(details);
  if (!expanded || !summary) return record;

  return {
    kind: "stack",
    children: [
      record,
      { kind: "divider", title: "Continuation summary", tone: "muted" },
      { kind: "markdown", content: summary },
    ],
  };
}
