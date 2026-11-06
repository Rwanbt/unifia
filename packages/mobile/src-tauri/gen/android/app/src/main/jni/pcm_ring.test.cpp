// SPDX-License-Identifier: MIT
#include "pcm_ring.h"
#include <cassert>
#include <iostream>
#include <thread>
#include <vector>

using unifia::voice::SampleRing;

void reused_scratch_underflow_is_silent() {
  for (const uint32_t frames : {192, 512, 2048, 3000, 4096, 5000}) {
    for (const uint32_t available : {0, 1, 512, 2048, 2400}) {
      SampleRing ring;
      std::vector<int16_t> input(available, 7000);
      ring.push(input.data(), available);
      std::array<int16_t, 2048> scratch{};
      uint32_t accepted = 0;
      for (uint32_t offset = 0; offset < frames;) {
        const auto count = std::min(uint32_t(scratch.size()), frames - offset);
        accepted += ring.pop(scratch.data(), count);
        for (uint32_t index = 0; index < count; ++index) {
          assert(scratch[index] == (offset + index < available ? 7000 : 0));
        }
        offset += count;
      }
      assert(accepted == std::min(frames, available));
    }
  }
}

void wrap_backpressure_and_clear_preserve_fifo() {
  SampleRing ring;
  constexpr auto capacity = unifia::voice::kRingCapacity - 1;
  std::vector<int16_t> input(capacity + 10, 1234), output(capacity + 10, -1);
  assert(ring.push(input.data(), input.size()) == capacity);
  assert(ring.push(input.data(), 1) == 0);
  assert(ring.pop(output.data(), capacity - 10) == capacity - 10);
  std::fill(input.begin(), input.end(), 5678);
  assert(ring.push(input.data(), 100) == 100);
  assert(ring.pop(output.data(), 120) == 110);
  for (uint32_t index = 0; index < 120; ++index) {
    assert(output[index] == (index < 10 ? 1234 : index < 110 ? 5678 : 0));
  }
  assert(ring.push(input.data(), 10) == 10);
  ring.clear();
  assert(ring.pop(output.data(), 20) == 0);
  for (int index = 0; index < 20; ++index) assert(output[index] == 0);
}

void concurrent_producer_consumer_preserve_order() {
  SampleRing ring;
  constexpr uint32_t count = 400000;
  std::thread producer([&] {
    for (uint32_t index = 0; index < count;) {
      const auto sample = static_cast<int16_t>(index % 30000);
      index += ring.push(&sample, 1);
    }
  });
  for (uint32_t index = 0; index < count;) {
    int16_t sample = -1;
    if (ring.pop(&sample, 1) == 0) { assert(sample == 0); continue; }
    assert(sample == static_cast<int16_t>(index % 30000));
    ++index;
  }
  producer.join();
}

int main() {
  reused_scratch_underflow_is_silent();
  wrap_backpressure_and_clear_preserve_fifo();
  concurrent_producer_consumer_preserve_order();
  std::cout << "PCM ring: 30 callback cases, zero tail, wrap, backpressure, clear, concurrent FIFO passed\n";
}
