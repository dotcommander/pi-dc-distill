/** Historical persisted names. New writes and public interfaces use distill. */
export const LEGACY_DATA_NAMESPACE = "dc-shrink";
export const LEGACY_COMPACTOR = "dc-shrink";
export const LEGACY_HANDOFF_ENTRY_TYPE = "dc-shrink-handoff";
export const LEGACY_CONTINUATION_MESSAGE_TYPE = "dc-shrink-continuation";
export const LEGACY_COMPACTION_CARD_TYPE = "dc-shrink-compaction";
export const LEGACY_OUTPUT_NOTICE_PREFIX = "[dc-shrink] Compacted ";
export const LEGACY_DUMPS_ENV = "DC_SHRINK_DUMPS";
export const LEGACY_DATA_DIR_ENV = "DC_SHRINK_DATA_DIR";

export function isDistillCompactor(value: unknown): boolean {
  return value === "dc-distill" || value === LEGACY_COMPACTOR;
}

export function isDistillHandoffType(value: unknown): boolean {
  return value === "dc-distill-handoff" || value === LEGACY_HANDOFF_ENTRY_TYPE;
}

/** Translate only the old fence label, never the historical handoff body. */
export function normalizeLegacyHandoffFence(text: string): string {
  return text.replace(/^(\s*```)shrink-handoff-(v[12]\n)/, "$1distill-handoff-$2");
}

export const LEGACY_MIGRATION_FLAG = ".migrated-from-dc-shrink";
