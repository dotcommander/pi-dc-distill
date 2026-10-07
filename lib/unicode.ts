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

/** String-iterator prefix semantics with detached storage for clipped text. */
export function codePointPrefix(text: string, limit: number): string {
  let remaining = Number.isNaN(limit) ? 0 : Math.trunc(limit);
  if (remaining < 0) remaining = Math.max(0, codePointLength(text) + remaining);
  const points: number[] = [];
  let index = 0;
  while (index < text.length && remaining > 0) {
    const point = text.codePointAt(index)!;
    points.push(point);
    index += point > 0xffff ? 2 : 1;
    remaining--;
  }
  if (index === text.length) return text;
  // Production limits are small; chunks also keep arbitrary callers below the
  // engine's function-argument limit without slicing the source backing store.
  let prefix = "";
  for (let offset = 0; offset < points.length; offset += 2048)
    prefix += String.fromCodePoint(...points.slice(offset, offset + 2048));
  return prefix;
}
