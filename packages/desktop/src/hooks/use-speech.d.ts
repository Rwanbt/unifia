/* SPDX-License-Identifier: MIT */
/**
 * Speech hooks for desktop.
 * STT: record mic → WAV → Parakeet ONNX → text in editor
 * TTS: managed Pocket worker → WAV file → audio playback
 */
export declare function initSpeechListeners(): void;
export declare function cleanupSpeechListeners(): void;
