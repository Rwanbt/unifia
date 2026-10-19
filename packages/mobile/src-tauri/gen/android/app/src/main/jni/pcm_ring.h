// SPDX-License-Identifier: MIT
#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>

namespace unifia::voice {

inline constexpr uint32_t kRingCapacity = 65'536;

// One producer and one consumer. clear() requires both to be stopped.
class SampleRing {
 public:
  void clear() noexcept {
    read_.store(0, std::memory_order_relaxed);
    write_.store(0, std::memory_order_relaxed);
  }

  uint32_t push(const int16_t* input, uint32_t count) noexcept {
    const uint32_t write = write_.load(std::memory_order_relaxed);
    const uint32_t read = read_.load(std::memory_order_acquire);
    const uint32_t available = kRingCapacity - (write - read) - 1;
    const uint32_t accepted = std::min(count, available);
    for (uint32_t index = 0; index < accepted; ++index) {
      samples_[(write + index) % kRingCapacity] = input[index];
    }
    write_.store(write + accepted, std::memory_order_release);
    return accepted;
  }

  // Returns accepted frames and initializes the full requested output span.
  uint32_t pop(int16_t* output, uint32_t count) noexcept {
    const uint32_t read = read_.load(std::memory_order_relaxed);
    const uint32_t write = write_.load(std::memory_order_acquire);
    const uint32_t accepted = std::min(count, write - read);
    for (uint32_t index = 0; index < accepted; ++index) {
      output[index] = samples_[(read + index) % kRingCapacity];
    }
    // Large callbacks reuse scratch storage for multiple sub-blocks. A short
    // read must not replay PCM left there by the preceding sub-block.
    if (accepted < count) std::fill(output + accepted, output + count, int16_t{0});
    read_.store(read + accepted, std::memory_order_release);
    return accepted;
  }

 private:
  std::array<int16_t, kRingCapacity> samples_{};
  std::atomic<uint32_t> read_{0};
  std::atomic<uint32_t> write_{0};
};

} // namespace unifia::voice
