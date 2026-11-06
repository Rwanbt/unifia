// SPDX-License-Identifier: MIT
#pragma once

#include <string>
#include <string_view>

namespace pocket_tts {

inline std::string normalize_apostrophes(const std::string& text) {
    // SentencePiece recognizes ASCII apostrophes but represents typographic
    // variants as byte fallback tokens, giving equivalent elisions different input.
    constexpr std::string_view quotes[] = {
        "\xe2\x80\x99", "\xe2\x80\x98", "\xca\xbc", "\xef\xbc\x87",
    };
    std::string normalized;
    normalized.reserve(text.size());
    for (std::size_t offset = 0; offset < text.size();) {
        std::size_t matched = 0;
        for (const auto quote : quotes) {
            if (text.compare(offset, quote.size(), quote.data(), quote.size()) != 0) continue;
            matched = quote.size();
            break;
        }
        normalized += matched == 0 ? text[offset] : '\'';
        offset += matched == 0 ? 1 : matched;
    }
    return normalized;
}

} // namespace pocket_tts
