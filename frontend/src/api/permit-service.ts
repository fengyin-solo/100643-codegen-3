import { filterRows } from '@/api/local-service'
import { listRows, persistedRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 承包商作业许可的专用服务：签发、撤销、改单退回、门岗核验、撤销联动检修清单，
// 全部收口在这里，页面只渲染结果，不做业务判断。
export const PERMIT_KEY = 'permit'
const OVERHAUL_KEY = 'overhaul'

export type Actor = {
  role: 'safety' | 'contractor'
  operator: string
  contractor: string
}

export type PermitDraft = {
  许可编号: string
  承包商: string
  作业区域: string
  许可开始: string
  许可结束: string
  作业人员: string
}

export type GateResult = {
  found: boolean
  pass: boolean
  conclusion: string
  detail: string
  row: EntryRow | null
}

// 改单红线：签发后动到许可时段或人员名单一律退回，退回消息指清越在哪一条。
const AMEND_RULES = [
  { fields: ['许可开始', '许可结束'], rule: '许可时段签发后不得变更' },
  { fields: ['作业人员'], rule: '入厂作业人员名单签发后不得变更' },
]

// 红线之外允许更正的字段；编号、承包商、签发信息一律不在可改范围。
const AMENDABLE_FIELDS = ['作业区域']

function parseMoment(value: string): number {
  return new Date(value.trim().replace(' ', 'T')).getTime()
}

export function formatMoment(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isRevoked(row: EntryRow): boolean {
  return String(row.status) === '已撤销'
}

// 门岗结论：只看撤销状态和许可时段，时段之外一律失效，失效不放人进厂。
export function permitConclusion(row: EntryRow, now: Date = new Date()): { pass: boolean; label: string } {
  if (isRevoked(row)) {
    return { pass: false, label: `失效（${String(row['撤销时间'])} 被 ${String(row['撤销人'])} 撤销）` }
  }
  const ts = now.getTime()
  if (ts < parseMoment(String(row['许可开始']))) {
    return { pass: false, label: '失效（未到生效时刻）' }
  }
  if (ts > parseMoment(String(row['许可结束']))) {
    return { pass: false, label: '失效（已出许可时段）' }
  }
  return { pass: true, label: '有效（许可时段内）' }
}

// 列表按签发单位划开：承包商只能看到与自己单位有关的条目。
export function listPermits(actor: Actor, filters: Record<string, string> = {}): EntryRow[] {
  const rows = listRows(PERMIT_KEY)
  const scoped =
    actor.role === 'contractor'
      ? rows.filter((row) => String(row['承包商']) === actor.contractor)
      : rows
  return filterRows(scoped, filters)
}

export function contractorNames(): string[] {
  const names = listRows(PERMIT_KEY).map((row) => String(row['承包商']))
  return [...new Set(names)]
}

export function nextPermitNo(): string {
  const max = listRows(PERMIT_KEY).reduce((acc, row) => {
    const matched = /^PERMIT-(\d+)$/.exec(String(row['许可编号']))
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 0)
  return `PERMIT-${String(max + 1).padStart(4, '0')}`
}

export function issuePermit(actor: Actor, draft: PermitDraft): ActionResult {
  if (actor.role !== 'safety') {
    return { ok: false, message: '退回：签发权在厂内安监口，承包商只能查看与自身相关的许可' }
  }
  const required: [keyof PermitDraft, string][] = [
    ['许可编号', '许可编号'],
    ['承包商', '承包商'],
    ['作业区域', '作业区域'],
    ['许可开始', '许可开始'],
    ['许可结束', '许可结束'],
    ['作业人员', '入厂作业人员名单'],
  ]
  const missing = required.filter(([field]) => draft[field].trim() === '').map(([, label]) => label)
  if (missing.length > 0) {
    return { ok: false, message: `退回：${missing.join('、')} 不能为空，许可上必须挂全这些信息` }
  }
  if (parseMoment(draft.许可结束) <= parseMoment(draft.许可开始)) {
    return { ok: false, message: '退回：许可结束必须晚于许可开始，许可时段不成立' }
  }
  // 并发：两个岗位同时提交同一编号时，落库前直读持久化层查重，只认先落库的那一份。
  const persisted = persistedRows(PERMIT_KEY)
  const no = draft.许可编号.trim()
  if (persisted.some((row) => String(row['许可编号']) === no)) {
    return { ok: false, message: `退回：许可编号 ${no} 已由其它岗位先落库，本次提交作废，只认先落库的那一份` }
  }
  const now = formatMoment(new Date())
  const row: EntryRow = {
    id: persisted.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: '生效中',
    pending: true,
    abnormal: false,
    许可编号: no,
    承包商: draft.承包商.trim(),
    作业区域: draft.作业区域.trim(),
    许可开始: draft.许可开始.trim(),
    许可结束: draft.许可结束.trim(),
    作业人员: draft.作业人员.trim(),
    签发人: actor.operator,
    签发时间: now,
    撤销人: '',
    撤销时间: '',
  }
  saveRows(PERMIT_KEY, [...persisted, row])
  return { ok: true, message: `作业许可 ${no} 已签发：签发人 ${actor.operator}，签发时间 ${now}，${draft.许可开始.trim()} 起生效` }
}

export function revokePermit(actor: Actor, id: number): ActionResult {
  if (actor.role !== 'safety') {
    return { ok: false, message: '退回：撤销权在厂内安监口，承包商只能查看与自身相关的许可' }
  }
  const rows = listRows(PERMIT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的作业许可` }
  }
  const target = rows[index]
  if (isRevoked(target)) {
    return {
      ok: false,
      message: `作业许可 ${String(target['许可编号'])} 已是撤销状态，整条只读；撤销人 ${String(target['撤销人'])}，撤销时间 ${String(target['撤销时间'])}`,
    }
  }
  const now = formatMoment(new Date())
  const next = [...rows]
  next[index] = {
    ...target,
    status: '已撤销',
    pending: false,
    abnormal: true,
    撤销人: actor.operator,
    撤销时间: now,
  }
  saveRows(PERMIT_KEY, next)
  const reshuffled = reshuffleOverhaul(String(target['承包商']))
  const linkNote =
    reshuffled > 0
      ? `；已驱动设备检修外协清单重排，${reshuffled} 条检修中记录退回待开工并移到清单末尾`
      : '；设备检修外协清单中没有该承包商检修中的记录，无需重排'
  return { ok: true, message: `作业许可 ${String(target['许可编号'])} 已撤销（${actor.operator}，${now}）${linkNote}` }
}

// 撤销联动：该承包商名下检修中的外协记录退回待开工，并沉到检修清单末尾完成重排。
function reshuffleOverhaul(contractor: string): number {
  const rows = listRows(OVERHAUL_KEY)
  const hit = rows.filter(
    (row) => String(row['检修班组']) === contractor && String(row.status) === '检修中',
  )
  if (hit.length === 0) {
    return 0
  }
  const hitIds = new Set(hit.map((row) => Number(row.id)))
  const kept = rows.filter((row) => !hitIds.has(Number(row.id)))
  const demoted = hit.map((row) => ({ ...row, status: '待开工', pending: true, abnormal: true }))
  saveRows(OVERHAUL_KEY, [...kept, ...demoted])
  return hit.length
}

export function amendPermit(actor: Actor, id: number, changes: Record<string, string>): ActionResult {
  if (actor.role !== 'safety') {
    return { ok: false, message: '退回：承包商只能查看与自身相关的许可，改动一律不受理' }
  }
  const rows = listRows(PERMIT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的作业许可` }
  }
  const target = rows[index]
  if (isRevoked(target)) {
    return { ok: false, message: `作业许可 ${String(target['许可编号'])} 已撤销，整条只读，任何改动一律退回` }
  }
  // 逐条对照改单红线：动到许可时段或人员名单，退回并说清越在哪一条。
  const violated: string[] = []
  AMEND_RULES.forEach((rule, ruleIndex) => {
    const touched = rule.fields.filter(
      (field) => field in changes && changes[field].trim() !== String(target[field] ?? '').trim(),
    )
    if (touched.length > 0) {
      violated.push(`第${ruleIndex + 1}条「${rule.rule}」（触及：${touched.join('、')}）`)
    }
  })
  if (violated.length > 0) {
    return { ok: false, message: `已退回：越了${violated.join('；')}，只能撤销后重新签发` }
  }
  const next = { ...target }
  let touchedCount = 0
  for (const field of AMENDABLE_FIELDS) {
    const value = changes[field]
    if (value !== undefined && value.trim() !== '' && value.trim() !== String(next[field])) {
      next[field] = value.trim()
      touchedCount += 1
    }
  }
  if (touchedCount === 0) {
    return { ok: false, message: '没有实际改动，未落库' }
  }
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(PERMIT_KEY, nextRows)
  return { ok: true, message: `作业许可 ${String(target['许可编号'])} 已更正（仅作业区域可改，许可时段与人员名单不在可改范围）` }
}

// 门岗核验：按许可编号读结论，失效一律不放人进厂。
export function gateCheck(permitNo: string, now: Date = new Date()): GateResult {
  const no = permitNo.trim()
  const row = listRows(PERMIT_KEY).find((item) => String(item['许可编号']) === no) ?? null
  if (!row) {
    return { found: false, pass: false, conclusion: '失效', detail: `查无许可 ${no}，不放人进厂`, row: null }
  }
  const verdict = permitConclusion(row, now)
  if (!verdict.pass) {
    return { found: true, pass: false, conclusion: '失效', detail: `${verdict.label}，不放人进厂`, row }
  }
  return {
    found: true,
    pass: true,
    conclusion: '有效',
    detail: `${verdict.label}，放行入厂作业人员：${String(row['作业人员'])}`,
    row,
  }
}
