import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/filaments' },
  { path: '/filaments', component: () => import('../pages/FilamentsPage.vue') },
  { path: '/accessories', component: () => import('../pages/AccessoriesPage.vue') },
  { path: '/shopping', component: () => import('../pages/ShoppingPage.vue') },
  { path: '/empty-spools', component: () => import('../pages/EmptySpoolsPage.vue') },
  { path: '/settings', component: () => import('../pages/SettingsPage.vue') },
]

export const router = createRouter({ history: createWebHashHistory(), routes })
