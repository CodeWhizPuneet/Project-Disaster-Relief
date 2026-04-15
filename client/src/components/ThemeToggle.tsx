import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

interface ThemeToggleProps {
  compact?: boolean
}

export const ThemeToggle = ({ compact = false }: ThemeToggleProps) => {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className="btn-secondary"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '7px 11px' : '9px 13px',
        fontSize: compact ? 12 : 13,
      }}
      title="Toggle theme"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
