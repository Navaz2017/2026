package mw.enrolla.smsforwarder.core

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Must stay byte-for-byte compatible with backend/src/lib/crypto.ts `deviceSignature`. */
object Signer {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    fun sha256Hex(s: String): String = hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8)))

    /** HMAC-SHA256(key as UTF-8 text, "<timestampMs>.<nonce>.<sha256hex(body)>"). */
    fun sign(deviceKey: String, timestampMs: String, nonce: String, body: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(deviceKey.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return hex(mac.doFinal("$timestampMs.$nonce.${sha256Hex(body)}".toByteArray(Charsets.UTF_8)))
    }
}
