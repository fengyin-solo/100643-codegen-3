<template>
  <section class="page" data-module="permit">
    <header class="page-head">
      <div>
        <h2>承包商作业许可</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button v-if="isSafety" class="btn primary" type="button" @click="toggleIssue">签发许可</button>
        <button v-if="isSafety" class="btn" type="button" @click="exportRows">导出承包商作业许可清单</button>
      </div>
    </header>

    <div class="role-bar">
      <span class="role-label">当前身份：</span>
      <button class="btn ghost" :class="{ on: isSafety }" type="button" @click="switchSafety">厂内安监口</button>
      <button
        v-for="name in contractorOptions"
        :key="name"
        class="btn ghost"
        :class="{ on: !isSafety && store.contractor === name }"
        type="button"
        @click="switchContractor(name)"
      >
        {{ name }}
      </button>
      <span class="role-note">签发、撤销归安监口；承包商只能查看与自身相关的条目</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar gate-bar" @submit.prevent="runGateCheck">
      <label class="filter-item">
        <span>门岗核验·许可编号</span>
        <input v-model="gateNo" placeholder="如 PERMIT-0001" />
      </label>
      <button class="btn" type="submit">核验</button>
      <span v-if="gateResult" class="gate-result" :class="gateResult.pass ? 'pass' : 'fail'">
        {{ gateResult.conclusion }}：{{ gateResult.detail }}
      </span>
    </form>

    <form v-if="showIssue && isSafety" class="edit-panel" @submit.prevent="submitIssue">
      <h3 class="panel-title">签发作业许可（签发人、签发时间自动落单）</h3>
      <div class="panel-grid">
        <label class="filter-item">
          <span>许可编号</span>
          <input v-model="issueForm.许可编号" />
        </label>
        <label class="filter-item">
          <span>承包商</span>
          <input v-model="issueForm.承包商" list="contractor-list" placeholder="外协单位名称" />
          <datalist id="contractor-list">
            <option v-for="name in contractorOptions" :key="name" :value="name" />
          </datalist>
        </label>
        <label class="filter-item">
          <span>作业区域</span>
          <input v-model="issueForm.作业区域" placeholder="如 2号焚烧炉检修平台" />
        </label>
        <label class="filter-item">
          <span>许可开始</span>
          <input v-model="issueForm.许可开始" type="datetime-local" />
        </label>
        <label class="filter-item">
          <span>许可结束</span>
          <input v-model="issueForm.许可结束" type="datetime-local" />
        </label>
        <label class="filter-item">
          <span>入厂作业人员名单</span>
          <input v-model="issueForm.作业人员" placeholder="顿号分隔，如：张立、王强" />
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn primary" type="submit">提交签发</button>
        <button class="btn ghost" type="button" @click="toggleIssue">收起</button>
      </div>
    </form>

    <form v-if="editingId !== null && isSafety" class="edit-panel" @submit.prevent="submitAmend">
      <h3 class="panel-title">改单 {{ editingNo }}（许可时段、人员名单签发后不得变更，动了会被退回）</h3>
      <div class="panel-grid">
        <label class="filter-item">
          <span>作业区域</span>
          <input v-model="amendForm.作业区域" />
        </label>
        <label class="filter-item">
          <span>许可开始</span>
          <input v-model="amendForm.许可开始" type="datetime-local" />
        </label>
        <label class="filter-item">
          <span>许可结束</span>
          <input v-model="amendForm.许可结束" type="datetime-local" />
        </label>
        <label class="filter-item">
          <span>入厂作业人员名单</span>
          <input v-model="amendForm.作业人员" />
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn primary" type="submit">提交改单</button>
        <button class="btn ghost" type="button" @click="cancelAmend">取消</button>
      </div>
    </form>

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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>门岗结论</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td :class="conclusionOf(row).pass ? 'gate-pass' : 'gate-fail'">{{ conclusionOf(row).label }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="isSafety && row.status !== '已撤销'">
              <button class="link" type="button" @click="openAmend(row)">改单</button>
              <button class="link danger" type="button" @click="revoke(row)">撤销</button>
            </template>
            <span v-else-if="row.status === '已撤销'" class="muted">已撤销·整条只读</span>
            <span v-else class="muted">仅可查看</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无承包商作业许可数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条作业许可记录</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  amendPermit,
  contractorNames,
  gateCheck,
  issuePermit,
  listPermits,
  nextPermitNo,
  permitConclusion,
  revokePermit,
  type Actor,
  type GateResult,
} from '@/api/permit-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('permit')
const columns = meta.fields
const statuses = meta.statuses
const filterFields = ['许可编号', '承包商', '作业区域']

const store = useSessionStore()
const isSafety = computed(() => store.isSafety)
const actor = computed<Actor>(() => ({
  role: store.role,
  operator: store.operator,
  contractor: store.contractor,
}))

const rows = ref<EntryRow[]>([])
const filters = ref<Record<string, string>>({})
const okMessage = ref('')
const errorMessage = ref('')
const contractorOptions = ref<string[]>([])

const gateNo = ref('')
const gateResult = ref<GateResult | null>(null)

const showIssue = ref(false)
const issueForm = ref({ 许可编号: '', 承包商: '', 作业区域: '', 许可开始: '', 许可结束: '', 作业人员: '' })

const editingId = ref<number | null>(null)
const editingNo = ref('')
const amendForm = ref({ 作业区域: '', 许可开始: '', 许可结束: '', 作业人员: '' })

const stats = computed(() => [
  { label: '生效中许可', value: rows.value.filter((row) => String(row.status) === '生效中').length },
  { label: '已撤销许可', value: rows.value.filter((row) => String(row.status) === '已撤销').length },
  { label: '此刻可放行', value: rows.value.filter((row) => permitConclusion(row).pass).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function toMoment(value: string): string {
  return value.replace('T', ' ')
}

function toInputMoment(value: string): string {
  return value.replace(' ', 'T')
}

function conclusionOf(row: EntryRow) {
  return permitConclusion(row)
}

function switchSafety() {
  store.useSafety()
  reload()
}

function switchContractor(name: string) {
  store.useContractor(name)
  reload()
}

function toggleIssue() {
  showIssue.value = !showIssue.value
  if (showIssue.value) {
    issueForm.value = { 许可编号: nextPermitNo(), 承包商: '', 作业区域: '', 许可开始: '', 许可结束: '', 作业人员: '' }
  }
}

function submitIssue() {
  okMessage.value = ''
  errorMessage.value = ''
  const result = issuePermit(actor.value, {
    ...issueForm.value,
    许可开始: toMoment(issueForm.value.许可开始),
    许可结束: toMoment(issueForm.value.许可结束),
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  showIssue.value = false
  reload()
}

function openAmend(row: EntryRow) {
  editingId.value = Number(row.id)
  editingNo.value = String(row['许可编号'])
  amendForm.value = {
    作业区域: String(row['作业区域']),
    许可开始: toInputMoment(String(row['许可开始'])),
    许可结束: toInputMoment(String(row['许可结束'])),
    作业人员: String(row['作业人员']),
  }
}

function cancelAmend() {
  editingId.value = null
}

function submitAmend() {
  okMessage.value = ''
  errorMessage.value = ''
  const result = amendPermit(actor.value, Number(editingId.value), {
    ...amendForm.value,
    许可开始: toMoment(amendForm.value.许可开始),
    许可结束: toMoment(amendForm.value.许可结束),
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  editingId.value = null
  reload()
}

function revoke(row: EntryRow) {
  if (!window.confirm(`确认撤销 ${String(row['许可编号'])}？撤销后整条只读，并会驱动设备检修外协清单重排。`)) {
    return
  }
  okMessage.value = ''
  errorMessage.value = ''
  const result = revokePermit(actor.value, Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  reload()
}

function runGateCheck() {
  gateResult.value = gateCheck(gateNo.value)
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  okMessage.value = ''
  errorMessage.value = ''
  rows.value = listPermits(actor.value, filters.value)
  contractorOptions.value = contractorNames()
}

onMounted(reload)
</script>

<style scoped>
.role-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.role-label { font-size: 13px; color: var(--muted); }
.role-note { font-size: 12px; color: var(--muted); }
.btn.on { background: var(--brand); border-color: var(--brand); color: #fff; }
.gate-bar { align-items: center; }
.gate-result { font-size: 13px; }
.gate-result.pass, .gate-pass { color: #067647; }
.gate-result.fail, .gate-fail { color: #b42318; }
.edit-panel { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.panel-title { margin: 0 0 10px; font-size: 14px; }
.panel-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.panel-grid .filter-item span { display: block; font-size: 12px; color: var(--muted); }
.panel-grid input { width: 100%; }
.panel-actions { display: flex; gap: 8px; margin-top: 10px; }
.link.danger { color: #b42318; }
.muted { color: var(--muted); font-size: 12px; }
.ok-text { color: #067647; }
</style>
