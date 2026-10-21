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
    std::cout << "Pocket streaming: batching, continuity, text joins, tail, cancellation passed\n";
}
