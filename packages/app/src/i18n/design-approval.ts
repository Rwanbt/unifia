/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// Strings for design-surface.tsx's ApprovalModal. packages/app/src/i18n/en.ts
// and fr.ts are already past the AGENTS.md 1500 LOC ceiling, so these keys
// live here instead (same reasoning as packages/app/src/i18n/home.ts).
//
// Same debt class as packages/app/src/i18n/design-artifact.ts: this modal
// hardcoded every string in French with no English variant at all, so an
// English-locale user saw "Approbation requise" / "Annuler" / "Refuser" no
// matter what.
//
// Every locale in @/context/language's Locale type now owns a translation
// here; each object is typed against DesignApprovalKey, so a missing key is a
// compile error rather than a silent English fallback.

import type { Locale } from "@/context/language"

export type DesignApprovalKey =
  | "title"
  | "description"
  | "expiredWarning"
  | "expiresAt"
  | "resolving"
  | "cancel"
  | "rerequest"
  | "deny"
  | "allow"
  | "exportCancelledByUser"
  | "exportCancelled"
  | "exportCancelRefused"
  | "unknownReason"

type DesignApprovalDict = Record<DesignApprovalKey, string>

const en: DesignApprovalDict = {
  title: "Approval required",
  description: "This operation requires approval ({capability}). The server is waiting for your decision before continuing.",
  expiredWarning: "The approval has expired. You can request a new one.",
  expiresAt: "Expires at: ",
  resolving: "Sending the decision to the server…",
  cancel: "Cancel",
  rerequest: "Request a new approval",
  deny: "Deny",
  allow: "Approve and retry",
  exportCancelledByUser: "Export cancelled by the user",
  exportCancelled: "Export cancelled",
  exportCancelRefused: "Export cancelled (the server refused the cancellation: {reason})",
  unknownReason: "unknown reason",
}

const fr: DesignApprovalDict = {
  title: "Approbation requise",
  description: "Cette opération nécessite une approbation ({capability}). Le serveur attend votre décision avant de continuer.",
  expiredWarning: "L'approbation a expiré. Vous pouvez en demander une nouvelle.",
  expiresAt: "Expire à : ",
  resolving: "Envoi de la décision au serveur…",
  cancel: "Annuler",
  rerequest: "Demander une nouvelle approbation",
  deny: "Refuser",
  allow: "Approuver et réessayer",
  exportCancelledByUser: "Export annulé par l'utilisateur",
  exportCancelled: "Export annulé",
  exportCancelRefused: "Export annulé (le serveur a refusé l'annulation : {reason})",
  unknownReason: "raison inconnue",
}

const zh: DesignApprovalDict = {
  title: "需要批准",
  description: "此操作需要批准（{capability}）。服务器正在等待你的决定以继续。",
  expiredWarning: "批准已过期。你可以重新申请。",
  expiresAt: "过期时间：",
  resolving: "正在将决定发送到服务器…",
  cancel: "取消",
  rerequest: "请求新的批准",
  deny: "拒绝",
  allow: "批准并重试",
  exportCancelledByUser: "用户已取消导出",
  exportCancelled: "导出已取消",
  exportCancelRefused: "导出已取消（服务器拒绝了取消请求：{reason}）",
  unknownReason: "未知原因",
}

const zht: DesignApprovalDict = {
  title: "需要核准",
  description: "此操作需要核准（{capability}）。伺服器正在等待你的決定以繼續。",
  expiredWarning: "核准已過期。你可以重新申請。",
  expiresAt: "到期時間：",
  resolving: "正在將決定傳送到伺服器…",
  cancel: "取消",
  rerequest: "請求新的核准",
  deny: "拒絕",
  allow: "核准並重試",
  exportCancelledByUser: "使用者已取消匯出",
  exportCancelled: "匯出已取消",
  exportCancelRefused: "匯出已取消（伺服器拒絕了取消請求：{reason}）",
  unknownReason: "未知原因",
}

const ko: DesignApprovalDict = {
  title: "승인 필요",
  description: "이 작업에는 승인이 필요합니다({capability}). 서버가 계속 진행하기 전에 결정을 기다리고 있습니다.",
  expiredWarning: "승인이 만료되었습니다. 새로 요청할 수 있습니다.",
  expiresAt: "만료 시각: ",
  resolving: "서버로 결정을 보내는 중…",
  cancel: "취소",
  rerequest: "새 승인 요청",
  deny: "거부",
  allow: "승인하고 다시 시도",
  exportCancelledByUser: "사용자가 내보내기를 취소했습니다",
  exportCancelled: "내보내기 취소됨",
  exportCancelRefused: "내보내기가 취소되었습니다(서버가 취소를 거부했습니다: {reason})",
  unknownReason: "알 수 없는 이유",
}

const de: DesignApprovalDict = {
  title: "Genehmigung erforderlich",
  description:
    "Dieser Vorgang erfordert eine Genehmigung ({capability}). Der Server wartet auf Ihre Entscheidung, bevor er fortfährt.",
  expiredWarning: "Die Genehmigung ist abgelaufen. Sie können eine neue anfordern.",
  expiresAt: "Läuft ab am: ",
  resolving: "Entscheidung wird an den Server gesendet…",
  cancel: "Abbrechen",
  rerequest: "Neue Genehmigung anfordern",
  deny: "Ablehnen",
  allow: "Genehmigen und erneut versuchen",
  exportCancelledByUser: "Export vom Benutzer abgebrochen",
  exportCancelled: "Export abgebrochen",
  exportCancelRefused: "Export abgebrochen (der Server hat den Abbruch abgelehnt: {reason})",
  unknownReason: "unbekannter Grund",
}

const es: DesignApprovalDict = {
  title: "Aprobación requerida",
  description: "Esta operación requiere aprobación ({capability}). El servidor espera su decisión antes de continuar.",
  expiredWarning: "La aprobación ha caducado. Puede solicitar una nueva.",
  expiresAt: "Caduca el: ",
  resolving: "Enviando la decisión al servidor…",
  cancel: "Cancelar",
  rerequest: "Solicitar una nueva aprobación",
  deny: "Denegar",
  allow: "Aprobar y reintentar",
  exportCancelledByUser: "Exportación cancelada por el usuario",
  exportCancelled: "Exportación cancelada",
  exportCancelRefused: "Exportación cancelada (el servidor rechazó la cancelación: {reason})",
  unknownReason: "motivo desconocido",
}

const da: DesignApprovalDict = {
  title: "Godkendelse påkrævet",
  description: "Denne handling kræver godkendelse ({capability}). Serveren venter på din beslutning, før den fortsætter.",
  expiredWarning: "Godkendelsen er udløbet. Du kan anmode om en ny.",
  expiresAt: "Udløber: ",
  resolving: "Sender beslutningen til serveren…",
  cancel: "Annuller",
  rerequest: "Anmod om en ny godkendelse",
  deny: "Afvis",
  allow: "Godkend og prøv igen",
  exportCancelledByUser: "Eksport annulleret af brugeren",
  exportCancelled: "Eksport annulleret",
  exportCancelRefused: "Eksport annulleret (serveren afviste annulleringen: {reason})",
  unknownReason: "ukendt årsag",
}

const ja: DesignApprovalDict = {
  title: "承認が必要です",
  description: "この操作には承認が必要です（{capability}）。サーバーは続行前にあなたの判断を待っています。",
  expiredWarning: "承認の有効期限が切れました。新しい承認を申請できます。",
  expiresAt: "有効期限: ",
  resolving: "決定をサーバーに送信中…",
  cancel: "キャンセル",
  rerequest: "新しい承認を申請",
  deny: "拒否",
  allow: "承認して再試行",
  exportCancelledByUser: "ユーザーがエクスポートをキャンセルしました",
  exportCancelled: "エクスポートをキャンセルしました",
  exportCancelRefused: "エクスポートをキャンセルしました（サーバーがキャンセルを拒否しました: {reason}）",
  unknownReason: "不明な理由",
}

const pl: DesignApprovalDict = {
  title: "Wymagana zgoda",
  description: "Ta operacja wymaga zgody ({capability}). Serwer czeka na Twoją decyzję przed kontynuowaniem.",
  expiredWarning: "Zgoda wygasła. Możesz poprosić o nową.",
  expiresAt: "Wygasa: ",
  resolving: "Wysyłanie decyzji do serwera…",
  cancel: "Anuluj",
  rerequest: "Poproś o nową zgodę",
  deny: "Odrzuć",
  allow: "Zatwierdź i ponów",
  exportCancelledByUser: "Eksport anulowany przez użytkownika",
  exportCancelled: "Eksport anulowany",
  exportCancelRefused: "Eksport anulowany (serwer odrzucił anulowanie: {reason})",
  unknownReason: "nieznany powód",
}

const ru: DesignApprovalDict = {
  title: "Требуется подтверждение",
  description: "Эта операция требует подтверждения ({capability}). Сервер ждёт вашего решения, чтобы продолжить.",
  expiredWarning: "Срок действия подтверждения истёк. Вы можете запросить новое.",
  expiresAt: "Истекает: ",
  resolving: "Отправка решения на сервер…",
  cancel: "Отмена",
  rerequest: "Запросить новое подтверждение",
  deny: "Отклонить",
  allow: "Подтвердить и повторить",
  exportCancelledByUser: "Экспорт отменён пользователем",
  exportCancelled: "Экспорт отменён",
  exportCancelRefused: "Экспорт отменён (сервер отклонил отмену: {reason})",
  unknownReason: "неизвестная причина",
}

const ar: DesignApprovalDict = {
  title: "الموافقة مطلوبة",
  description: "تتطلب هذه العملية موافقة ({capability}). الخادم ينتظر قرارك قبل المتابعة.",
  expiredWarning: "انتهت صلاحية الموافقة. يمكنك طلب موافقة جديدة.",
  expiresAt: "تنتهي في: ",
  resolving: "جارٍ إرسال القرار إلى الخادم…",
  cancel: "إلغاء",
  rerequest: "طلب موافقة جديدة",
  deny: "رفض",
  allow: "الموافقة وإعادة المحاولة",
  exportCancelledByUser: "أُلغى التصدير بواسطة المستخدم",
  exportCancelled: "أُلغي التصدير",
  exportCancelRefused: "أُلغي التصدير (رفض الخادم الإلغاء: {reason})",
  unknownReason: "سبب غير معروف",
}

const no: DesignApprovalDict = {
  title: "Godkjenning kreves",
  description: "Denne handlingen krever godkjenning ({capability}). Serveren venter på avgjørelsen din før den fortsetter.",
  expiredWarning: "Godkjenningen har utløpt. Du kan be om en ny.",
  expiresAt: "Utløper: ",
  resolving: "Sender avgjørelsen til serveren…",
  cancel: "Avbryt",
  rerequest: "Be om en ny godkjenning",
  deny: "Avslå",
  allow: "Godkjenn og prøv igjen",
  exportCancelledByUser: "Eksporten ble avbrutt av brukeren",
  exportCancelled: "Eksport avbrutt",
  exportCancelRefused: "Eksport avbrutt (serveren avviste avbruddet: {reason})",
  unknownReason: "ukjent årsak",
}

const br: DesignApprovalDict = {
  title: "Aprovação necessária",
  description: "Esta operação exige aprovação ({capability}). O servidor está aguardando sua decisão para continuar.",
  expiredWarning: "A aprovação expirou. Você pode solicitar uma nova.",
  expiresAt: "Expira em: ",
  resolving: "Enviando a decisão ao servidor…",
  cancel: "Cancelar",
  rerequest: "Solicitar uma nova aprovação",
  deny: "Recusar",
  allow: "Aprovar e tentar novamente",
  exportCancelledByUser: "Exportação cancelada pelo usuário",
  exportCancelled: "Exportação cancelada",
  exportCancelRefused: "Exportação cancelada (o servidor recusou o cancelamento: {reason})",
  unknownReason: "motivo desconhecido",
}

const th: DesignApprovalDict = {
  title: "ต้องได้รับการอนุมัติ",
  description: "การดำเนินการนี้ต้องได้รับการอนุมัติ ({capability}) เซิร์ฟเวอร์กำลังรอการตัดสินใจของคุณก่อนดำเนินการต่อ",
  expiredWarning: "การอนุมัติหมดอายุแล้ว คุณขออนุมัติใหม่ได้",
  expiresAt: "หมดอายุเมื่อ: ",
  resolving: "กำลังส่งการตัดสินใจไปยังเซิร์ฟเวอร์…",
  cancel: "ยกเลิก",
  rerequest: "ขออนุมัติใหม่",
  deny: "ปฏิเสธ",
  allow: "อนุมัติและลองอีกครั้ง",
  exportCancelledByUser: "ผู้ใช้ยกเลิกการส่งออกแล้ว",
  exportCancelled: "ยกเลิกการส่งออกแล้ว",
  exportCancelRefused: "ยกเลิกการส่งออกแล้ว (เซิร์ฟเวอร์ปฏิเสธการยกเลิก: {reason})",
  unknownReason: "ไม่ทราบสาเหตุ",
}

const bs: DesignApprovalDict = {
  title: "Potrebno odobrenje",
  description: "Ova operacija zahtijeva odobrenje ({capability}). Server čeka vašu odluku prije nastavka.",
  expiredWarning: "Odobrenje je isteklo. Možete zatražiti novo.",
  expiresAt: "Istječe: ",
  resolving: "Slanje odluke serveru…",
  cancel: "Otkaži",
  rerequest: "Zatraži novo odobrenje",
  deny: "Odbij",
  allow: "Odobri i pokušaj ponovo",
  exportCancelledByUser: "Izvoz otkazao korisnik",
  exportCancelled: "Izvoz otkazan",
  exportCancelRefused: "Izvoz otkazan (server je odbio otkazivanje: {reason})",
  unknownReason: "nepoznat razlog",
}

const tr: DesignApprovalDict = {
  title: "Onay gerekli",
  description: "Bu işlem onay gerektiriyor ({capability}). Sunucu devam etmeden önce kararınızı bekliyor.",
  expiredWarning: "Onayın süresi doldu. Yeni bir onay isteyebilirsiniz.",
  expiresAt: "Son geçerlilik: ",
  resolving: "Karar sunucuya gönderiliyor…",
  cancel: "İptal",
  rerequest: "Yeni onay iste",
  deny: "Reddet",
  allow: "Onayla ve yeniden dene",
  exportCancelledByUser: "Dışa aktarma kullanıcı tarafından iptal edildi",
  exportCancelled: "Dışa aktarma iptal edildi",
  exportCancelRefused: "Dışa aktarma iptal edildi (sunucu iptali reddetti: {reason})",
  unknownReason: "bilinmeyen neden",
}

export const dicts: Record<Locale, DesignApprovalDict> = {
  en,
  zh,
  zht,
  ko,
  de,
  es,
  fr,
  da,
  ja,
  pl,
  ru,
  ar,
  no,
  br,
  th,
  bs,
  tr,
}

export function tDesignApproval(locale: Locale, key: DesignApprovalKey, params?: Record<string, string>): string {
  const template = dicts[locale][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
