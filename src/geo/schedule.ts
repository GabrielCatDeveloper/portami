// Helpers for schedules and incidents.

import type { Route, Incident } from '@/api/types';

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const FULL_DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function dayName(dow: number, short = true): string {
  return (short ? DAY_NAMES : FULL_DAY_NAMES)[dow] ?? '?';
}

export function dayNames(dows: number[], short = true): string {
  if (dows.length === 7) return 'Todos los días';
  if (dows.length === 5 && [1, 2, 3, 4, 5].every((d) => dows.includes(d))) return 'Lunes a viernes';
  if (dows.length === 2 && dows.includes(0) && dows.includes(6)) return 'Fines de semana';
  return dows.map((d) => dayName(d, short)).join(', ');
}

/** Returns true if `at` falls inside any schedule interval on the route. */
export function isRouteActiveAt(route: Route, at: Date = new Date()): boolean {
  if (!route.schedules || route.schedules.length === 0) return true;
  const dow = at.getDay();
  const hh = at.getHours();
  const mm = at.getMinutes();
  const tNow = hh * 60 + mm;
  return route.schedules.some((s) => {
    if (!s.daysOfWeek.includes(dow)) return false;
    return s.intervals.some((iv) => {
      const [sh, sm] = iv.start.split(':').map(Number);
      const [eh, em] = iv.end.split(':').map(Number);
      const tStart = sh * 60 + sm;
      const tEnd = eh * 60 + em;
      return tNow >= tStart && tNow <= tEnd;
    });
  });
}

export function summarizeSchedule(route: Route): string {
  if (!route.schedules || route.schedules.length === 0) return 'Sin horario definido';
  // If multiple schedules, just say "Ver horarios"
  if (route.schedules.length > 1) return `${route.schedules.length} horarios`;
  const s = route.schedules[0];
  const days = dayNames(s.daysOfWeek);
  const intervals = s.intervals.map((iv) => `${iv.start}–${iv.end}`).join(', ');
  return `${days} · ${intervals}`;
}

/** Format an HH:MM range as "HH:MM–HH:MM". */
export function formatInterval(start: string, end: string): string {
  return `${start}–${end}`;
}

export function isIncidentVisible(i: Incident, now = Date.now()): boolean {
  if (i.resolved) return false;
  if (i.endsAt !== undefined && i.endsAt < now) return false;
  return true;
}

export function incidentIcon(kind: Incident['kind']): string {
  switch (kind) {
    case 'cancellation': return '🚫';
    case 'delay': return '⏱️';
    case 'diversion': return '↪️';
    default: return '⚠️';
  }
}

export function incidentLabel(kind: Incident['kind']): string {
  switch (kind) {
    case 'cancellation': return 'Cancelado';
    case 'delay': return 'Con retraso';
    case 'diversion': return 'Desvío';
    default: return 'Incidencia';
  }
}

void formatInterval;