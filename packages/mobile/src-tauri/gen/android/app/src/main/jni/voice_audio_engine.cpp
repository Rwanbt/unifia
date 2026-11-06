// SPDX-License-Identifier: MIT
#include <array>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <memory>

#include <oboe/Oboe.h>
#include "pcm_ring.h"

namespace {

constexpr int32_t kCanonicalSampleRate = 48'000;
constexpr uint32_t kMaximumCallbackFrames = 2'048;

using unifia::voice::SampleRing;

struct PlaybackTraceStats {
  uint64_t outputFrames;
  uint32_t droppedSamples;
  uint32_t maxCallbackFrames;
};
static_assert(sizeof(PlaybackTraceStats) == 16);
static_assert(std::atomic<uint64_t>::is_always_lock_free);

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
        // WHY Media and not VoiceCommunication: VoiceCommunication is the
        // voice-call path. Android attenuates it by a fixed amount, routes it
        // to the call volume instead of the media volume, and runs the voice
        // EQ on it. On the Xiaomi that showed up as a read-aloud that is
        // several decibels too quiet -- measured source peaks are -6.5 to
        // -8.4 dBFS, so the audio itself is fine and the path was eating it --
        // plus a processed, "soundtrack" character while the model was
        // thinking. ContentType::Speech already carries the "this is speech"
        // hint; Media is the usage that puts it on the media stream, which is
        // what the WebAudio read-aloud path already uses and what Android's own
        // TTS uses. The input stream keeps VoiceCommunication, which is where
        // the AEC and noise suppression belong.
        ->setUsage(oboe::Usage::Media)
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
      if (count > maxCallbackFrames_.load(std::memory_order_relaxed)) {
        maxCallbackFrames_.store(count, std::memory_order_relaxed);
      }
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
        if (traceEnabled_.load(std::memory_order_acquire)) {
          const auto copied = trace_.push(monoSamples.data(), chunkFrames);
          traceDropped_.fetch_add(chunkFrames - copied, std::memory_order_relaxed);
          traceFrames_.fetch_add(chunkFrames, std::memory_order_relaxed);
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

  void traceEnabled(bool enabled) noexcept {
    traceEnabled_.store(enabled, std::memory_order_release);
  }

  uint32_t traceRead(int16_t* samples, uint32_t capacity, PlaybackTraceStats* stats) noexcept {
    const auto count = trace_.pop(samples, capacity);
    stats->outputFrames = traceFrames_.load(std::memory_order_relaxed);
    stats->droppedSamples = traceDropped_.load(std::memory_order_relaxed);
    stats->maxCallbackFrames = maxCallbackFrames_.load(std::memory_order_relaxed);
    return count;
  }

  int32_t sampleRate() const noexcept {
    return input_ ? input_->getSampleRate() : 0;
  }

  int32_t framesPerBurst() const noexcept {
    return input_ ? input_->getFramesPerBurst() : 0;
  }

  int64_t audioClockFrames() const noexcept {
    return input_ ? input_->getFramesRead() : 0;
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
  SampleRing trace_;
  std::atomic<bool> traceEnabled_{false};
  std::atomic<uint64_t> traceFrames_{0};
  std::atomic<uint32_t> traceDropped_{0};
  std::atomic<uint32_t> maxCallbackFrames_{0};
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
  int64_t audioClockFrames;
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
  stats->audioClockFrames = engine->audioClockFrames();
  stats->sampleRate = engine->sampleRate();
  stats->framesPerBurst = engine->framesPerBurst();
  stats->xrunCount = engine->xrunCount();
  stats->lastError = engine->lastError();
  stats->captureOverflows = engine->captureOverflows();
  stats->playbackOverflows = engine->playbackOverflows();
  stats->playbackEmptySamples = engine->playbackEmptySamples();
}

void voice_audio_trace_enable(void* handle, uint32_t enabled) noexcept {
  if (auto* engine = engineFor(handle)) engine->traceEnabled(enabled != 0);
}

uint32_t voice_audio_trace_read(void* handle, int16_t* samples, uint32_t capacity,
                               PlaybackTraceStats* stats) noexcept {
  auto* engine = engineFor(handle);
  if (engine == nullptr || samples == nullptr || stats == nullptr) return 0;
  return engine->traceRead(samples, capacity, stats);
}

}  // extern "C"
