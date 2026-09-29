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

# WHY these FetchContent names are so short: CMake repeats the declared name
# four times inside the population stamp tree
#   <binary>/_deps/<name>-subbuild/<name>-populate-prefix/src/
#            <name>-populate-stamp/<name>-populate-done
# and Gradle already puts <binary> at
#   gen/android/app/.cxx/RelWithDebInfo/<hash>/<abi>/
# The descriptive name `pocket_onnxruntime_aar` makes that stamp file 264
# characters, and ninja then dies with a bare
# "Stat(...): Filename longer than 260 characters" during *configure*, before
# a single object file is compiled. The short names below bring the longest
# stamp path to ~204 characters, leaving headroom for a deeper checkout.
# Do not rename these back to something readable without re-checking the
# resulting path length on Windows.
FetchContent_Declare(pok_ort
    URL https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/1.23.0/onnxruntime-android-1.23.0.aar
    URL_HASH SHA256=2b7e4ed3c3028a1b2afac8dc324442c70b8983fc1a7cb6adda4133030d53f20a
    DOWNLOAD_NAME onnxruntime-android-1.23.0.zip
)
FetchContent_GetProperties(pok_ort)
if(NOT pok_ort_POPULATED)
    FetchContent_Populate(pok_ort)
endif()

set(SPM_ENABLE_SHARED OFF CACHE BOOL "" FORCE)
set(SPM_ENABLE_TCMALLOC OFF CACHE BOOL "" FORCE)
set(SPM_PROTOBUF_PROVIDER "internal" CACHE STRING "" FORCE)
set(SPM_ABSL_PROVIDER "internal" CACHE STRING "" FORCE)
set(SPM_ENABLE_NFKC_COMPILE OFF CACHE BOOL "" FORCE)
FetchContent_Declare(pok_spm
    URL https://github.com/google/sentencepiece/archive/refs/tags/v0.2.1.tar.gz
    URL_HASH SHA256=c1a59e9259c9653ad0ade653dadff074cd31f0a6ff2a11316f67bee4189a8f1b
)
FetchContent_GetProperties(pok_spm)
if(NOT pok_spm_POPULATED)
    # WHY link_libraries(log): sentencepiece compiles protobuf-lite in, and
    # protobuf-lite's default Android log handler calls __android_log_write.
    # Upstream guards that with `if(ANDROID) target_link_libraries(sentencepiece
    # log)`, but only on the SHARED target — which SPM_ENABLE_SHARED=OFF above
    # removes — so with the static build every consumer of libsentencepiece.a is
    # left with an unresolved symbol and ld.lld fails the *tools* first:
    #   ld.lld: error: undefined symbol: __android_log_write
    #   referenced by common.cc:150 (third_party/protobuf-lite/common.cc)
    # link_libraries applies to every target created in this directory and
    # below, which covers the five spm_* executables that add_subdirectory
    # builds unconditionally (there is no upstream option to skip them).
    link_libraries(log)
    FetchContent_Populate(pok_spm)
    add_subdirectory(${pok_spm_SOURCE_DIR} ${pok_spm_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()
target_compile_options(sentencepiece-static PRIVATE -w)

FetchContent_Declare(pok_dr
    URL https://github.com/mackron/dr_libs/archive/dfe8377631000664666519fdb83da193fd8037f4.tar.gz
    URL_HASH SHA256=4654acb029f4f2a43ac2edb60c4cb09f40615b4b5bee9709954f910cb979e5fd
)
FetchContent_GetProperties(pok_dr)
if(NOT pok_dr_POPULATED)
    FetchContent_Populate(pok_dr)
endif()

add_library(pocket_onnxruntime SHARED IMPORTED)
set_target_properties(pocket_onnxruntime PROPERTIES
    IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/../../jniLibs/${ANDROID_ABI}/libonnxruntime.so
)

add_library(pocket_tts SHARED pocket_tts.cpp)
target_compile_definitions(pocket_tts PRIVATE PTT_SHARED_LIB)
target_include_directories(pocket_tts PRIVATE
    ${pok_ort_SOURCE_DIR}/headers
    ${pok_spm_SOURCE_DIR}/src
    ${pok_dr_SOURCE_DIR}
)
target_link_libraries(pocket_tts PRIVATE pocket_onnxruntime sentencepiece-static log)
