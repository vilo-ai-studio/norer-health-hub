import { useState } from 'react';
import { Plus, Search, Utensils, Trash2, Save, X, Edit2, ChevronLeft, Check, ChevronsUpDown, ChevronDown, Copy } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateAfterPlatilloChange } from '@/lib/invalidation';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import SmaeIngredientePicker from '@/components/SmaeIngredientePicker';
import type { Platillo, Ingrediente } from '@/types';

const DEFAULT_CATEGORIAS = ['DESAYUNO', 'COLACIÓN', 'ALMUERZO', 'CENA', 'PRE-ENTRENO', 'POST-ENTRENO', 'OTROS'];

const Platillos = () => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [currentPlatillo, setCurrentPlatillo] = useState<Partial<Platillo> | null>(null);
  const [previewPlatillo, setPreviewPlatillo] = useState<Platillo | null>(null);

  const { data: platillos = [], isLoading: loading } = useQuery({
    queryKey: queryKeys.platillos.all(),
    queryFn: async () => {
      const { data } = await api.get('/api/platillos');
      return (data?.data || []) as Platillo[];
    },
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const handleCreate = () => {
    setCurrentPlatillo({
      nombre: '',
      categoria: '',
      ingredientes: []
    });
    setIsEditing(true);
  };

  const handleEdit = (p: Platillo) => {
    setCurrentPlatillo({ 
      ...p,
      ingredientes: (p.ingredientes || []).map(i => ({ ...i, id: i.id || Math.random().toString(36).substr(2, 9) }))
    });
    setIsEditing(true);
  };

  const handleDuplicate = (p: Platillo) => {
    setCurrentPlatillo({
      ...p,
      id: undefined, // Quitamos el ID para que se guarde como nuevo
      nombre: p.nombre + ' (Copia)',
      ingredientes: (p.ingredientes || []).map(i => ({ ...i, id: Math.random().toString(36).substr(2, 9) }))
    });
    setIsEditing(true);
    setPreviewPlatillo(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este platillo?')) return;
    try {
      await api.delete(`/api/platillos/${id}`);
      invalidateAfterPlatilloChange(queryClient);
      toast({ title: 'Eliminado', description: 'Platillo eliminado correctamente' });
    } catch (err) {
      toast({ title: 'Error', description: 'No se pudo eliminar el platillo', variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    if (!currentPlatillo?.nombre || !currentPlatillo?.categoria) {
      toast({ title: 'Error', description: 'Nombre y categoría son requeridos', variant: 'destructive' });
      return;
    }

    try {
      if (currentPlatillo.id) {
        await api.put(`/api/platillos/${currentPlatillo.id}`, currentPlatillo);
        toast({ title: 'Actualizado', description: 'Platillo actualizado correctamente' });
      } else {
        await api.post('/api/platillos', currentPlatillo);
        toast({ title: 'Creado', description: 'Platillo creado correctamente' });
      }
      setIsEditing(false);
      setCurrentPlatillo(null);
      invalidateAfterPlatilloChange(queryClient);
    } catch (err: any) {
      const duplicado = err?.response?.status === 409;
      toast({
        title: duplicado ? 'Ya existe' : 'Error',
        description: err?.response?.data?.error || 'No se pudo guardar el platillo',
        variant: 'destructive',
      });
    }
  };

  const addIngrediente = () => {
    if (!currentPlatillo) return;
    const newIng: Ingrediente = {
      id: Math.random().toString(36).substr(2, 9),
      descripcion: '',
      cantidad: 0,
      unidad: 'GR',
      orden: (currentPlatillo.ingredientes?.length || 0) + 1
    };
    setCurrentPlatillo({
      ...currentPlatillo,
      ingredientes: [...(currentPlatillo.ingredientes || []), newIng]
    });
  };

  const updateIngrediente = (idx: number, updates: Partial<Ingrediente>) => {
    if (!currentPlatillo?.ingredientes) return;
    const newIngs = [...currentPlatillo.ingredientes];
    newIngs[idx] = { ...newIngs[idx], ...updates };
    setCurrentPlatillo({ ...currentPlatillo, ingredientes: newIngs });
  };

  const removeIngrediente = (idx: number) => {
    if (!currentPlatillo?.ingredientes) return;
    const newIngs = currentPlatillo.ingredientes.filter((_, i) => i !== idx);
    setCurrentPlatillo({ ...currentPlatillo, ingredientes: newIngs });
  };

  const filtered = platillos.filter(p => {
    const matchSearch = p.nombre.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === '' || p.categoria.toUpperCase() === categoryFilter.toUpperCase();
    return matchSearch && matchCategory;
  });

  // Obtener todas las categorías únicas para sugerencias
  const suggestedCategories = Array.from(new Set([
    ...DEFAULT_CATEGORIAS,
    ...platillos.map(p => p.categoria.toUpperCase())
  ])).sort().filter(c => c !== '');

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Biblioteca de Platillos</h1>
          <p className="text-text-muted text-sm">Gestiona tus preparaciones y recetas para reutilizarlas en los planes.</p>
        </div>
        {!isEditing && (
          <Button onClick={handleCreate} className="bg-brand-primary text-black hover:bg-brand-primary/90 font-bold px-6">
            <Plus className="w-4 h-4 mr-2" /> NUEVO PLATILLO
          </Button>
        )}
      </div>

      {!isEditing ? (
        <>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <Input 
                placeholder="Buscar por nombre..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-bg-surface border-border-subtle"
              />
            </div>
            
            <div className="relative w-full sm:w-auto">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full sm:w-[240px] h-10 bg-bg-surface border border-border-subtle text-text-primary text-[11px] font-black uppercase tracking-widest rounded-md pl-4 pr-10 outline-none focus:border-brand-primary appearance-none transition-colors hover:border-text-muted"
              >
                <option value="">TODAS LAS CATEGORÍAS</option>
                {suggestedCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <div className="absolute right-0 top-0 bottom-0 flex items-center justify-center w-10 pointer-events-none border-l border-border-subtle/50">
                <ChevronDown className="w-4 h-4 text-text-muted" />
              </div>
            </div>
          </div>

          {/* Grouped Tables */}
          {suggestedCategories.map(cat => {
            const catPlatillos = filtered.filter(p => p.categoria.toUpperCase() === cat);
            if (catPlatillos.length === 0) return null;

            return (
              <div key={cat} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-1 bg-brand-primary rounded-full" />
                  <h2 className="text-sm font-black text-text-primary uppercase tracking-[0.2em]">{cat}</h2>
                  <span className="text-[10px] font-bold text-text-muted bg-bg-surface px-2 py-0.5 rounded-full border border-border-subtle">
                    {catPlatillos.length}
                  </span>
                </div>

                <div className="bg-bg-surface border border-border-subtle rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-bg-base/50 border-b border-border-subtle">
                          <th className="px-6 py-4 text-[10px] font-black text-text-muted uppercase tracking-widest">Nombre del Platillo</th>
                          <th className="px-6 py-4 text-[10px] font-black text-text-muted uppercase tracking-widest">Ingredientes</th>
                          <th className="px-6 py-4 text-[10px] font-black text-text-muted uppercase tracking-widest">Macros Est.</th>
                          <th className="px-6 py-4 text-[10px] font-black text-text-muted uppercase tracking-widest text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle/50">
                        {catPlatillos.map(p => (
                          <tr key={p.id} onClick={() => setPreviewPlatillo(p)} className="hover:bg-bg-base/30 transition-colors group cursor-pointer">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center">
                                  <Utensils className="w-4 h-4 text-brand-primary" />
                                </div>
                                <span className="font-bold text-text-primary text-sm">{p.nombre}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {p.ingredientes?.slice(0, 3).map((ing, i) => (
                                  <span key={i} className="text-[10px] bg-bg-base border border-border-subtle px-1.5 py-0.5 rounded text-text-muted truncate">
                                    {ing.descripcion}
                                  </span>
                                ))}
                                {(p.ingredientes?.length || 0) > 3 && (
                                  <span className="text-[10px] text-text-muted font-bold">
                                    +{ (p.ingredientes?.length || 0) - 3} más
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                               <span className="text-xs font-medium text-text-muted">
                                 {p.ingredientes?.length || 0} items
                               </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-end gap-2">
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={(e) => { e.stopPropagation(); handleDuplicate(p); }}
                                  className="h-8 w-8 p-0 text-[#90c2ff] hover:bg-[#90c2ff]/10"
                                  title="Duplicar Platillo"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={(e) => { e.stopPropagation(); handleEdit(p); }}
                                  className="h-8 w-8 p-0"
                                  title="Editar"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                                  className="h-8 w-8 p-0 text-accent-red hover:bg-accent-red/10"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}
          
          {filtered.length === 0 && !loading && (
            <div className="text-center py-24 border-2 border-dashed border-border-subtle rounded-2xl bg-bg-surface/30">
              <div className="w-20 h-20 bg-bg-surface rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl border border-border-subtle">
                <Utensils className="w-10 h-10 text-border-default" />
              </div>
              <h3 className="text-lg font-bold text-text-primary mb-2">No hay platillos</h3>
              <p className="text-text-muted max-w-xs mx-auto text-sm">Empieza por crear preparaciones comunes como "Omelet de claras" o "Batido de proteína".</p>
              <Button onClick={handleCreate} variant="outline" className="mt-8 border-border-subtle hover:bg-bg-surface">
                 Crear primer platillo
              </Button>
            </div>
          )}

          {loading && (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1,2,3].map(i => (
                  <div key={i} className="h-32 bg-bg-surface animate-pulse rounded-xl border border-border-subtle" />
                ))}
             </div>
          )}
        </>
      ) : (
        <Card className="p-0 bg-bg-surface border-border-subtle max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 shadow-2xl overflow-visible">
          <div className="sticky top-0 z-10 p-6 md:p-8 flex items-center justify-between bg-bg-surface border-b border-border-subtle rounded-t-[inherit]">
            <div className="flex items-center gap-4">
               <button 
                onClick={() => setIsEditing(false)}
                className="p-2 hover:bg-bg-base rounded-full text-text-muted transition-colors"
               >
                 <ChevronLeft className="w-5 h-5" />
               </button>
               <div>
                 <h2 className="text-xl font-bold text-text-primary">
                   {currentPlatillo?.id ? 'Editar Platillo' : 'Nuevo Platillo'}
                 </h2>
                 <p className="text-xs text-text-muted uppercase font-bold tracking-wider mt-1">Biblioteca de alimentos</p>
               </div>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setIsEditing(false)} className="px-6">Cancelar</Button>
              <Button onClick={handleSave} className="bg-brand-primary text-black hover:bg-brand-primary/90 font-black px-8">
                <Save className="w-4 h-4 mr-2" /> GUARDAR
              </Button>
            </div>
          </div>

          <div className="p-6 md:p-8 space-y-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-text-muted uppercase tracking-[0.2em] block">Nombre del Platillo</label>
                <Input 
                  value={currentPlatillo?.nombre} 
                  onChange={(e) => setCurrentPlatillo({ ...currentPlatillo, nombre: e.target.value })}
                  placeholder="Ej. Omelet con Espinacas y Queso"
                  className="text-lg font-bold bg-bg-base border-border-subtle focus:border-brand-primary h-12"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-text-muted uppercase tracking-[0.2em] block">Categoría del Platillo</label>
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={popoverOpen}
                      className="w-full h-12 justify-between bg-bg-base border-border-subtle focus:border-brand-primary font-bold uppercase"
                    >
                      {currentPlatillo?.categoria
                        ? suggestedCategories.find((c) => c === currentPlatillo.categoria) || currentPlatillo.categoria
                        : "Seleccionar categoría..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0 bg-[#0a0a0a] border-[#333]">
                    <Command className="bg-transparent">
                      <CommandInput 
                        placeholder="Buscar o crear categoría..." 
                        value={newCatInput}
                        onValueChange={setNewCatInput}
                      />
                      <CommandList className="max-h-[300px]">
                        <CommandEmpty className="p-2">
                          <Button 
                            variant="ghost" 
                            className="w-full justify-start text-brand-primary hover:bg-brand-primary/10"
                            onClick={() => {
                              if (newCatInput) {
                                setCurrentPlatillo({ ...currentPlatillo, categoria: newCatInput.toUpperCase() });
                                setPopoverOpen(false);
                                setNewCatInput('');
                              }
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" /> Crear "{newCatInput.toUpperCase()}"
                          </Button>
                        </CommandEmpty>
                        <CommandGroup>
                          {suggestedCategories.map((cat) => (
                            <CommandItem
                              key={cat}
                              value={cat}
                              onSelect={(currentValue) => {
                                setCurrentPlatillo({ ...currentPlatillo, categoria: currentValue === currentPlatillo?.categoria ? "" : currentValue });
                                setPopoverOpen(false);
                              }}
                              className="uppercase font-bold"
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  currentPlatillo?.categoria === cat ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {cat}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-text-primary flex items-center gap-2 text-lg">
                    <Utensils className="w-5 h-5 text-brand-primary" /> Ingredientes del Platillo
                  </h3>
                  <p className="text-xs text-text-muted mt-1">Define la composición base de esta preparación usando el buscador SMAE.</p>
                </div>
                <Button variant="outline" size="sm" onClick={addIngrediente} className="h-9 border-dashed border-border-subtle bg-bg-base hover:bg-brand-primary/5 hover:border-brand-primary/30 text-brand-primary px-4">
                  <Plus className="w-4 h-4 mr-2" /> AGREGAR INGREDIENTE
                </Button>
              </div>

              <div className="bg-bg-base p-6 rounded-2xl border border-border-subtle space-y-6 shadow-inner">
                {currentPlatillo?.ingredientes?.map((ing, idx) => (
                  <SmaeIngredientePicker 
                    key={ing.id || idx}
                    index={idx}
                    ingrediente={ing}
                    readonlyCatalog={true}
                    onUpdate={(upd) => updateIngrediente(idx, upd)}
                    onRemove={() => removeIngrediente(idx)}
                  />
                ))}
                
                {(currentPlatillo?.ingredientes?.length || 0) === 0 && (
                  <div className="text-center py-16">
                    <div className="w-16 h-16 bg-bg-surface rounded-full flex items-center justify-center mx-auto mb-4 border border-border-subtle">
                       <Plus className="w-6 h-6 text-text-muted" />
                    </div>
                    <p className="text-text-muted text-sm font-medium">Sin ingredientes aún.</p>
                    <p className="text-[11px] text-text-muted/60 mt-1">Busca y añade alimentos de la lista SMAE.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ─── Modal de Vista Previa ─── */}
      {previewPlatillo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-200">
          <div className="bg-bg-surface w-full max-w-lg rounded-2xl shadow-2xl border border-border-subtle overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-5 bg-bg-base/50 border-b border-border-subtle">
              <div>
                <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
                  <Utensils className="w-5 h-5 text-brand-primary" />
                  {previewPlatillo.nombre}
                </h2>
                <span className="inline-block mt-1 text-[10px] font-bold tracking-widest text-text-muted uppercase bg-bg-base px-2 py-0.5 rounded border border-border-subtle">
                  {previewPlatillo.categoria}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPreviewPlatillo(null)} className="h-8 w-8 p-0 text-text-muted hover:text-white">
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Body */}
            <div className="p-5 flex-1 overflow-y-auto custom-scrollbar">
              <h3 className="text-[11px] font-black text-text-muted uppercase tracking-widest mb-3">Composición ({previewPlatillo.ingredientes?.length || 0} items)</h3>
              <div className="space-y-3">
                {previewPlatillo.ingredientes?.map((ing, i) => (
                  <div key={i} className="flex items-start justify-between bg-bg-base p-3 rounded-xl border border-border-subtle">
                    <div>
                      <p className="text-sm font-bold text-text-primary">{ing.descripcion}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {ing.cantidad} {ing.unidad}
                      </p>
                    </div>
                    {ing.eqGrupo && (
                      <span className="text-[10px] font-medium text-[#90c2ff] bg-[#90c2ff]/10 px-2 py-1 rounded border border-[#90c2ff]/20">
                        {ing.eqCantidad} Eq {ing.eqGrupo}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer with actions */}
            <div className="p-5 border-t border-border-subtle bg-bg-base/30 flex items-center justify-between">
               <Button 
                 variant="outline" 
                 className="text-accent-red border-accent-red/20 hover:bg-accent-red/10"
                 onClick={() => {
                   const id = previewPlatillo.id;
                   setPreviewPlatillo(null);
                   handleDelete(id);
                 }}
               >
                 <Trash2 className="w-4 h-4 mr-2" /> Eliminar
               </Button>
               <div className="flex items-center gap-3">
                 <Button 
                   variant="outline"
                   onClick={() => handleDuplicate(previewPlatillo)}
                   className="border-[#90c2ff]/30 text-[#90c2ff] hover:bg-[#90c2ff]/10"
                 >
                   <Copy className="w-4 h-4 mr-2" /> Duplicar
                 </Button>
                 <Button 
                   variant="default"
                   onClick={() => { 
                     setPreviewPlatillo(null);
                     handleEdit(previewPlatillo); 
                   }}
                   className="bg-brand-primary text-bg-base hover:bg-white"
                 >
                   <Edit2 className="w-4 h-4 mr-2" /> Editar Platillo
                 </Button>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Platillos;
