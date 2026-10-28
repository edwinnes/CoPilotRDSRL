/**
 * Matriz Oficial de Parámetros de Tarifas NosotrosRD® / CoPilotRD
 * Ubicación: config/pricingMatrix.js
 *
 * Centraliza la estructura de costos, factores de distancia, tiempo,
 * tarifas mínimas, comisiones del socio y recompensas de KM.
 */

const PRICING_MATRIX = {
  currency: 'DOP',
  currencySymbol: 'RD$',
  pointsPerDOP: 50,       // 1 punto de Banco de KM por cada 50 DOP facturados
  roundingFactor: 10,     // Redondeo comercial dominicano a múltiplos de 10 DOP

  // Tarifas Base por Categoría de Servicio
  categories: {
    moto: {
      id: 'moto',
      name: 'Motor',
      vehicleType: 'MOTORCYCLE',
      tagline: 'Rápido, Económico y Ágil',
      description: 'Traslado ágil en motocicleta urbana con casco protector verificado.',
      seats: 1,
      baseFare: 80,
      kmRate: 18,
      minuteRate: 2.5,
      minFare: 100,
      cancellationFee: 50,
      driverCommission: 0.05,
      badge: 'Más Rápido en Tráfico 🛵',
      badgeColor: '#F59E0B',
      iconName: 'bike'
    },
    clasico: {
      id: 'clasico',
      name: 'Clásico',
      vehicleType: 'COMPACT_SEDAN',
      tagline: 'Económico y Confiable',
      description: 'Sedán compacto con A/C verificado. Ideal para trayectos diarios.',
      seats: 4,
      baseFare: 120,        // Banderazo / Tarifa base de arranque (DOP)
      kmRate: 28,           // Costo por kilómetro recorrido (DOP/km)
      minuteRate: 4,        // Costo por minuto de viaje (DOP/min)
      minFare: 150,         // Tarifa mínima garantizada al chófer (DOP)
      cancellationFee: 80,  // Tarifa por cancelación tardía (>5 min)
      driverCommission: 0.05, // 5% Comisión Socio Semilla
      badge: 'Socio Semilla 5%',
      badgeColor: '#10B981',
      iconName: 'car-compact'
    },
    estandar: {
      id: 'estandar',
      name: 'Estándar',
      vehicleType: 'SEDAN_COMFORT',
      tagline: 'El más solicitado en Santo Domingo',
      description: 'Sedán espacioso (Corolla / Civic / Elantra) con maletero amplio.',
      seats: 4,
      baseFare: 160,        // Banderazo (DOP)
      kmRate: 36,           // Costo por kilómetro (DOP/km)
      minuteRate: 5,        // Costo por minuto (DOP/min)
      minFare: 200,         // Tarifa mínima (DOP)
      cancellationFee: 100,
      driverCommission: 0.05,
      badge: 'Más Popular ⭐',
      badgeColor: '#00E5FF',
      iconName: 'car-sedan'
    },
    premium: {
      id: 'premium',
      name: 'Premium',
      vehicleType: 'SUV_EXECUTIVE',
      tagline: 'Confort Superior y Espacio',
      description: 'SUV ejecutiva (CR-V, RAV4, Tucson) con chófer de calificación 4.9+.',
      seats: 4,
      baseFare: 250,        // Banderazo (DOP)
      kmRate: 52,           // Costo por kilómetro (DOP/km)
      minuteRate: 7,        // Costo por minuto (DOP/min)
      minFare: 300,         // Tarifa mínima (DOP)
      cancellationFee: 150,
      driverCommission: 0.08,
      badge: 'Confort Superior',
      badgeColor: '#8B5CF6',
      iconName: 'suv'
    },
    elite: {
      id: 'elite',
      name: 'Elite',
      vehicleType: 'LUXURY_SUV',
      tagline: 'Máxima Exclusividad y Capacidad',
      description: 'SUV de lujo de 3 filas (Tahoe, Prado, Explorer) con chófer bilingüe.',
      seats: 6,
      baseFare: 420,        // Banderazo (DOP)
      kmRate: 80,           // Costo por kilómetro (DOP/km)
      minuteRate: 10,       // Costo por minuto (DOP/min)
      minFare: 500,         // Tarifa mínima (DOP)
      cancellationFee: 250,
      driverCommission: 0.10,
      badge: 'VIP Exclusivo 💎',
      badgeColor: '#F59E0B',
      iconName: 'car-luxury'
    },
    package: {
      id: 'package',
      name: 'Envío Paquetería',
      vehicleType: 'MOTOR_COURIER',
      tagline: 'Entrega Segura con Código OTP',
      description: 'Envío express de paquetes, sobres y encomiendas con código de seguridad OTP.',
      seats: 1,
      baseFare: 100,
      kmRate: 22,
      minuteRate: 3,
      minFare: 130,
      cancellationFee: 60,
      driverCommission: 0.05,
      badge: 'Envío Seguro OTP 📦',
      badgeColor: '#10B981',
      iconName: 'package'
    },
    veh: {
      id: 'veh',
      name: 'Transporte Asistido VEH',
      vehicleType: 'ASSISTED_VEHICLE',
      tagline: 'Traslado No Urgente Asistido',
      description: 'Unidad adaptada con rampa/espacio para silla de ruedas y acompañante. No para emergencias agudas (llame al 9-1-1).',
      seats: 2,
      baseFare: 350,
      kmRate: 45,
      minuteRate: 6,
      minFare: 400,
      cancellationFee: 200,
      driverCommission: 0.05,
      badge: 'Transporte Asistido ♿',
      badgeColor: '#00E5FF',
      iconName: 'accessibility'
    }
  },

  // Multiplicadores Geográficos por Ciudad / Polo Turístico
  cityMultipliers: {
    'santo-domingo': 1.0,
    'santiago': 0.95,
    'punta-cana': 1.25,
    'la-romana': 1.10
  },

  // Función Central de Cotización
  calculateCategoryPrice(categoryId, distanceKm = 0, durationMinutes = 0, surgeMultiplier = 1.0, cityId = 'santo-domingo') {
    const cat = this.categories[categoryId] || this.categories.estandar;
    const cityMult = this.cityMultipliers[cityId] || 1.0;
    const dist = parseFloat(distanceKm) || 0;
    const time = parseFloat(durationMinutes) || 0;
    const surge = parseFloat(surgeMultiplier) || 1.0;

    const raw = (cat.baseFare + (dist * cat.kmRate) + (time * cat.minuteRate)) * surge * cityMult;
    const finalPrice = Math.max(cat.minFare, Math.round(raw / this.roundingFactor) * this.roundingFactor);

    // Regla Oficial NosotrosRD: 1 KM de banco por cada 10 KM recorridos/acumulados
    const kmEarned = parseFloat((dist / 10).toFixed(2));

    return {
      priceDOP: finalPrice,
      kmBankPointsEarned: kmEarned > 0 ? kmEarned : 0.5,
      breakdown: {
        baseFare: cat.baseFare,
        kmRate: cat.kmRate,
        minuteRate: cat.minuteRate,
        distanceFare: Math.round(dist * cat.kmRate),
        timeFare: Math.round(time * cat.minuteRate),
        surgeMultiplier: surge,
        cityMultiplier: cityMult,
        minFareApplied: finalPrice === cat.minFare
      }
    };
  }
};

module.exports = PRICING_MATRIX;
