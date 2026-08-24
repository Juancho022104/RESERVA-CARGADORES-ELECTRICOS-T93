/**
 * SISTEMA DE RESERVA DE CARGADORES ELÉCTRICOS — Edificio (40 apartamentos)
 * Backend Google Apps Script — hoja de cálculo como base de datos.
 *
 * Hoja "Reservas" (se crea sola si no existe), columnas:
 * [ID_Reserva, Timestamp, Fecha, Bloque, Punto, Apartamento, Correo, Estado]
 */

// ───────────────────────────── CONFIGURACIÓN ─────────────────────────────

const SHEET_NAME = 'Reservas';

const CONFIG = {
  ADVANCE_WINDOW_HOURS: 48,          // ventana máxima de antelación
  PEAK_WEEKLY_LIMIT: 2,              // cupo semanal en bloques D/E
  ADMIN_EMAIL: 'administracion@tuedificio.com', // ← cambia por el correo real de celaduría/admin
  TIMEZONE: 'America/Bogota',
};

// Los bloques están ordenados cronológicamente; el índice se usa para
// detectar bloques "consecutivos" el mismo día (A-B, B-C, C-D, D-E).
const BLOCKS = [
  { id: 'A', label: 'Bloque A', horario: '05:00 a.m. – 09:00 a.m.', startHour: 5, startMin: 0, endHour: 9, endMin: 0, peak: false },
  { id: 'B', label: 'Bloque B', horario: '09:30 a.m. – 01:30 p.m.', startHour: 9, startMin: 30, endHour: 13, endMin: 30, peak: false },
  { id: 'C', label: 'Bloque C', horario: '02:00 p.m. – 06:00 p.m.', startHour: 14, startMin: 0, endHour: 18, endMin: 0, peak: false },
  { id: 'D', label: 'Bloque D', horario: '06:30 p.m. – 10:30 p.m.', startHour: 18, startMin: 30, endHour: 22, endMin: 30, peak: true },
  { id: 'E', label: 'Bloque E', horario: '11:00 p.m. – 04:30 a.m.', startHour: 23, startMin: 0, endHour: 4, endMin: 30, peak: true },
];

const POINTS = [
  { id: 'P1', label: 'Punto 1', desc: 'Conector Tipo 2 (Carga Semirrápida / Rápida)', icon: 'zap' },
  { id: 'P2', label: 'Punto 2', desc: 'Toma NEMA (Carga Lenta)', icon: 'plug' },
];

const COLS = {
  ID: 1, TIMESTAMP: 2, FECHA: 3, BLOQUE: 4, PUNTO: 5, APTO: 6, CORREO: 7, ESTADO: 8,
};

// ───────────────────────────── WEB APP ENTRY ─────────────────────────────

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  return template
    .evaluate()
    .setTitle('Reserva de Cargadores Eléctricos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ───────────────────────────── DATOS DE APOYO ─────────────────────────────

function getBootstrapData() {
  return {
    blocks: BLOCKS.map(b => ({ id: b.id, label: b.label, horario: b.horario, peak: b.peak })),
    points: POINTS,
    advanceWindowHours: CONFIG.ADVANCE_WINDOW_HOURS,
    peakWeeklyLimit: CONFIG.PEAK_WEEKLY_LIMIT,
  };
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['ID_Reserva', 'Timestamp', 'Fecha', 'Bloque', 'Punto', 'Apartamento', 'Correo', 'Estado']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Lee todas las filas activas (no canceladas) como objetos simples. */
function readReservations_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  return values
    .map((row, idx) => ({
      rowIndex: idx + 2,
      id: row[COLS.ID - 1],
      timestamp: row[COLS.TIMESTAMP - 1],
      fecha: formatDate_(row[COLS.FECHA - 1]),
      bloque: row[COLS.BLOQUE - 1],
      punto: row[COLS.PUNTO - 1],
      apto: row[COLS.APTO - 1],
      correo: row[COLS.CORREO - 1],
      estado: row[COLS.ESTADO - 1],
    }))
    .filter(r => r.estado !== 'Cancelada');
}

function formatDate_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  return String(value);
}

/**
 * Devuelve la disponibilidad de todos los bloques/puntos para una fecha dada.
 * Estructura: { "A_P1": { ocupado: bool, apto: "..." (opcional) }, ... }
 */
function getAvailability(fechaStr) {
  const reservations = readReservations_().filter(r => r.fecha === fechaStr);
  const map = {};
  BLOCKS.forEach(b => {
    POINTS.forEach(p => {
      const key = b.id + '_' + p.id;
      const found = reservations.find(r => r.bloque === b.id && r.punto === p.id);
      map[key] = found ? { ocupado: true } : { ocupado: false };
    });
  });
  return map;
}

// ───────────────────────────── REGLAS DE NEGOCIO ─────────────────────────────

function getBlockById_(blockId) {
  return BLOCKS.find(b => b.id === blockId);
}

/** Fecha/hora real de inicio del bloque para la fecha indicada (yyyy-MM-dd). */
function getBlockStartDate_(fechaStr, blockId) {
  const block = getBlockById_(blockId);
  const [y, m, d] = fechaStr.split('-').map(Number);
  return new Date(y, m - 1, d, block.startHour, block.startMin, 0);
}

/** Lunes 00:00 de la semana ISO que contiene fechaStr. */
function getWeekStart_(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0=domingo
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function validateAdvanceWindow_(fechaStr, blockId) {
  const start = getBlockStartDate_(fechaStr, blockId);
  const now = new Date();
  const diffHours = (start.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (diffHours < 0) {
    return { ok: false, message: 'Ese bloque ya pasó. Elige una fecha u horario futuro.' };
  }
  if (diffHours > CONFIG.ADVANCE_WINDOW_HOURS) {
    return {
      ok: false,
      message: `Solo puedes reservar con un máximo de ${CONFIG.ADVANCE_WINDOW_HOURS} horas de anticipación respecto al bloque elegido.`,
    };
  }
  return { ok: true };
}

function validatePeakQuota_(apto, fechaStr, blockId, allReservations) {
  const block = getBlockById_(blockId);
  if (!block.peak) return { ok: true };

  const weekStart = getWeekStart_(fechaStr);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const peakCountThisWeek = allReservations.filter(r => {
    if (r.apto !== apto) return false;
    if (r.bloque !== 'D' && r.bloque !== 'E') return false;
    const [y, m, d] = r.fecha.split('-').map(Number);
    const rDate = new Date(y, m - 1, d);
    return rDate >= weekStart && rDate < weekEnd;
  }).length;

  if (peakCountThisWeek >= CONFIG.PEAK_WEEKLY_LIMIT) {
    return {
      ok: false,
      message: `Tu apartamento ya tiene ${peakCountThisWeek} reservas esta semana en bloques de alta demanda (D/E). ` +
        `El límite es ${CONFIG.PEAK_WEEKLY_LIMIT} por semana para garantizar equidad entre vecinos.`,
    };
  }
  return { ok: true };
}

function validateNoConsecutiveBlocks_(apto, fechaStr, blockId, allReservations) {
  const idx = BLOCKS.findIndex(b => b.id === blockId);
  const sameDayBlocks = allReservations
    .filter(r => r.apto === apto && r.fecha === fechaStr)
    .map(r => BLOCKS.findIndex(b => b.id === r.bloque));

  const isConsecutive = sameDayBlocks.some(otherIdx => Math.abs(otherIdx - idx) === 1);
  if (isConsecutive) {
    return {
      ok: false,
      message: 'No puedes reservar dos bloques horarios seguidos el mismo día. Elige un bloque no consecutivo.',
    };
  }
  return { ok: true };
}

function validateSlotFree_(fechaStr, blockId, pointId, allReservations) {
  const taken = allReservations.some(r => r.fecha === fechaStr && r.bloque === blockId && r.punto === pointId);
  if (taken) {
    return { ok: false, message: 'Justo acaban de reservar este cupo. Elige otro bloque o punto disponible.' };
  }
  return { ok: true };
}

// ───────────────────────────── CREAR RESERVA ─────────────────────────────

/**
 * data = { fecha: 'yyyy-MM-dd', bloque: 'A'..'E', punto: 'P1'|'P2', apto: '301', correo: 'a@b.com' }
 */
function createReservation(data) {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(10000);
  if (!gotLock) {
    return { ok: false, message: 'El sistema está ocupado procesando otra reserva. Intenta de nuevo en unos segundos.' };
  }

  try {
    const fecha = String(data.fecha || '').trim();
    const bloque = String(data.bloque || '').trim();
    const punto = String(data.punto || '').trim();
    const apto = String(data.apto || '').trim();
    const correo = String(data.correo || '').trim();

    if (!fecha || !bloque || !punto || !apto || !correo) {
      return { ok: false, message: 'Faltan datos obligatorios para completar la reserva.' };
    }
    if (!getBlockById_(bloque)) {
      return { ok: false, message: 'Bloque horario inválido.' };
    }
    if (!POINTS.find(p => p.id === punto)) {
      return { ok: false, message: 'Punto de carga inválido.' };
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(correo)) {
      return { ok: false, message: 'El correo electrónico no es válido.' };
    }

    // Re-lee todo dentro del lock para evitar condiciones de carrera.
    const allReservations = readReservations_();

    const advanceCheck = validateAdvanceWindow_(fecha, bloque);
    if (!advanceCheck.ok) return advanceCheck;

    const slotCheck = validateSlotFree_(fecha, bloque, punto, allReservations);
    if (!slotCheck.ok) return slotCheck;

    const peakCheck = validatePeakQuota_(apto, fecha, bloque, allReservations);
    if (!peakCheck.ok) return peakCheck;

    const consecutiveCheck = validateNoConsecutiveBlocks_(apto, fecha, bloque, allReservations);
    if (!consecutiveCheck.ok) return consecutiveCheck;

    // Doble verificación final justo antes de escribir (anti-fantasmas).
    const finalCheck = validateSlotFree_(fecha, bloque, punto, readReservations_());
    if (!finalCheck.ok) return finalCheck;

    const id = 'RES-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    const timestamp = new Date();
    const sheet = getSheet_();
    sheet.appendRow([id, timestamp, fecha, bloque, punto, apto, correo, 'Confirmada']);
    SpreadsheetApp.flush();

    sendConfirmationEmails_({ id, fecha, bloque, punto, apto, correo });

    return {
      ok: true,
      message: 'Reserva confirmada con éxito.',
      reserva: { id, fecha, bloque, punto, apto },
    };
  } catch (err) {
    return { ok: false, message: 'Ocurrió un error inesperado: ' + err.message };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── NOTIFICACIONES ─────────────────────────────

function sendConfirmationEmails_(r) {
  const block = getBlockById_(r.bloque);
  const point = POINTS.find(p => p.id === r.punto);

  const subjectResidente = `✅ Reserva confirmada — ${block.label} · ${point.label} · ${r.fecha}`;
  const bodyResidente =
    `Hola,\n\n` +
    `Tu reserva del cargador eléctrico ha sido confirmada:\n\n` +
    `  • ID de reserva: ${r.id}\n` +
    `  • Fecha: ${r.fecha}\n` +
    `  • Bloque horario: ${block.label} (${block.horario})\n` +
    `  • Punto de carga: ${point.label} — ${point.desc}\n` +
    `  • Apartamento: ${r.apto}\n\n` +
    `Recuerda llegar a tiempo y liberar el punto de carga al finalizar tu bloque.\n\n` +
    `Este es un mensaje automático del sistema de reserva de cargadores.`;

  try {
    MailApp.sendEmail(r.correo, subjectResidente, bodyResidente);
  } catch (e) {
    // No se detiene la reserva si el envío de correo falla.
  }

  const subjectAdmin = `🔐 Control de acceso — Cargador reservado (Apto ${r.apto})`;
  const bodyAdmin =
    `Nueva reserva registrada para control de acceso al parqueadero:\n\n` +
    `  • ID de reserva: ${r.id}\n` +
    `  • Apartamento: ${r.apto}\n` +
    `  • Correo del residente: ${r.correo}\n` +
    `  • Fecha: ${r.fecha}\n` +
    `  • Bloque horario: ${block.label} (${block.horario})\n` +
    `  • Punto de carga: ${point.label}\n`;

  try {
    if (CONFIG.ADMIN_EMAIL) {
      MailApp.sendEmail(CONFIG.ADMIN_EMAIL, subjectAdmin, bodyAdmin);
    }
  } catch (e) {
    // No se detiene la reserva si el envío de correo falla.
  }
}
