package mw.enrolla.smsforwarder

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings as AndroidSettings
import android.text.InputType
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.*
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.text.DateFormat
import java.util.Date
import kotlin.concurrent.thread

/** One screen, built in code (no XML) to keep the app tiny and easy to audit. */
class MainActivity : Activity() {
    private lateinit var s: Settings
    private lateinit var url: EditText
    private lateinit var id: EditText
    private lateinit var key: EditText
    private lateinit var status: TextView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        s = Settings(this)
        fun field(hint: String, v: String, secret: Boolean = false) = EditText(this).apply {
            this.hint = hint; setText(v); setSingleLine()
            if (secret) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        fun button(t: String, f: () -> Unit) = Button(this).apply { text = t; setOnClickListener { f() } }
        url = field("Server URL (https://api.example.com)", s.baseUrl)
        id = field("Device ID", s.deviceId)
        key = field("Device key (shown once in owner dashboard)", s.deviceKey, secret = true)
        status = TextView(this).apply { setPadding(0, 24, 0, 0) }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(40, 60, 40, 40)
            addView(TextView(context).apply { text = "Enrolla SMS Forwarder"; textSize = 22f })
            addView(TextView(context).apply { text = "Forwards ONLY incoming Airtel Money / Mpamba payment messages to your Enrolla server." })
            listOf(url, id, key).forEach { addView(it, LinearLayout.LayoutParams(MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)) }
            addView(button("1. Save settings") { save() })
            addView(button("2. Allow SMS access") { requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS), 1) })
            addView(button("3. Don't let battery saver stop this app") { batteryExemption() })
            addView(button("Test connection") { testConnection() })
            addView(button("Sync now") { syncNow() })
            addView(status)
        }
        setContentView(ScrollView(this).apply { addView(col) })
        Scheduler.schedulePeriodic(this)
    }

    override fun onResume() { super.onResume(); refresh() }

    private fun save() {
        if (!url.text.toString().trim().startsWith("https://")) return toast("Server URL must start with https://")
        s.baseUrl = url.text.toString(); s.deviceId = id.text.toString(); s.deviceKey = key.text.toString()
        if (!s.configured) toast("Check the ID and key") else toast("Saved")
        refresh()
    }

    private fun testConnection() {
        status.text = "Testing..."
        thread {
            val r = Uploader.ping(s)
            runOnUiThread {
                toast(when (r) { Outcome.Ok -> "Connected"; Outcome.Retry -> "Server unreachable"; is Outcome.Rejected -> "Refused (${r.code}): check ID, key and that phone date/time is automatic" })
                refresh()
            }
        }
    }

    private fun syncNow() {
        WorkManager.getInstance(this).enqueue(OneTimeWorkRequestBuilder<BackfillWorker>().build())
        toast("Scanning inbox and uploading"); refresh()
    }

    private fun batteryExemption() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName))
            startActivity(Intent(AndroidSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        else toast("Already exempt")
    }

    private fun refresh() {
        val perm = checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
        val last = s.lastUploadMs.takeIf { it > 0 }?.let { DateFormat.getDateTimeInstance().format(Date(it)) } ?: "never"
        status.text = "Configured: ${s.configured}\nSMS permission: $perm\nWaiting to upload: ${Queue(this).count()}\nLast upload: $last\n${s.lastError}"
    }

    override fun onRequestPermissionsResult(rc: Int, p: Array<out String>, r: IntArray) { super.onRequestPermissionsResult(rc, p, r); refresh() }
    private fun toast(t: String) = Toast.makeText(this, t, Toast.LENGTH_LONG).show()
}
