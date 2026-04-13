import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import axios from 'axios'
import App from './App'
import './index.css'

const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
if (envBase) {
  axios.defaults.baseURL = envBase.replace(/\/+$/, '')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)