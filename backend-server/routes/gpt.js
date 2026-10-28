/**
 * CoPilotRD® / NosotrosRD - Módulo de API Oficial para ChatGPT / OpenAI Agents
 * Ruta: /backend-server/routes/gpt.js
 *
 * Permite a ChatGPT (Custom GPTs / Actions / Agentes Autónomos) LEER y MODIFICAR
 * el estado operativo de la plataforma con permisos completos de gestión:
 * - Viajes (Consultar, cotizar, solicitar, actualizar estado, asignar chofer, cancelar)
 * - Usuarios y Choferes (Consultar, verificar KYC, saldo Banco de KM, editar roles)
 * - Zonas de Demanda y Tarifas Dinámicas (Surge pricing, matriz de costos)
 * - Notificaciones y Alertas del Sistema
 * - Registro de Auditoría de Operaciones de IA
 * - Especificación OpenAPI 3.1.0 lista para importar en ChatGPT Custom Actions
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Clave Maestra de Acceso para ChatGPT (Configurable vía GPT_API_KEY)
const GPT_MASTER_KEY = process.env.GPT_API_KEY || '';

// Dependencias de almacenamiento existentes
let quotesStore = new Map();
let tripsStore = new Map();
let idempotencyStore = new Map();
let DOMINICAN_PLACES_DIRECTORY = [];
let calculateHaversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1.35 * 10) / 10;
};

try {
  const apiV1 = require('./apiV1');
  if (apiV1.quotesStore) quotesStore = apiV1.quotesStore;
  if (apiV1.tripsStore) tripsStore = apiV1.tripsStore;
  if (apiV1.idempotencyStore) idempotencyStore = apiV1.idempotencyStore;
  if (apiV1.DOMINICAN_PLACES_DIRECTORY) DOMINICAN_PLACES_DIRECTORY = apiV1.DOMINICAN_PLACES_DIRECTORY;
  if (apiV1.calculateHaversineDistanceKm) calculateHaversineDistanceKm = apiV1.calculateHaversineDistanceKm;
} catch (e) {
  console.warn('ℹ️ [GPT-API] Conectado a almacén local independiente para cotizaciones y viajes.');
}

// Protección temporal: usuarios GPT deshabilitados hasta integrar Neon.
router.use('/api/v1/gpt/users', (req, res) => {
  return res.status(503).json({
    success: false,
    code: 'GPT_USERS_NEON_MIGRATION_REQUIRED',
    error: 'Las operaciones de usuarios GPT están temporalmente deshabilitadas.'
  });
});

// Repositorio antiguo deshabilitado durante la migración Neon.
// No representa el número real de usuarios registrados.
const users = new Map();

// Cargar viajes iniciales desde data/trips-database.json si tripsStore está vacío
function hydrateTripsFromDisk() {
  if (tripsStore.size === 0) {
    try {
      const dbPath = path.join(__dirname, '..', 'data', 'trips-database.json');
      if (fs.existsSync(dbPath)) {
        const raw = fs.readFileSync(dbPath, 'utf8');
        const tripsData = JSON.parse(raw);
        if (Array.isArray(tripsData)) {
          tripsData.forEach(trip => {
            const id = trip.id || trip.codigo;
            if (id) tripsStore.set(id, trip);
          });
          console.log(`✅ [GPT-API] ${tripsStore.size} viajes sincronizados desde trips-database.json`);
        }
      }
    } catch (err) {
      console.warn('⚠️ [GPT-API] No se pudo cargar trips-database.json:', err.message);
    }
  }
}
hydrateTripsFromDisk();

// Matriz de Tarifas
let PRICING_MATRIX;
try {
  PRICING_MATRIX = require('../config/pricingMatrix');
} catch (e) {
  PRICING_MATRIX = {
    currency: 'DOP',
    currencySymbol: 'RD$',
    categories: {
      clasico: { name: 'Clásico', baseFare: 120, kmRate: 28, minuteRate: 4, minFare: 150 },
      estandar: { name: 'Estándar', baseFare: 160, kmRate: 36, minuteRate: 5, minFare: 200 },
      confort: { name: 'Confort', baseFare: 220, kmRate: 46, minuteRate: 6.5, minFare: 280 },
      xl: { name: 'XL 6 Pasajeros', baseFare: 300, kmRate: 58, minuteRate: 8, minFare: 380 },
      veh: { name: 'VEH Ambulancia / Médica', baseFare: 450, kmRate: 70, minuteRate: 10, minFare: 600 },
      paquete: { name: 'Entrega de Paquetes', baseFare: 130, kmRate: 25, minuteRate: 3.5, minFare: 160 }
    }
  };
}

// Registro de Auditoría de Operaciones ejecutadas por GPT
const auditLogs = [];
function recordAuditLog({ action, resource, resourceId, details, success = true, clientIp = '127.0.0.1' }) {
  const logEntry = {
    id: `AUDIT-GPT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: 'ChatGPT-SuperAdmin-Agent',
    action,
    resource,
    resourceId: resourceId || null,
    details: details || {},
    success,
    clientIp,
    timestamp: new Date().toISOString()
  };
  auditLogs.unshift(logEntry);
  if (auditLogs.length > 500) auditLogs.pop();
  return logEntry;
}

// Chóferes activos en vivo para consultas y asignaciones
const activeDrivers = [
  {
    id: 'drv-01',
    name: 'Carlos Manuel Durán',
    phone: '+1 829-555-0872',
    category: 'Clasico',
    vehicle: { marca: 'Toyota', modelo: 'Corolla 2022', color: 'Blanco', placa: 'A948210' },
    rating: 4.95,
    completedTrips: 218,
    status: 'AVAILABLE',
    latitude: 18.4735,
    longitude: -69.9360,
    sector: 'Piantini, Santo Domingo'
  },
  {
    id: 'drv-02',
    name: 'Yomaira Almonte',
    phone: '+1 809-555-0321',
    category: 'Confort',
    vehicle: { marca: 'Hyundai', modelo: 'Sonata 2021', color: 'Gris Oscuro', placa: 'A829104' },
    rating: 4.98,
    completedTrips: 189,
    status: 'AVAILABLE',
    latitude: 18.4810,
    longitude: -69.9412,
    sector: 'Naco, Santo Domingo'
  },
  {
    id: 'drv-03',
    name: 'Ramón Antonio Peña',
    phone: '+1 849-555-0914',
    category: 'XL',
    vehicle: { marca: 'Chevrolet', modelo: 'Traverse 2020', color: 'Negro', placa: 'G459201' },
    rating: 4.89,
    completedTrips: 342,
    status: 'AVAILABLE',
    latitude: 18.4680,
    longitude: -69.9295,
    sector: 'Bella Vista, Santo Domingo'
  },
  {
    id: 'drv-04',
    name: 'Dr. Héctor Méndez (Paramédico Certificado)',
    phone: '+1 809-555-0911',
    category: 'VEH',
    vehicle: { marca: 'Ford', modelo: 'Transit Med-Care', color: 'Blanco / Cruz Roja', placa: 'O019283' },
    rating: 5.0,
    completedTrips: 76,
    status: 'AVAILABLE',
    latitude: 18.4891,
    longitude: -69.9242,
    sector: 'Plaza de la Salud / CEDIMAT'
  }
];

// Zonas de Demanda y Surge Multipliers
const demandZones = [
  { id: 'zone-piantini', name: 'Piantini & Naco', city: 'Santo Domingo', surgeMultiplier: 1.15, activeDrivers: 8, pendingRequests: 12, level: 'ALTO' },
  { id: 'zone-aila', name: 'Aeropuerto Int. Las Américas (AILA)', city: 'Boca Chica', surgeMultiplier: 1.25, activeDrivers: 5, pendingRequests: 8, level: 'MUY_ALTO' },
  { id: 'zone-downtown', name: 'Bella Vista & Downtown Center', city: 'Santo Domingo', surgeMultiplier: 1.0, activeDrivers: 10, pendingRequests: 4, level: 'NORMAL' },
  { id: 'zone-santiago-monumento', name: 'Monumento & Los Jardines', city: 'Santiago', surgeMultiplier: 1.10, activeDrivers: 6, pendingRequests: 5, level: 'MEDIO' },
  { id: 'zone-bavaro', name: 'Bávaro & Punta Cana', city: 'La Altagracia', surgeMultiplier: 1.30, activeDrivers: 14, pendingRequests: 21, level: 'CRITICO' }
];

function gptAuthMiddleware(req, res, next) {
  const publicPaths = [
    '/api/v1/gpt/openapi.json',
    '/api/v1/gpt/openapi.yaml',
    '/api/v1/gpt/instructions',
    '/api/v1/gpt/docs',
    '/api/v1/gpt/health'
  ];

  if (publicPaths.includes(req.path)) {
    return next();
  }

  let providedKey = '';

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7).trim();
  }

  if (!providedKey && req.headers['x-api-key']) {
    providedKey = String(req.headers['x-api-key']).trim();
  }

  if (!GPT_MASTER_KEY || !providedKey || providedKey.length !== GPT_MASTER_KEY.length || !crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(GPT_MASTER_KEY))) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED_GPT_ACCESS',
      error: 'Clave API no válida o no proporcionada.',
      message: 'ChatGPT requiere autenticación con permisos completos de lectura y modificación. Proporcione la clave maestra en el encabezado Authorization: Bearer <GPT_API_KEY> o X-API-Key: <GPT_API_KEY>.',
      hint: 'Puede configurar su GPT Custom Action usando autenticación API Key (Bearer) con la clave configurada en el backend.'
    });
  }

  req.gptAgent = {
    actor: 'ChatGPT-SuperAdmin-Agent',
    role: 'SUPER_ADMIN_AI',
    permissions: [
      'ALL_PERMISSIONS',
      'READ_TRIPS',
      'MODIFY_TRIPS',
      'CANCEL_TRIPS',
      'ASSIGN_DRIVERS',
      'READ_USERS',
      'MODIFY_USERS',
      'MANAGE_KMBANK',
      'EMERGENCY_OVERRIDE',
      'MODIFY_SURGE',
      'SYSTEM_ADMIN'
    ],
    authenticatedAt: new Date().toISOString()
  };

  next();
}

router.use(gptAuthMiddleware);

router.get('/api/v1/gpt/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ONLINE',
    service: 'CoPilotRD / NosotrosRD GPT Management API',
    version: '1.0.0',
    capabilities: [
      'READ_OPERATIONS',
      'WRITE_OPERATIONS',
      'TRIP_LIFECYCLE_MANAGEMENT',
      'DRIVER_DISPATCH',
      'KMBANK_CREDITS',
      'SURGE_PRICING',
      'AUDIT_LOGGING'
    ],
    timestamp: new Date().toISOString()
  });
});

router.get('/api/v1/gpt/system/status', (req, res) => {
  hydrateTripsFromDisk();

  const trips = Array.from(tripsStore.values());
  const tripsByStatus = {
    BUSCANDO_CHOFER: trips.filter(t => t.status === 'SEARCHING_DRIVER' || t.status === 'BUSCANDO_CHOFER' || t.estado === 'BUSCANDO_CHOFER').length,
    ASIGNADO: trips.filter(t => t.status === 'ASSIGNED' || t.status === 'ASIGNADO' || t.estado === 'ASIGNADO').length,
    EN_CURSO: trips.filter(t => t.status === 'IN_PROGRESS' || t.status === 'EN_CURSO' || t.estado === 'EN_CURSO').length,
    FINALIZADO: trips.filter(t => t.status === 'COMPLETED' || t.status === 'FINALIZADO' || t.estado === 'FINALIZADO').length,
    CANCELADO: trips.filter(t => t.status === 'CANCELLED' || t.status === 'CANCELADO' || t.estado === 'CANCELADO').length
  };

  recordAuditLog({
    action: 'READ_SYSTEM_STATUS',
    resource: 'SYSTEM',
    details: { totalTrips: trips.length, activeDrivers: activeDrivers.length },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    system: {
      name: 'CoPilotRD® / NosotrosRD Mobility Platform',
      environment: process.env.NODE_ENV || 'production',
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    },
    metrics: {
      totalTripsInDatabase: trips.length,
      tripsByStatus,
      activeQuotesInMemory: quotesStore.size,
      registeredUsersCount: users.size,
      availableDriversCount: activeDrivers.filter(d => d.status === 'AVAILABLE').length,
      demandZonesCount: demandZones.length,
      totalAuditEntries: auditLogs.length
    },
    agentPermissions: req.gptAgent ? req.gptAgent.permissions : ['UNAUTHENTICATED_CHECK']
  });
});

router.get('/api/v1/gpt/trips', (req, res) => {
  hydrateTripsFromDisk();

  const { status, category, clientId, driverId, limit = 50, offset = 0 } = req.query;
  let allTrips = Array.from(tripsStore.values());

  if (status && status !== 'ALL') {
    const s = String(status).toUpperCase();
    allTrips = allTrips.filter(t => {
      const tripStatus = (t.status || t.estado || '').toUpperCase();
      return tripStatus === s || (s === 'FINALIZADO' && tripStatus === 'COMPLETED') || (s === 'CANCELADO' && tripStatus === 'CANCELLED');
    });
  }

  if (category) {
    const cat = String(category).toLowerCase();
    allTrips = allTrips.filter(t => (t.category || t.categoria || '').toLowerCase() === cat);
  }

  if (clientId) {
    allTrips = allTrips.filter(t => t.clientId === clientId || t.clienteId === clientId);
  }

  if (driverId) {
    allTrips = allTrips.filter(t => t.choferId === driverId || t.assignedDriver?.id === driverId);
  }

  const total = allTrips.length;
  const paginated = allTrips.slice(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10));

  recordAuditLog({
    action: 'READ_TRIPS_LIST',
    resource: 'TRIPS',
    details: { total, returned: paginated.length, filters: { status, category, clientId } },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    total,
    count: paginated.length,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    trips: paginated
  });
});

router.get('/api/v1/gpt/trips/:tripId', (req, res) => {
  hydrateTripsFromDisk();

  const tripId = req.params.tripId;
  let trip = tripsStore.get(tripId);

  if (!trip) {
    for (const t of tripsStore.values()) {
      if (t.codigo === tripId || t.tripId === tripId || t.id === tripId) {
        trip = t;
        break;
      }
    }
  }

  if (!trip) {
    return res.status(404).json({
      success: false,
      code: 'TRIP_NOT_FOUND',
      error: `No se encontró ningún viaje con el identificador '${tripId}'.`
    });
  }

  recordAuditLog({
    action: 'READ_TRIP_DETAIL',
    resource: 'TRIP',
    resourceId: tripId,
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    trip
  });
});

router.get('/api/v1/gpt/fares/quotes', (req, res) => {
  const quotes = Array.from(quotesStore.values()).map(q => ({
    ...q,
    isExpired: q.expiresAtTimestamp ? q.expiresAtTimestamp < Date.now() : false
  }));

  return res.status(200).json({
    success: true,
    total: quotes.length,
    quotes
  });
});

router.get('/api/v1/gpt/fares/quotes/:quoteId', (req, res) => {
  const quote = quotesStore.get(req.params.quoteId);
  if (!quote) {
    return res.status(404).json({
      success: false,
      error: 'Cotización no encontrada o expirada.'
    });
  }

  return res.status(200).json({
    success: true,
    quote: {
      ...quote,
      isExpired: quote.expiresAtTimestamp ? quote.expiresAtTimestamp < Date.now() : false
    }
  });
});

router.get('/api/v1/gpt/users', (req, res) => {
  const { role, status, kycStatus } = req.query;
  let list = Array.from(users.values()).map(u => {
    const safeUser = { ...u };
    delete safeUser.passwordHash;
    return safeUser;
  });

  if (role) {
    list = list.filter(u => u.role === String(role).toUpperCase());
  }
  if (status) {
    list = list.filter(u => u.status === String(status).toUpperCase());
  }
  if (kycStatus) {
    list = list.filter(u => u.kycStatus === String(kycStatus).toUpperCase());
  }

  recordAuditLog({
    action: 'READ_USERS_LIST',
    resource: 'USERS',
    details: { totalReturned: list.length, filterRole: role },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    total: list.length,
    users: list
  });
});

router.get('/api/v1/gpt/users/:userId', (req, res) => {
  const user = users.get(req.params.userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      error: `Usuario '${req.params.userId}' no encontrado.`
    });
  }

  const safeUser = { ...user };
  delete safeUser.passwordHash;

  const userTrips = Array.from(tripsStore.values()).filter(t => t.clientId === user.id || t.clienteId === user.id || t.choferId === user.id);

  return res.status(200).json({
    success: true,
    user: safeUser,
    associatedTripsCount: userTrips.length,
    recentTrips: userTrips.slice(0, 5)
  });
});

router.get('/api/v1/gpt/drivers/available', (req, res) => {
  const { category } = req.query;
  let drivers = [...activeDrivers];
  if (category) {
    drivers = drivers.filter(d => d.category.toLowerCase() === String(category).toLowerCase());
  }

  return res.status(200).json({
    success: true,
    totalAvailable: drivers.length,
    drivers,
    timestamp: new Date().toISOString()
  });
});

router.get('/api/v1/gpt/zones/demand', (req, res) => {
  return res.status(200).json({
    success: true,
    zones: demandZones,
    timestamp: new Date().toISOString()
  });
});

router.get('/api/v1/gpt/audit/logs', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  return res.status(200).json({
    success: true,
    totalLogs: auditLogs.length,
    logs: auditLogs.slice(0, limit)
  });
});

router.post('/api/v1/gpt/fares/quote', (req, res) => {
  const body = req.body || {};
  const origin = body.origin || { address: 'Piantini, Santo Domingo', lat: 18.4728, lng: -69.9405 };
  const destination = body.destination || { address: 'Aeropuerto Int. Las Américas (AILA)', lat: 18.4297, lng: -69.6689 };
  const requestedCategory = (body.category || 'estandar').toLowerCase();
  const surgeMultiplier = typeof body.surgeMultiplier === 'number' ? body.surgeMultiplier : 1.0;

  const originLat = origin.lat || 18.4728;
  const originLng = origin.lng || -69.9405;
  const destLat = destination.lat || 18.4297;
  const destLng = destination.lng || -69.6689;

  const distanceKm = calculateHaversineDistanceKm(originLat, originLng, destLat, destLng);
  const durationMin = Math.max(5, Math.round(distanceKm * 2.6));

  const quoteId = `QUOTE-GPT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

  const categoriesPricing = {};
  const catKeys = ['moto', 'clasico', 'estandar', 'confort', 'xl', 'veh', 'paquete'];

  catKeys.forEach(key => {
    const matrix = PRICING_MATRIX.categories[key] || { baseFare: 150, kmRate: 30, minuteRate: 4, minFare: 180 };
    const base = matrix.baseFare || 150;
    const kmCost = Math.round(distanceKm * (matrix.kmRate || 30));
    const timeCost = Math.round(durationMin * (matrix.minuteRate || 4));
    const subtotal = Math.round((base + kmCost + timeCost) * surgeMultiplier);
    const finalFare = Math.max(matrix.minFare || 180, Math.ceil(subtotal / 10) * 10);

    categoriesPricing[key] = {
      name: matrix.name || key,
      fareRD: finalFare,
      currency: 'DOP',
      breakdown: {
        baseFare: base,
        distanceCost: kmCost,
        timeCost,
        surgeMultiplier,
        minFare: matrix.minFare || 180
      }
    };
  });

  const selectedPricing = categoriesPricing[requestedCategory] || categoriesPricing['estandar'];

  const quoteRecord = {
    quoteId,
    fareRD: selectedPricing.fareRD,
    currency: 'DOP',
    distanceKm,
    durationMin,
    origin,
    destination,
    category: requestedCategory,
    breakdown: selectedPricing.breakdown,
    allCategories: categoriesPricing,
    issuedAt: now.toISOString(),
    expiresAt,
    expiresAtTimestamp: now.getTime() + 15 * 60 * 1000,
    createdBy: 'ChatGPT-SuperAdmin'
  };

  quotesStore.set(quoteId, quoteRecord);

  recordAuditLog({
    action: 'CREATE_QUOTE',
    resource: 'QUOTE',
    resourceId: quoteId,
    details: { requestedCategory, fareRD: selectedPricing.fareRD, distanceKm },
    clientIp: req.ip
  });

  return res.status(201).json({
    success: true,
    code: 'QUOTE_ISSUED',
    quoteId,
    fareRD: selectedPricing.fareRD,
    currency: 'DOP',
    distanceKm,
    durationMin,
    category: requestedCategory,
    origin,
    destination,
    breakdown: selectedPricing.breakdown,
    expiresAt,
    availableCategories: categoriesPricing,
    message: 'Cotización oficial creada exitosamente por el Agente GPT.'
  });
});

router.post('/api/v1/gpt/trips/create', (req, res) => {
  hydrateTripsFromDisk();

  const body = req.body || {};
  const quoteId = body.quoteId;
  let quote = null;

  if (quoteId) {
    quote = quotesStore.get(quoteId);
  }

  const tripId = `TRIP-RD-${Date.now()}`;
  const tripCode = `VIA-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const now = new Date().toISOString();

  const origin = body.origin || (quote ? quote.origin : { address: 'Piantini, Santo Domingo', lat: 18.4728, lng: -69.9405 });
  const destination = body.destination || (quote ? quote.destination : { address: 'Aeropuerto Int. Las Américas (AILA)', lat: 18.4297, lng: -69.6689 });
  const category = body.category || (quote ? quote.category : 'Clasico');
  const fareRD = body.fareRD || (quote ? quote.fareRD : 850);
  const distanceKm = body.distanceKm || (quote ? quote.distanceKm : 14.5);
  const durationMin = body.durationMin || (quote ? quote.durationMin : 30);
  const clientId = body.clientId || 'cli-01';
  const clientName = body.clientName || 'María Elena Ventura';

  let assignedDriver = null;
  let initialStatus = 'BUSCANDO_CHOFER';

  if (body.assignedDriverId) {
    const foundDriver = activeDrivers.find(d => d.id === body.assignedDriverId);
    if (foundDriver) {
      assignedDriver = {
        id: foundDriver.id,
        name: foundDriver.name,
        phone: foundDriver.phone,
        vehicle: foundDriver.vehicle,
        rating: foundDriver.rating
      };
      initialStatus = 'ASIGNADO';
    }
  }

  const newTrip = {
    id: tripId,
    tripId,
    codigo: tripCode,
    status: initialStatus,
    estado: initialStatus,
    category,
    categoria: category,
    fareRD,
    tarifaTotalDOP: fareRD,
    currency: 'DOP',
    distanceKm,
    durationMin,
    tiempoEstimadoMinutos: durationMin,
    origen: origin,
    destino: destination,
    pickup: origin,
    destination: destination,
    clientId,
    nombreCliente: clientName,
    paymentMethod: body.paymentMethod || 'CASH',
    metodoPago: body.paymentMethod || 'EFECTIVO',
    quoteId: quoteId || null,
    assignedDriver,
    creadoAt: now,
    timestamp: now,
    actualizadoAt: now,
    dispatchNotes: body.notes || 'Creado por Agente GPT con autorización ejecutiva.',
    auditLog: [
      { action: 'CREATED_BY_GPT', timestamp: now, actor: 'ChatGPT-SuperAdmin-Agent' }
    ]
  };

  tripsStore.set(tripId, newTrip);

  recordAuditLog({
    action: 'CREATE_AND_DISPATCH_TRIP',
    resource: 'TRIP',
    resourceId: tripId,
    details: { tripCode, category, fareRD, initialStatus, clientId },
    clientIp: req.ip
  });

  return res.status(201).json({
    success: true,
    code: 'TRIP_CREATED_BY_GPT',
    tripId,
    tripCode,
    status: initialStatus,
    trip: newTrip,
    message: `Viaje ${tripCode} creado y despachado exitosamente por GPT.`
  });
});

router.patch('/api/v1/gpt/trips/:tripId/status', (req, res) => {
  hydrateTripsFromDisk();

  const tripId = req.params.tripId;
  const { status, note, etaMinutes, driverCoordinates } = req.body || {};

  if (!status) {
    return res.status(400).json({
      success: false,
      error: "El campo 'status' es obligatorio (ej: BUSCANDO_CHOFER, ASIGNADO, EN_CAMINO, EN_CURSO, FINALIZADO, CANCELADO)."
    });
  }

  let trip = tripsStore.get(tripId);
  if (!trip) {
    for (const t of tripsStore.values()) {
      if (t.codigo === tripId || t.tripId === tripId || t.id === tripId) {
        trip = t;
        break;
      }
    }
  }

  if (!trip) {
    return res.status(404).json({
      success: false,
      error: `Viaje '${tripId}' no encontrado.`
    });
  }

  const previousStatus = trip.status || trip.estado;
  const now = new Date().toISOString();

  trip.status = status;
  trip.estado = status;
  trip.actualizadoAt = now;

  if (typeof etaMinutes === 'number') {
    trip.etaMinutes = etaMinutes;
  }

  if (driverCoordinates) {
    trip.ubicacionActualChofer = {
      lat: driverCoordinates.lat,
      lng: driverCoordinates.lng,
      ultimaActualizacion: now
    };
  }

  if (status === 'FINALIZADO' || status === 'COMPLETED') {
    trip.finalizadoAt = now;
  }

  if (!trip.auditLog) trip.auditLog = [];
  trip.auditLog.push({
    action: 'STATUS_MODIFIED_BY_GPT',
    from: previousStatus,
    to: status,
    note: note || 'Actualización efectuada por ChatGPT Agent',
    timestamp: now
  });

  recordAuditLog({
    action: 'MODIFY_TRIP_STATUS',
    resource: 'TRIP',
    resourceId: tripId,
    details: { from: previousStatus, to: status, note },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    code: 'TRIP_STATUS_UPDATED',
    tripId: trip.id || trip.tripId,
    previousStatus,
    newStatus: status,
    updatedAt: now,
    message: `Estado del viaje actualizado exitosamente de '${previousStatus}' a '${status}'.`
  });
});

router.post('/api/v1/gpt/trips/:tripId/assign-driver', (req, res) => {
  hydrateTripsFromDisk();

  const tripId = req.params.tripId;
  const { driverId, driverName, phone, vehicle, plate } = req.body || {};

  if (!driverId) {
    return res.status(400).json({
      success: false,
      error: "El campo 'driverId' es obligatorio para la asignación."
    });
  }

  let trip = tripsStore.get(tripId);
  if (!trip) {
    for (const t of tripsStore.values()) {
      if (t.codigo === tripId || t.tripId === tripId || t.id === tripId) {
        trip = t;
        break;
      }
    }
  }

  if (!trip) {
    return res.status(404).json({ success: false, error: `Viaje '${tripId}' no encontrado.` });
  }

  const foundInCatalog = activeDrivers.find(d => d.id === driverId);

  const assigned = {
    id: driverId,
    nombre: driverName || (foundInCatalog ? foundInCatalog.name : 'Chófer Certificado NosotrosRD'),
    name: driverName || (foundInCatalog ? foundInCatalog.name : 'Chófer Certificado NosotrosRD'),
    telefono: phone || (foundInCatalog ? foundInCatalog.phone : '+1 809-555-0100'),
    phone: phone || (foundInCatalog ? foundInCatalog.phone : '+1 809-555-0100'),
    vehiculo: vehicle || (foundInCatalog ? foundInCatalog.vehicle : { marca: 'Toyota', modelo: 'Corolla' }),
    placa: plate || (foundInCatalog ? foundInCatalog.vehicle?.placa : 'A000000'),
    assignedAt: new Date().toISOString()
  };

  trip.assignedDriver = assigned;
  trip.choferId = driverId;
  trip.nombreChofer = assigned.name;
  trip.status = 'ASIGNADO';
  trip.estado = 'ASIGNADO';
  trip.actualizadoAt = new Date().toISOString();

  recordAuditLog({
    action: 'ASSIGN_DRIVER',
    resource: 'TRIP',
    resourceId: tripId,
    details: { driverId, driverName: assigned.name },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    code: 'DRIVER_ASSIGNED',
    tripId: trip.id || trip.tripId,
    assignedDriver: assigned,
    status: 'ASIGNADO',
    message: `Chofer '${assigned.name}' (${driverId}) asignado exitosamente al viaje.`
  });
});

router.post('/api/v1/gpt/trips/:tripId/cancel', (req, res) => {
  hydrateTripsFromDisk();

  const tripId = req.params.tripId;
  const { reason, cancelledBy = 'GPT_AGENT', cancellationFeeDOP = 0 } = req.body || {};

  let trip = tripsStore.get(tripId);
  if (!trip) {
    for (const t of tripsStore.values()) {
      if (t.codigo === tripId || t.tripId === tripId || t.id === tripId) {
        trip = t;
        break;
      }
    }
  }

  if (!trip) {
    return res.status(404).json({ success: false, error: `Viaje '${tripId}' no encontrado.` });
  }

  const now = new Date().toISOString();
  trip.status = 'CANCELADO';
  trip.estado = 'CANCELADO';
  trip.cancellationReason = reason || 'Cancelado por intervención de soporte de IA.';
  trip.cancelledBy = cancelledBy;
  trip.cancellationFeeDOP = cancellationFeeDOP;
  trip.canceladoAt = now;
  trip.actualizadoAt = now;

  recordAuditLog({
    action: 'CANCEL_TRIP',
    resource: 'TRIP',
    resourceId: tripId,
    details: { reason, cancelledBy, cancellationFeeDOP },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    code: 'TRIP_CANCELLED',
    tripId: trip.id || trip.tripId,
    status: 'CANCELADO',
    cancellationReason: trip.cancellationReason,
    cancellationFeeDOP,
    cancelledAt: now,
    message: `El viaje '${tripId}' ha sido cancelado exitosamente.`
  });
});

router.patch('/api/v1/gpt/users/:userId', (req, res) => {
  const userId = req.params.userId;
  const user = users.get(userId);

  if (!user) {
    return res.status(404).json({ success: false, error: `Usuario '${userId}' no encontrado.` });
  }

  const { fullName, phone, email, status, kycStatus, kmBankBalanceAdjustment, role, adminNotes } = req.body || {};

  if (fullName) user.fullName = fullName;
  if (phone) user.phone = phone;
  if (email) user.email = email;
  if (status) user.status = status;
  if (kycStatus) user.kycStatus = kycStatus;
  if (role) user.role = role;

  if (typeof kmBankBalanceAdjustment === 'number') {
    user.kmBankBalance = (user.kmBankBalance || 0) + kmBankBalanceAdjustment;
  }

  user.lastModifiedBy = 'ChatGPT-SuperAdmin';
  user.lastModifiedAt = new Date().toISOString();
  if (adminNotes) user.adminNotes = adminNotes;

  const safeUser = { ...user };
  delete safeUser.passwordHash;

  recordAuditLog({
    action: 'MODIFY_USER',
    resource: 'USER',
    resourceId: userId,
    details: { fullName, status, kycStatus, kmBankAdjustment: kmBankBalanceAdjustment },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    code: 'USER_UPDATED_BY_GPT',
    user: safeUser,
    message: `Cuenta del usuario '${userId}' modificada correctamente por GPT.`
  });
});

router.post('/api/v1/gpt/users/create', (req, res) => {
  const body = req.body || {};
  const { fullName, email, phone, role = 'CLIENT', documentId, initialKmBalance = 50 } = body;

  if (!fullName || !email) {
    return res.status(400).json({
      success: false,
      error: 'Se requieren fullName y email para registrar un nuevo usuario.'
    });
  }

  const userId = `usr-gpt-${Date.now()}`;
  const newUser = {
    id: userId,
    fullName,
    email,
    phone: phone || '+1 809-555-0000',
    documentId: documentId || '001-0000000-0',
    role: String(role).toUpperCase(),
    status: 'ACTIVO',
    kycStatus: 'APROBADO',
    kmBankBalance: initialKmBalance,
    kmBankUnlocked: true,
    completedTripsCount: 0,
    registeredAt: new Date().toISOString(),
    createdSource: 'ChatGPT-SuperAdmin-API'
  };

  users.set(userId, newUser);

  recordAuditLog({
    action: 'CREATE_USER',
    resource: 'USER',
    resourceId: userId,
    details: { fullName, email, role },
    clientIp: req.ip
  });

  const safeUser = { ...newUser };

  return res.status(201).json({
    success: true,
    code: 'USER_CREATED',
    user: safeUser,
    message: `Usuario '${fullName}' (${userId}) registrado exitosamente con privilegios aprobados.`
  });
});

router.post('/api/v1/gpt/notifications/send', (req, res) => {
  const { recipientId, title, message, channel = 'IN_APP', priority = 'NORMAL' } = req.body || {};

  if (!recipientId || !message) {
    return res.status(400).json({
      success: false,
      error: "Se requieren 'recipientId' y 'message' para emitir la notificación."
    });
  }

  const notificationId = `NOTIF-${Date.now()}`;
  const notificationRecord = {
    id: notificationId,
    recipientId,
    title: title || 'Notificación Oficial NosotrosRD',
    message,
    channel,
    priority,
    sentAt: new Date().toISOString(),
    sentBy: 'ChatGPT-Agent',
    status: 'DELIVERED'
  };

  recordAuditLog({
    action: 'SEND_NOTIFICATION',
    resource: 'NOTIFICATION',
    resourceId: notificationId,
    details: { recipientId, title, channel, priority },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    code: 'NOTIFICATION_SENT',
    notification: notificationRecord,
    message: `Notificación enviada exitosamente al destinatario '${recipientId}'.`
  });
});

router.post('/api/v1/gpt/pricing/surge', (req, res) => {
  const { zoneId, surgeMultiplier, reason } = req.body || {};

  if (!zoneId || typeof surgeMultiplier !== 'number') {
    return res.status(400).json({
      success: false,
      error: "Se requieren 'zoneId' y 'surgeMultiplier' (número ej. 1.30)."
    });
  }

  const zone = demandZones.find(z => z.id === zoneId);
  if (!zone) {
    return res.status(404).json({
      success: false,
      error: `Zona '${zoneId}' no encontrada.`
    });
  }

  const oldSurge = zone.surgeMultiplier;
  zone.surgeMultiplier = surgeMultiplier;
  zone.lastSurgeUpdate = new Date().toISOString();
  zone.surgeReason = reason || 'Ajuste dinámico por balance de oferta/demanda vía GPT.';

  recordAuditLog({
    action: 'UPDATE_SURGE_PRICING',
    resource: 'PRICING_ZONE',
    resourceId: zoneId,
    details: { oldSurge, newSurge: surgeMultiplier, reason },
    clientIp: req.ip
  });

  return res.status(200).json({
    success: true,
    code: 'SURGE_UPDATED',
    zoneId,
    zoneName: zone.name,
    previousSurge: oldSurge,
    currentSurge: surgeMultiplier,
    updatedAt: zone.lastSurgeUpdate,
    message: `Tarifa dinámica para la zona '${zone.name}' actualizada a ${surgeMultiplier}x.`
  });
});

function generateOpenApiSchema(serverBaseUrl = 'https://nosotrosrd-backend-m5t.run.app') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CoPilotRD / NosotrosRD Mobility Platform - GPT SuperAdmin API',
      description: 'API oficial de control total para que ChatGPT (Custom GPT / Asistentes Autónomos) pueda LEER, COTIZAR, SOLICITAR, ASIGNAR CONDUCTORES, MODIFICAR ESTADOS DE VIAJES, GESTIONAR USUARIOS Y CONTROLAR TARIFAS DINÁMICAS en República Dominicana.',
      version: '1.0.0',
      contact: {
        name: 'Soporte Técnico CoPilotRD',
        email: 'nosotrosrdoficial@gmail.com'
      }
    },
    servers: [
      {
        url: serverBaseUrl,
        description: 'Servidor Oficial CoPilotRD / Cloud Run'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Clave Maestra para Agentes GPT. También se admite Authorization: Bearer <key>'
        }
      },
      schemas: {
        Location: {
          type: 'object',
          properties: {
            address: { type: 'string', example: 'Torre Piantini, Av. Gustavo Mejía Ricart, Santo Domingo' },
            lat: { type: 'number', example: 18.4721 },
            lng: { type: 'number', example: -69.9325 },
            referencia: { type: 'string', example: 'Frente a Acrópolis Center' }
          }
        },
        TripStatus: {
          type: 'string',
          enum: ['BUSCANDO_CHOFER', 'ASIGNADO', 'EN_CAMINO', 'EN_CURSO', 'FINALIZADO', 'CANCELADO']
        }
      }
    },
    security: [
      { ApiKeyAuth: [] }
    ],
    paths: {
      '/api/v1/gpt/system/status': {
        get: {
          operationId: 'getSystemStatus',
          summary: 'Consultar estado general del sistema y métricas',
          description: 'Devuelve métricas en tiempo real: conteo de viajes por estado, conductores activos, cotizaciones y memoria.',
          responses: {
            '200': { description: 'Estado y métricas operativas exitosas' }
          }
        }
      },
      '/api/v1/gpt/trips': {
        get: {
          operationId: 'listTrips',
          summary: 'Listar viajes con filtros opcionales',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'clientId', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
          ],
          responses: {
            '200': { description: 'Lista de viajes' }
          }
        }
      },
      '/api/v1/gpt/trips/{tripId}': {
        get: {
          operationId: 'getTripDetail',
          summary: 'Obtener detalle completo de un viaje específico',
          parameters: [
            { name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Detalle completo del viaje' },
            '404': { description: 'Viaje no encontrado' }
          }
        }
      },
      '/api/v1/gpt/fares/quote': {
        post: {
          operationId: 'createFareQuote',
          summary: 'Calcular y emitir una cotización oficial de tarifa',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    origin: { $ref: '#/components/schemas/Location' },
                    destination: { $ref: '#/components/schemas/Location' },
                    category: { type: 'string', example: 'clasico' },
                    surgeMultiplier: { type: 'number', example: 1.0 }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Cotización emitida exitosamente' }
          }
        }
      },
      '/api/v1/gpt/trips/create': {
        post: {
          operationId: 'createAndDispatchTrip',
          summary: 'Crear y despachar un viaje directamente',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    quoteId: { type: 'string' },
                    clientId: { type: 'string', example: 'cli-01' },
                    clientName: { type: 'string', example: 'María Elena Ventura' },
                    origin: { $ref: '#/components/schemas/Location' },
                    destination: { $ref: '#/components/schemas/Location' },
                    category: { type: 'string', example: 'Clasico' },
                    fareRD: { type: 'number', example: 850 },
                    assignedDriverId: { type: 'string', example: 'drv-01' },
                    notes: { type: 'string', example: 'Despacho prioritario solicitado por ChatGPT' }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'Viaje creado exitosamente' }
          }
        }
      },
      '/api/v1/gpt/trips/{tripId}/status': {
        patch: {
          operationId: 'updateTripStatus',
          summary: 'Modificar el estado de un viaje',
          parameters: [
            { name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: {
                    status: { $ref: '#/components/schemas/TripStatus' },
                    note: { type: 'string' },
                    etaMinutes: { type: 'integer' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Estado actualizado' }
          }
        }
      },
      '/api/v1/gpt/trips/{tripId}/assign-driver': {
        post: {
          operationId: 'assignDriverToTrip',
          summary: 'Asignar o reasignar un chofer a un viaje',
          parameters: [
            { name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['driverId'],
                  properties: {
                    driverId: { type: 'string', example: 'drv-01' },
                    driverName: { type: 'string' },
                    phone: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Conductor asignado' }
          }
        }
      },
      '/api/v1/gpt/trips/{tripId}/cancel': {
        post: {
          operationId: 'cancelTrip',
          summary: 'Cancelar un viaje con motivo',
          parameters: [
            { name: 'tripId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['reason'],
                  properties: {
                    reason: { type: 'string' },
                    cancelledBy: { type: 'string', default: 'GPT_AGENT' },
                    cancellationFeeDOP: { type: 'number', default: 0 }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Viaje cancelado' }
          }
        }
      },
      '/api/v1/gpt/users': {
        get: {
          operationId: 'listUsers',
          summary: 'Listar usuarios registrados',
          parameters: [
            { name: 'role', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Lista de usuarios' }
          }
        }
      },
      '/api/v1/gpt/users/{userId}': {
        get: {
          operationId: 'getUserDetail',
          summary: 'Detalle de un usuario y saldo en Banco de KM',
          parameters: [
            { name: 'userId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Detalle de usuario' }
          }
        },
        patch: {
          operationId: 'modifyUser',
          summary: 'Modificar datos de usuario o ajustar balance de Banco de KM',
          parameters: [
            { name: 'userId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    fullName: { type: 'string' },
                    phone: { type: 'string' },
                    status: { type: 'string', enum: ['ACTIVO', 'SUSPENDIDO'] },
                    kycStatus: { type: 'string', enum: ['APROBADO', 'PENDIENTE', 'RECHAZADO'] },
                    kmBankBalanceAdjustment: { type: 'number' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Usuario modificado exitosamente' }
          }
        }
      },
      '/api/v1/gpt/drivers/available': {
        get: {
          operationId: 'getAvailableDrivers',
          summary: 'Obtener choferes activos y disponibles en mapa',
          responses: {
            '200': { description: 'Lista de choferes disponibles' }
          }
        }
      },
      '/api/v1/gpt/zones/demand': {
        get: {
          operationId: 'getDemandZones',
          summary: 'Consultar zonas de demanda y tarifas dinámicas en RD',
          responses: {
            '200': { description: 'Zonas de demanda' }
          }
        }
      },
      '/api/v1/gpt/pricing/surge': {
        post: {
          operationId: 'updateSurgeMultiplier',
          summary: 'Ajustar multiplicador de tarifa dinámica para una zona',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['zoneId', 'surgeMultiplier'],
                  properties: {
                    zoneId: { type: 'string', example: 'zone-piantini' },
                    surgeMultiplier: { type: 'number', example: 1.25 },
                    reason: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Tarifa dinámica actualizada' }
          }
        }
      },
      '/api/v1/gpt/notifications/send': {
        post: {
          operationId: 'sendNotification',
          summary: 'Enviar notificación o alerta a cliente o chofer',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['recipientId', 'message'],
                  properties: {
                    recipientId: { type: 'string', example: 'cli-01' },
                    title: { type: 'string' },
                    message: { type: 'string' },
                    channel: { type: 'string', default: 'IN_APP' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Notificación enviada' }
          }
        }
      },
      '/api/v1/gpt/audit/logs': {
        get: {
          operationId: 'getAuditLogs',
          summary: 'Consultar registro de auditoría de operaciones ejecutadas por GPT',
          responses: {
            '200': { description: 'Historial de auditoría' }
          }
        }
      }
    }
  };
}

router.get('/api/v1/gpt/openapi.json', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  const schema = generateOpenApiSchema(baseUrl);
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).send(JSON.stringify(schema, null, 2));
});

router.get('/api/v1/gpt/instructions', (req, res) => {
  const instructions = `
# SYSTEM INSTRUCTIONS PARA CUSTOM GPT: COPILOTRD AGENT
Eres el Agente Inteligente Oficial de Operaciones de CoPilotRD® / NosotrosRD en República Dominicana.
Tienes autorización completa de SUPER_ADMINISTRADOR para LEER y MODIFICAR viajes, cotizaciones, choferes, usuarios y tarifas.
Moneda oficial: DOP (RD$).
`;

  return res.status(200).json({
    success: true,
    title: 'Custom GPT System Instructions',
    instructions: instructions.trim(),
    authentication: 'API Key mediante encabezado Authorization o X-API-Key'
  });
});

module.exports = router;
module.exports.gptAuthMiddleware = gptAuthMiddleware;
module.exports.recordAuditLog = recordAuditLog;
module.exports.generateOpenApiSchema = generateOpenApiSchema;
module.exports.GPT_MASTER_KEY = GPT_MASTER_KEY;
