// SPDX-License-Identifier: MIT
//! Maps text onto the punctuation the Pocket tokenizer actually knows.
//!
//! The pocket-tts SentencePiece vocabulary only has `.`, `,`, `?`, `'`, `-`
//! and the French guillemets. Every other sign (`:`, `!`, `;`, `’`, `…`,
//! dashes, brackets, the French narrow no-break space) falls back to raw byte
//! tokens the model barely saw in training, and it voices them as audible
//! artefacts. Checked with `tokenizer.model` of pack `pocket-tts-fr-24l-int8`
//! 1.1.0: `"TTS : Aujourd’hui"` encodes `<0x3A>` and `<0xE2> <0x80> <0x99>`.

/// Rewrites `text` so every punctuation sign is one the tokenizer has a piece
/// for, keeping the pauses the original signs implied.
pub fn normalize_for_tokenizer(text: &str) -> String {
    let mut mapped = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    for (index, &character) in chars.iter().enumerate() {
        match character {
            '\u{2019}' | '\u{2018}' | '\u{02BC}' | '`' => mapped.push('\''),
            '"' | '\u{201C}' | '\u{201D}' | '\u{201E}' => {}
            '\u{00A0}' | '\u{202F}' | '\u{2009}' => mapped.push(' '),
            // A clock time ("14:30") reads as a pause, not a clause break.
            ':' if is_between_digits(&chars, index) => mapped.push(' '),
            ':' | ';' | '\u{2013}' | '\u{2014}' | '(' | ')' | '[' | ']' | '{' | '}' => {
                mapped.push_str(", ")
            }
            '!' | '\u{2026}' => mapped.push_str(". "),
            '*' | '#' | '_' | '~' | '^' | '|' | '\\' | '<' | '>' | '/' => mapped.push(' '),
            other => mapped.push(other),
        }
    }
    tidy_punctuation(&mapped)
}

fn is_between_digits(chars: &[char], index: usize) -> bool {
    let before = index
        .checked_sub(1)
        .and_then(|previous| chars.get(previous));
    let after = chars.get(index + 1);
    matches!((before, after), (Some(left), Some(right)) if left.is_ascii_digit() && right.is_ascii_digit())
}

/// Collapses the runs the mapping can create (`" , ,"`, `",."`, `"..."`) and
/// removes the space French typography puts before a sign.
fn tidy_punctuation(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        let is_sign = matches!(character, ',' | '.' | '?');
        if is_sign {
            while out.ends_with(' ') {
                out.pop();
            }
            match (out.chars().last(), character) {
                // A stronger stop replaces a weaker one; repeats collapse.
                (Some(','), '.' | '?') => {
                    out.pop();
                }
                (Some(',' | '.' | '?'), _) => continue,
                (None, _) => continue,
                _ => {}
            }
        } else if character.is_whitespace() && (out.is_empty() || out.ends_with(' ')) {
            continue;
        }
        out.push(if character.is_whitespace() {
            ' '
        } else {
            character
        });
    }
    out.trim_end().to_owned()
}

#[cfg(test)]
mod tests {
    use super::normalize_for_tokenizer;

    #[test]
    fn typographic_apostrophe_becomes_the_ascii_one() {
        assert_eq!(
            normalize_for_tokenizer("Aujourd\u{2019}hui, l\u{2019}air"),
            "Aujourd'hui, l'air"
        );
    }

    #[test]
    fn french_colon_with_narrow_space_becomes_a_comma() {
        assert_eq!(
            normalize_for_tokenizer("tester le TTS\u{202F}: Aujourd\u{2019}hui"),
            "tester le TTS, Aujourd'hui"
        );
        assert_eq!(normalize_for_tokenizer("le TTS : voici"), "le TTS, voici");
    }

    #[test]
    fn clock_times_keep_their_digits_apart() {
        assert_eq!(normalize_for_tokenizer("à 14:30."), "à 14 30.");
    }

    #[test]
    fn exclamation_and_ellipsis_end_the_sentence() {
        assert_eq!(
            normalize_for_tokenizer("Super ! Et puis\u{2026} rien."),
            "Super. Et puis. rien."
        );
    }

    #[test]
    fn brackets_and_dashes_become_pauses_without_doubling() {
        assert_eq!(
            normalize_for_tokenizer("La météo (très variable) \u{2014} change."),
            "La météo, très variable, change."
        );
    }

    #[test]
    fn quotes_and_markup_symbols_are_not_voiced() {
        assert_eq!(
            normalize_for_tokenizer("Il a dit \u{201C}oui\u{201D} **vraiment**."),
            "Il a dit oui vraiment."
        );
    }

    #[test]
    fn plain_text_is_unchanged() {
        let text = "Bonjour, je vais vous expliquer comment configurer votre projet.";
        assert_eq!(normalize_for_tokenizer(text), text);
    }

    #[test]
    fn every_output_sign_is_in_the_tokenizer_vocabulary() {
        let text = "a:b;c!d(e)f[g]h{i}j\u{2013}k\u{2014}l\u{2026}m\u{2019}n\u{201C}o\u{201D}p*q#r_s~t^u|v\\w<x>y/z\u{00A0}\u{202F}";
        let known = |character: char| {
            character.is_alphanumeric() || matches!(character, ' ' | '.' | ',' | '?' | '\'' | '-')
        };
        let normalized = normalize_for_tokenizer(text);
        assert!(normalized.chars().all(known), "{normalized:?}");
    }
}
