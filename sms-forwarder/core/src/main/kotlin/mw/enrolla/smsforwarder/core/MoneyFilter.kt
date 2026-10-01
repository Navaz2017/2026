package mw.enrolla.smsforwarder.core

/**
 * Privacy gate: the phone is personal-ish, so ONLY messages that announce incoming money are ever uploaded.
 * Everything else (chats, OTPs, outgoing-money receipts) never leaves the device.
 * Mirrors the wordings the server parser understands (backend/src/lib/smsParser.ts). Add new operator
 * wordings in BOTH places.
 */
object MoneyFilter {
    private val incoming = listOf(
        Regex("""You have received MK\s?[\d,]+""", RegexOption.IGNORE_CASE),          // Airtel credit (bank etc.)
        Regex("""has deposited MK\s?[\d,]+ to your account""", RegexOption.IGNORE_CASE), // Airtel wallet deposit
        Regex("""^\s*Money Received from\s+\+?\d{9,13}""", RegexOption.IGNORE_CASE),     // Mpamba
    )

    fun isIncomingMoney(body: String): Boolean =
        body.length <= 1000 && incoming.any { it.containsMatchIn(body) } && !body.trimStart().startsWith("Money Sent", true)
}
