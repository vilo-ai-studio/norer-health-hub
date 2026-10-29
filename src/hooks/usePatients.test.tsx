import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AxiosError, CanceledError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { usePatients } from './usePatients';

const originalAdapter = api.defaults.adapter;
let client: QueryClient;
const paciente = { id: 'prueba', nombre: 'Paciente', apellido: 'Prueba', valoraciones: [], planes: [] };
const success: AxiosAdapter = async config => ({ data: { success: true, data: [paciente] }, status: 200, statusText: 'OK', headers: {}, config });
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  api.defaults.adapter = originalAdapter;
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('carga resumida de pacientes', () => {
  it('pide el resumen con búsqueda codificada y permite cancelar al salir', async () => {
    const adapter = vi.fn(success);
    api.defaults.adapter = adapter;
    const { result, unmount } = renderHook(() => usePatients('María & José'), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.data).toEqual([paciente]);
    const config = adapter.mock.calls[0][0];
    expect(config.url).toBe('/api/pacientes?resumen=true&buscar=Mar%C3%ADa%20%26%20Jos%C3%A9');
    expect(config.skipRetry).toBe(true);
    expect(config.signal).toBeDefined();
    unmount();
  });

  it('limita un fallo de conexión a dos intentos, sin multiplicar reintentos de Axios', async () => {
    const adapter = vi.fn<AxiosAdapter>(config => new Promise((_, reject) => {
      setTimeout(() => reject(new AxiosError('timeout de prueba', 'ECONNABORTED', config)), config.timeout);
    }));
    api.defaults.adapter = adapter;
    const { result } = renderHook(() => usePatients(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(61_001); });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('no reintenta errores 4xx ni cancelaciones', async () => {
    for (const canceled of [false, true]) {
      const adapter = vi.fn<AxiosAdapter>(async config => {
        if (canceled) throw new CanceledError('cancelación de prueba');
        throw new AxiosError('sin permiso', 'ERR_BAD_REQUEST', config, undefined,
          { data: {}, status: 403, statusText: 'Forbidden', headers: {}, config });
      });
      api.defaults.adapter = adapter;
      const { result, unmount } = renderHook(() => usePatients(String(canceled)), { wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(2_001); });
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(result.current.isError).toBe(true);
      unmount();
    }
  });

  it('aborta una búsqueda que deja de usarse sin reintentarla', async () => {
    let signal: AbortSignal | undefined;
    const adapter = vi.fn<AxiosAdapter>(config => new Promise((_, reject) => {
      signal = config.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new CanceledError('cancelación de prueba')));
    }));
    api.defaults.adapter = adapter;
    const { unmount } = renderHook(() => usePatients('búsqueda anterior'), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(signal?.aborted).toBe(true);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('comparte la consulta, conserva datos si falla el refresco y respeta el minuto de frescura', async () => {
    const adapter = vi.fn(success);
    api.defaults.adapter = adapter;
    const first = renderHook(() => usePatients(), { wrapper });
    const second = renderHook(() => usePatients(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(adapter).toHaveBeenCalledTimes(1);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    api.defaults.adapter = async config => { throw new AxiosError('sin permiso', 'ERR_BAD_REQUEST', config, undefined,
      { data: {}, status: 403, statusText: 'Forbidden', headers: {}, config }); };
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.pacientes.all });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(first.result.current.isError).toBe(true);
    expect(first.result.current.data).toEqual([paciente]);
    expect(second.result.current.data).toEqual([paciente]);
  });
});
