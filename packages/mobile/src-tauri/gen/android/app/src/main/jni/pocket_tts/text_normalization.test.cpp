// SPDX-License-Identifier: MIT
// Host: g++ -std=c++17 -Wall -Wextra -Werror text_normalization.test.cpp -o text-normalization-test
#include "text_normalization.h"
#include <cassert>
#include <iostream>

int main(int count, char** arguments) {
    using pocket_tts::normalize_apostrophes;
    if (count == 2 && std::string(arguments[1]) == "--normalize") {
        const std::string text(std::istreambuf_iterator<char>(std::cin), {});
        std::cout << normalize_apostrophes(text);
        return 0;
    }
    assert(normalize_apostrophes(u8"L’audio fonctionne.") == "L'audio fonctionne.");
    assert(normalize_apostrophes(u8"Je vérifie l’audio aujourd’hui.") == u8"Je vérifie l'audio aujourd'hui.");
    assert(normalize_apostrophes(u8"L‘audio, lʼaudio et l＇audio.") == "L'audio, l'audio et l'audio.");
    assert(normalize_apostrophes("L'audio fonctionne.") == "L'audio fonctionne.");
    assert(normalize_apostrophes(u8"J’ai vérifié l’entrée, d’abord et qu’il n’y ait pas d’hésitation.") ==
           u8"J'ai vérifié l'entrée, d'abord et qu'il n'y ait pas d'hésitation.");
    assert(normalize_apostrophes(u8"Don't change English contractions: it’s fine.") ==
           "Don't change English contractions: it's fine.");
    assert(normalize_apostrophes(u8"Écoute : « déjà », cœur, 3,5 €, 😀.") ==
           u8"Écoute : « déjà », cœur, 3,5 €, 😀.");
    assert(normalize_apostrophes("").empty());
    assert(normalize_apostrophes("'") == "'");
    assert(normalize_apostrophes(u8"’") == "'");
    const std::string partial("\xe2\x80", 2);
    assert(normalize_apostrophes(partial) == partial);
    const auto normalized = normalize_apostrophes(u8"L’audio n’est pas le audio.");
    assert(normalize_apostrophes(normalized) == normalized);
    std::cout << "Pocket apostrophes: French elisions, Unicode variants, ASCII, UTF-8 preservation, idempotence passed\n";
}
