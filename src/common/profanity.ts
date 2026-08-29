import {
    DataSet,
    RegExpMatcher,
    englishDataset,
    englishRecommendedTransformers,
    pattern,
} from 'obscenity';

// `englishDataset` (see obscenity's preset/english.ts) already includes the recommended
// leetspeak/confusable/duplicate-letter transformers and a solid slur list (nigger, negro,
// chink, kike, chingchong, fag, dyke, tranny, spastic, retard, abeed, abo, africoon, arabush,
// boonga, ...). This supplements it with a short list of common ethnic/religious slurs that
// dataset is missing, so player names get the same coverage. Extend this list — not the
// enforcement call site — the next time a new case slips through.
const supplementaryDataset = new DataSet<{ originalWord: string }>()
    .addAll(englishDataset)
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'spic' }).addPattern(pattern`|spic[k]`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'wetback' }).addPattern(pattern`wetback`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'beaner' }).addPattern(pattern`beaner`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'gook' }).addPattern(pattern`|gook`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'coon' }).addPattern(pattern`|coon|`).addWhitelistedTerm('raccoon'))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'porchmonkey' }).addPattern(pattern`porchmonkey`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'jigaboo' }).addPattern(pattern`jigaboo`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'raghead' }).addPattern(pattern`raghead`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'towelhead' }).addPattern(pattern`towelhead`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'zipperhead' }).addPattern(pattern`zipperhead`))
    .addPhrase((phrase) => phrase
        .setMetadata({ originalWord: 'paki' })
        .addPattern(pattern`|paki|`)
        .addWhitelistedTerm('pakistan'))
    .addPhrase((phrase) => phrase
        .setMetadata({ originalWord: 'jap' })
        .addPattern(pattern`|jap|`)
        .addWhitelistedTerm('japan'))
    // Hungarian. Patterns are written unaccented — `stripSeparators` below folds á/é/í/ó/ö/ő/ú/ü/ű
    // to their base ASCII vowel (NFKD decomposes each to vowel + combining accent, which the
    // diacritic strip then removes), so e.g. "köcsög" still matches `kocsog` via the second,
    // folded matcher pass in isNameClean. Only explicit slur/vulgar forms are listed — the plain
    // ethnonyms ("cigány"/Roma, "zsidó"/Jewish) are deliberately NOT blacklisted on their own.
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'geci' }).addPattern(pattern`geci`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'kurva' }).addPattern(pattern`kurva`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'picsa' }).addPattern(pattern`picsa`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'fasz' }).addPattern(pattern`|fasz`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'buzi' }).addPattern(pattern`|buzi`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'ribanc' }).addPattern(pattern`ribanc`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'kocsog' }).addPattern(pattern`kocsog`))
    .addPhrase((phrase) => phrase
        .setMetadata({ originalWord: 'szar' })
        .addPattern(pattern`|szar`)
        .addWhitelistedTerm('szarvas')) // Szarvas — a Hungarian town, and a surname
    .addPhrase((phrase) => phrase
        .setMetadata({ originalWord: 'cigo' }) // derogatory diminutive for Roma people
        .addPattern(pattern`|cigo`))
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'budoscigany' }).addPattern(pattern`budoscigany`)) // "büdös cigány" (stinky gypsy)
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'koszoscigany' }).addPattern(pattern`koszoscigany`)) // "koszos cigány" (filthy gypsy)
    .addPhrase((phrase) => phrase.setMetadata({ originalWord: 'budoszsido' }).addPattern(pattern`budoszsido`)); // "büdös zsidó" (stinky jew)

const matcher = new RegExpMatcher({
    ...supplementaryDataset.build(),
    ...englishRecommendedTransformers,
});

// obscenity's own transformers deliberately don't strip spaces/punctuation (see its
// `skipNonAlphabeticTransformer` being commented out in preset/english.ts) to avoid false
// positives on words like "assess"/"asset" that a naive strip could re-glue into something else.
// That leaves separator-padded evasions like "n.i.g.g.e.r" or "n i g g e r" unmatched. Re-running
// the *same* matcher (word-boundary patterns, whitelist terms, and all) against a
// separator-stripped copy catches those without losing that fidelity — unlike collapsing repeated
// letters, which would equate "nigger" with the legitimate name/country "Niger".
function stripSeparators(name: string): string {
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // strip diacritics
        .replace(/[^\p{L}\p{N}]+/gu, ''); // drop spaces/punctuation/separators
}

/** True when `name` contains no profanity/slur match — checked both as-is and with
 *  spaces/punctuation stripped out, via obscenity (leetspeak/confusable-aware). */
export function isNameClean(name: string): boolean {
    return !matcher.hasMatch(name) && !matcher.hasMatch(stripSeparators(name));
}
