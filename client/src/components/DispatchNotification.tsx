import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, XCircle, MapPin, Users, Clock } from 'lucide-react'

export interface DispatchPayload {
  requestId: string
  type: string
  urgency: 'low' | 'medium' | 'high' | 'critical'
  description: string
  address: string
  coordinates: { lat: number; lng: number }
  numberOfPeople: number
  distanceKm: number
  dispatchedAt: string
  roundLabel: string
}

interface DispatchNotificationProps {
  notification: DispatchPayload
  onAccept: (requestId: string) => void
  onReject: (requestId: string) => void
  timeoutSeconds?: number
}

const URGENCY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
}

const URGENCY_BG: Record<string, string> = {
  critical: 'rgba(239,68,68,0.12)',
  high:     'rgba(249,115,22,0.12)',
  medium:   'rgba(234,179,8,0.12)',
  low:      'rgba(34,197,94,0.12)',
}

const TYPE_EMOJI: Record<string, string> = {
  medical: '🩺', rescue: '🚑', food: '🍲', water: '💧', shelter: '🏠',
}

export function DispatchNotification({
  notification,
  onAccept,
  onReject,
  timeoutSeconds = 40,
}: DispatchNotificationProps) {
  const [remaining, setRemaining] = useState(timeoutSeconds)
  const [accepted, setAccepted] = useState(false)
  const [rejected, setRejected] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const color  = URGENCY_COLOR[notification.urgency] || '#6b7280'
  const bg     = URGENCY_BG[notification.urgency]    || 'rgba(107,114,128,0.12)'
  const emoji  = TYPE_EMOJI[notification.type] || '🚨'

  // Countdown timer
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!)
          // Auto-dismiss as reject when timed out
          onReject(notification.requestId)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current!)
  }, [])

  const handleAccept = () => {
    clearInterval(intervalRef.current!)
    setAccepted(true)
    onAccept(notification.requestId)
  }

  const handleReject = () => {
    clearInterval(intervalRef.current!)
    setRejected(true)
    onReject(notification.requestId)
  }

  const progressPct = (remaining / timeoutSeconds) * 100

  if (rejected) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(107,114,128,0.3)',
        background: 'rgba(107,114,128,0.08)', display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, color: 'var(--color-text-muted)',
      }}>
        <XCircle size={16} color="#6b7280" />
        Declined — standing by
      </div>
    )
  }

  if (accepted) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(34,197,94,0.4)',
        background: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, color: '#4ade80', fontWeight: 700,
      }}>
        <CheckCircle size={16} color="#22c55e" />
        Accepted — loading task details…
      </div>
    )
  }

  return (
    <div
      className="fade-in"
      style={{
        borderRadius: 16,
        border: `2px solid ${color}`,
        background: bg,
        backdropFilter: 'blur(14px)',
        overflow: 'hidden',
        boxShadow: `0 0 32px ${color}33, 0 4px 24px rgba(0,0,0,0.3)`,
        animation: 'dispatchPulse 2s ease-in-out infinite',
      }}
    >
      {/* Progress bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', position: 'relative' }}>
        <div
          style={{
            height: '100%',
            width: `${progressPct}%`,
            background: color,
            transition: 'width 1s linear',
            boxShadow: `0 0 8px ${color}`,
          }}
        />
      </div>

      <div style={{ padding: '16px 20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: `${color}22`, border: `1.5px solid ${color}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
              boxShadow: `0 0 14px ${color}44`,
            }}>
              {emoji}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.2px' }}>
                🚨 Emergency Nearby
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
                {notification.roundLabel}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span
              style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: 0.5,
                background: `${color}22`, border: `1px solid ${color}66`, color,
              }}
            >
              {notification.urgency}
            </span>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 10px', borderRadius: 20,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              fontSize: 12, color: remaining <= 10 ? '#ef4444' : 'var(--color-text-muted)', fontWeight: 600,
            }}>
              <Clock size={11} />
              {remaining}s
            </div>
          </div>
        </div>

        {/* Info grid */}
        <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flex: 1, minWidth: 180 }}>
            <MapPin size={13} color={color} style={{ flexShrink: 0 }} />
            <span style={{ color: 'var(--color-text-muted)' }}>{notification.address}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, flexShrink: 0 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>
              📍 <strong style={{ color: 'var(--color-text)' }}>{notification.distanceKm} km</strong> away
            </span>
            {notification.numberOfPeople > 1 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-text-muted)' }}>
                <Users size={12} />
                <strong style={{ color: 'var(--color-text)' }}>{notification.numberOfPeople}</strong> people
              </span>
            )}
          </div>
        </div>

        {/* Type tag + description */}
        <div style={{ marginBottom: 16 }}>
          <span style={{
            display: 'inline-block', padding: '2px 10px', borderRadius: 6,
            background: 'rgba(255,255,255,0.08)', fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--color-text-muted)',
            marginBottom: 6,
          }}>
            {notification.type}
          </span>
          {notification.description && (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5, margin: 0 }}>
              {notification.description}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleAccept}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: 0.3,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 4px 16px rgba(22,163,74,0.4)',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = '' }}
          >
            <CheckCircle size={16} />
            Accept Task
          </button>

          <button
            onClick={handleReject}
            style={{
              padding: '11px 20px', borderRadius: 10, cursor: 'pointer',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)',
              color: '#f87171', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.2)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)' }}
          >
            <XCircle size={15} />
            Reject
          </button>
        </div>
      </div>

      {/* Pulse animation keyframes injected once */}
      <style>{`
        @keyframes dispatchPulse {
          0%, 100% { box-shadow: 0 0 32px ${color}33, 0 4px 24px rgba(0,0,0,0.3); }
          50%       { box-shadow: 0 0 48px ${color}55, 0 4px 32px rgba(0,0,0,0.4); }
        }
      `}</style>
    </div>
  )
}
