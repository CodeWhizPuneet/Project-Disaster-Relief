import { useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { AlertTriangle, MapPin, ChevronRight, ChevronLeft, CheckCircle, Navigation } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const TYPES = ['food', 'water', 'medical', 'rescue', 'shelter'] as const
const URGENCIES = [
  { value: 'critical', label: '🔴 Critical', color: '#ef4444', desc: 'Life-threatening situation' },
  { value: 'high', label: '🟠 High', color: '#f97316', desc: 'Urgent help needed' },
  { value: 'medium', label: '🟡 Medium', color: '#eab308', desc: 'Needs help soon' },
  { value: 'low', label: '🟢 Low', color: '#22c55e', desc: 'Non-urgent assistance' },
]

const LocationPicker = ({ onPick }: { onPick: (lat: number, lng: number) => void }) => {
  useMapEvents({ click: (e: any) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

export default function SOSPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [form, setForm] = useState({
    type: '' as typeof TYPES[number] | '',
    urgency: '' as string,
    description: '',
    numberOfPeople: 1,
    location: { lat: 20.5937, lng: 78.9629, address: '' },
  })

  const detectLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(p => ({ ...p, location: { lat: pos.coords.latitude, lng: pos.coords.longitude, address: 'Auto-detected location' } }))
        setLocating(false)
        toast.success('Location detected!')
      },
      () => { toast.error('Could not detect location. Please click on the map.'); setLocating(false) }
    )
  }

  const handleSubmit = async () => {
    if (!form.type || !form.urgency) { toast.error('Please fill all required fields'); return }
    setLoading(true)
    try {
      await axios.post('/api/requests', {
        type: form.type,
        urgency: form.urgency,
        description: form.description,
        numberOfPeople: form.numberOfPeople,
        location: form.location,
      })
      toast.success('🚨 SOS sent! Help is on the way.')
      setStep(5)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to send SOS')
    } finally {
      setLoading(false)
    }
  }

  const steps = ['Type', 'Details', 'Location', 'Review']
  const canNext = () => {
    if (step === 1) return !!form.type
    if (step === 2) return !!form.urgency
    if (step === 3) return true
    return true
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(239,68,68,0.1) 0%, transparent 60%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle compact />
      </div>
      <div className="glass fade-in" style={{ width: '100%', maxWidth: 560, padding: 36 }}>
        {/* Header */}
        {step < 5 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
              <div style={{ background: '#ef4444', borderRadius: 10, padding: 10 }}>
                <AlertTriangle size={22} color="white" />
              </div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800 }}>Send SOS Request</h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Step {step} of 4 — {steps[step - 1]}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: 'var(--color-surface-2)', borderRadius: 2, marginBottom: 28, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(step / 4) * 100}%`, background: '#ef4444', borderRadius: 2, transition: 'width 0.3s ease' }} />
            </div>
          </>
        )}

        {/* Step 1: Type */}
        {step === 1 && (
          <div className="fade-in">
            <label style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'block' }}>What do you need?</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {TYPES.map(t => {
                const icons: Record<string, string> = { food: '🍱', water: '💧', medical: '🏥', rescue: '🚁', shelter: '⛺' }
                const active = form.type === t
                return (
                  <button key={t} type="button" onClick={() => setForm(p => ({ ...p, type: t }))}
                    style={{ padding: '16px 12px', borderRadius: 10, textAlign: 'center', cursor: 'pointer', border: `2px solid ${active ? '#ef4444' : 'rgba(255,255,255,0.1)'}`, background: active ? 'rgba(239,68,68,0.12)' : 'var(--glass-bg)', transition: 'all 0.2s' }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>{icons[t]}</div>
                    <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize', color: active ? '#ef4444' : 'var(--color-text)' }}>{t}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 2: Details */}
        {step === 2 && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'block' }}>Urgency Level</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {URGENCIES.map(u => {
                  const active = form.urgency === u.value
                  return (
                    <button key={u.value} type="button" onClick={() => setForm(p => ({ ...p, urgency: u.value }))}
                      style={{ padding: '12px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `2px solid ${active ? u.color : 'rgba(255,255,255,0.1)'}`, background: active ? `${u.color}18` : 'var(--glass-bg)', transition: 'all 0.2s' }}>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{u.label}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 }}>{u.desc}</span>
                      </div>
                      {active && <CheckCircle size={18} color={u.color} />}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Description (optional)</label>
              <textarea className="input-field" rows={3} placeholder="Describe your situation..." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} style={{ resize: 'none' }} />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Number of people affected</label>
              <input type="number" min={1} className="input-field" value={form.numberOfPeople} onChange={e => setForm(p => ({ ...p, numberOfPeople: parseInt(e.target.value) || 1 }))} style={{ width: 100 }} />
            </div>
          </div>
        )}

        {/* Step 3: Location */}
        {step === 3 && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={detectLocation} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} disabled={locating}>
                <Navigation size={14} />{locating ? 'Detecting...' : 'Detect My Location'}
              </button>
            </div>
            <div style={{ height: 280, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
              <MapContainer center={[form.location.lat, form.location.lng] as [number, number]} zoom={5} worldCopyJump style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" noWrap={false} />
                <LocationPicker onPick={(lat, lng) => { setForm(p => ({ ...p, location: { lat, lng, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` } })); toast.success('Location pinned!') }} />
                {form.location.lat !== 20.5937 && (
                  <Marker position={[form.location.lat, form.location.lng] as [number, number]} />
                )}
              </MapContainer>
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Address / Landmark</label>
              <div style={{ position: 'relative' }}>
                <MapPin size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input className="input-field" style={{ paddingLeft: 32 }} placeholder="Enter address or click on map" value={form.location.address} onChange={e => setForm(p => ({ ...p, location: { ...p.location, address: e.target.value } }))} />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Review your SOS request</h3>
            {[
              { label: 'Type', value: form.type, icon: '🆘' },
              { label: 'Urgency', value: form.urgency, icon: '⚡' },
              { label: 'People Affected', value: String(form.numberOfPeople), icon: '👥' },
              { label: 'Location', value: form.location.address || `${form.location.lat.toFixed(4)}, ${form.location.lng.toFixed(4)}`, icon: '📍' },
              ...(form.description ? [{ label: 'Description', value: form.description, icon: '📝' }] : []),
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', gap: 12, padding: '10px 14px', background: 'var(--glass-bg)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{item.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 5: Success / Confirmation */}
        {step === 5 && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ 
              width: 80, height: 80, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px',
              border: '2px solid rgba(34,197,94,0.3)',
              boxShadow: '0 0 40px rgba(34,197,94,0.3)'
            }}>
              <CheckCircle size={40} color="#4ade80" />
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12, letterSpacing: '-0.5px' }}>Help is on the way.</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 15, marginBottom: 28, lineHeight: 1.6 }}>
              Your SOS request has been successfully transmitted to the DisasterLink coordination center. First responders are being assigned.
            </p>
            
            <div style={{ background: 'var(--glass-bg)', padding: 20, borderRadius: 12, border: '1px solid var(--glass-border)', marginBottom: 32, textAlign: 'left' }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f87171', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={16} /> Important Instructions
              </h3>
              <ul style={{ color: 'var(--color-text-muted)', fontSize: 13, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li>Do not leave your location if it is safe to stay there.</li>
                <li>Keep your phone line free and conserve battery.</li>
                <li>Watch for updates in your dashboard.</li>
              </ul>
            </div>

            <button onClick={() => navigate('/my-requests')} className="btn-primary" style={{ width: '100%', padding: '14px', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              Go to My Dashboard
            </button>
          </div>
        )}

        {/* Navigation */}
        {step < 5 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, gap: 10 }}>
            <button type="button" onClick={() => step === 1 ? navigate(-1) : setStep(s => s - 1)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ChevronLeft size={16} />{step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 4 ? (
              <button type="button" onClick={() => setStep(s => s + 1)} className="btn-primary" disabled={!canNext()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Next <ChevronRight size={16} />
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={loading} className="btn-primary sos-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#ef4444', padding: '10px 24px' }}>
                <AlertTriangle size={16} />{loading ? 'Sending...' : 'Send SOS Now'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
