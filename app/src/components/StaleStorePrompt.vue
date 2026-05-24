<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, AlertCircle, Loader2 } from 'lucide-vue-next'
import { useStoreListsStore } from '../stores/storeLists'
import { usePrintersStore } from '../stores/printers'
import { useNotifications, notificationKey } from '../composables/useNotifications'
import { useStoreFetch } from '../composables/useStoreFetch'
import type { StoreList } from '../types'

// -----------------------------------------------------------------------
// Find the first stale list whose notification is still active.
// Dismissed for this session only via dismissedKeys (local, not persisted).
// -----------------------------------------------------------------------
const storeLists = useStoreListsStore()
const printers = usePrintersStore()
const notifications = useNotifications()
const { fetchStore, loading, error } = useStoreFetch()

const dismissedKeys = ref<Set<string>>(new Set())

const target = computed<StoreList | null>(() => {
  if (!storeLists.loaded) return null
  return (
    storeLists.stale.find((list) => {
      const key = notificationKey('store-stale', list.brand)
      return notifications.isActive(key) && !dismissedKeys.value.has(key)
    }) ?? null
  )
})

const targetKey = computed(() =>
  target.value ? notificationKey('store-stale', target.value.brand) : null,
)

const ageDaysRounded = computed(() =>
  target.value ? Math.round(storeLists.ageDays(target.value)) : 0,
)

// The store URL for the target brand: prefer what's stored on the StoreList,
// fall back to the matching printer's store_url.
const storeUrl = computed<string | undefined>(() => {
  if (!target.value) return undefined
  if (target.value.store_url) return target.value.store_url
  const lc = target.value.brand.trim().toLowerCase()
  return printers.printers.find((p) => p.brand.trim().toLowerCase() === lc)?.store_url
})

// -----------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------

/** Yes, update — fetch fresh store data. On success the list's fetched_at
 *  resets, so it will no longer be in storeLists.stale → prompt disappears. */
async function handleUpdate() {
  if (!target.value || loading.value) return
  await fetchStore(target.value.brand, storeUrl.value, true)
  // On success: error.value stays null, storeLists.stale no longer includes
  // this list (fetched_at was reset by useStoreFetch → upsert). `target`
  // recomputes automatically. No manual dismiss needed.
}

/** No — dismiss for this session only; no persisted state change. */
function handleNo() {
  if (targetKey.value) dismissedKeys.value.add(targetKey.value)
}

/** Ask me in a week — snooze for 7 days then dismiss this view. */
async function handleSnooze() {
  if (!targetKey.value) return
  await notifications.snooze(targetKey.value, 7)
  // snooze persists → isActive now returns false → target recomputes to null
  // (or the next stale list). No additional dismissal needed.
}

/** Disable — never show again (until re-enabled from Settings). */
async function handleDisable() {
  if (!targetKey.value) return
  await notifications.disable(targetKey.value)
  // disable persists → isActive returns false → target recomputes automatically.
}

onMounted(async () => {
  if (!storeLists.loaded) await storeLists.load()
  if (!printers.loaded) await printers.load()
})
</script>

<template>
  <div
    v-if="target"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print-hide"
  >
    <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
      <!-- Header -->
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-amber-600/20 text-amber-300">
          <RefreshCw :size="22" />
        </div>
        <h2 class="text-lg font-semibold">Store list out of date</h2>
      </div>

      <!-- Body -->
      <p class="mt-3 text-sm text-slate-300">
        The <span class="text-slate-100 font-medium">{{ target.brand }}</span> store list is
        <span class="text-amber-300 font-medium">{{ ageDaysRounded }} days old</span>.
        Update it now to get current prices, new products, and P2S-relevant replacements?
      </p>

      <!-- Inline fetch error -->
      <div
        v-if="error"
        class="mt-3 flex items-start gap-2 rounded-lg border border-red-800/60 bg-red-900/20 px-3 py-2 text-xs text-red-300"
      >
        <AlertCircle :size="14" class="mt-0.5 flex-none" />
        <span>{{ error }}</span>
      </div>

      <!-- Actions -->
      <div class="mt-5 flex flex-col gap-2">
        <!-- Primary: Yes, update -->
        <button
          :disabled="loading"
          class="flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          @click="handleUpdate"
        >
          <Loader2 v-if="loading" :size="15" class="animate-spin" />
          <span>{{ loading ? 'Updating…' : 'Yes, update' }}</span>
        </button>

        <!-- Secondary row -->
        <div class="flex gap-2">
          <button
            :disabled="loading"
            class="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            @click="handleNo"
          >
            No
          </button>
          <button
            :disabled="loading"
            class="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            @click="handleSnooze"
          >
            Ask me in a week
          </button>
          <button
            :disabled="loading"
            class="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 disabled:opacity-50"
            @click="handleDisable"
          >
            Disable this
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
