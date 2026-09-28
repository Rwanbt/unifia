# SPDX-License-Identifier: MIT
#
# libpocket_tts.so — the Pocket TTS runtime (PocketTTS.cpp, MIT) for Android.
# Loaded by Rust (src/voice/pocket_tts.rs) through its C ABI (ptt_*); see
# PROVENANCE.md for the pinned upstream source and the local patch.
#
# It links the libonnxruntime.so already bundled for Parakeet/Silero/Smart
# Turn, so the headers must come from that exact release: the official
# onnxruntime-android 1.23.0 AAR, pinned by SHA-256 like everywhere else
# (packages/mobile/native-versions.json).

include(FetchContent)

FetchContent_Declare(pocket_onnxruntime_aar
    URL https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.23.0/onnxruntime-android-1.23.0.aar
    URL_HASH SHA256=2b7e4ed3c3028a1b2afac8dc324442c70b8983fc1a7cb6adda4133030d53f20a
    DOWNLOAD_NAME onnxruntime-android-1.23.0.zip
)
FetchContent_GetProperties(pocket_onnxruntime_aar)
if(NOT pocket_onnxruntime_aar_POPULATED)
    FetchContent_Populate(pocket_onnxruntime_aar)
endif()

set(SPM_ENABLE_SHARED OFF CACHE BOOL "" FORCE)
set(SPM_ENABLE_TCMALLOC OFF CACHE BOOL "" FORCE)
set(SPM_PROTOBUF_PROVIDER "internal" CACHE STRING "" FORCE)
set(SPM_ABSL_PROVIDER "internal" CACHE STRING "" FORCE)
set(SPM_ENABLE_NFKC_COMPILE OFF CACHE BOOL "" FORCE)
FetchContent_Declare(pocket_sentencepiece
    URL https://github.com/google/sentencepiece/archive/refs/tags/v0.2.1.tar.gz
    URL_HASH SHA256=c1a59e9259c9653ad0ade653dadff074cd31f0a6ff2a11316f67bee4189a8f1b
)
FetchContent_GetProperties(pocket_sentencepiece)
if(NOT pocket_sentencepiece_POPULATED)
    FetchContent_Populate(pocket_sentencepiece)
    add_subdirectory(${pocket_sentencepiece_SOURCE_DIR} ${pocket_sentencepiece_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()
target_compile_options(sentencepiece-static PRIVATE -w)

FetchContent_Declare(pocket_dr_libs
    URL https://github.com/mackron/dr_libs/archive/dfe8377631000664666519fdb83da193fd8037f4.tar.gz
    URL_HASH SHA256=4654acb029f4f2a43ac2edb60c4cb09f40615b4b5bee9709954f910cb979e5fd
)
FetchContent_GetProperties(pocket_dr_libs)
if(NOT pocket_dr_libs_POPULATED)
    FetchContent_Populate(pocket_dr_libs)
endif()

add_library(pocket_onnxruntime SHARED IMPORTED)
set_target_properties(pocket_onnxruntime PROPERTIES
    IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/../../jniLibs/${ANDROID_ABI}/libonnxruntime.so
)

add_library(pocket_tts SHARED pocket_tts.cpp)
target_compile_definitions(pocket_tts PRIVATE PTT_SHARED_LIB)
target_include_directories(pocket_tts PRIVATE
    ${pocket_onnxruntime_aar_SOURCE_DIR}/headers
    ${pocket_sentencepiece_SOURCE_DIR}/src
    ${pocket_dr_libs_SOURCE_DIR}
)
target_link_libraries(pocket_tts PRIVATE pocket_onnxruntime sentencepiece-static log)
