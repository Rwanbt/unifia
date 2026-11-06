/* SPDX-License-Identifier: MIT */
// Strings for the Automate node settings (control.if condition, control.merge
// strategy). en/fr live here because en.ts and fr.ts are past the 1500 LOC
// ceiling; every other locale owns an object below, typed against
// AutomateNodeConfigKey so a missing key fails the build instead of falling
// back to English.

import type { Locale } from "@/context/language"
import type { AutomateNodeConfigDict, AutomateNodeConfigKey } from "./automate-node-config/types"

export type { AutomateNodeConfigDict, AutomateNodeConfigKey }

const en: AutomateNodeConfigDict = {
  "config.title": "Settings",
  "config.if.condition": "Condition",
  "config.if.hint": "Reads earlier steps as $node.<id>.json.<field>, for example $node.fetch.json.count > 2. The true and false outputs are the two ports of this node.",
  "config.if.required": "A condition is required before this workflow can run.",
  "config.merge.strategy": "Continue when",
  "config.merge.all": "all incoming branches are done",
  "config.merge.any": "one incoming branch is done",
  "config.merge.waitsOn": "Waits on: {ids}",
  "config.merge.noBranches": "Draw at least one edge into this node.",
}

const fr: AutomateNodeConfigDict = {
  "config.title": "Réglages",
  "config.if.condition": "Condition",
  "config.if.hint": "Lit les étapes précédentes avec $node.<id>.json.<champ>, par exemple $node.fetch.json.count > 2. Les sorties vrai et faux sont les deux ports de ce nœud.",
  "config.if.required": "Une condition est nécessaire pour lancer ce workflow.",
  "config.merge.strategy": "Continuer quand",
  "config.merge.all": "toutes les branches entrantes sont terminées",
  "config.merge.any": "une branche entrante est terminée",
  "config.merge.waitsOn": "Attend : {ids}",
  "config.merge.noBranches": "Tracez au moins un lien vers ce nœud.",
}

const ar: AutomateNodeConfigDict = {
  "config.title": "الإعدادات",
  "config.if.condition": "الشرط",
  "config.if.hint": "يقرأ الخطوات السابقة بالصيغة $node.<id>.json.<حقل>، مثل $node.fetch.json.count > 2. مخرجا «صحيح» و«خطأ» هما منفذا هذه العقدة.",
  "config.if.required": "الشرط مطلوب قبل تشغيل سير العمل هذا.",
  "config.merge.strategy": "المتابعة عندما",
  "config.merge.all": "تكتمل جميع الفروع الواردة",
  "config.merge.any": "يكتمل فرع وارد واحد",
  "config.merge.waitsOn": "ينتظر: {ids}",
  "config.merge.noBranches": "ارسم حافة واحدة على الأقل إلى هذه العقدة.",
}

const br: AutomateNodeConfigDict = {
  "config.title": "Configurações",
  "config.if.condition": "Condição",
  "config.if.hint": "Lê etapas anteriores como $node.<id>.json.<campo>, por exemplo $node.fetch.json.count > 2. As saídas verdadeira e falsa são as duas portas deste nó.",
  "config.if.required": "Uma condição é obrigatória antes de este workflow ser executado.",
  "config.merge.strategy": "Continuar quando",
  "config.merge.all": "todos os ramos de entrada terminarem",
  "config.merge.any": "um ramo de entrada terminar",
  "config.merge.waitsOn": "Aguarda: {ids}",
  "config.merge.noBranches": "Desenhe pelo menos uma aresta até este nó.",
}

const bs: AutomateNodeConfigDict = {
  "config.title": "Postavke",
  "config.if.condition": "Uslov",
  "config.if.hint": "Čita prethodne korake kao $node.<id>.json.<polje>, na primjer $node.fetch.json.count > 2. Izlazi tačno i netačno su dva porta ovog čvora.",
  "config.if.required": "Uslov je obavezan prije pokretanja ovog workflowa.",
  "config.merge.strategy": "Nastavi kada",
  "config.merge.all": "sve ulazne grane završe",
  "config.merge.any": "jedna ulazna grana završi",
  "config.merge.waitsOn": "Čeka na: {ids}",
  "config.merge.noBranches": "Nacrtajte barem jednu vezu u ovaj čvor.",
}

const da: AutomateNodeConfigDict = {
  "config.title": "Indstillinger",
  "config.if.condition": "Betingelse",
  "config.if.hint": "Læser tidligere trin som $node.<id>.json.<felt>, for eksempel $node.fetch.json.count > 2. Sand- og falsk-udgangene er denne nodes to porte.",
  "config.if.required": "En betingelse er påkrævet, før dette workflow kan køre.",
  "config.merge.strategy": "Fortsæt når",
  "config.merge.all": "alle indgående grene er færdige",
  "config.merge.any": "én indgående gren er færdig",
  "config.merge.waitsOn": "Venter på: {ids}",
  "config.merge.noBranches": "Tegn mindst én kant ind i denne node.",
}

const de: AutomateNodeConfigDict = {
  "config.title": "Einstellungen",
  "config.if.condition": "Bedingung",
  "config.if.hint": "Liest frühere Schritte als $node.<id>.json.<feld>, zum Beispiel $node.fetch.json.count > 2. Die Wahr- und Falsch-Ausgänge sind die beiden Ports dieses Knotens.",
  "config.if.required": "Eine Bedingung ist erforderlich, bevor dieser Workflow ausgeführt werden kann.",
  "config.merge.strategy": "Fortsetzen, wenn",
  "config.merge.all": "alle eingehenden Zweige abgeschlossen sind",
  "config.merge.any": "ein eingehender Zweig abgeschlossen ist",
  "config.merge.waitsOn": "Wartet auf: {ids}",
  "config.merge.noBranches": "Zeichnen Sie mindestens eine Kante in diesen Knoten.",
}

const es: AutomateNodeConfigDict = {
  "config.title": "Ajustes",
  "config.if.condition": "Condición",
  "config.if.hint": "Lee los pasos anteriores como $node.<id>.json.<campo>, por ejemplo $node.fetch.json.count > 2. Las salidas verdadera y falsa son los dos puertos de este nodo.",
  "config.if.required": "Se requiere una condición antes de ejecutar este workflow.",
  "config.merge.strategy": "Continuar cuando",
  "config.merge.all": "todas las ramas entrantes hayan terminado",
  "config.merge.any": "una rama entrante haya terminado",
  "config.merge.waitsOn": "Espera a: {ids}",
  "config.merge.noBranches": "Dibuja al menos una arista hacia este nodo.",
}

const ja: AutomateNodeConfigDict = {
  "config.title": "設定",
  "config.if.condition": "条件",
  "config.if.hint": "以前のステップを $node.<id>.json.<フィールド> として読み取ります（例: $node.fetch.json.count > 2）。true と false の出力は、このノードの 2 つのポートです。",
  "config.if.required": "このワークフローを実行するには条件が必要です。",
  "config.merge.strategy": "続行する条件",
  "config.merge.all": "入力ブランチがすべて完了したとき",
  "config.merge.any": "入力ブランチが 1 つ完了したとき",
  "config.merge.waitsOn": "待機対象: {ids}",
  "config.merge.noBranches": "このノードに少なくとも 1 本のエッジを描画してください。",
}

const ko: AutomateNodeConfigDict = {
  "config.title": "설정",
  "config.if.condition": "조건",
  "config.if.hint": "이전 단계를 $node.<id>.json.<필드> 형식으로 읽습니다. 예: $node.fetch.json.count > 2. true와 false 출력은 이 노드의 두 포트입니다.",
  "config.if.required": "이 워크플로를 실행하려면 조건이 필요합니다.",
  "config.merge.strategy": "계속 조건",
  "config.merge.all": "들어오는 모든 분기가 완료되면",
  "config.merge.any": "들어오는 분기 하나가 완료되면",
  "config.merge.waitsOn": "대기 대상: {ids}",
  "config.merge.noBranches": "이 노드로 최소 하나의 에지를 그리세요.",
}

const no: AutomateNodeConfigDict = {
  "config.title": "Innstillinger",
  "config.if.condition": "Betingelse",
  "config.if.hint": "Leser tidligere trinn som $node.<id>.json.<felt>, for eksempel $node.fetch.json.count > 2. Utgangene sann og usann er de to portene til denne noden.",
  "config.if.required": "En betingelse kreves før denne workflowen kan kjøre.",
  "config.merge.strategy": "Fortsett når",
  "config.merge.all": "alle inngående grener er ferdige",
  "config.merge.any": "én inngående gren er ferdig",
  "config.merge.waitsOn": "Venter på: {ids}",
  "config.merge.noBranches": "Tegn minst én kant inn i denne noden.",
}

const pl: AutomateNodeConfigDict = {
  "config.title": "Ustawienia",
  "config.if.condition": "Warunek",
  "config.if.hint": "Odczytuje wcześniejsze kroki jako $node.<id>.json.<pole>, na przykład $node.fetch.json.count > 2. Wyjścia prawda i fałsz to dwa porty tego węzła.",
  "config.if.required": "Warunek jest wymagany, zanim ten workflow będzie mógł zostać uruchomiony.",
  "config.merge.strategy": "Kontynuuj, gdy",
  "config.merge.all": "wszystkie gałęzie wejściowe zostaną zakończone",
  "config.merge.any": "jedna gałąź wejściowa zostanie zakończona",
  "config.merge.waitsOn": "Oczekuje na: {ids}",
  "config.merge.noBranches": "Narysuj co najmniej jedną krawędź do tego węzła.",
}

const ru: AutomateNodeConfigDict = {
  "config.title": "Настройки",
  "config.if.condition": "Условие",
  "config.if.hint": "Читает предыдущие шаги как $node.<id>.json.<поле>, например $node.fetch.json.count > 2. Выходы «истина» и «ложь» — это два порта этого узла.",
  "config.if.required": "Условие обязательно, прежде чем этот workflow сможет запуститься.",
  "config.merge.strategy": "Продолжить, когда",
  "config.merge.all": "все входящие ветви завершены",
  "config.merge.any": "одна входящая ветвь завершена",
  "config.merge.waitsOn": "Ожидает: {ids}",
  "config.merge.noBranches": "Проведите хотя бы одно ребро в этот узел.",
}

const th: AutomateNodeConfigDict = {
  "config.title": "การตั้งค่า",
  "config.if.condition": "เงื่อนไข",
  "config.if.hint": "อ่านขั้นตอนก่อนหน้าเป็น $node.<id>.json.<ฟิลด์> เช่น $node.fetch.json.count > 2 เอาต์พุตจริงและเท็จคือพอร์ตสองพอร์ตของโหนดนี้",
  "config.if.required": "ต้องมีเงื่อนไขก่อนจึงจะเรียกใช้เวิร์กโฟลว์นี้ได้",
  "config.merge.strategy": "ดำเนินการต่อเมื่อ",
  "config.merge.all": "สาขาขาเข้าทั้งหมดเสร็จสิ้น",
  "config.merge.any": "สาขาขาเข้าหนึ่งสาขาเสร็จสิ้น",
  "config.merge.waitsOn": "รอ: {ids}",
  "config.merge.noBranches": "วาดเส้นเชื่อมอย่างน้อยหนึ่งเส้นเข้าสู่โหนดนี้",
}

const tr: AutomateNodeConfigDict = {
  "config.title": "Ayarlar",
  "config.if.condition": "Koşul",
  "config.if.hint": "Önceki adımları $node.<id>.json.<alan> olarak okur, örneğin $node.fetch.json.count > 2. Doğru ve yanlış çıktıları bu düğümün iki portudur.",
  "config.if.required": "Bu workflow çalışmadan önce bir koşul gerekir.",
  "config.merge.strategy": "Şu durumda devam et",
  "config.merge.all": "gelen tüm dallar tamamlandığında",
  "config.merge.any": "gelen bir dal tamamlandığında",
  "config.merge.waitsOn": "Beklediği: {ids}",
  "config.merge.noBranches": "Bu düğüme en az bir kenar çizin.",
}

const zh: AutomateNodeConfigDict = {
  "config.title": "设置",
  "config.if.condition": "条件",
  "config.if.hint": "以 $node.<id>.json.<字段> 的形式读取之前的步骤，例如 $node.fetch.json.count > 2。true 和 false 输出是此节点的两个端口。",
  "config.if.required": "运行此工作流前必须提供条件。",
  "config.merge.strategy": "继续条件",
  "config.merge.all": "所有传入分支均已完成",
  "config.merge.any": "一个传入分支完成",
  "config.merge.waitsOn": "等待：{ids}",
  "config.merge.noBranches": "为此节点绘制至少一条边。",
}

const zht: AutomateNodeConfigDict = {
  "config.title": "設定",
  "config.if.condition": "條件",
  "config.if.hint": "以 $node.<id>.json.<欄位> 的形式讀取先前的步驟，例如 $node.fetch.json.count > 2。true 與 false 輸出是此節點的兩個連接埠。",
  "config.if.required": "執行此工作流程前必須提供條件。",
  "config.merge.strategy": "繼續條件",
  "config.merge.all": "所有傳入分支都已完成",
  "config.merge.any": "一個傳入分支完成",
  "config.merge.waitsOn": "等待：{ids}",
  "config.merge.noBranches": "為此節點繪製至少一條邊。",
}

export const dicts: Record<Locale, AutomateNodeConfigDict> = {
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

export function tAutomateNodeConfig(locale: Locale, key: AutomateNodeConfigKey, params?: Record<string, string>): string {
  const template = dicts[locale][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
