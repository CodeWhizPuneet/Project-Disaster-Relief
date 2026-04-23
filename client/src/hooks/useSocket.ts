import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type SocketUser = { _id: string; role: string } | null

let sharedSocket: Socket | null = null
let sharedSocketUserKey: string | null = null

const getSocketUrl = () => {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim()
  if (!envBase) return undefined
  return envBase.replace(/\/$/, '')
}

export const useSocket = (user: SocketUser) => {
  const socketRef = useRef<Socket | null>(null)
  const listenerSocketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null)

  useEffect(() => {
    const userKey = user?._id ? `${user._id}:${user.role}` : null

    if (!user?._id) {
      socketRef.current = null
      setSocketInstance(null)
      setConnected(false)

      if (sharedSocket) {
        sharedSocket.disconnect()
      }
      sharedSocket = null
      sharedSocketUserKey = null

      if (listenerSocketRef.current) {
        listenerSocketRef.current = null
      }

      return
    }

    if (sharedSocket && sharedSocketUserKey === userKey) {
      socketRef.current = sharedSocket
      setSocketInstance(sharedSocket)
      setConnected(sharedSocket.connected)
    } else {
      if (sharedSocket) {
        sharedSocket.disconnect()
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

      sharedSocket = socket
      sharedSocketUserKey = userKey
      socketRef.current = socket
      setSocketInstance(socket)
      setConnected(socket.connected)
    }

    const socket = socketRef.current
    if (!socket) return

    const onConnect = () => {
      setConnected(true)
      if (user.role === 'volunteer' || user.role === 'admin') {
        socket.emit('join_room', { room: 'staff' })
      }
      socket.emit('join_user_room', { userId: user._id })
    }

    const onDisconnect = () => setConnected(false)
    const onConnectError = () => setConnected(false)

    listenerSocketRef.current = socket
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)

    if (socket.connected) {
      onConnect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)

      if (listenerSocketRef.current?.id === socket.id) {
        listenerSocketRef.current = null
      }

      socketRef.current = null
      setConnected(false)
    }
  }, [user?._id, user?.role])

  return { socket: socketInstance, connected }
}
