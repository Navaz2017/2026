package mw.enrolla.smsforwarder

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Device id + HMAC key live in the Android Keystore-backed encrypted prefs, never plain text. */
class Settings(ctx: Context) {
    private val p = EncryptedSharedPreferences.create(
        ctx, "secure_settings",
        MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    var baseUrl: String get() = p.getString("url", "") ?: ""; set(v) = p.edit().putString("url", v.trim().trimEnd('/')).apply()
    var deviceId: String get() = p.getString("id", "") ?: ""; set(v) = p.edit().putString("id", v.trim()).apply()
    var deviceKey: String get() = p.getString("key", "") ?: ""; set(v) = p.edit().putString("key", v.trim()).apply()
    var lastBackfillMs: Long get() = p.getLong("backfill", 0L); set(v) = p.edit().putLong("backfill", v).apply()
    var lastUploadMs: Long get() = p.getLong("lastUpload", 0L); set(v) = p.edit().putLong("lastUpload", v).apply()
    var lastError: String get() = p.getString("err", "") ?: ""; set(v) = p.edit().putString("err", v).apply()
    val configured get() = baseUrl.startsWith("https://") && deviceId.isNotEmpty() && deviceKey.length >= 32
}
