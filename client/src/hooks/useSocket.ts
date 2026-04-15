import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type SocketUser = { _id: string; role: string } | null

const getSocketUrl = () => {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  if (!envBase) return undefined
  return envBase.replace(/\/$/, '')
}

export const useSocket = (user: SocketUser) => {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!user?._id) {
      socketRef.current?.disconnect()
      socketRef.current = null
      setConnected(false)
      return
    }

    const socket = io(getSocketUrl(), {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket'],
      auth: {
        token: localStorage.getItem('token'),
      },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 12000,
    })

    socketRef.current = socket

    const onConnect = () => {
      setConnected(true)
      if (user.role === 'volunteer' || user.role === 'admin') {
        socket.emit('join_room', { room: 'staff' })
      }
      socket.emit('join_user_room', { userId: user._id })
    }

    const onDisconnect = () => setConnected(false)
    const onConnectError = () => setConnected(false)

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.disconnect()
      if (socketRef.current?.id === socket.id) {
        socketRef.current = null
      }
      setConnected(false)
    }
  }, [user?._id, user?.role])

  return { socket: socketRef.current, connected }
}
