package mw.enrolla.smsforwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import mw.enrolla.smsforwarder.core.MoneyFilter

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!Settings(ctx).configured) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        // Long messages arrive as several PDUs - stitch them per sender before filtering.
        val queue = Queue(ctx)
        var any = false
        parts.groupBy { it.originatingAddress ?: "" }.forEach { (sender, pdus) ->
            val body = pdus.joinToString("") { it.messageBody ?: "" }
            if (MoneyFilter.isIncomingMoney(body)) { queue.add(sender, body, pdus.first().timestampMillis); any = true }
        }
        if (any) Scheduler.uploadNow(ctx)
    }
}
