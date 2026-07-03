# Language

Rules for any change that touches user-facing text on the Kali Mandir site.
This is a bilingual site (Hindi and English) for a working temple, read by
devotees of a wide age and education range — clarity and respect matter more
than cleverness here.

## Structural rule (non-negotiable)

Every visible string on `index.html` and `admin.html` needs both versions,
marked with `lang-el="en"` and `lang-el="hi"` on sibling elements, matching
the pattern already in the file (see `styles.css` for how `[data-lang]` on
`<html>` toggles visibility). Never add an English-only string to a
public-facing section and leave the Hindi counterpart as a placeholder or a
straight copy of the English — that's worse than not shipping the string,
since it silently breaks the bilingual promise of the site for Hindi-first
readers.

If you cannot produce a confident Hindi translation for new copy, say so
explicitly and flag the string for human review rather than guessing.

## Translation register

- **Hindi:** respectful, warm, and simple — the register a devotee would
  hear from a temple committee member, not textbook-formal Hindi and not
  heavily Sanskritized. Prefer commonly used words a visitor of any
  education level would recognize over more "correct" but obscure
  alternatives.
- **English:** plain and direct, matching `frontend-design`'s writing
  guidance elsewhere in this repo — no filler, active voice, name things by
  what the visitor recognizes ("Visiting Hours," not "Operational
  Parameters").
- Keep the two versions equivalent in *meaning and warmth*, not necessarily
  a literal word-for-word translation — natural phrasing in each language
  takes priority over mirroring sentence structure.

## Proper nouns and transliteration

- Deity and festival names keep standard, widely recognized spellings in
  English (Kali, Durga Puja, Kali Puja, Navratri) rather than strict
  academic transliteration (no diacritics like Kālī).
- The temple's own name and address are fixed strings — do not paraphrase
  or re-translate "New Kali Mandir, Belabagan, Deoghar" or the N.M Road
  address in either language; copy them exactly as they appear in the
  Contact section.
- When in doubt on a spelling choice, match whatever the repo's existing
  copy already uses for that term, for consistency, rather than introducing
  a new variant.

## Devanagari rendering

- Hindi headings use the `--font-display-hi` (Tiro Devanagari Hindi) token;
  Hindi body text uses `--font-body` (Mukta), which already covers
  Devanagari. Don't introduce a new font for Hindi text without checking it
  renders conjuncts (संयुक्ताक्षर) correctly — many Latin-first web fonts
  render Devanagari poorly or not at all.
- Don't mix numerals — use Western numerals (8:00 AM, not ८:००) in both
  languages for times/dates, since that's what the existing hours and
  schedule sections use; stay consistent with that choice for any new
  numeric content.

## Scope

This file governs the two HTML pages' visible text and any new page added
later. It does not govern `agent/*.md` or code comments, which stay in
English regardless of audience (see `document-creator.md`).
