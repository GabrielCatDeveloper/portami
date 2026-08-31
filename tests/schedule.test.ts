import { describe, it, expect } from 'vitest';
import {
  isRouteActiveAt,
  summarizeSchedule,
  dayNames,
  isIncidentVisible,
} from '@/geo/schedule';
import type { Route, Incident } from '@/api/types';

const baseRoute: Route = {
  id: 'r1', name: 'Test', stops: [], polyline: [[0, 0]],
  createdBy: 'a', version: 1, active: true,
};

describe('schedule.isRouteActiveAt', () => {
  it('returns true when route has no schedule', () => {
    expect(isRouteActiveAt(baseRoute, new Date('2025-01-01T12:00:00'))).toBe(true);
  });

  it('matches HH:MM interval on the correct day', () => {
    const r: Route = {
      ...baseRoute,
      schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], intervals: [{ start: '08:00', end: '10:00' }] }],
    };
    // 2025-01-06 is a Monday
    expect(isRouteActiveAt(r, new Date('2025-01-06T08:30:00'))).toBe(true);
    expect(isRouteActiveAt(r, new Date('2025-01-06T07:30:00'))).toBe(false);
    expect(isRouteActiveAt(r, new Date('2025-01-06T10:30:00'))).toBe(false);
    // Sunday should be excluded
    expect(isRouteActiveAt(r, new Date('2025-01-05T09:00:00'))).toBe(false);
  });

  it('handles multiple intervals', () => {
    const r: Route = {
      ...baseRoute,
      schedules: [{
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        intervals: [{ start: '07:00', end: '09:30' }, { start: '17:00', end: '20:00' }],
      }],
    };
    expect(isRouteActiveAt(r, new Date('2025-01-06T08:00:00'))).toBe(true);
    expect(isRouteActiveAt(r, new Date('2025-01-06T12:00:00'))).toBe(false);
    expect(isRouteActiveAt(r, new Date('2025-01-06T19:00:00'))).toBe(true);
  });
});

describe('schedule.summarizeSchedule', () => {
  it('says "Sin horario" for empty', () => {
    expect(summarizeSchedule(baseRoute)).toMatch(/sin horario/i);
  });

  it('summarises a single weekday schedule', () => {
    const r: Route = {
      ...baseRoute,
      schedules: [{ daysOfWeek: [1, 2, 3, 4, 5], intervals: [{ start: '08:00', end: '09:00' }] }],
    };
    expect(summarizeSchedule(r)).toMatch(/lunes/i);
    expect(summarizeSchedule(r)).toMatch(/08:00/);
  });
});

describe('schedule.dayNames', () => {
  it('handles all 7 days', () => {
    expect(dayNames([0, 1, 2, 3, 4, 5, 6])).toMatch(/Todos/);
  });
  it('handles weekdays only', () => {
    expect(dayNames([1, 2, 3, 4, 5])).toMatch(/lunes/i);
    expect(dayNames([1, 2, 3, 4, 5])).toMatch(/viernes/i);
  });
  it('handles weekend only', () => {
    expect(dayNames([0, 6])).toMatch(/Fin/);
  });
});

describe('schedule.isIncidentVisible', () => {
  it('hides resolved incidents', () => {
    const i: Incident = {
      id: '1', routeId: 'r1', kind: 'delay', reason: 'x',
      reportedBy: 'a', ts: 0, resolved: true,
    };
    expect(isIncidentVisible(i)).toBe(false);
  });

  it('hides expired incidents', () => {
    const i: Incident = {
      id: '1', routeId: 'r1', kind: 'delay', reason: 'x',
      reportedBy: 'a', ts: 0, resolved: false, endsAt: 1000,
    };
    expect(isIncidentVisible(i, 2000)).toBe(false);
  });

  it('shows active incidents', () => {
    const i: Incident = {
      id: '1', routeId: 'r1', kind: 'delay', reason: 'x',
      reportedBy: 'a', ts: 0, resolved: false,
    };
    expect(isIncidentVisible(i)).toBe(true);
  });
});