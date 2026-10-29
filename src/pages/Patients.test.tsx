import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Patients from './Patients';
import { usePatients } from '@/hooks/usePatients';

vi.mock('@/hooks/usePatients', () => ({ usePatients: vi.fn() }));
afterEach(cleanup);

describe('errores del directorio', () => {
  it('muestra el error y permite reintentar sin fingir una lista vacía', () => {
    const refetch = vi.fn();
    vi.mocked(usePatients).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch } as unknown as ReturnType<typeof usePatients>);
    render(<MemoryRouter><Patients /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo actualizar');
    expect(screen.queryByText('Sin registros que coincidan')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('mantiene los pacientes en pantalla y avisa si falla una actualización', () => {
    vi.mocked(usePatients).mockReturnValue({ data: [{ id: 'prueba', nombre: 'Paciente', apellido: 'Prueba', valoraciones: [] }],
      isLoading: false, isError: true, refetch: vi.fn() } as unknown as ReturnType<typeof usePatients>);
    render(<MemoryRouter><Patients /></MemoryRouter>);
    expect(screen.getByText('Paciente Prueba')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('pueden no estar al día');
  });
});
