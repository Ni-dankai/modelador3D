// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { NextUIProvider } from '@nextui-org/react'
// Make sure App.tsx exists in the same directory, or update the path if needed
import App from '../App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <NextUIProvider>
    <App/>
  </NextUIProvider>
)