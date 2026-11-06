// SPDX-License-Identifier: MIT
#pragma once

#include <algorithm>
#include <cmath>
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

// Shortens long silences without touching audible samples. Every text chunk
// restarts generation from the voice prompt, so a chunk join carries the
// previous chunk's post-EOS frames plus the prompt's own trailing silence:
// 1.1 to 2.7 s on a long French answer, against at most 0.74 s from the
// official runtime on the same text. Runs longer than `max_run` keep only
// their first `max_run` samples; shorter pauses pass through unchanged.
class SilenceLimiter {
    static constexpr float silence_level = 0.003f;  // about -50 dBFS
    std::size_t max_run_;
    std::size_t run_ = 0;
    std::vector<float> held_;

public:
    explicit SilenceLimiter(std::size_t max_run) : max_run_(max_run) {}

    template<class Emit>
    bool push(const float* samples, std::size_t count, Emit&& emit) {
        std::vector<float> out;
        out.reserve(count + held_.size());
        for (std::size_t index = 0; index < count; ++index) {
            const float sample = samples[index];
            if (std::abs(sample) < silence_level) {
                if (run_++ < max_run_) held_.push_back(sample);
                continue;
            }
            out.insert(out.end(), held_.begin(), held_.end());
            held_.clear();
            run_ = 0;
            out.push_back(sample);
        }
        return out.empty() || emit(out.data(), out.size());
    }

    template<class Emit>
    bool finish(Emit&& emit) {
        auto pcm = std::move(held_);
        held_.clear();
        run_ = 0;
        return pcm.empty() || emit(pcm.data(), pcm.size());
    }
};

} // namespace pocket_tts
