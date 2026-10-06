/** String-iterator code point semantics, including isolated UTF-16 surrogates. */
export function codePointLength(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++, count++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
    }
  }
  return count;
}

/** Equivalent to Array.from(text).slice(0, limit).join("") without a character array. */
export function codePointPrefix(text: string, limit: number): string {
  let remaining = Number.isNaN(limit) ? 0 : Math.trunc(limit);
  if (remaining < 0) remaining = Math.max(0, codePointLength(text) + remaining);
  let index = 0;
  while (index < text.length && remaining > 0) {
    const unit = text.charCodeAt(index++);
    if (unit >= 0xd800 && unit <= 0xdbff && index < text.length) {
      const next = text.charCodeAt(index);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
    }
    remaining--;
  }
  return text.slice(0, index);
}

/** Last normalized `limit` code points; zero never means the whole string. */
export function codePointSuffix(text: string, limit: number): string {
  let remaining = Number.isNaN(limit) ? 0 : Math.trunc(limit);
  if (remaining < 0) remaining = Math.max(0, codePointLength(text) + remaining);
  let index = text.length;
  while (index > 0 && remaining > 0) {
    const unit = text.charCodeAt(--index);
    if (unit >= 0xdc00 && unit <= 0xdfff && index > 0) {
      const previous = text.charCodeAt(index - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) index--;
    }
    remaining--;
  }
  return text.slice(index);
}
