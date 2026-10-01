package mw.enrolla.smsforwarder

import mw.enrolla.smsforwarder.core.Signer
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.time.Instant

sealed interface Outcome {
    data object Ok : Outcome
    data object Retry : Outcome                    // network / 5xx / replay: try again later
    data class Rejected(val code: Int) : Outcome   // 4xx: our request is wrong (bad key, bad payload)
}

object Uploader {
    private fun nonce() = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }

    /** POST a signed body. The signature covers the exact bytes sent, so they are built once and reused. */
    fun post(s: Settings, path: String, json: String): Outcome = try {
        val ts = System.currentTimeMillis().toString()
        val n = nonce()
        val c = (URL(s.baseUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 20_000; doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("x-device-id", s.deviceId)
            setRequestProperty("x-timestamp", ts)
            setRequestProperty("x-nonce", n)
            setRequestProperty("x-signature", Signer.sign(s.deviceKey, ts, n, json))
        }
        c.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
        val code = c.responseCode
        c.disconnect()
        when {
            code in 200..299 -> Outcome.Ok
            code == 409 || code == 429 || code >= 500 -> Outcome.Retry
            else -> Outcome.Rejected(code)
        }
    } catch (e: java.io.IOException) { Outcome.Retry }

    fun ping(s: Settings): Outcome = post(s, "/v1/sms/ping", "{}")

    private fun body(items: List<Pending>) = JSONObject().put("messages", JSONArray().apply {
        items.forEach { put(JSONObject().put("sender", it.sender).put("body", it.body).put("receivedAt", Instant.ofEpochMilli(it.receivedAt).toString())) }
    }).toString()

    /** Drain the queue in batches. Returns Retry if anything is left to try later. */
    fun drain(s: Settings, q: Queue): Outcome {
        if (!s.configured) return Outcome.Rejected(0)
        while (true) {
            val batch = q.next(50)
            if (batch.isEmpty()) { s.lastError = ""; return Outcome.Ok }
            when (val r = post(s, "/v1/sms/ingest", body(batch))) {
                Outcome.Ok -> { q.delete(batch.map { it.id }); s.lastUploadMs = System.currentTimeMillis(); s.lastError = "" }
                Outcome.Retry -> { s.lastError = "Offline or server busy - will retry"; return Outcome.Retry }
                is Outcome.Rejected -> {
                    if (r.code == 401 || r.code == 403) { s.lastError = "Server refused this device (check ID/key/phone clock)"; return r }
                    // 400 etc: one bad message must not block the rest. Send individually and drop the offender.
                    for (m in batch) when (post(s, "/v1/sms/ingest", body(listOf(m)))) {
                        Outcome.Retry -> return Outcome.Retry
                        else -> q.delete(listOf(m.id))
                    }
                }
            }
        }
    }
}
