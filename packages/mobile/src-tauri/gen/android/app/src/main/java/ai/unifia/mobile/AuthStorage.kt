package ai.unifia.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

private const val AUTH_KEY_ALIAS = "opencode.auth.master"
private const val AUTH_PREFS = "opencode_secure_auth"
private const val WRAPPED_KEY_PREF = "wrapped_key"
private const val AUTH_KEY_BYTES = 32
private const val GCM_IV_BYTES = 12
private const val GCM_TAG_BITS = 128
// Wrapped blob layout: GCM IV, then the AES-GCM ciphertext of the 32-byte key
// with its 128-bit tag appended.
private const val PACKED_KEY_BYTES = GCM_IV_BYTES + AUTH_KEY_BYTES + GCM_TAG_BITS / 8
private const val AUTH_LOG_TAG = "Unifia"

/**
 * The 32-byte key the embedded server encrypts its auth storage with, kept by
 * the AndroidKeyStore.
 *
 * WHY this is not a MainActivity method: server.rs resolves it through JNI from
 * the context wry registers with ndk_context, which on this Tauri version is the
 * Application (OpenCodeApp), not the activity. Both entry points therefore
 * delegate here; a single implementation keeps the two contexts from drifting.
 */
object AuthStorage {
  // The AndroidKeyStore entry and the wrapped key in SharedPreferences have
  // independent lifecycles. A lock-screen credential change, a keystore reset,
  // or an OEM-specific invalidation drops the key while the wrapped blob
  // survives — decryption then fails the GCM tag check on every launch and the
  // embedded server can never start (observed on MIUI: keystore2 reports
  // `finish: KeyMint::finish failed / ErrorCode(-30)` = VERIFICATION_FAILED).
  // Re-key rather than stay bricked: whatever the lost key protected is already
  // unrecoverable, so keeping the stale blob buys nothing.
  fun key(context: Context): String =
    try {
      loadOrCreate(context)
    } catch (e: GeneralSecurityException) {
      rekey(context, e)
    } catch (e: IllegalStateException) {
      rekey(context, e)
    } catch (e: IllegalArgumentException) {
      // Base64.decode on a truncated or malformed wrapped_key.
      rekey(context, e)
    }

  // Drops the unusable key material so the next load regenerates it. Any
  // second failure propagates — one recovery attempt, never a retry loop.
  private fun rekey(context: Context, cause: Exception): String {
    Log.w(AUTH_LOG_TAG, "secure auth storage unusable, re-keying", cause)
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (store.containsAlias(AUTH_KEY_ALIAS)) store.deleteEntry(AUTH_KEY_ALIAS)
    // commit(), not apply(): the regeneration below reads this file back, so the
    // removal has to be durable before it runs.
    context.getSharedPreferences(AUTH_PREFS, Context.MODE_PRIVATE).edit().remove(WRAPPED_KEY_PREF).commit()
    return loadOrCreate(context)
  }

  private fun loadOrCreate(context: Context): String {
    val alias = AUTH_KEY_ALIAS
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!store.containsAlias(alias)) {
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(
        KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setUserAuthenticationRequired(false)
          .build(),
      )
      generator.generateKey()
      // Reload: `store` was loaded before this alias existed. AndroidKeyStore
      // key generation goes through a separate system service (keystore2/
      // Keymint) — on some OEM builds (observed on MIUI) a `KeyStore` handle
      // loaded before the key was created does not reliably see it on the
      // very next `getKey()` call, so `getKey()` returns null and the
      // `Cipher.init()` below throws immediately. Reloading forces a fresh
      // read of the current alias set before we ever touch the new key.
      store.load(null)
    }
    val key = store.getKey(alias, null)
      ?: throw IllegalStateException("AndroidKeyStore alias '$alias' exists but getKey() returned null")
    val prefs = context.getSharedPreferences(AUTH_PREFS, Context.MODE_PRIVATE)
    val wrapped = prefs.getString(WRAPPED_KEY_PREF, null)
    val raw = if (wrapped == null) {
      ByteArray(AUTH_KEY_BYTES).also { SecureRandom().nextBytes(it) }.also { keyBytes ->
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        prefs.edit().putString(WRAPPED_KEY_PREF, Base64.encodeToString(cipher.iv + cipher.doFinal(keyBytes), Base64.NO_WRAP)).apply()
      }
    } else {
      val packed = Base64.decode(wrapped, Base64.NO_WRAP)
      // Guard before slicing: a truncated blob would raise
      // ArrayIndexOutOfBoundsException, which key() does not treat as
      // recoverable. IllegalStateException routes it to the re-key path.
      check(packed.size == PACKED_KEY_BYTES) {
        "wrapped auth key is ${packed.size} bytes, expected $PACKED_KEY_BYTES"
      }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, packed.copyOfRange(0, GCM_IV_BYTES)))
      cipher.doFinal(packed.copyOfRange(GCM_IV_BYTES, packed.size))
    }
    check(raw.size == AUTH_KEY_BYTES) { "auth key is ${raw.size} bytes, expected $AUTH_KEY_BYTES" }
    return Base64.encodeToString(raw, Base64.NO_WRAP)
  }
}
