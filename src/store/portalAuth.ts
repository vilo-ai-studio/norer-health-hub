import { create } from 'zustand';
import Cookies from 'js-cookie';

export interface PortalPaciente {
  id: string;
  nombre: string;
  apellido: string | null;
  nivelMembresia: string;
}

interface PortalAuthState {
  token: string | null;
  paciente: PortalPaciente | null;
  setPortalAuth: (token: string, paciente: PortalPaciente) => void;
  clearPortalAuth: () => void;
}

const getInitialToken = () => Cookies.get('norder_portal_token') || null;
const cookieOptions = () => ({ expires: 30, sameSite: 'Strict' as const, secure: window.location.protocol === 'https:' });

const getInitialPaciente = (): PortalPaciente | null => {
  try {
    const str = Cookies.get('norder_portal_paciente');
    return str ? JSON.parse(str) : null;
  } catch {
    return null;
  }
};

export const usePortalAuthStore = create<PortalAuthState>((set) => ({
  token: getInitialToken(),
  paciente: getInitialPaciente(),
  setPortalAuth: (token, paciente) => {
    Cookies.set('norder_portal_token', token, cookieOptions());
    Cookies.set('norder_portal_paciente', JSON.stringify(paciente), cookieOptions());
    set({ token, paciente });
  },
  clearPortalAuth: () => {
    Cookies.remove('norder_portal_token');
    Cookies.remove('norder_portal_paciente');
    set({ token: null, paciente: null });
  },
}));
