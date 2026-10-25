import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { CreateEditPlanForm } from './CreateEditPlan';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/PacienteResumenSidebar', () => ({ PacienteResumenSidebar: () => null }));
vi.mock('./Phase4Delivery', () => ({ Phase4Delivery: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async url => ({ data: { data: url.endsWith('/planes/plan-test')
    ? { id: 'plan-test', nombre: 'Menú de prueba', calorias: 1800, proteinasPct: 30, carbohidratosPct: 40, grasasPct: 30, menus: [] }
    : url === '/api/pacientes/paciente-test' ? { nombre: 'Paciente', apellido: 'Prueba' } : [] } }));
  vi.mocked(api.put).mockResolvedValue({ data: { data: { id: 'plan-test' } } });
});
afterEach(cleanup);

describe('Guardar menú fijo', () => {
  it.each([undefined, 'paciente-test'])('mantiene el acceso a guardar fuera del contenedor que se desplaza (paciente: %s)', async pacienteId => {
    const onSaved = vi.fn();
    const { container } = render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <div style={{ transform: 'translateY(0)' }}>
        <CreateEditPlanForm pacienteId={pacienteId} planId="plan-test" onSaved={onSaved} />
      </div>
    </QueryClientProvider></MemoryRouter>);

    const save = await screen.findByRole('button', { name: 'Guardar', exact: true });
    const bar = save.parentElement!;
    expect(bar.parentElement).toBe(document.body);
    expect(container).not.toContainElement(save);
    expect(bar).toHaveClass('fixed', 'bottom-0');
    expect(bar).not.toHaveClass('md:hidden');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('plan-test'));
    expect(api.put).toHaveBeenCalledWith(pacienteId ? `/api/pacientes/${pacienteId}/planes/plan-test` : '/api/planes/plan-test', expect.objectContaining({
      proteinasPct: 30, carbohidratosPct: 40, grasasPct: 30,
    }));
  });
});
