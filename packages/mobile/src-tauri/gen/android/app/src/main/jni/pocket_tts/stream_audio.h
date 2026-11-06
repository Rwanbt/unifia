// SPDX-License-Identifier: MIT
#pragma once

#include <algorithm>
#include <cstddef>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <utility>
#include <vector>

namespace pocket_tts {

// The decoder can throw while the producer is running. Stop and join before
// stack-owned queue/condition variables disappear, including during unwinding.
class GenerationJoiner {
    std::thread& thread_;
    std::mutex& mutex_;
    std::condition_variable& ready_;
    bool& aborted_;
public:
    GenerationJoiner(std::thread& thread, std::mutex& mutex,
                     std::condition_variable& ready, bool& aborted)
        : thread_(thread), mutex_(mutex), ready_(ready), aborted_(aborted) {}
    GenerationJoiner(const GenerationJoiner&) = delete;
    GenerationJoiner& operator=(const GenerationJoiner&) = delete;
    ~GenerationJoiner() {
        if (!thread_.joinable()) return;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            aborted_ = true;
        }
        ready_.notify_all();
        thread_.join();
    }
};

inline std::size_t decode_batch(std::size_t available, bool first,
                                std::size_t initial, std::size_t maximum) {
    const auto wanted = first ? initial : maximum;
    // Batch what is ready; the cap is not a minimum fill requirement.
    return std::min(available, wanted);
}

class PcmJoiner {
    // Same 10 ms overlap as PocketTTS::generate, retained outside the audio callback.
    static constexpr std::size_t fade_samples = 240;
    std::vector<float> tail_;

public:
    template<class Emit>
    bool append(const float* samples, std::size_t count, bool boundary, Emit&& emit) {
        if (count == 0) return true;
        auto pcm = std::move(tail_);
        const auto overlap = boundary ? std::min(pcm.size(), count) : 0;
        for (std::size_t index = 0; index < overlap; ++index) {
            const auto mix = float(index + 1) / float(overlap + 1);
            auto& sample = pcm[pcm.size() - overlap + index];
            sample = sample * (1.0f - mix) + samples[index] * mix;
        }
        pcm.insert(pcm.end(), samples + overlap, samples + count);
        const auto ready = pcm.size() - std::min(pcm.size(), fade_samples);
        tail_.assign(pcm.begin() + ready, pcm.end());
        return ready == 0 || emit(pcm.data(), ready);
    }

    template<class Emit>
    bool finish(Emit&& emit) {
        auto pcm = std::move(tail_);
        tail_.clear();
        return pcm.empty() || emit(pcm.data(), pcm.size());
    }
};

} // namespace pocket_tts
