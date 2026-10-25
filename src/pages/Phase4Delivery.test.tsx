import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { Phase4Delivery } from './Phase4Delivery';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value: vi.fn(() => 'blob:plan-preview'),
});

Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value: vi.fn(),
});

describe('Phase4Delivery en el detalle del plan', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).includes('/api/planes/')) {
        return {
          data: {
            data: {
              menus: [{ tipoContenido: 'platillos' }],
              pdfCustomMeta: {},
            },
          },
        } as never;
      }
      return {
        data: {
          data: {
            nombre: 'Paciente',
            apellido: 'Prueba',
            email: 'paciente@example.com',
            telefono: '9990000000',
          },
        },
      } as never;
    });
    vi.mocked(api.post).mockResolvedValue({ data: new Blob(['pdf']) } as never);
  });

  it('actualiza la vista previa con letra grande y guarda ese tamaño al descargar', async () => {
    const onMetaChange = vi.fn();
    render(<Phase4Delivery pacienteId="paciente-1" planId="plan-1" onFinish={vi.fn()} onMetaChange={onMetaChange} />);
    const large = await screen.findByRole('button', { name: 'Letra grande' });
    expect(screen.getByRole('button', { name: 'Estándar' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(large);
    await waitFor(() => expect(onMetaChange).toHaveBeenLastCalledWith(expect.objectContaining({ menuFontSize: 13.5 })));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/api/planes/plan-1/pdf/preview', expect.objectContaining({ menuFontSize: 13.5 }), { responseType: 'blob' }), { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: /descargar oficial pdf/i }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/planes/plan-1/pdf-meta', expect.objectContaining({ menuFontSize: 13.5 })));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/planes/plan-1/pdf', { responseType: 'blob' }));
  });

  it('detiene la descarga si no se pudo guardar la configuración elegida', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(new Error('No disponible'));
    render(<Phase4Delivery pacienteId="paciente-1" planId="plan-1" onFinish={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /descargar oficial pdf/i }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.get).not.toHaveBeenCalledWith('/api/planes/plan-1/pdf', expect.anything());
  });

  it('guarda el tamaño elegido antes de confirmar el envío', async () => {
    render(<Phase4Delivery pacienteId="paciente-1" planId="plan-1" onFinish={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Letra grande' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar y Finalizar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar envío' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/planes/plan-1/enviar', expect.anything()));
    expect(api.put).toHaveBeenCalledWith('/api/planes/plan-1/pdf-meta', expect.objectContaining({ menuFontSize: 13.5 }));
    expect(vi.mocked(api.put).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.post).mock.invocationCallOrder[0]);
  });

  it('muestra configuración, vista previa y envío directo sin finalizar consulta', async () => {
    render(
      <Phase4Delivery
        pacienteId="paciente-1"
        planId="plan-1"
        onFinish={vi.fn()}
        context="plan-detail"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /configurar y enviar pdf/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /descargar oficial pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar al paciente/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /omitir y.*finalizar consulta/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle('PDF Preview')).toBeInTheDocument();
    }, { timeout: 2_000 });
  });
});
