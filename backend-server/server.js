const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// Middlewares globales
app.use(cors({
  origin: (origin, callback) => {
    const allowed = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
    callback(null, !origin || allowed.includes(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Device-Platform', 'X-App-Version']
}));
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos y descargas de paquetes
app.use('/downloads', express.static(path.join(__dirname, 'public', 'downloads')));

// Handler universal de descargas directas
const handleDownload = (req, res) => {
  const filename = path.basename(req.params.filename);
  let filePath = path.join(__dirname, 'public', 'downloads', filename);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'public', filename);
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado', filename });
  }
  return res.download(filePath, filename);
};

app.get('/api/download/:filename', handleDownload);
app.get('/api/v1/download/:filename', handleDownload);
app.get('/download/:filename', handleDownload);

// Montar Routers de la API NosotrosRD (App Cliente & Pasajero)
const sduiRouter = require('./routes/sdui');
const sduiNeonRouter = require('./routes/sduiNeon');
const authRouter = require('./routes/authNeon');
const apiV1Router = require('./routes/apiV1');
const mapsRouter = require('./routes/maps');
const gptRouter = require('./routes/gpt');

// Endpoint raíz para Cloud Run y health check
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    service: 'NosotrosRD Backend API & SDUI Server (App Cliente & Pasajero)',
    version: '1.0.0',
    port: PORT,
    environment: process.env.NODE_ENV || 'production',
    endpoints: {
      health: '/health',
      sduiAuth: '/api/v1/sdui/auth?role=CLIENT',
      sduiConfig: '/api/v1/sdui/config?mode=ride',
      sduiRidePlanner: '/api/v1/sdui/ride-planner',
      authGoogle: '/api/v1/auth/google',
      authLogin: '/api/v1/auth/login',
      authRegister: '/api/v1/auth/register',
      authMe: '/api/v1/auth/me',
      clientPlacesAutocomplete: '/api/v1/clients/places/autocomplete',
      clientFareQuote: '/api/v1/clients/fares/quote',
      clientTripRequest: '/api/v1/clients/trips/request',
      clientTripStatus: '/api/v1/clients/trips/status',
      demandZones: '/api/v1/maps/demand-zones',
      gptOpenApiJson: '/api/v1/gpt/openapi.json',
      gptInstructions: '/api/v1/gpt/instructions',
      gptDocs: '/api/v1/gpt/docs',
      gptSystemStatus: '/api/v1/gpt/system/status',
      gptTrips: '/api/v1/gpt/trips'
    },
    message: 'Backend oficial activo para la Aplicación Móvil Cliente de NosotrosRD.'
  });
});

// Endpoint de verificación de salud explícito
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ONLINE',
    service: 'NosotrosRD Backend (App Cliente)',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});


app.use(authRouter);
app.use(apiV1Router);
app.use(sduiNeonRouter);
app.use(sduiRouter);
app.use(mapsRouter);
app.use(gptRouter);

// Iniciar servidor - Escuchando en 0.0.0.0 y puerto configurado
if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 [NosotrosRD] Servidor SDUI activo en puerto ${PORT} (0.0.0.0)`);
    console.log(`📡 GET  http://0.0.0.0:${PORT}/health`);
    console.log(`📡 GET  http://0.0.0.0:${PORT}/api/v1/sdui/auth?role=CLIENT`);
    console.log(`📥 POST http://0.0.0.0:${PORT}/api/v1/clients/trips/request`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`ℹ️ [NosotrosRD] Puerto ${PORT} ya está en uso. Servidor backend ya se encuentra activo.`);
    } else {
      console.error('❌ Error en servidor HTTP:', err);
    }
  });

  // Manejo de señales para apagado limpio en Google Cloud Run
  process.on('SIGTERM', () => {
    console.log('🛑 [NosotrosRD] Señal SIGTERM recibida, cerrando servidor HTTP...');
    server.close(() => {
      console.log('✅ [NosotrosRD] Servidor cerrado correctamente.');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('🛑 [NosotrosRD] Señal SIGINT recibida.');
    server.close(() => {
      process.exit(0);
    });
  });
}

module.exports = app;
