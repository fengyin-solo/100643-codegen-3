import { defineStore } from 'pinia'

import type { Post } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '生活垃圾焚烧发电厂运行管理平台',
    // 当前岗位与单位：作业许可模块按这个划权（安监口签发撤销 / 承包商看本单位 / 门岗核验）。
    post: 'safety' as Post,
    org: '厂安监口',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setPost(post: Post) {
      this.post = post
    },
    setOrg(org: string) {
      this.org = org
    },
  },
})
