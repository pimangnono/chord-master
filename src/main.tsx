import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startCloudSync } from './platform';
import { autoConnectMidi } from './audio/midiHub';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startCloudSync();
autoConnectMidi();
