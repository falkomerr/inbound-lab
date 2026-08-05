/**
 * Vite production bundle entry (not used in dev — see index.html classic scripts).
 */
import { createApp, h } from 'vue';
import { Chart, registerables } from 'chart.js/auto';
import { extractCurlData } from './curlParser.js';

Chart.register(...registerables);

window.Vue = { createApp, h };
window.Chart = Chart;
window.extractCurlData = extractCurlData;

async function startDashboard() {
  await import('./modules/apiClient.esm.js');
  await import('./modules/icon.js');
  await import('./app.js');
}

startDashboard();
