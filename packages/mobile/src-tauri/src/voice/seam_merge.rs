// SPDX-License-Identifier: MIT

//! Joins two transcripts decoded from overlapping audio. The overlap repeats
//! the end of the first segment at the head of the second, so the repeated
//! words must be dropped exactly once — a sloppy join duplicates them, an
//! aggressive one eats real words.

/// How many words at the seam may be treated as a repetition.
pub(crate) const SEAM_WORDS: usize = 6;

fn words(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

/// Comparison key: letters and digits only, lowercased, so "Monde," matches
/// "monde".
fn key(word: &str) -> String {
    word.chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect()
}

fn repeated_prefix(previous: &[&str], next: &[&str], window: usize) -> usize {
    let limit = window.min(previous.len()).min(next.len());
    (1..=limit)
        .rev()
        .find(|count| {
            (0..*count)
                .all(|offset| key(previous[previous.len() - count + offset]) == key(next[offset]))
        })
        .unwrap_or(0)
}

/// Appends `next` to `accumulated`, dropping the words already heard at the
/// seam. Both sides are normalised to single spaces.
pub(crate) fn merge(accumulated: &str, next: &str, window: usize) -> String {
    let next = words(next);
    if next.is_empty() {
        return accumulated.trim().to_string();
    }
    let previous = words(accumulated);
    if previous.is_empty() {
        return next.join(" ");
    }
    let repeated = repeated_prefix(&previous, &next, window);
    let fresh = next[repeated..].join(" ");
    if fresh.is_empty() {
        return previous.join(" ");
    }
    format!("{} {}", previous.join(" "), fresh)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_is_appended_with_one_space() {
        assert_eq!(merge("bonjour", "le monde", SEAM_WORDS), "bonjour le monde");
    }

    #[test]
    fn the_repeated_seam_word_is_kept_once() {
        assert_eq!(
            merge("bonjour le monde", "monde à tous", SEAM_WORDS),
            "bonjour le monde à tous"
        );
    }

    #[test]
    fn a_whole_repeated_phrase_is_deduplicated() {
        assert_eq!(
            merge("il fait très beau", "très beau aujourd'hui", SEAM_WORDS),
            "il fait très beau aujourd'hui"
        );
    }

    #[test]
    fn comparison_ignores_case_and_punctuation() {
        assert_eq!(
            merge("Bonjour, le Monde", "monde. À tous", SEAM_WORDS),
            "Bonjour, le Monde À tous"
        );
    }

    #[test]
    fn words_that_only_look_alike_are_not_deduplicated() {
        assert_eq!(
            merge("le monde", "mondial à tous", SEAM_WORDS),
            "le monde mondial à tous"
        );
    }

    #[test]
    fn identical_words_beyond_the_window_are_kept() {
        let previous = "un deux trois quatre cinq six sept";
        assert_eq!(
            merge(previous, "sept sept huit", 1),
            "un deux trois quatre cinq six sept sept huit"
        );
    }

    #[test]
    fn a_fully_repeated_tail_does_not_duplicate_the_text() {
        assert_eq!(
            merge("bonjour le monde", "le monde", SEAM_WORDS),
            "bonjour le monde"
        );
    }

    #[test]
    fn leading_whitespace_and_empty_sides_are_normalised() {
        assert_eq!(
            merge("", "  bonjour  le  monde ", SEAM_WORDS),
            "bonjour le monde"
        );
        assert_eq!(merge("bonjour ", "   ", SEAM_WORDS), "bonjour");
        assert_eq!(merge("", "", SEAM_WORDS), "");
    }
}
