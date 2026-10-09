"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { Badge, Btn, Card, Field, Msg, confirmBox, useBusy } from "@/lib/ui";

export interface WaState { desired: boolean; status: string; qr: string | null; pairingCode: string | null; pairPhone: string | null; phone: string | null; lastError: string | null; workerOnline: boolean }
export interface Check { ok: boolean; ok_text: string; bad_text: string }

// Shared by the institution's own page and the owner's platform page: link by QR or by phone-number code, see what is
// missing, send a test message. All state lives in the database; the wa-worker process does the actual WhatsApp work.
export function WhatsAppLink({ s, checks, connect, disconnect, test, reload, canAct }: {
  s: WaState; checks: Check[]; connect: (phone?: string) => Promise<unknown>; disconnect: () => Promise<unknown>; test?: (phone: string) => Promise<unknown>; reload: () => void; canAct: boolean;
}) {
  const { t } = useT();
  const { busy, msg, run } = useBusy();
  const tst = useBusy();
  const [method, setMethod] = useState<"qr" | "code">("qr"), [phone, setPhone] = useState(""), [tphone, setTphone] = useState(""), [img, setImg] = useState("");
  const pairing = s.desired && ["STARTING", "QR", "CODE"].includes(s.status);

  // WhatsApp rotates the QR every ~20 s; poll while pairing so the screen stays fresh and flips to "Linked" by itself.
  useEffect(() => {
    if (!s.desired || s.status === "CONNECTED" || s.status === "FAILED") return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [s.desired, s.status, reload]);
  useEffect(() => { if (s.qr) QRCode.toDataURL(s.qr, { margin: 1, width: 260 }).then(setImg); else setImg(""); }, [s.qr]);

  // "wa_err:<reason>[:<technical detail>]" from the WhatsApp service -> a sentence people understand (+ the raw detail for the person fixing it)
  const [, code, ...rest] = s.lastError?.startsWith("wa_err:") ? s.lastError.split(":") : [];
  const err = code ? t(`wa.err.${code}`) : s.lastError;
  const detail = rest.join(":");
  const ready = canAct && checks.every((c) => c.ok);
  const idle = !s.desired || s.status === "FAILED" || s.status === "DISCONNECTED";

  return (
    <>
      <Card title={t("wa.checkTitle")}>
        {checks.map((c, i) => <Msg key={i} kind={c.ok ? "ok" : "warn"}>{c.ok ? c.ok_text : c.bad_text}</Msg>)}
      </Card>
      <Card>
        <div className="row"><Badge ns="st.wa" value={s.status} /></div>
        {s.status === "CONNECTED" && <><Msg kind="ok">{t("inst.waLinkedAs", { phone: s.phone ?? "" })}</Msg><p className="muted">{t("wa.linkedHelp")}</p></>}
        {s.status === "FAILED" && <Msg kind="err">{err}{detail ? <><br /><small>{t("wa.err.details")}: {detail}</small></> : null}</Msg>}
        {pairing && s.status === "STARTING" && <p className="muted">{t("wa.starting")}</p>}
        {s.status === "QR" && <><p>{t("inst.waScan")}</p>{img && <div className="qr"><img src={img} alt="WhatsApp QR" width={260} height={260} /></div>}</>}
        {s.status === "CODE" && s.pairingCode && <><p>{t("wa.enterCode")}</p><div className="pairing" aria-live="polite" data-testid="pairing-code">{s.pairingCode}</div></>}
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}

        {idle && <>
          <h2 style={{ marginTop: "1rem" }}>{t("wa.method")}</h2>
          <div className="row" role="radiogroup" style={{ marginBottom: ".6rem" }}>
            <Btn type="button" kind={method === "qr" ? "primary" : "ghost"} onClick={() => setMethod("qr")}>{t("wa.byQr")}</Btn>
            <Btn type="button" kind={method === "code" ? "primary" : "ghost"} onClick={() => setMethod("code")}>{t("wa.byCode")}</Btn>
          </div>
          {method === "code" && <><p className="muted">{t("wa.codeHelp")}</p><Field label={t("wa.number")}><input type="tel" inputMode="tel" placeholder="0999 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field></>}
          <Btn busy={busy} disabled={!ready || (method === "code" && phone.trim().length < 6)} onClick={() => run(async () => { await connect(method === "code" ? phone.trim() : undefined); reload(); })}>
            {s.status === "FAILED" ? t("wa.tryAgain") : method === "code" ? t("wa.getCode") : t("inst.waConnect")}
          </Btn>
        </>}
        {!idle && s.status !== "CONNECTED" && <p><Btn kind="ghost" busy={busy} onClick={() => run(async () => { await disconnect(); reload(); })}>{t("common.cancel")}</Btn></p>}
        {s.status === "CONNECTED" && <div className="row" style={{ marginTop: ".5rem" }}><Btn kind="danger" busy={busy} disabled={!canAct} onClick={() => confirmBox(t("inst.waDisconnect") + "?") && run(async () => { await disconnect(); reload(); })}>{t("inst.waDisconnect")}</Btn></div>}
      </Card>
      {s.status === "CONNECTED" && test && (
        <Card title={t("msg.sendTest")}>
          <form onSubmit={(e) => { e.preventDefault(); void tst.run(async () => { await test(tphone.trim()); }, t("wa.testOk")); }}>
            <Field label={t("msg.test")}><input type="tel" inputMode="tel" required placeholder="0999 123 456" value={tphone} onChange={(e) => setTphone(e.target.value)} /></Field>
            {tst.msg && <Msg kind={tst.msg.kind}>{tst.msg.text}</Msg>}
            <Btn busy={tst.busy} disabled={!canAct}>{t("msg.sendTest")}</Btn>
          </form>
        </Card>
      )}
    </>
  );
}
