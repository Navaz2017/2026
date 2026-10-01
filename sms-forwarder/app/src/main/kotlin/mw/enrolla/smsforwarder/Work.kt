package mw.enrolla.smsforwarder

import android.content.Context
import android.provider.Telephony
import androidx.work.*
import mw.enrolla.smsforwarder.core.MoneyFilter
import java.util.concurrent.TimeUnit

class UploadWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        val s = Settings(applicationContext)
        return when (Uploader.drain(s, Queue(applicationContext))) {
            Outcome.Ok -> Result.success()
            Outcome.Retry -> Result.retry()          // WorkManager exponential backoff
            is Outcome.Rejected -> Result.failure()  // misconfigured; the UI shows why. Periodic work tries again later.
        }
    }
}

/** Safety net: picks up anything the live receiver missed (phone was off, app was force-stopped, battery saver). */
class BackfillWorker(ctx: Context, p: WorkerParameters) : Worker(ctx, p) {
    override fun doWork(): Result {
        val s = Settings(applicationContext)
        if (!s.configured) return Result.success()
        val q = Queue(applicationContext)
        val since = if (s.lastBackfillMs == 0L) System.currentTimeMillis() - 7 * 86_400_000L else s.lastBackfillMs - 60_000L
        var newest = s.lastBackfillMs
        try {
            applicationContext.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
                "${Telephony.Sms.DATE} > ?", arrayOf(since.toString()), "${Telephony.Sms.DATE} ASC",
            )?.use { c ->
                while (c.moveToNext()) {
                    val body = c.getString(1) ?: continue
                    val date = c.getLong(2)
                    if (MoneyFilter.isIncomingMoney(body)) q.add(c.getString(0) ?: "", body, date)
                    newest = maxOf(newest, date)
                }
            }
        } catch (e: SecurityException) { s.lastError = "SMS permission missing"; return Result.success() }
        s.lastBackfillMs = maxOf(newest, System.currentTimeMillis() - 60_000L)
        Scheduler.uploadNow(applicationContext)
        return Result.success()
    }
}

object Scheduler {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun uploadNow(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniqueWork("upload", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<UploadWorker>().setConstraints(online).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build())
    }

    fun schedulePeriodic(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("backfill", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<BackfillWorker>(15, TimeUnit.MINUTES).build())
    }
}
