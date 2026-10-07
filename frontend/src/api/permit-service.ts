import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, Post } from '@/data/types'

// 承包商作业许可的专属规则，通用框架（local-service）装不下的业务判断都放这里：
// 签发/撤销按岗位划权、许可时段与人员名单受保护、门岗按时段读结论、撤销联动检修外协清单重排。

export const PERMIT_KEY = 'permit'
export const OVERHAUL_KEY = 'overhaul'
export const SAFETY_ORG = '厂安监口'
export const GATE_ORG = '门岗'

// 演示用承包商名录：岗位切到承包商时从这里选单位。
export const CONTRACTORS = ['华东检修一队', '蓝天保温工程队', '顺达土建劳务']

export type Actor = { post: Post; name: string; org: string }

export type GateResult = { pass: boolean; conclusion: string; reasons: string[] }

export type IssuePayload = {
  许可编号: string
  承包商: string
  作业区域: string
  许可开始: string
  许可结束: string
  入厂作业人员名单: string
}

// 许可时段与人员名单在签发时定死，承包商动这两类字段一律退回，并按条款说清越在哪一条。
const PROTECTED_CLAUSES: Record<string, string> = {
  许可开始: '许可时段（开始时间）只能由厂安监口在签发时确定，承包商无权提前或延后',
  许可结束: '许可时段（结束时间）只能由厂安监口在签发时确定，承包商无权提前或延后',
  入厂作业人员名单: '入厂作业人员名单只能由厂安监口维护，承包商无权增减人员',
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatMinute(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function parseMinute(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text.trim())
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
}

function normalizeMinute(text: string): string {
  const d = parseMinute(text)
  return d ? formatMinute(d) : text.trim()
}

export function parseRoster(text: string): string[] {
  return text
    .split(/[、,，;；\n]/)
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

function normalizeField(field: string, value: string): string {
  if (field === '许可开始' || field === '许可结束') return normalizeMinute(value)
  if (field === '入厂作业人员名单') return parseRoster(value).join('、')
  return value.trim()
}

function isRevoked(row: EntryRow): boolean {
  return String(row['撤销人'] ?? '').trim() !== ''
}

/** 许可的实时状态：撤销优先，其余按当前时刻与许可时段比对得出。 */
export function effectiveStatus(row: EntryRow, now: Date = new Date()): string {
  if (isRevoked(row)) return '已撤销'
  const start = parseMinute(String(row['许可开始'] ?? ''))
  const end = parseMinute(String(row['许可结束'] ?? ''))
  if (start && now < start) return '待生效'
  if (end && now > end) return '已失效'
  return '生效中'
}

/** 门岗读到的结论：只有「生效中」的许可放人，其余一律失效。 */
export function gateVerdict(row: EntryRow, now: Date = new Date()): string {
  return effectiveStatus(row, now) === '生效中' ? '有效，可放行' : '失效，禁止入厂'
}

/** 把随时间漂移的状态（待生效/生效中/已失效）回写存储，让概览统计与列表读到的是当下结论。 */
export function refreshPermitStatuses(now: Date = new Date()): void {
  const rows = listRows(PERMIT_KEY)
  if (!rows.length) return
  let dirty = false
  const next = rows.map((row) => {
    const status = effectiveStatus(row, now)
    const pending = status === '待生效' || status === '生效中'
    const abnormal = status === '已撤销'
    if (row.status === status && row.pending === pending && row.abnormal === abnormal) {
      return row
    }
    dirty = true
    return { ...row, status, pending, abnormal }
  })
  if (dirty) {
    saveRows(PERMIT_KEY, next)
  }
}

/** 按岗位取列表：承包商只能看到与本单位有关的条目，安监口与门岗看全部。 */
export function listPermits(
  actor: Actor,
  filters: Record<string, string> = {},
): { items: EntryRow[]; total: number } {
  refreshPermitStatuses()
  let rows = listRows(PERMIT_KEY)
  if (actor.post === 'contractor') {
    rows = rows.filter((row) => String(row['承包商']) === actor.org)
  }
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length > 0) {
    rows = rows.filter((row) =>
      pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
    )
  }
  return { items: rows, total: rows.length }
}

/** 签发：只有厂安监口能签；同一编号被两个岗位同时提交时，只认先落库的那一份。 */
export function issuePermit(actor: Actor, payload: IssuePayload): ActionResult {
  if (actor.post !== 'safety') {
    return { ok: false, message: '越权拦截：只有厂安监口才能签发作业许可' }
  }
  const no = payload.许可编号.trim()
  if (no === '') return { ok: false, message: '许可编号不能为空' }
  if (payload.承包商.trim() === '') return { ok: false, message: '承包商不能为空' }
  if (payload.作业区域.trim() === '') return { ok: false, message: '作业区域不能为空' }
  const start = parseMinute(payload.许可开始)
  const end = parseMinute(payload.许可结束)
  if (!start || !end) {
    return { ok: false, message: '许可时段格式不对，按 YYYY-MM-DD HH:mm 填写' }
  }
  if (start >= end) {
    return { ok: false, message: '许可时段不自洽：开始时间必须早于结束时间' }
  }
  const roster = parseRoster(payload.入厂作业人员名单)
  if (roster.length === 0) {
    return { ok: false, message: '入厂作业人员名单至少写一个人' }
  }
  const rows = listRows(PERMIT_KEY)
  const dup = rows.find((row) => String(row['许可编号']) === no)
  if (dup) {
    return {
      ok: false,
      message: `许可编号 ${no} 已由 ${dup['签发人']} 于 ${dup['签发时间']} 先一步落库，本次提交退回，同号许可只认先落库的那一份`,
    }
  }
  const now = new Date()
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: '待生效',
    pending: true,
    abnormal: false,
    revision: 1,
    许可编号: no,
    承包商: payload.承包商.trim(),
    作业区域: payload.作业区域.trim(),
    许可开始: formatMinute(start),
    许可结束: formatMinute(end),
    入厂作业人员名单: roster.join('、'),
    签发人: actor.name,
    签发时间: formatMinute(now),
    撤销人: '',
    撤销时间: '',
  }
  row.status = effectiveStatus(row, now)
  row.pending = row.status === '待生效' || row.status === '生效中'
  saveRows(PERMIT_KEY, [...rows, row])
  return {
    ok: true,
    message: `作业许可 ${no} 已签发，${row['许可开始']} 起生效，入厂作业人员 ${roster.length} 人`,
  }
}

/** 撤销：只有厂安监口能撤；撤销留痕（谁、几点），整条只读，并驱动检修外协清单重排。 */
export function revokePermit(actor: Actor, id: number): ActionResult {
  if (actor.post !== 'safety') {
    return { ok: false, message: '越权拦截：只有厂安监口才能撤销作业许可' }
  }
  const rows = listRows(PERMIT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的作业许可` }
  }
  const row = rows[index]
  if (isRevoked(row)) {
    return {
      ok: false,
      message: `该许可已于 ${row['撤销时间']} 被 ${row['撤销人']} 撤销，整条只读，不能重复撤销`,
    }
  }
  const now = new Date()
  const revoked: EntryRow = {
    ...row,
    status: '已撤销',
    pending: false,
    abnormal: true,
    revision: Number(row['revision'] ?? 1) + 1,
    撤销人: actor.name,
    撤销时间: formatMinute(now),
  }
  const next = [...rows]
  next[index] = revoked
  saveRows(PERMIT_KEY, next)
  const reworked = requeueOutsourcedOverhauls(String(row['承包商']))
  const linkage =
    reworked > 0
      ? `已联动设备检修外协清单重排：${reworked} 条检修记录退回「待开工」并提到队首`
      : '设备检修外协清单里没有该承包商的未完记录，无需重排'
  return {
    ok: true,
    message: `作业许可 ${row['许可编号']} 已撤销（${actor.name}，${revoked['撤销时间']}）；${linkage}`,
  }
}

// 撤销联动：该承包商名下的未完外协检修一律退回「待开工」，并提到检修清单队首重新排队。
function requeueOutsourcedOverhauls(contractor: string): number {
  const rows = listRows(OVERHAUL_KEY)
  const hit = (row: EntryRow) =>
    String(row['检修班组']) === contractor && String(row.status) !== '已完工'
  const affected = rows.filter(hit).map((row) => ({ ...row, status: '待开工', pending: true }))
  if (affected.length === 0) return 0
  const rest = rows.filter((row) => !hit(row))
  saveRows(OVERHAUL_KEY, [...affected, ...rest])
  return affected.length
}

/**
 * 承包商变更申请：承包商对许可只有查看权，任何改动都退回；
 * 动到许可时段或人员名单时，按条款逐条说清越在哪一条。
 */
export function submitContractorChange(
  actor: Actor,
  id: number,
  patch: Record<string, string>,
): ActionResult {
  if (actor.post !== 'contractor') {
    return { ok: false, message: '变更申请入口只面向承包商；厂安监口请直接撤销后重新签发' }
  }
  const row = listRows(PERMIT_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的作业许可` }
  }
  if (String(row['承包商']) !== actor.org) {
    return {
      ok: false,
      message: `越权拦截：${actor.org} 只能查看与本单位有关的许可，「${row['许可编号']}」属于 ${row['承包商']}`,
    }
  }
  if (isRevoked(row)) {
    return {
      ok: false,
      message: `该许可已于 ${row['撤销时间']} 被 ${row['撤销人']} 撤销，整条只读，任何变更都不受理`,
    }
  }
  const violations: string[] = []
  for (const [field, raw] of Object.entries(patch)) {
    const changed = normalizeField(field, raw) !== normalizeField(field, String(row[field] ?? ''))
    if (!changed) continue
    const clause = PROTECTED_CLAUSES[field]
    violations.push(clause ?? `「${field}」不在承包商可改范围内，承包商对许可只有查看权`)
  }
  if (violations.length === 0) {
    return { ok: false, message: '变更退回：没有检测到改动；承包商对许可只有查看权，确需调整请联系厂安监口撤销重签' }
  }
  return { ok: false, message: `变更退回：${violations.join('；')}` }
}

/** 门岗核验：许可时段之外、已撤销、人不在名单内，结论一律是失效，不放人进厂。 */
export function gateCheck(permitNo: string, person: string, now: Date = new Date()): GateResult {
  const no = permitNo.trim()
  const row = listRows(PERMIT_KEY).find((item) => String(item['许可编号']) === no)
  if (!row) {
    return { pass: false, conclusion: '禁止入厂', reasons: [`许可编号 ${no || '（空）'} 查无此单`] }
  }
  const reasons: string[] = []
  if (isRevoked(row)) {
    reasons.push(`许可已于 ${row['撤销时间']} 被 ${row['撤销人']} 撤销`)
  }
  const start = parseMinute(String(row['许可开始'] ?? ''))
  const end = parseMinute(String(row['许可结束'] ?? ''))
  if (start && now < start) reasons.push(`许可未生效，${row['许可开始']} 起才能入厂`)
  if (end && now > end) reasons.push(`许可已失效，有效时段 ${row['许可开始']} ~ ${row['许可结束']}`)
  const name = person.trim()
  const roster = parseRoster(String(row['入厂作业人员名单'] ?? ''))
  if (name === '') {
    reasons.push('未填写入厂人员姓名')
  } else if (!roster.includes(name)) {
    reasons.push(`${name} 不在入厂作业人员名单内`)
  }
  if (reasons.length > 0) {
    return { pass: false, conclusion: '禁止入厂', reasons }
  }
  return { pass: true, conclusion: '放行', reasons: [`许可 ${row['许可编号']} 在有效时段内，${name} 在名单内`] }
}

/** 签发时预填的许可编号：WP-年份-流水，流水取当前最大加一。 */
export function suggestPermitNo(now: Date = new Date()): string {
  const prefix = `WP-${now.getFullYear()}-`
  const maxSeq = listRows(PERMIT_KEY).reduce((max, row) => {
    const no = String(row['许可编号'] ?? '')
    if (!no.startsWith(prefix)) return max
    return Math.max(max, Number(no.slice(prefix.length)) || 0)
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`
}
