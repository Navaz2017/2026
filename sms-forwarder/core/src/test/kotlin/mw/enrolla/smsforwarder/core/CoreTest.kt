package mw.enrolla.smsforwarder.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoreTest {
    @Test fun `signature matches the Node backend test vector`() {
        // Generated with Node: createHmac("sha256", key).update(`${ts}.${nonce}.${sha256(body)}`)
        assertEquals("5e4ce7b36ba37b78a5d5f9fd08e6b7b54ba6879d651aa46ec9e1d6fa24ebe30a", Signer.sha256Hex("""{"messages":[]}"""))
        assertEquals(
            "51dd47cda0f8a9da9d70d358da8715c3af454d5fafed7c22506812d59221dda0",
            Signer.sign("k3y-ünï", "1700000000000", "abcdefabcdefabcd", """{"messages":[]}"""),
        )
    }

    @Test fun `forwards incoming Airtel and Mpamba money messages`() {
        assertTrue(MoneyFilter.isIncomingMoney("BW260929.1403.PL4887. You have received MK 10,000 from FCB BANK on 29/09/26 02:03 PM. Ref 000391467945 Bal: MK 10373.52."))
        assertTrue(MoneyFilter.isIncomingMoney("SHIDAHCHITAYA has deposited MK 9,000 to your account on 15/09/26 06:03 PM.Bal: MK 9373.52. TID CI260915.1803.125840."))
        assertTrue(MoneyFilter.isIncomingMoney("Money Received from 265883095004 JAMES BLIGHT on 23/04/2026 12:50:52. \nAmount: 2,500.00MWK \nRef: DHN1368TJHT \nBal: 2,509.28MWK"))
    }

    @Test fun `never forwards outgoing money, chats or OTPs`() {
        assertFalse(MoneyFilter.isIncomingMoney("MWK4,500 sent: 10226768 MERVIS SANUDI on 29/09/26 04:31 PM. Fee: MWK200, Levy: MK0.0. Bal: MWK673.52 TID:CO260929.1631.OB7196."))
        assertFalse(MoneyFilter.isIncomingMoney("Money Sent to 0891852731 MERCY CHIRWA on 13/08/2026 19:25:28. \nAmount: 5,400.00MWK \nFee: 75.00MWK \nRef: DHD135BKBTH"))
        assertFalse(MoneyFilter.isIncomingMoney("Mum: are you coming for dinner?"))
        assertFalse(MoneyFilter.isIncomingMoney("Your OTP is 482913"))
    }
}
