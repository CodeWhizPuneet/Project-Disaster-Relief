/**
 * timeAgo — converts a timestamp into a compact, human-readable relative string.
 *
 * Format rules:
 *   < 1 min   → "Just now"
 *   < 60 min  → "5m ago"
 *   < 24 hr   → "2h 15m ago"  (minutes omitted when 0: "3h ago")
 *   ≥ 24 hr   → "1d 2h ago"   (hours omitted when 0: "21d ago")
 *
 * @param timestamp  ISO string, Date object, or anything new Date() can parse
 * @returns          Human-readable relative time string
 */
export const timeAgo = (timestamp: string | Date | null | undefined): string => {
  if (!timestamp) return '—'

  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  if (isNaN(date.getTime())) return '—'

  const totalSeconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (totalSeconds < 0)  return 'Just now'  // future dates (clock skew)
  if (totalSeconds < 60) return 'Just now'

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m ago`

  const hours   = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m ago` : `${hours}h ago`
  }

  const days       = Math.floor(hours / 24)
  const remHours   = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h ago` : `${days}d ago`
}

/**
 * formatExactDate — formats a timestamp as a full readable date/time string.
 * Used as the tooltip/title on hover alongside timeAgo.
 *
 * Example: "April 22, 2026, 10:45 PM"
 */
export const formatExactDate = (timestamp: string | Date | null | undefined): string => {
  if (!timestamp) return ''
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('en-IN', {
    year:   'numeric',
    month:  'long',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}
