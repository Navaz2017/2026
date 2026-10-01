"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { Badge, Btn, Card, Field, Loading, Msg, Page, confirmBox, dt, openSigned, useBusy, useLoad } from "@/lib/ui";

export default function ApplicantFile() {
  const { id } = useParams<{ id: string }>();
  const { t } = useT();
  const { user } = useSession();
  const { data: a, error, loading, reload } = useLoad<any>(`/institution/applications/${id}`);
  const { busy, msg, run } = useBusy();
  const [note, setNote] = useState("");
  const decided = a && (a.status === "ACCEPTED" || a.status === "REJECTED");

  const view = (cid: string) => run(() => openSigned(async () => (await api(`/institution/applications/${id}/credentials/${cid}/download`)).url));
  const decide = (decision: "ACCEPTED" | "REJECTED") => {
    if (!confirmBox(t(decision === "ACCEPTED" ? "inst.confirmAccept" : "inst.confirmReject"))) return;
    run(async () => { await post(`/institution/applications/${id}/decision`, { decision, note: note || undefined }); await reload(); });
  };

  return (
    <Page title={a?.student.fullName ?? "…"} actions={<Link href="/app/institution/applications">← {t("common.back")}</Link>}>
      <Loading error={error} loading={loading} />
      {a && <>
        <Card>
          <div className="row" style={{ justifyContent: "space-between" }}><strong>{a.program.title} · {a.program.level}</strong><Badge ns="st.app" value={a.status} /></div>
          <h2 style={{ marginTop: ".75rem" }}>{t("inst.profile")}</h2>
          <div>{t("inst.dob")}: {dt(a.student.dateOfBirth)} · {t("inst.gender")}: {a.student.gender ?? "—"}</div>
          {a.student.parent && <div>{t("inst.parent")}: {a.student.parent.user.fullName} · {a.student.parent.user.phone ?? a.student.parent.user.email} · {t("inst.parentJob")}: {a.student.parent.occupation}{a.student.parent.employer ? ` (${a.student.parent.employer})` : ""}</div>}
          {a.statement && <><h2 style={{ marginTop: ".75rem" }}>{t("inst.statement")}</h2><p style={{ whiteSpace: "pre-wrap" }}>{a.statement}</p></>}
        </Card>
        <Card title={t("inst.creds")}>
          {!user?.mfa && <Msg kind="warn">{t("inst.viewNeedsMfa")} <Link href="/app/security">{t("mfa.goSetup")}</Link></Msg>}
          {a.credentials.length === 0 && <p className="muted">{t("common.none")}</p>}
          {a.credentials.map((c: any) => (
            <div key={c.id} className="row" style={{ justifyContent: "space-between", padding: ".35rem 0" }}>
              <span>📄 <strong>{c.title}</strong> <span className="muted">· {t(`dockind.${c.kind}`) === `dockind.${c.kind}` ? c.kind : t(`dockind.${c.kind}`)}</span></span>
              <Btn kind="ghost" busy={busy} disabled={!user?.mfa} onClick={() => view(c.id)}>{t("common.view")}</Btn>
            </div>
          ))}
        </Card>
        {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
        {!decided && <Card>
          {a.status === "SUBMITTED" && <Btn kind="ghost" busy={busy} onClick={() => run(async () => { await post(`/institution/applications/${id}/start-review`); await reload(); })}>{t("inst.startReview")}</Btn>}
          <Field label={t("inst.decisionNote")}><textarea style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <p className="muted">{t("inst.letterNote")} · {t("nav.programs")}: {t("inst.seatsUsed", { used: a.program.seatsTaken, total: a.program.seats })}</p>
          <div className="row">
            <Btn busy={busy} disabled={!user?.mfa} onClick={() => decide("ACCEPTED")}>✓ {t("inst.accept")}</Btn>
            <Btn kind="danger" busy={busy} disabled={!user?.mfa} onClick={() => decide("REJECTED")}>✕ {t("inst.rejectApp")}</Btn>
          </div>
        </Card>}
        {decided && a.decisionNote && <Card><strong>{t("common.note")}:</strong> {a.decisionNote}</Card>}
      </>}
    </Page>
  );
}
