/**
 * Trade API mod/property text carries inline markup: `[Dexterity|Dex]` or
 * `[Quality]`. The pipe form is `[id|displayText]` — render the display half;
 * the bare form is its own display text. Mirrors how pathofexile.com renders it.
 */
export function stripMarkup(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, (_, inner: string) => {
    const pipe = inner.indexOf('|')
    return pipe === -1 ? inner : inner.slice(pipe + 1)
  })
}
