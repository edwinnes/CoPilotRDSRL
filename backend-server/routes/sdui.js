const express = require('express');
const router = express.Router();
const PRICING_MATRIX = require('../config/pricingMatrix');

/**
 * =====================================================================
 * SDUI Engine - Esquema Universal de Autenticación CoPilotRD®
 * =====================================================================
 * GET & POST /api/v1/sdui/auth y /api/sdui/auth
 * Se mantiene 100% intacto y funcional para login/registro.
 */
function handleSduiAuth(req, res) {
  const role = (req.query.role || req.body?.role || 'CLIENT').toUpperCase();
  const isDriver = role === 'DRIVER';

  const sduiAuthSchema = {
    screenId: 'COPILOT_RD_AUTH_SDUI',
    version: '3.3.0',
    meta: {
      platform: 'SDUI_CROSS_PLATFORM',
      theme: 'DARK_MODERN',
      accentColor: '#00E5FF',
      backgroundColor: '#0B0F19',
      surfaceColor: '#10172A',
      title: isDriver ? 'Acceso Piloto & Socio Semilla' : 'Acceso Pasajero NósotrosRD'
    },
    header: {
      brandLogo: '🚗',
      brandTitle: 'CoPilotRD',
      registeredSymbol: '®',
      title: isDriver ? 'Portal de Conductores' : 'Bienvenido a CoPilotRD',
      subtitle: isDriver
        ? 'Gana más con la tarifa de servicio más baja (5% Semilla)'
        : 'Muévete rápido y seguro por toda la República Dominicana',
      clientRole: role
    },
    roleSelector: {
      currentRole: role,
      options: [
        { id: 'CLIENT', label: 'Pasajero / Cliente', icon: '👤' },
        { id: 'DRIVER', label: 'Conductor / Piloto', icon: '🚕' }
      ]
    },
    formFields: [
      {
        fieldId: 'identity',
        type: 'TEXT',
        label: 'Teléfono Móvil o Correo',
        placeholder: '+1 809-555-0142 o tu@correo.com',
        icon: 'phone',
        required: true,
        autoCapitalize: 'none',
        keyboardType: 'email-address',
        validation: {
          minLength: 8,
          errorMessage: 'Ingresa un número dominicano válido o correo electrónico.'
        }
      },
      {
        fieldId: 'password',
        type: 'PASSWORD',
        label: 'Contraseña de Seguridad',
        placeholder: '••••••••',
        icon: 'lock',
        required: true,
        secureTextEntry: true,
        validation: {
          minLength: 6,
          errorMessage: 'La contraseña debe contener al menos 6 caracteres.'
        }
      }
    ],
    submitButton: {
      id: 'btn_auth_submit',
      label: isDriver ? 'Ingresar a Cabina de Piloto' : 'Iniciar Viaje con NosotrosRD',
      bgColor: '#00E5FF',
      textColor: '#0B0F19',
      endpoint: '/api/v1/auth/login',
      method: 'POST'
    },
    socialProviders: [
      {
        id: 'google_gis',
        type: 'GOOGLE_GIS',
        provider: 'GOOGLE',
        label: 'Continuar con Google GIS',
        icon: 'google',
        bgColor: '#FFFFFF',
        textColor: '#1F2937',
        endpoint: '/api/v1/auth/google',
        method: 'POST'
      },
      {
        id: 'apple_sign_in',
        type: 'APPLE_SIGN_IN',
        provider: 'APPLE',
        label: 'Continuar con Apple',
        icon: 'apple',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        borderColor: '#334155',
        endpoint: '/api/v1/auth/apple',
        method: 'POST'
      }
    ],
    securityDirectives: {
      kycEnforced: true,
      jceCedulaLookup: true,
      biometricSupported: true,
      deviceValidationEndpoint: '/api/v1/devices/validate'
    }
  };

  return res.status(200).json({
    success: true,
    screen: 'auth-screen',
    title: isDriver ? 'CoPilotRD - Conductores' : 'CoPilotRD - Login or Register',
    theme: 'dark',
    components: [
      { type: 'header', title: 'CoPilotRD®', subtitle: isDriver ? 'Portal de Conductores' : 'Login or Register' },
      { type: 'input', placeholder: 'Email o Teléfono Dominicano', key: 'identifier', icon: 'mail' },
      { type: 'input', placeholder: 'Contraseña', key: 'password', secure: true, icon: 'lock', suffixIcon: '🙈' },
      { type: 'button', label: 'Sign In', action: 'login', style: 'primary' },
      { type: 'link', label: 'Forgot Password?', action: 'forgot_password' },
      { type: 'divider', text: 'Or continue with' },
      { type: 'socialButton', provider: 'google', label: 'Continue with Google' },
      { type: 'socialButton', provider: 'apple', label: 'Continue with Apple' },
      { type: 'footerLink', text: 'New to CoPilotRD?', actionText: 'Create an account', action: 'navigate_register' }
    ],
    schema: sduiAuthSchema
  });
}

/**
 * =====================================================================
 * CONTRATO SDUI: MODALIDAD 1 — RIDE (Transporte de Pasajeros)
 * =====================================================================
 */
function buildRideSduiConfig(req) {
  const body = req.method === 'POST' ? req.body : req.query;
  const distanceKm = parseFloat(body.distanceKm) || 7.2;
  const durationMinutes = parseFloat(body.durationMinutes) || 22;
  const surgeMultiplier = parseFloat(body.surgeMultiplier) || 1.15;
  const origin = body.origin || 'Torre Piantini, Av. Winston Churchill';
  const destination = body.destination || 'Aeropuerto Internacional Las Américas (AILA)';
  const cityId = body.cityId || 'santo-domingo';

  // Categorías oficiales calculadas dinámicamente incluyendo "Motor" (moto)
  const categories = Object.keys(PRICING_MATRIX.categories).map((key) => {
    const cat = PRICING_MATRIX.categories[key];
    const calc = PRICING_MATRIX.calculateCategoryPrice(key, distanceKm, durationMinutes, surgeMultiplier, cityId);
    return {
      id: cat.id,
      name: cat.name,
      tagline: cat.tagline,
      description: cat.description,
      vehicleType: cat.vehicleType,
      iconName: cat.iconName,
      seats: cat.seats,
      priceDOP: calc.priceDOP,
      formattedPrice: `RD$ ${calc.priceDOP}`,
      etaMinutes: key === 'moto' ? 2 : key === 'clasico' ? 3 : key === 'estandar' ? 4 : key === 'premium' ? 6 : 8,
      badge: cat.badge,
      badgeColor: cat.badgeColor,
      kmBankPointsEarned: calc.kmBankPointsEarned,
      breakdown: {
        baseFare: cat.baseFare,
        kmRate: cat.kmRate,
        minuteRate: cat.minuteRate,
        distanceFare: calc.breakdown.distanceFare,
        timeFare: calc.breakdown.timeFare,
        surgeMultiplier,
        itbis18Percent: Math.round(calc.priceDOP * 0.18),
        kmBankReward: calc.kmBankPointsEarned
      }
    };
  });

  return {
    success: true,
    screen: 'client-ride-planner',
    screenId: 'client-ride-planner',
    mode: 'ride',
    version: '3.4.0',
    title: 'CoPilotRD® — Planificador de Viajes',
    subtitle: 'Transporte urbano seguro, climatizado y con tarifa justa en República Dominicana',
    theme: 'dark',
    interactionFlow: {
      step1: 'Buscar y confirmar destino en Santo Domingo',
      step2: 'Activar mapa completo para seleccionar punto de recogida',
      step3: 'Confirmar coordenadas de recogida resueltas por geocodificación',
      step4: 'Solicitar cotización real al servidor (POST /api/v1/clients/fares/quote)',
      step5: 'Seleccionar categoría (Motor, Clásico, Estándar, Premium, Elite)',
      step6: 'Confirmar y solicitar chofer (POST /api/v1/clients/trips/request)'
    },
    components: [
      {
        id: 'header_ride_status',
        type: 'header',
        brand: 'CoPilotRD® Rideshare',
        surgeActive: surgeMultiplier > 1.0,
        surgeMultiplier,
        surgeText: surgeMultiplier > 1.0 ? `Alta Demanda Activa (x${surgeMultiplier})` : 'Tarifa Normal'
      },
      // 1. Buscar y confirmar destino
      {
        id: 'destination_search_bar',
        type: 'destinationSearchBar',
        label: '¿A dónde vas?',
        placeholder: 'Buscar destino en Santo Domingo...',
        action: 'searchDestination',
        autocompleteEndpoint: '/api/v1/clients/places/autocomplete',
        defaultDestination: destination
      },
      // 2. Activar el mapa completo para seleccionar origen
      {
        id: 'full_map_pin_picker',
        type: 'fullMapPinPicker',
        label: 'Seleccionar ubicación en el mapa',
        action: 'activateFullMap',
        pinMode: 'ORIGIN_PICKUP',
        initialRegion: {
          latitude: 18.4721,
          longitude: -69.9325,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05
        }
      },
      // 3. Confirmar coordenadas del punto de recogida
      {
        id: 'pickup_confirmation',
        type: 'pickupConfirmation',
        label: 'Confirmar Punto de Recogida',
        defaultAddress: origin,
        reverseGeocodeEndpoint: '/api/geocode/reverse',
        action: 'confirmPickupCoordinates'
      },
      // 4. Solicitar cotización real al servidor
      {
        id: 'server_quoting_action',
        type: 'serverQuotingAction',
        label: 'Cotización en Tiempo Real',
        action: 'requestServerQuote',
        endpoint: '/api/v1/clients/fares/quote',
        method: 'POST',
        quoteValiditySeconds: 900,
        serverCalculationEnforced: true,
        note: 'Las tarifas no son fijas; se calculan en el servidor según coordenadas GPS exactas, tráfico y demanda dinámica.'
      },
      // 5. Categorías disponibles, incluyendo Motor
      {
        id: 'category_selection_carousel',
        type: 'categorySelection',
        label: 'Seleccionar Categoría',
        defaultCategory: 'estandar',
        categories
      },
      // Métodos de Pago
      {
        id: 'payment_selector',
        type: 'paymentSelector',
        defaultMethod: 'CASH',
        options: [
          { id: 'CASH', label: 'Efectivo en DOP', subtitle: 'Pagas al completar el viaje' },
          { id: 'CARD', label: 'Tarjeta Crédito / Débito', subtitle: 'Cobro automático verificado' },
          { id: 'KM_BANK', label: 'Banco de KM (Saldo)', subtitle: 'Canjea tus KM acumulados (1 KM por cada 10 KM)' }
        ]
      },
      // Propinas Opcionales
      {
        id: 'tip_selector',
        type: 'tipSelector',
        currency: 'DOP',
        presetsDOP: [0, 50, 100, 150, 200],
        defaultTip: 0
      },
      // 6. Confirmar viaje
      {
        id: 'confirm_trip_action',
        type: 'confirmTripAction',
        label: 'Confirmar y Solicitar CoPilotRD®',
        action: 'confirmRide',
        endpoint: '/api/v1/clients/trips/request',
        method: 'POST',
        requiresAuth: true
      }
    ],
    validations: {
      originRequired: true,
      destinationRequired: true,
      categoryRequired: true,
      authorizationRequired: true,
      noMockCreationOnRead: true,
      minDistanceKm: 0.5,
      maxDistanceKm: 300,
      supportedCities: ['santo-domingo', 'santiago', 'punta-cana', 'la-romana']
    },
    allowedActions: [
      'searchDestination',
      'activateFullMap',
      'confirmPickupCoordinates',
      'requestServerQuote',
      'selectCategory',
      'confirmRide',
      'cancel_trip',
      'track_driver',
      'contact_driver',
      'emergency_sos'
    ],
    states: [
      'CONFIGURING',
      'DESTINATION_CONFIRMED',
      'ORIGIN_PINNED',
      'QUOTED',
      'SEARCHING_DRIVER',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVED',
      'TRIP_IN_PROGRESS',
      'COMPLETED'
    ],
    schema: {
      screenId: 'client-ride-planner',
      routeSummary: { origin, destination, distanceKm, durationMinutes, surgeMultiplier },
      fareCarousel: { categories },
      bottomSheet: {
        confirmAction: {
          label: 'Confirmar y Solicitar CoPilotRD®',
          endpoint: '/api/v1/clients/trips/request'
        }
      }
    }
  };
}

/**
 * =====================================================================
 * CONTRATO SDUI: MODALIDAD 2 — PACKAGE (Envíos y Paquetería Express)
 * =====================================================================
 */
function buildPackageSduiConfig(req) {
  const body = req.method === 'POST' ? req.body : req.query;
  const distanceKm = parseFloat(body.distanceKm) || 5.5;
  const origin = body.origin || 'Torre Piantini, Santo Domingo';
  const destination = body.destination || 'Zona Colonial, Santo Domingo';

  // Matriz real de tarifas de paquetería urbana
  const packageCategories = [
    {
      id: 'documentos_sobre',
      name: 'Documentos y Sobres',
      maxWeightKg: 1,
      description: 'Documentos, llaves, contratos o pasaportes. Traslado en compartimento impermeable.',
      baseFare: 220,
      kmRate: 22,
      priceDOP: Math.round(220 + distanceKm * 22),
      formattedPrice: `RD$ ${Math.round(220 + distanceKm * 22)}`,
      etaMinutes: 15,
      vehicleType: 'MOTORCYCLE_EXPRESS',
      requiresOtp: true,
      badge: 'Entrega Rápida ⚡'
    },
    {
      id: 'paquete_pequeno',
      name: 'Paquete Pequeño (hasta 5 kg)',
      maxWeightKg: 5,
      description: 'Cajas de zapatos, compras personales, repuestos o regalos medianos.',
      baseFare: 320,
      kmRate: 28,
      priceDOP: Math.round(320 + distanceKm * 28),
      formattedPrice: `RD$ ${Math.round(320 + distanceKm * 28)}`,
      etaMinutes: 20,
      vehicleType: 'MOTORCYCLE_CARGO',
      requiresOtp: true,
      badge: 'Más Usado ⭐'
    },
    {
      id: 'paquete_mediano',
      name: 'Paquete Mediano (hasta 15 kg)',
      maxWeightKg: 15,
      description: 'Cajas voluminosas o múltiples paquetes. Traslado en baúl de sedán o SUV.',
      baseFare: 480,
      kmRate: 38,
      priceDOP: Math.round(480 + distanceKm * 38),
      formattedPrice: `RD$ ${Math.round(480 + distanceKm * 38)}`,
      etaMinutes: 25,
      vehicleType: 'SEDAN_CARGO',
      requiresOtp: true,
      badge: 'Carga Protegida 📦'
    }
  ];

  return {
    success: true,
    screen: 'package-delivery-screen',
    mode: 'package',
    version: '3.3.0',
    title: 'CoPilotRD® — Envíos Express Urbanos',
    subtitle: 'Entrega puerta a puerta con seguimiento GPS en tiempo real y código OTP de recepción',
    theme: 'dark',
    components: [
      {
        type: 'header',
        brand: 'CoPilotRD® Envíos',
        badge: 'PIN OTP Obligatorio de Entrega'
      },
      {
        type: 'routeSelector',
        pickupField: { key: 'origin', label: 'Punto de Recogida (Remitente)', defaultAddress: origin },
        dropoffField: { key: 'destination', label: 'Punto de Entrega (Destinatario)', defaultAddress: destination },
        distanceKm
      },
      {
        type: 'recipientContactFields',
        recipientName: { key: 'recipientName', label: 'Nombre de quien recibe', required: true, placeholder: 'Nombre completo' },
        recipientPhone: { key: 'recipientPhone', label: 'Teléfono del destinatario', required: true, placeholder: '+1 809-XXX-XXXX' }
      },
      {
        type: 'packageTypeCarousel',
        defaultCategory: 'paquete_pequeno',
        categories: packageCategories
      },
      {
        type: 'securityOptions',
        requiresOtp: { label: 'Código PIN de Entrega (OTP)', value: true, locked: true, description: 'El chofer solo entrega cuando el receptor digita el PIN en su app.' },
        photoProofRequired: { label: 'Foto de Comprobante al Entregar', value: true, locked: false },
        declaredValueField: { key: 'declaredValueDOP', label: 'Valor declarado en DOP (opcional para seguro)', placeholder: 'RD$ 0.00' }
      },
      {
        type: 'packageInstructions',
        key: 'instructions',
        label: 'Indicaciones para el mensajero',
        placeholder: 'Ej: Apartamento 4B, timbre al llegar o dejar en garita de seguridad.'
      },
      {
        type: 'paymentSelector',
        defaultMethod: 'CARD',
        options: [
          { id: 'CARD', label: 'Tarjeta Crédito / Débito (Remitente)', subtitle: 'Cobro inmediato verificado' },
          { id: 'CASH_ORIGIN', label: 'Efectivo en Origen', subtitle: 'Paga quien envía' },
          { id: 'CASH_DESTINATION', label: 'Efectivo en Destino', subtitle: 'Paga quien recibe' },
          { id: 'KM_BANK', label: 'Banco de KM (Saldo)', subtitle: 'Canjea tus KM de fidelidad' }
        ]
      },
      {
        type: 'actionButton',
        label: 'Solicitar Envío Seguro',
        action: 'request_package_delivery',
        endpoint: '/api/v1/packages/request',
        method: 'POST'
      }
    ],
    validations: {
      recipientPhoneFormat: 'DOMINICAN_PHONE (+1 809/829/849)',
      maxWeightKg: 15,
      prohibitedItems: [
        'Sustancias controladas o ilícitas',
        'Armas de fuego o explosivos',
        'Dinero en efectivo o joyas de alto valor',
        'Materiales biológicos o químicos peligrosos'
      ]
    },
    allowedActions: [
      'quote_package',
      'request_delivery',
      'track_courier',
      'verify_delivery_otp',
      'cancel_delivery'
    ],
    states: [
      'DRAFT',
      'QUOTED',
      'COURIER_ASSIGNED',
      'PICKING_UP_PACKAGE',
      'PACKAGE_IN_TRANSIT',
      'ARRIVED_AT_DESTINATION',
      'OTP_VERIFIED',
      'DELIVERED'
    ],
    schema: {
      screenId: 'COPILOT_RD_PACKAGE_DELIVERY_SDUI',
      packageCategories
    }
  };
}

/**
 * =====================================================================
 * CONTRATO SDUI: MODALIDAD 3 — VEH (Movilidad Asistida & Traslados No Urgentes)
 * =====================================================================
 * Estricto cumplimiento:
 * - Distingue transporte asistido NO URGENTE de emergencias 9-1-1.
 * - Cero solicitud de historiales clínicos ni diagnósticos de salud (Ley 42-01).
 * - Únicamente adaptaciones físicas y requerimientos de accesibilidad.
 */
function buildVehSduiConfig(req) {
  const body = req.method === 'POST' ? req.body : req.query;
  const distanceKm = parseFloat(body.distanceKm) || 8.4;
  const origin = body.origin || 'Residencial Bella Vista, Santo Domingo';
  const destination = body.destination || 'Centro Médico Real, Av. Rómulo Betancourt';

  // Categorías de accesibilidad física
  const vehCategories = [
    {
      id: 'asistido_ambulatorio',
      name: 'Asistencia Ambulatoria',
      description: 'Sedán espacioso o SUV de acceso bajo para personas de la tercera edad o con bastón/andador. Chófer capacitado para asistencia al subir y descender.',
      baseFare: 550,
      kmRate: 42,
      priceDOP: Math.round(550 + distanceKm * 42),
      formattedPrice: `RD$ ${Math.round(550 + distanceKm * 42)}`,
      etaMinutes: 25,
      vehicleType: 'ACCESSIBLE_LOW_FLOOR_SUV',
      accessibilityFeatures: ['Piso bajo sin escalón alto', 'Asideros de apoyo reforzados', 'Asistencia física de abordaje'],
      badge: 'Traslado Asistido 🤝'
    },
    {
      id: 'silla_plegable',
      name: 'Espacio Silla de Ruedas Plegable',
      description: 'Vehículo con maletero de gran capacidad para resguardar silla de ruedas plegable y equipo de soporte ambulatorio.',
      baseFare: 750,
      kmRate: 48,
      priceDOP: Math.round(750 + distanceKm * 48),
      formattedPrice: `RD$ ${Math.round(750 + distanceKm * 48)}`,
      etaMinutes: 25,
      vehicleType: 'CROSSOVER_CARGO_ASSIST',
      accessibilityFeatures: ['Maletero amplio de apertura plana', 'Guantes y anclajes seguros para silla plegable', 'Acompañante incluido sin costo'],
      badge: 'Movilidad Inclusiva ♿'
    },
    {
      id: 'rampa_hidraulica',
      name: 'Unidad con Rampa / Elevador Hidráulico',
      description: 'Furgón adaptado con rampa o elevador certificado y anclajes de 4 puntos. El pasajero viaja asegurado en su propia silla de ruedas sin transferirse.',
      baseFare: 1200,
      kmRate: 65,
      priceDOP: Math.round(1200 + distanceKm * 65),
      formattedPrice: `RD$ ${Math.round(1200 + distanceKm * 65)}`,
      etaMinutes: 40,
      vehicleType: 'VAN_HYDRAULIC_LIFT',
      accessibilityFeatures: ['Rampa / elevador hidráulico certificado', 'Sistema de sujeción retráctil de 4 puntos', 'Cinturón de seguridad torácico exclusivo para silla'],
      badge: 'Accesibilidad Total 🚐'
    }
  ];

  return {
    success: true,
    screen: 'veh-medical-transport-screen',
    mode: 'veh',
    version: '3.3.0',
    title: 'CoPilotRD® — Movilidad Asistida & Traslado Programado',
    subtitle: 'Transporte inclusivo adaptado para citas médicas, terapias físicas y consultas ambulatorias no urgentes',
    theme: 'dark',
    disclaimerBanner: {
      type: 'LEGAL_MEDICAL_DISCLAIMER',
      severity: 'CRITICAL_NOTICE',
      title: 'AVISO IMPORTANTE DE SEGURIDAD',
      message: 'Este servicio es EXCLUSIVAMENTE para traslados ambulatorios y traslados asistidos NO URGENTES (consultas médicas, terapias, diálisis o altas hospitalarias programadas). NO somos un servicio de ambulancia ni contamos con soporte vital avanzado. Para emergencias con riesgo vital, llame inmediatamente al Sistema Nacional de Atención a Emergencias 9-1-1.',
      emergencyContact: {
        number: '911',
        action: 'tel:911',
        label: 'Llamar al 9-1-1'
      }
    },
    privacyNotice: {
      type: 'PRIVACY_COMPLIANCE_NOTICE',
      message: 'En estricto cumplimiento de la Ley General de Salud 42-01 y las normativas de protección de datos, CoPilotRD® NO solicita ni almacena diagnósticos clínicos, recetas ni historiales médicos. Únicamente se registran las adaptaciones físicas necesarias para su traslado.'
    },
    components: [
      {
        type: 'alertBanner',
        style: 'warning',
        text: 'Servicio programado no urgente. Para emergencias de vida o muerte, marque al 9-1-1.'
      },
      {
        type: 'routeSelector',
        originField: { key: 'origin', label: 'Punto de Recogida', defaultAddress: origin },
        destinationField: { key: 'destination', label: 'Centro de Salud o Destino', defaultAddress: destination },
        distanceKm
      },
      {
        type: 'scheduleSelector',
        options: [
          { id: 'SCHEDULED', label: 'Programar para Cita / Terapia (Recomendado)', default: true },
          { id: 'ASAP', label: 'Solicitud Inmediata (Sujeto a disponibilidad de unidad adaptada)' }
        ],
        dateTimeField: { key: 'scheduledDateTime', label: 'Fecha y Hora del Traslado', placeholder: 'Seleccionar fecha y hora' }
      },
      {
        type: 'accessibilityCategorySelector',
        defaultCategory: 'asistido_ambulatorio',
        categories: vehCategories
      },
      {
        type: 'accessibilityOptions',
        companionTraveling: {
          key: 'hasCompanion',
          label: '¿Viaja un familiar o acompañante?',
          description: 'Espacio para 1 acompañante incluido sin ningún cargo adicional.',
          defaultValue: true
        },
        passengerBringsWheelchair: {
          key: 'bringsWheelchair',
          label: '¿El pasajero lleva su propia silla de ruedas o andador?',
          description: 'Permite al conductor despejar el espacio necesario.',
          defaultValue: false
        }
      },
      {
        type: 'accessNotesField',
        key: 'accessNotes',
        label: 'Observaciones de Acceso Físico (Sin datos de salud)',
        placeholder: 'Ej: Edificio cuenta con rampa en la entrada, portón accesible para silla de ruedas.'
      },
      {
        type: 'paymentSelector',
        defaultMethod: 'CARD',
        options: [
          { id: 'CARD', label: 'Tarjeta de Crédito / Débito', subtitle: 'Cobro seguro procesado' },
          { id: 'CASH', label: 'Efectivo en DOP', subtitle: 'Pagas al chofer al finalizar' },
          { id: 'KM_BANK', label: 'Banco de KM (Saldo)', subtitle: 'Canjea saldo acumulado' }
        ]
      },
      {
        type: 'actionButton',
        label: 'Programar Traslado Asistido',
        action: 'schedule_assisted_transfer',
        endpoint: '/api/v1/veh/request',
        method: 'POST'
      }
    ],
    validations: {
      originRequired: true,
      destinationRequired: true,
      noClinicalDataAllowed: true,
      minAdvanceMinutes: 30
    },
    allowedActions: [
      'quote_veh',
      'schedule_transfer',
      'request_immediate',
      'cancel_transfer',
      'track_adapted_vehicle'
    ],
    states: [
      'CONFIGURING',
      'SCHEDULED',
      'DRIVER_DISPATCHED',
      'ARRIVED_AT_PICKUP',
      'BOARDING_ASSISTANCE',
      'IN_TRANSIT',
      'ARRIVED_AT_DESTINATION',
      'COMPLETED'
    ],
    schema: {
      screenId: 'COPILOT_RD_VEH_MEDICAL_TRANSPORT_SDUI',
      vehCategories
    }
  };
}

/**
 * =====================================================================
 * CONTROLADOR PRINCIPAL SDUI: /api/v1/sdui/config
 * =====================================================================
 * Enruta de forma estricta según ?mode=ride, ?mode=package o ?mode=veh.
 * NUNCA devuelve "auth-screen" como fallback.
 * Si el modo no es soportado, responde con HTTP 400 Bad Request explícito.
 */
function handleSduiConfig(req, res) {
  const modeParam = (req.query.mode || req.body?.mode || '').toString().trim().toLowerCase();

  switch (modeParam) {
    case 'ride':
      return res.status(200).json(buildRideSduiConfig(req));

    case 'package':
      return res.status(200).json(buildPackageSduiConfig(req));

    case 'veh':
      return res.status(200).json(buildVehSduiConfig(req));

    default:
      // Rechazo estricto: NUNCA devolver auth-screen como fallback
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_MODE',
        error: `Modalidad '${modeParam || 'vacía'}' no soportada. Debe especificar un parámetro 'mode' válido en la URL (?mode=ride, ?mode=package, ?mode=veh).`,
        supportedModes: [
          {
            mode: 'ride',
            screen: 'ride-planner-screen',
            version: '3.3.0',
            description: 'Transporte de pasajeros urbano e interurbano (Clásico, Estándar, Premium, Elite)'
          },
          {
            mode: 'package',
            screen: 'package-delivery-screen',
            version: '3.3.0',
            description: 'Envíos express y paquetería urbana con código PIN OTP de entrega'
          },
          {
            mode: 'veh',
            screen: 'veh-medical-transport-screen',
            version: '3.3.0',
            description: 'Movilidad asistida y traslados ambulatorios programados no urgentes'
          }
        ]
      });
  }
}

// 1. Rutas de Autenticación SDUI (Intactas)
router.get('/api/v1/sdui/auth', handleSduiAuth);
router.post('/api/v1/sdui/auth', handleSduiAuth);
router.get('/api/sdui/auth', handleSduiAuth);
router.post('/api/sdui/auth', handleSduiAuth);

// 2. Ruta Oficial de Configuración Dinámica SDUI Multi-Modal
router.get('/api/v1/sdui/config', handleSduiConfig);
router.post('/api/v1/sdui/config', handleSduiConfig);
router.all('/api/sdui/config', handleSduiConfig);

// 3. Rutas de conveniencia directa por modalidad
router.all('/api/v1/sdui/ride-planner', (req, res) => {
  req.query.mode = 'ride';
  return handleSduiConfig(req, res);
});
router.all('/api/sdui/ride-planner', (req, res) => {
  req.query.mode = 'ride';
  return handleSduiConfig(req, res);
});
router.all('/api/v1/sdui/package', (req, res) => {
  req.query.mode = 'package';
  return handleSduiConfig(req, res);
});
router.all('/api/v1/sdui/veh', (req, res) => {
  req.query.mode = 'veh';
  return handleSduiConfig(req, res);
});

module.exports = router;
