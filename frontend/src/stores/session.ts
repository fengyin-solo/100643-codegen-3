import { defineStore } from 'pinia'

// 厂内安监口才能签发、撤销许可；承包商账号只能看与自己单位有关的条目。
export type SessionRole = 'safety' | 'contractor'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '安监专工·王瑾',
    role: 'safety' as SessionRole,
    contractor: '',
    shiftLabel: '白班 08:00-20:00',
    scope: '生活垃圾焚烧发电厂运行管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isSafety: (state) => state.role === 'safety',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    useSafety(operator = '安监专工·王瑾') {
      this.role = 'safety'
      this.operator = operator
      this.contractor = ''
    },
    useContractor(name: string) {
      this.role = 'contractor'
      this.contractor = name
      this.operator = `${name}·外协联系人`
    },
  },
})
