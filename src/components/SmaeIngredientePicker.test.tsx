import { useState } from 'react';
import type { Ingrediente } from '@/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { invalidateSmaeCache, SmaeIngredientePicker } from './SmaeIngredientePicker';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

describe('edición de ingrediente aislada del catálogo SMAE', () => {
  beforeEach(() => { vi.clearAllMocks(); invalidateSmaeCache(); });

  it('modifica la copia del ingrediente y ofrece búsqueda sin crear ni modificar alimentos', async () => {
    const alimento = { id: 'pollo', nombre: 'Pollo', grupo: 'aoaMuyBajo', pesoGramos: 30, unidadBase: 'g', equivalentesBase: 1 };
    vi.mocked(api.get).mockResolvedValue({ data: { data: [alimento] } });
    const onUpdate = vi.fn();
    render(<SmaeIngredientePicker index={0} ingrediente={{
      descripcion: 'Pollo', cantidad: 30, unidad: 'GR', smaeGrPorEq: 30,
      eqCantidad: 1, eqGrupo: 'AOA Muy Bajo', equivalencias: [{ grupo: 'AOA Muy Bajo', cantidad: 1 }],
    }} onUpdate={onUpdate} onRemove={vi.fn()} />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '60' } });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ cantidad: 60, eqCantidad: 2 }));

    fireEvent.change(screen.getByPlaceholderText('Buscar en catálogo SMAE o escribir libre...'), { target: { value: 'Po' } });
    await screen.findByRole('button', { name: /Pollo.*30 g/ });
    expect(screen.queryByText(/Guardar.*en Catálogo SMAE/)).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(alimento.pesoGramos).toBe(30);
  });
});

const foods = [
  { id: 'huevo', nombre: 'Huevo blanco cocido', grupo: 'aoaModerado', pesoGramos: 44, unidadBase: 'g', equivalentesBase: 1, cantidadPorcion: 1, unidadPorcion: 'pieza' },
  { id: 'queso', nombre: 'Queso Oaxaca', grupo: 'aoaModerado', pesoGramos: 30, unidadBase: 'g', equivalentesBase: 1 },
];
function ControlledPicker({ initial, gap = {} }: { initial: Ingrediente; gap?: Record<string, number> }) {
  const [ingredient, setIngredient] = useState(initial);
  return <SmaeIngredientePicker ingrediente={ingredient} index={0} gapByGroup={gap}
    onUpdate={update => setIngredient(previous => ({ ...previous, ...update }))} onRemove={() => {}} />;
}
describe('conversiones reportadas por Eyder', () => {
  beforeEach(() => {
    vi.clearAllMocks(); invalidateSmaeCache();
    vi.mocked(api.get).mockResolvedValue({ data: { data: foods } });
  });
  it.each(['g', 'GR', 'gramos'])('queso guardado en %s: conserva al abrir y convierte 1 / 2 EQ a 30 / 60 g', async unit => {
    render(<ControlledPicker initial={{ descripcion: 'Queso Oaxaca', alimentoSmaeId: 'queso', cantidad: 120, unidad: unit, smaeGrPorEq: 30, eqCantidad: 2, eqGrupo: 'AOA Moderado' }} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('120');
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '1' } });
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('30');
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '2' } });
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('60');
  });
  it('huevo: 1 EQ = 1 pieza, 2 EQ = 2 piezas y 20 piezas no se convierten en gramos', async () => {
    render(<ControlledPicker initial={{ descripcion: 'Huevo blanco cocido', alimentoSmaeId: 'huevo', cantidad: 4, unidad: 'PZA', smaeGrPorEq: 44, eqCantidad: 2, eqGrupo: 'AOA Moderado' }} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('PIEZA'));
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '1' } });
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('1');
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '2' } });
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('2');
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '20' } });
    expect(screen.getAllByPlaceholderText('0')[1]).toHaveValue('20');
    expect(screen.getByRole('combobox')).toHaveValue('PIEZA');
  });
  it.each([['Huevo blanco cocido', 'Hu', '2', 'PIEZA'], ['Queso Oaxaca', 'Que', '60', 'GR']])('seleccionar %s para 2 EQ usa su referencia', async (name, query, amount, unit) => {
    render(<ControlledPicker initial={{ descripcion: '', cantidad: 0, unidad: 'g' }} gap={{ aoaModerado: 2 }} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar en catálogo SMAE o escribir libre...'), { target: { value: query } });
    fireEvent.mouseDown(await screen.findByRole('button', { name: new RegExp(name) }));
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue(amount);
    expect(screen.getByRole('combobox')).toHaveValue(unit);
    expect(screen.getAllByPlaceholderText('0')[1]).toHaveValue('2');
    expect(api.post).not.toHaveBeenCalled(); expect(api.put).not.toHaveBeenCalled();
  });
  it('unidad sin relación: conserva cantidad y EQ y avisa', async () => {
    render(<ControlledPicker initial={{ descripcion: 'Queso Oaxaca', cantidad: 120, unidad: 'bolsa', smaeGrPorEq: 30, eqCantidad: 2, eqGrupo: 'AOA Moderado' }} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '3' } });
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('120');
    expect(screen.getAllByPlaceholderText('0')[1]).toHaveValue('2');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'No se puede convertir esta unidad' }));
  });
});

describe('unidades base y proporciones del catálogo', () => {
  beforeEach(() => { vi.clearAllMocks(); invalidateSmaeCache(); });
  it.each([
    ['ml', 240, 1, undefined, undefined, '480', 'ML'],
    ['pz', 2, 2, undefined, undefined, '2', 'PIEZA'],
    ['serv', 1, 3, undefined, undefined, '0.67', 'SERV'],
    ['paquete', 2, 1, undefined, undefined, '4', 'PAQUETE'],
    ['g', 117, 4, undefined, undefined, '58.5', 'GR'],
    ['g', 30, 1, 60, 'gramos', '60', 'GR'],
    ['g', 100, 1, 0.5, 'taza', '1', 'TAZA'],
  ])('seleccionar referencia %s (%s / %s EQ) y editar EQ usa la relación válida', async (base, amount, equivalents, household, householdUnit, expected, unit) => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [{ id: 'ref', nombre: 'Referencia', grupo: 'verduras', pesoGramos: amount, unidadBase: base, equivalentesBase: equivalents, cantidadPorcion: household, unidadPorcion: householdUnit }] } });
    render(<ControlledPicker initial={{ descripcion: '', cantidad: 0, unidad: 'g' }} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar en catálogo SMAE o escribir libre...'), { target: { value: 'Ref' } });
    fireEvent.mouseDown(await screen.findByRole('button', { name: /Referencia/ }));
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '2' } });
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue(expected);
    expect(screen.getByRole('combobox')).toHaveValue(unit);
  });
});

describe('platillo importado sin coincidencia en catálogo', () => {
  beforeEach(() => {
    vi.clearAllMocks(); invalidateSmaeCache();
    vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
  });
  it('permite editar 5 → 3 EQ y 90 → 120 gramos desde la porción guardada', async () => {
    render(<ControlledPicker initial={{ descripcion: 'Salmón de prueba', cantidad: 150, unidad: 'gr', eqCantidad: 5, equivalencias: [{ grupo: 'AOA Moderado', cantidad: 5 }] }} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '3' } });
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('90');
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '120' } });
    expect(screen.getAllByPlaceholderText('0')[1]).toHaveValue('4');
    expect(api.put).not.toHaveBeenCalled();
  });
});
