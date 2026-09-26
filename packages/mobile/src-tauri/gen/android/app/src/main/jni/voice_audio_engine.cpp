// SPDX-License-Identifier: MIT
#include <array>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <memory>

#include <oboe/Oboe.h>

namespace {

constexpr int32_t kCanonicalSampleRate = 48'000;
constexpr uint32_t kRingCapacity = 65'536;
constexpr uint32_t kMaximumCallbackFrames = 2'048;

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
    const uint32_t accepted = count < available ? count : available;
    for (uint32_t index = 0; index < accepted; ++index) {
      samples_[(write + index) % kRingCapacity] = input[index];
    }
    write_.store(write + accepted, std::memory_order_release);
    return accepted;
  }

  uint32_t pop(int16_t* output, uint32_t count) noexcept {
    const uint32_t read = read_.load(std::memory_order_relaxed);
    const uint32_t write = write_.load(std::memory_order_acquire);
    const uint32_t available = write - read;
    const uint32_t accepted = count < available ? count : available;
    for (uint32_t index = 0; index < accepted; ++index) {
      output[index] = samples_[(read + index) % kRingCapacity];
    }
    read_.store(read + accepted, std::memory_order_release);
    return accepted;
  }

 private:
  std::array<int16_t, kRingCapacity> samples_{};
  std::atomic<uint32_t> read_{0};
  std::atomic<uint32_t> write_{0};
};

class VoiceAudioEngine final : public oboe::AudioStreamDataCallback,
                               public oboe::AudioStreamErrorCallback {
 public:
  oboe::Result open() noexcept {
    if (input_ || output_) return oboe::Result::ErrorInvalidState;
    capture_.clear();
    playback_.clear();
    captureOverflows_.store(0, std::memory_order_relaxed);
    playbackOverflows_.store(0, std::memory_order_relaxed);
    playbackEmptySamples_.store(0, std::memory_order_relaxed);
    lastError_.store(0, std::memory_order_relaxed);
    oboe::AudioStreamBuilder inputBuilder;
    inputBuilder.setDirection(oboe::Direction::Input)
        ->setSampleRate(kCanonicalSampleRate)
        ->setChannelCount(oboe::ChannelCount::Mono)
        ->setFormat(oboe::AudioFormat::I16)
        ->setInputPreset(oboe::InputPreset::VoiceCommunication)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Shared)
        ->setDataCallback(this)
        ->setErrorCallback(this);
    auto result = inputBuilder.openStream(input_);
    if (result != oboe::Result::OK) return result;
    if (input_->getFormat() != oboe::AudioFormat::I16 ||
        input_->getSampleRate() != kCanonicalSampleRate) {
      closeStream(input_);
      return oboe::Result::ErrorInvalidFormat;
    }

    oboe::AudioStreamBuilder outputBuilder;
    outputBuilder.setDirection(oboe::Direction::Output)
        ->setSampleRate(kCanonicalSampleRate)
        ->setChannelCount(oboe::ChannelCount::Mono)
        ->setFormat(oboe::AudioFormat::I16)
        ->setUsage(oboe::Usage::VoiceCommunication)
        ->setContentType(oboe::ContentType::Speech)
        ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
        ->setSharingMode(oboe::SharingMode::Shared)
        ->setDataCallback(this)
        ->setErrorCallback(this);
    result = outputBuilder.openStream(output_);
    if (result != oboe::Result::OK) {
      closeStream(input_);
      return result;
    }
    if (output_->getFormat() != oboe::AudioFormat::I16 ||
        output_->getSampleRate() != kCanonicalSampleRate) {
      closeStream(output_);
      closeStream(input_);
      return oboe::Result::ErrorInvalidFormat;
    }

    result = input_->requestStart();
    if (result != oboe::Result::OK) {
      closeStream(output_);
      closeStream(input_);
      return result;
    }
    result = output_->requestStart();
    if (result != oboe::Result::OK) {
      closeStream(output_);
      closeStream(input_);
      return result;
    }
    return oboe::Result::OK;
  }

  void close() noexcept {
    closeStream(output_);
    closeStream(input_);
  }

  oboe::DataCallbackResult onAudioReady(oboe::AudioStream* stream, void* audioData,
                                        int32_t frameCount) noexcept override {
    if (frameCount <= 0 || audioData == nullptr) return oboe::DataCallbackResult::Continue;
    auto* samples = static_cast<int16_t*>(audioData);
    const auto count = static_cast<uint32_t>(frameCount);
    if (stream->getDirection() == oboe::Direction::Input) {
      const uint32_t channels = static_cast<uint32_t>(stream->getChannelCount());
      if (channels == 0) return oboe::DataCallbackResult::Continue;
      std::array<int16_t, kMaximumCallbackFrames> monoSamples{};
      uint32_t offset = 0;
      while (offset < count) {
        const uint32_t chunkFrames = std::min(kMaximumCallbackFrames, count - offset);
        for (uint32_t frame = 0; frame < chunkFrames; ++frame) {
          int32_t sum = 0;
          for (uint32_t channel = 0; channel < channels; ++channel) {
            sum += samples[(offset + frame) * channels + channel];
          }
          monoSamples[frame] = static_cast<int16_t>(sum / static_cast<int32_t>(channels));
        }
        const uint32_t accepted = capture_.push(monoSamples.data(), chunkFrames);
        if (accepted != chunkFrames) {
          captureOverflows_.fetch_add(chunkFrames - accepted, std::memory_order_relaxed);
        }
        offset += chunkFrames;
      }
    } else {
      const uint32_t channels = static_cast<uint32_t>(stream->getChannelCount());
      if (channels == 0) return oboe::DataCallbackResult::Continue;
      std::array<int16_t, kMaximumCallbackFrames> monoSamples{};
      uint32_t offset = 0;
      while (offset < count) {
        const uint32_t chunkFrames = std::min(kMaximumCallbackFrames, count - offset);
        const uint32_t rendered = playback_.pop(monoSamples.data(), chunkFrames);
        if (rendered < chunkFrames) {
          playbackEmptySamples_.fetch_add(chunkFrames - rendered, std::memory_order_relaxed);
        }
        for (uint32_t frame = 0; frame < chunkFrames; ++frame) {
          for (uint32_t channel = 0; channel < channels; ++channel) {
            samples[(offset + frame) * channels + channel] = monoSamples[frame];
          }
        }
        offset += chunkFrames;
      }
    }
    return oboe::DataCallbackResult::Continue;
  }

  void onErrorAfterClose(oboe::AudioStream*, oboe::Result error) noexcept override {
    lastError_.store(static_cast<int32_t>(error), std::memory_order_relaxed);
  }

  uint32_t read(int16_t* samples, uint32_t capacity) noexcept {
    return capture_.pop(samples, capacity);
  }

  uint32_t write(const int16_t* samples, uint32_t count) noexcept {
    const uint32_t accepted = playback_.push(samples, count);
    if (accepted != count) playbackOverflows_.fetch_add(count - accepted, std::memory_order_relaxed);
    return accepted;
  }

  int32_t sampleRate() const noexcept {
    return input_ ? input_->getSampleRate() : 0;
  }

  int32_t framesPerBurst() const noexcept {
    return input_ ? input_->getFramesPerBurst() : 0;
  }

  int32_t xrunCount() const noexcept {
    const auto inputResult = input_ && input_->isXRunCountSupported()
                                 ? input_->getXRunCount()
                                 : oboe::ResultWithValue<int32_t>(0);
    const auto outputResult = output_ && output_->isXRunCountSupported()
                                  ? output_->getXRunCount()
                                  : oboe::ResultWithValue<int32_t>(0);
    const int32_t inputCount = inputResult ? inputResult.value() : 0;
    const int32_t outputCount = outputResult ? outputResult.value() : 0;
    return (inputCount < 0 ? 0 : inputCount) + (outputCount < 0 ? 0 : outputCount);
  }

  uint32_t captureOverflows() const noexcept { return captureOverflows_.load(); }
  uint32_t playbackOverflows() const noexcept { return playbackOverflows_.load(); }
  uint32_t playbackEmptySamples() const noexcept { return playbackEmptySamples_.load(); }
  int32_t lastError() const noexcept { return lastError_.load(); }

 private:
  static void closeStream(std::shared_ptr<oboe::AudioStream>& stream) noexcept {
    if (!stream) return;
    stream->requestStop();
    stream->close();
    stream.reset();
  }

  SampleRing capture_;
  SampleRing playback_;
  std::shared_ptr<oboe::AudioStream> input_;
  std::shared_ptr<oboe::AudioStream> output_;
  std::atomic<uint32_t> captureOverflows_{0};
  std::atomic<uint32_t> playbackOverflows_{0};
  std::atomic<uint32_t> playbackEmptySamples_{0};
  std::atomic<int32_t> lastError_{0};
};

struct VoiceAudioHandle {
  std::unique_ptr<VoiceAudioEngine> engine = std::make_unique<VoiceAudioEngine>();
};

VoiceAudioEngine* engineFor(void* handle) noexcept {
  return handle == nullptr ? nullptr : static_cast<VoiceAudioHandle*>(handle)->engine.get();
}

}  // namespace

extern "C" {

struct VoiceAudioStats {
  int32_t sampleRate;
  int32_t framesPerBurst;
  int32_t xrunCount;
  int32_t lastError;
  uint32_t captureOverflows;
  uint32_t playbackOverflows;
  uint32_t playbackEmptySamples;
};

void* voice_audio_create() noexcept {
  return std::make_unique<VoiceAudioHandle>().release();
}

void voice_audio_destroy(void* handle) noexcept {
  std::unique_ptr<VoiceAudioHandle> owner(static_cast<VoiceAudioHandle*>(handle));
  if (owner && owner->engine) owner->engine->close();
}

int32_t voice_audio_open(void* handle) noexcept {
  auto* engine = engineFor(handle);
  return engine == nullptr ? static_cast<int32_t>(oboe::Result::ErrorNull) : static_cast<int32_t>(engine->open());
}

void voice_audio_close(void* handle) noexcept {
  if (auto* engine = engineFor(handle)) engine->close();
}

uint32_t voice_audio_read(void* handle, int16_t* samples, uint32_t capacity) noexcept {
  auto* engine = engineFor(handle);
  return engine == nullptr || samples == nullptr ? 0 : engine->read(samples, capacity);
}

uint32_t voice_audio_write(void* handle, const int16_t* samples, uint32_t count) noexcept {
  auto* engine = engineFor(handle);
  return engine == nullptr || samples == nullptr ? 0 : engine->write(samples, count);
}

void voice_audio_stats(void* handle, VoiceAudioStats* stats) noexcept {
  auto* engine = engineFor(handle);
  if (engine == nullptr || stats == nullptr) return;
  stats->sampleRate = engine->sampleRate();
  stats->framesPerBurst = engine->framesPerBurst();
  stats->xrunCount = engine->xrunCount();
  stats->lastError = engine->lastError();
  stats->captureOverflows = engine->captureOverflows();
  stats->playbackOverflows = engine->playbackOverflows();
  stats->playbackEmptySamples = engine->playbackEmptySamples();
}

}  // extern "C"
