import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { TradingSettingsProvider } from './hooks/useTradingSettings.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <TradingSettingsProvider>
    <App />
  </TradingSettingsProvider>
);
