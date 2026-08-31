// Store for the user's stop alerts (read from IndexedDB).
import { create } from 'zustand';
import type { StopAlert } from '@/storage/stopAlerts';

type State = {
  alerts: StopAlert[];
  setAlerts: (next: StopAlert[] | ((cur: StopAlert[]) => StopAlert[])) => void;
};

export const useStopAlertStore = create<State>((set) => ({
  alerts: [],
  setAlerts: (next) =>
    set((s) => ({
      alerts: typeof next === 'function' ? (next as (cur: StopAlert[]) => StopAlert[])(s.alerts) : next,
    })),
}));