import { useSettingsStore } from '../stores/settings'
import type { NotificationState } from '../types'

// Small shared wrapper over the keyed notification state in settings. Used by
// any prompt that should be dismissable/snoozable (today: the >30-day store
// staleness prompt, key `store-stale:<brand-slug>`), and by the Settings →
// Notifications panel that re-enables disabled ones / clears snoozes.
//
// A key is "active" (allowed to prompt) unless it is disabled or snoozed past
// now. "Disable this notification" -> disable(key); "Ask me in a week" ->
// snooze(key, 7).

export function notificationKey(kind: string, subject?: string): string {
  return subject ? `${kind}:${subject.trim().toLowerCase().replace(/\s+/g, '-')}` : kind
}

export function useNotifications() {
  const store = useSettingsStore()

  function state(): NotificationState {
    if (!store.settings.notifications) store.settings.notifications = { disabled: [], snoozed: {} }
    if (!store.settings.notifications.disabled) store.settings.notifications.disabled = []
    if (!store.settings.notifications.snoozed) store.settings.notifications.snoozed = {}
    return store.settings.notifications
  }

  /** May this notification prompt right now? (not disabled, not snoozed). */
  function isActive(key: string): boolean {
    const s = state()
    if (s.disabled.includes(key)) return false
    const until = s.snoozed[key]
    if (until && Date.parse(until) > Date.now()) return false
    return true
  }

  /** Permanently turn off until the user re-enables it from Settings. */
  function disable(key: string) {
    const s = state()
    if (!s.disabled.includes(key)) s.disabled.push(key)
    delete s.snoozed[key]
    return store.save()
  }

  /** "Ask me in a week" — quiet until now + `days`. */
  function snooze(key: string, days = 7) {
    const s = state()
    s.snoozed[key] = new Date(Date.now() + days * 86_400_000).toISOString()
    return store.save()
  }

  /** Re-enable a single notification (clears disabled + snooze for the key). */
  function enable(key: string) {
    const s = state()
    s.disabled = s.disabled.filter((k) => k !== key)
    delete s.snoozed[key]
    return store.save()
  }

  /** Reset ALL notification state — the Settings "reset disabled notifications". */
  function resetAll() {
    const s = state()
    s.disabled = []
    s.snoozed = {}
    return store.save()
  }

  function disabledKeys(): string[] {
    return state().disabled.slice()
  }
  function snoozedEntries(): { key: string; until: string }[] {
    return Object.entries(state().snoozed).map(([key, until]) => ({ key, until }))
  }

  return { isActive, disable, snooze, enable, resetAll, disabledKeys, snoozedEntries }
}
