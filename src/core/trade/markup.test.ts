import { describe, expect, it } from 'vitest'
import { stripMarkup } from './markup'

describe('stripMarkup', () => {
  it('renders the display half of [id|Display]', () => {
    expect(stripMarkup('Requires Level 75, [Dexterity|Dex]: 94')).toBe('Requires Level 75, Dex: 94')
  })

  it('renders bare [Display] as itself', () => {
    expect(stripMarkup('[Quality]: +20%')).toBe('Quality: +20%')
  })

  it('handles multiple placeholders in one line', () => {
    expect(stripMarkup('Adds 22 to 32 [Cold] damage to [Attack|Attacks]')).toBe(
      'Adds 22 to 32 Cold damage to Attacks'
    )
  })

  it('leaves unmarked text untouched', () => {
    expect(stripMarkup('+30 to Dexterity')).toBe('+30 to Dexterity')
  })
})
