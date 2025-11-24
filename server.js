const express = require('express');
const webpush = require('web-push');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Archivo para almacenar suscripciones (en producción usar una base de datos)
const SUBSCRIPTIONS_FILE = '/data/subscriptions.json';

// Asegurar que existe el directorio de datos
if (!fs.existsSync('/data')) {
  fs.mkdirSync('/data', { recursive: true });
}

// Inicializar archivo de suscripciones si no existe
if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify([]));
}

// Generar VAPID keys (estas deben ser permanentes en producción)
const vapidKeys = webpush.generateVAPIDKeys();

// En producción, usar variables de entorno
const publicVapidKey = process.env.PUBLIC_VAPID_KEY || vapidKeys.publicKey;
const privateVapidKey = process.env.PRIVATE_VAPID_KEY || vapidKeys.privateKey;

webpush.setVapidDetails(
  'mailto:admin@n0cker.com',
  publicVapidKey,
  privateVapidKey
);

console.log('=================================');
console.log('VAPID Keys (guarda estas keys):');
console.log('PUBLIC_VAPID_KEY:', publicVapidKey);
console.log('PRIVATE_VAPID_KEY:', privateVapidKey);
console.log('=================================');

// Función para leer suscripciones
function getSubscriptions() {
  try {
    const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Función para guardar suscripciones
function saveSubscriptions(subscriptions) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

// API: Obtener la clave pública VAPID
app.get('/api/vapidPublicKey', (req, res) => {
  res.json({ publicKey: publicVapidKey });
});

// API: Suscribirse a notificaciones
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  // Obtener suscripciones existentes
  let subscriptions = getSubscriptions();

  // Verificar si ya existe
  const exists = subscriptions.some(sub =>
    sub.endpoint === subscription.endpoint
  );

  if (!exists) {
    subscriptions.push({
      ...subscription,
      subscribedAt: new Date().toISOString()
    });
    saveSubscriptions(subscriptions);
  }

  res.status(201).json({ message: 'Suscripción exitosa' });
});

// API: Desuscribirse
app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body;

  let subscriptions = getSubscriptions();
  subscriptions = subscriptions.filter(sub => sub.endpoint !== endpoint);
  saveSubscriptions(subscriptions);

  res.json({ message: 'Desuscripción exitosa' });
});

// API: Enviar notificación a todos los suscriptores
app.post('/api/notify', async (req, res) => {
  const { title, body, icon, url } = req.body;

  const subscriptions = getSubscriptions();

  if (subscriptions.length === 0) {
    return res.status(400).json({ error: 'No hay suscriptores' });
  }

  const payload = JSON.stringify({
    title: title || 'N0cker Notification',
    body: body || 'Nueva notificación',
    icon: icon || '/icon-192.png',
    url: url || '/'
  });

  const results = await Promise.allSettled(
    subscriptions.map(subscription =>
      webpush.sendNotification(subscription, payload)
        .catch(error => {
          // Si hay error 410 (Gone), eliminar la suscripción
          if (error.statusCode === 410) {
            let subs = getSubscriptions();
            subs = subs.filter(sub => sub.endpoint !== subscription.endpoint);
            saveSubscriptions(subs);
          }
          throw error;
        })
    )
  );

  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  res.json({
    message: 'Notificaciones enviadas',
    successful,
    failed,
    total: subscriptions.length
  });
});

// API: Obtener estadísticas
app.get('/api/stats', (req, res) => {
  const subscriptions = getSubscriptions();
  res.json({
    totalSubscribers: subscriptions.length,
    subscriptions: subscriptions.map(sub => ({
      endpoint: sub.endpoint.substring(0, 50) + '...',
      subscribedAt: sub.subscribedAt
    }))
  });
});

// Servir el HTML principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servir el panel de administración
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});