import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/alegreya-sans/400.css'
import '@fontsource/alegreya-sans/500.css'
import '@fontsource/alegreya-sans/700.css'
import './styles/theme.css'

import { createRoot } from 'react-dom/client'
import App from './App'

// No StrictMode: the tradewind preload appends IPC listeners with no
// unsubscribe, so the dev double-invoke would deliver every item twice.
createRoot(document.getElementById('app')!).render(<App />)
