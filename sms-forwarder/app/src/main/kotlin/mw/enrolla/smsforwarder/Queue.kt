package mw.enrolla.smsforwarder

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Pending(val id: Long, val sender: String, val body: String, val receivedAt: Long)

/** Durable outbox: a message is on disk before we try the network, so nothing is lost if the phone is offline or killed. */
class Queue(ctx: Context) : SQLiteOpenHelper(ctx, "queue.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE pending (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, body TEXT NOT NULL, receivedAt INTEGER NOT NULL, UNIQUE(sender, receivedAt, body))")
    }
    override fun onUpgrade(db: SQLiteDatabase, o: Int, n: Int) {}

    /** The live receiver and the inbox backfill can both see a message; the UNIQUE index makes that harmless. */
    fun add(sender: String, body: String, receivedAt: Long) {
        writableDatabase.insertWithOnConflict("pending", null,
            ContentValues().apply { put("sender", sender); put("body", body); put("receivedAt", receivedAt) }, SQLiteDatabase.CONFLICT_IGNORE)
    }

    fun next(limit: Int): List<Pending> = readableDatabase.rawQuery("SELECT id,sender,body,receivedAt FROM pending ORDER BY id LIMIT ?", arrayOf(limit.toString())).use {
        buildList { while (it.moveToNext()) add(Pending(it.getLong(0), it.getString(1), it.getString(2), it.getLong(3))) }
    }

    fun delete(ids: List<Long>) { if (ids.isNotEmpty()) writableDatabase.execSQL("DELETE FROM pending WHERE id IN (${ids.joinToString(",")})") }

    fun count(): Long = readableDatabase.rawQuery("SELECT COUNT(*) FROM pending", null).use { it.moveToFirst(); it.getLong(0) }
}
