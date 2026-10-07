<template>
  <section class="page" data-module="permit">
    <header class="page-head">
      <div>
        <h2>承包商作业许可</h2>
        <p class="page-desc">一份许可挂承包商、作业区域、许可时段与入厂作业人员名单，签发人、生效时间留在单子上；门岗按许可时段读结论，失效许可不放人进厂。</p>
      </div>
      <div class="page-actions">
        <button v-if="isSafety" class="btn primary" type="button" @click="openIssue">签发作业许可</button>
        <button class="btn" type="button" @click="exportRows">导出作业许可清单</button>
      </div>
    </header>

    <div class="role-bar">
      <label class="role-item">
        <span>当前岗位</span>
        <select v-model="session.post">
          <option value="safety">厂安监口（可签发 / 撤销）</option>
          <option value="contractor">承包商（只看本单位）</option>
          <option value="gate">门岗（只读 + 入厂核验）</option>
        </select>
      </label>
      <label v-if="isContractor" class="role-item">
        <span>所属单位</span>
        <select v-model="session.org">
          <option v-for="name in contractors" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <span class="role-hint">{{ roleHint }}</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="gate-panel">
      <strong class="gate-title">门岗核验</strong>
      <input v-model="gateNo" placeholder="许可编号，如 WP-2026-0001" />
      <input v-model="gatePerson" placeholder="入厂人员姓名" />
      <button class="btn" type="button" @click="runGateCheck">核验</button>
      <span v-if="gateResult" :class="['gate-verdict', gateResult.pass ? 'pass' : 'deny']">
        {{ gateResult.conclusion }}：{{ gateResult.reasons.join('；') }}
      </span>
    </div>

    <p v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>门岗结论</th>
          <th>撤销留痕</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-revoked': revoked(row) }">
          <td>{{ row['许可编号'] }}</td>
          <td>{{ row['承包商'] }}</td>
          <td>{{ row['作业区域'] }}</td>
          <td>{{ row['许可开始'] }}</td>
          <td>{{ row['许可结束'] }}</td>
          <td>{{ row['入厂作业人员名单'] }}（{{ rosterCount(row) }}人）</td>
          <td>{{ row['签发人'] }}<br />{{ row['签发时间'] }}</td>
          <td>{{ effective(row) }}</td>
          <td :class="effective(row) === '生效中' ? 'verdict-pass' : 'verdict-deny'">
            {{ verdict(row) }}
          </td>
          <td>
            <template v-if="revoked(row)">{{ row['撤销人'] }} · {{ row['撤销时间'] }}</template>
            <span v-else>—</span>
          </td>
          <td class="row-actions">
            <button
              v-if="isSafety && !revoked(row)"
              class="link"
              type="button"
              @click="confirmRevoke(row)"
            >
              撤销
            </button>
            <button
              v-if="isContractor && !revoked(row)"
              class="link"
              type="button"
              @click="openChange(row)"
            >
              申请变更
            </button>
            <span v-if="revoked(row)" class="readonly-tag">已撤销·整条只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">
            {{ isContractor ? `暂无与 ${session.org} 有关的作业许可` : '暂无作业许可，可由厂安监口签发' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条作业许可</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="showIssue" class="modal-mask">
      <div class="modal">
        <h3>签发作业许可</h3>
        <label class="modal-field">
          <span>许可编号</span>
          <input v-model="issueForm.no" />
        </label>
        <label class="modal-field">
          <span>承包商</span>
          <select v-model="issueForm.contractor">
            <option v-for="name in contractors" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>作业区域</span>
          <input v-model="issueForm.area" placeholder="如 1号焚烧炉检修平台" />
        </label>
        <label class="modal-field">
          <span>许可开始（生效时间）</span>
          <input v-model="issueForm.start" type="datetime-local" />
        </label>
        <label class="modal-field">
          <span>许可结束</span>
          <input v-model="issueForm.end" type="datetime-local" />
        </label>
        <label class="modal-field">
          <span>入厂作业人员名单（顿号 / 逗号 / 换行分隔）</span>
          <textarea v-model="issueForm.roster" rows="3" placeholder="王大力、李二柱"></textarea>
        </label>
        <p class="modal-hint">签发人、签发时间自动留在单子上；同一编号被两个岗位同时提交时，只认先落库的那一份。</p>
        <p v-if="issueError" class="error-text">{{ issueError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitIssue">提交签发</button>
          <button class="btn ghost" type="button" @click="showIssue = false">取消</button>
        </div>
      </div>
    </div>

    <div v-if="showChange" class="modal-mask">
      <div class="modal">
        <h3>申请变更 · {{ changeRow?.['许可编号'] }}</h3>
        <label class="modal-field">
          <span>作业区域</span>
          <input v-model="changeForm.area" />
        </label>
        <label class="modal-field">
          <span>许可开始</span>
          <input v-model="changeForm.start" type="datetime-local" />
        </label>
        <label class="modal-field">
          <span>许可结束</span>
          <input v-model="changeForm.end" type="datetime-local" />
        </label>
        <label class="modal-field">
          <span>入厂作业人员名单</span>
          <textarea v-model="changeForm.roster" rows="3"></textarea>
        </label>
        <p class="modal-hint">承包商对许可只有查看权：动到许可时段或人员名单，提交会被退回并注明越在哪一条。</p>
        <p v-if="changeError" class="error-text">{{ changeError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitChange">提交变更</button>
          <button class="btn ghost" type="button" @click="showChange = false">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  CONTRACTORS,
  GATE_ORG,
  SAFETY_ORG,
  effectiveStatus,
  formatMinute,
  gateCheck,
  gateVerdict,
  issuePermit,
  listPermits,
  parseRoster,
  revokePermit,
  submitContractorChange,
  suggestPermitNo,
  type Actor,
  type GateResult,
} from '@/api/permit-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const contractors = CONTRACTORS

const columns = ['许可编号', '承包商', '作业区域', '许可开始', '许可结束', '入厂作业人员名单', '签发']
const statuses = ['待生效', '生效中', '已失效', '已撤销']
const filterFields = ['许可编号', '承包商', '作业区域']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})

const gateNo = ref('')
const gatePerson = ref('')
const gateResult = ref<GateResult | null>(null)

const showIssue = ref(false)
const issueForm = ref({ no: '', contractor: CONTRACTORS[0], area: '', start: '', end: '', roster: '' })
const issueError = ref('')

const showChange = ref(false)
const changeRow = ref<EntryRow | null>(null)
const changeForm = ref({ area: '', start: '', end: '', roster: '' })
const changeError = ref('')

const isSafety = computed(() => session.post === 'safety')
const isContractor = computed(() => session.post === 'contractor')

const actor = computed<Actor>(() => ({
  post: session.post,
  name: session.post === 'safety' ? `安监口-${session.operator}` : session.operator,
  org: session.post === 'contractor' ? session.org : session.post === 'safety' ? SAFETY_ORG : GATE_ORG,
}))

const roleHint = computed(() => {
  if (session.post === 'safety') return '安监口可签发新许可、撤销在用许可；撤销会联动设备检修外协清单重排。'
  if (session.post === 'contractor') return '承包商只能查看与本单位有关的许可；提交时段或名单改动会被退回并注明越权条款。'
  return '门岗只读；许可时段之外或已撤销的许可结论一律是失效，不放人进厂。'
})

const stats = computed(() => [
  { label: '生效中许可', value: rows.value.filter((row) => effective(row) === '生效中').length },
  { label: '待生效许可', value: rows.value.filter((row) => effective(row) === '待生效').length },
  { label: '已撤销许可', value: rows.value.filter((row) => effective(row) === '已撤销').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => effective(row) === status).length,
  })),
)

function effective(row: EntryRow): string {
  return effectiveStatus(row)
}

function revoked(row: EntryRow): boolean {
  return String(row['撤销人'] ?? '').trim() !== ''
}

function verdict(row: EntryRow): string {
  return gateVerdict(row)
}

function rosterCount(row: EntryRow): number {
  return parseRoster(String(row['入厂作业人员名单'] ?? '')).length
}

function toInputMinute(text: string): string {
  return String(text ?? '').trim().replace(' ', 'T')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('permit')
}

function openIssue() {
  const now = new Date()
  const end = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  issueForm.value = {
    no: suggestPermitNo(now),
    contractor: CONTRACTORS[0],
    area: '',
    start: toInputMinute(formatMinute(now)),
    end: toInputMinute(formatMinute(end)),
    roster: '',
  }
  issueError.value = ''
  showIssue.value = true
}

function submitIssue() {
  issueError.value = ''
  const result = issuePermit(actor.value, {
    许可编号: issueForm.value.no,
    承包商: issueForm.value.contractor,
    作业区域: issueForm.value.area,
    许可开始: issueForm.value.start,
    许可结束: issueForm.value.end,
    入厂作业人员名单: issueForm.value.roster,
  })
  if (!result.ok) {
    issueError.value = result.message
    return
  }
  showIssue.value = false
  noticeMessage.value = result.message
  reload()
}

function confirmRevoke(row: EntryRow) {
  const ok = window.confirm(
    `确认撤销作业许可 ${row['许可编号']}（${row['承包商']}）？撤销后整条只读，并联动设备检修外协清单重排。`,
  )
  if (!ok) return
  const result = revokePermit(actor.value, Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function openChange(row: EntryRow) {
  changeRow.value = row
  changeForm.value = {
    area: String(row['作业区域'] ?? ''),
    start: toInputMinute(String(row['许可开始'] ?? '')),
    end: toInputMinute(String(row['许可结束'] ?? '')),
    roster: String(row['入厂作业人员名单'] ?? ''),
  }
  changeError.value = ''
  showChange.value = true
}

function submitChange() {
  if (!changeRow.value) return
  changeError.value = ''
  const result = submitContractorChange(actor.value, Number(changeRow.value.id), {
    作业区域: changeForm.value.area,
    许可开始: changeForm.value.start,
    许可结束: changeForm.value.end,
    入厂作业人员名单: changeForm.value.roster,
  })
  if (!result.ok) {
    changeError.value = result.message
    return
  }
  showChange.value = false
  noticeMessage.value = result.message
  reload()
}

function runGateCheck() {
  gateResult.value = gateCheck(gateNo.value, gatePerson.value)
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listPermits(actor.value, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '作业许可列表读取失败'
  }
}

watch(
  () => session.post,
  (post) => {
    if (post === 'contractor' && !CONTRACTORS.includes(session.org)) {
      session.setOrg(CONTRACTORS[0])
    }
    reload()
  },
)
watch(
  () => session.org,
  () => {
    if (session.post === 'contractor') reload()
  },
)

onMounted(reload)
</script>

<style scoped>
.role-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.role-item {
  display: flex;
  gap: 6px;
  align-items: center;
}
.role-item span {
  color: var(--muted);
  font-size: 12px;
}
.role-hint {
  color: var(--muted);
  font-size: 12px;
}
.gate-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.gate-title {
  font-size: 13px;
}
.gate-verdict {
  font-size: 13px;
}
.gate-verdict.pass {
  color: #067647;
}
.gate-verdict.deny {
  color: #b42318;
}
.verdict-pass {
  color: #067647;
}
.verdict-deny {
  color: #b42318;
}
.notice-text {
  color: #067647;
  font-size: 13px;
  margin: 0 0 8px;
}
.row-revoked td {
  color: #98a2b3;
  background: #f8fafc;
}
.readonly-tag {
  color: var(--muted);
  font-size: 12px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.modal {
  width: 420px;
  max-height: 86vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal h3 {
  margin: 0;
  font-size: 15px;
}
.modal-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.modal-field input,
.modal-field select,
.modal-field textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
}
.modal-hint {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
