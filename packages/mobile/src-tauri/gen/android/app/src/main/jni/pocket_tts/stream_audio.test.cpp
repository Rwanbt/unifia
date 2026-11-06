// SPDX-License-Identifier: MIT
// Host: g++ -std=c++17 -Wall -Wextra -Werror stream_audio.test.cpp -o stream-audio-test
#include "stream_audio.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <stdexcept>

int main() {
    using pocket_tts::decode_batch;
    assert(decode_batch(0, true, 1, 15) == 0);
    assert(decode_batch(1, true, 1, 15) == 1);
    assert(decode_batch(2, false, 1, 15) == 2);
    assert(decode_batch(40, false, 1, 15) == 15);

    std::vector<float> output;
    const auto emit = [&](const float* samples, std::size_t count) {
        output.insert(output.end(), samples, samples + count);
        return true;
    };
    std::vector<float> ramp(1000);
    for (std::size_t index = 0; index < ramp.size(); ++index) ramp[index] = float(index);
    pocket_tts::PcmJoiner chunks;
    for (std::size_t offset = 0; offset < ramp.size(); offset += 17) {
        assert(chunks.append(ramp.data() + offset, std::min(std::size_t(17), ramp.size() - offset), offset == 0, emit));
    }
    assert(chunks.finish(emit));
    assert(output == ramp);

    output.clear();
    pocket_tts::PcmJoiner sentences;
    const std::vector<float> positive(300, 1.0f);
    const std::vector<float> negative(300, -1.0f);
    assert(sentences.append(positive.data(), positive.size(), true, emit));
    assert(sentences.append(negative.data(), negative.size(), true, emit));
    assert(sentences.finish(emit));
    assert(output.size() == 360);
    assert(output.front() == 1.0f && output.back() == -1.0f);
    for (std::size_t index = 1; index < output.size(); ++index) {
        assert(std::abs(output[index] - output[index - 1]) < 0.02f);
    }

    output.clear();
    pocket_tts::PcmJoiner short_audio;
    assert(short_audio.append(ramp.data(), 1, true, emit));
    assert(short_audio.append(nullptr, 0, true, emit));
    assert(output.empty());
    assert(short_audio.finish(emit));
    assert(output == std::vector<float>{0});
    assert(short_audio.finish(emit));
    assert(output.size() == 1);

    pocket_tts::PcmJoiner cancelled;
    assert(!cancelled.append(ramp.data(), ramp.size(), true,
                            [](const float*, std::size_t) { return false; }));

    std::mutex mutex;
    std::condition_variable ready;
    bool aborted = false;
    bool joined = false;
    try {
        std::thread producer([&] {
            std::unique_lock<std::mutex> lock(mutex);
            ready.wait(lock, [&] { return aborted; });
            joined = true;
        });
        pocket_tts::GenerationJoiner guard(producer, mutex, ready, aborted);
        throw std::runtime_error("decoder failure");
    } catch (const std::runtime_error&) {
        assert(joined);
    }
    // Silence limiter: a long gap is cut to max_run, a short pause and every
    // audible sample survive, and order is preserved across pushes.
    output.clear();
    pocket_tts::SilenceLimiter limiter(10);
    std::vector<float> speech_gap_speech(5, 0.5f);
    speech_gap_speech.insert(speech_gap_speech.end(), 30, 0.0f);
    speech_gap_speech.insert(speech_gap_speech.end(), 5, -0.5f);
    speech_gap_speech.insert(speech_gap_speech.end(), 4, 0.0f);
    speech_gap_speech.insert(speech_gap_speech.end(), 5, 0.25f);
    for (std::size_t offset = 0; offset < speech_gap_speech.size(); offset += 7) {
        assert(limiter.push(speech_gap_speech.data() + offset,
                            std::min(std::size_t(7), speech_gap_speech.size() - offset), emit));
    }
    assert(limiter.finish(emit));
    std::vector<float> expected(5, 0.5f);
    expected.insert(expected.end(), 10, 0.0f);
    expected.insert(expected.end(), 5, -0.5f);
    expected.insert(expected.end(), 4, 0.0f);
    expected.insert(expected.end(), 5, 0.25f);
    assert(output == expected);

    output.clear();
    pocket_tts::SilenceLimiter trailing(3);
    const std::vector<float> tail{0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
    assert(trailing.push(tail.data(), tail.size(), emit));
    assert(output == std::vector<float>{0.5f});
    assert(trailing.finish(emit));
    assert((output == std::vector<float>{0.5f, 0.0f, 0.0f, 0.0f}));

    std::cout << "Pocket streaming: batching, continuity, text joins, tail, cancellation, silence limit passed\n";
}
