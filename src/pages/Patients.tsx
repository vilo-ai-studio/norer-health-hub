import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ChevronRight } from 'lucide-react';
import { usePatients } from '@/hooks/usePatients';
import type { Paciente } from '@/types';
import { formatDate } from '@/lib/format';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { PatientLoadError } from '@/components/PatientLoadError';

const Patients = () => {
  const [search, setSearch]           = useState('');
  const [debouncedSearch, setDebounced] = useState('');
  const navigate = useNavigate();

  // Debounce 300ms — no se llama a la API por cada tecla
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: pacientes = [], isLoading: loading, isError, refetch } = usePatients(debouncedSearch);

  const diasSinVisita = (fecha?: string) => {
    if (!fecha) return null;
    const cleanStr = fecha.includes('T') ? fecha.split('T')[0] + 'T12:00:00' : fecha;
    const diff = Math.floor((Date.now() - new Date(cleanStr).getTime()) / 86400000);
    return diff;
  };

  if (loading && pacientes.length === 0) return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)]">
      <NutritionLoader text="Cargando Directorio Clínico..." />
    </div>
  );

  if (isError && pacientes.length === 0) return <PatientLoadError onRetry={() => refetch()} />;

  return (
    <div className="space-y-8 animate-fade-in pb-32 max-w-none">
      {isError && <PatientLoadError onRetry={() => refetch()} />}
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pt-4">
        <div>
          <h1 className="text-[26px] font-bold text-text-primary m-0">
            Directorio Clínico
          </h1>
          <p className="text-[14px] font-normal text-text-secondary mt-1">
             Gestión de Pacientes · {pacientes.length} Expedientes
          </p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => navigate('/pacientes/nuevo')}
            className="flex items-center gap-2 bg-transparent border border-border-default text-text-primary rounded-[8px] px-[18px] py-[10px] text-[14px] font-medium transition-colors hover:bg-bg-elevated"
          >
            <Plus className="h-[18px] w-[18px] text-text-secondary" /> Registrar nuevo paciente
          </button>
        </div>
      </div>

      {/* CONTROLS SECTION */}
      <div className="bg-bg-surface p-6 rounded-[12px] border border-border-subtle shadow-none space-y-6 animate-slide-up">
        <div className="flex flex-col lg:flex-row gap-6 items-center justify-between">
          <div className="relative w-full lg:w-[450px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-text-muted" />
            <input
              type="text"
              placeholder="Buscar por nombre o teléfono..."
              className="w-full bg-bg-elevated border border-border-subtle rounded-[8px] pl-12 pr-4 py-[10px] text-[14px] font-normal text-text-primary outline-none focus:border-[#444] transition-all placeholder:text-text-muted"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* LIST TABLE SECTION */}
        <div className="overflow-x-auto rounded-[8px] border border-border-subtle bg-bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-subtle text-left bg-bg-surface">
                <th className="px-6 py-4 text-[12px] font-medium text-text-muted uppercase">Paciente</th>
                <th className="px-6 py-4 text-[12px] font-medium text-text-muted uppercase">Última Visita</th>
                <th className="px-6 py-4 text-[12px] font-medium text-text-muted uppercase text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {pacientes.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-20 text-center">
                    <p className="text-[14px] text-text-secondary">Sin registros que coincidan</p>
                  </td>
                </tr>
              ) : (
                pacientes.map((p) => {
                  const ultimaVisitaReal = p.ultimaValoracion?.fecha ?? p.valoraciones?.[0]?.fecha ?? null;
                  const sinVisita = diasSinVisita(ultimaVisitaReal);
                  
                  return (
                    <tr 
                      key={p.id} 
                      className="group hover:bg-bg-elevated transition-colors cursor-pointer"
                      onClick={() => navigate(`/pacientes/${p.id}`)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-bg-elevated border border-border-subtle text-text-primary flex items-center justify-center font-bold text-[14px]">
                            {p.nombre[0]}
                          </div>
                          <div>
                            <p className="text-[14px] font-medium text-text-primary m-0">{p.nombre} {p.apellido}</p>
                            <p className="text-[12px] font-normal text-text-secondary mt-0.5">{p.id.slice(-6).toUpperCase()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                         <div className="flex items-center gap-3">
                           {ultimaVisitaReal ? (
                             <div className="flex flex-col">
                               <p className="text-[14px] font-normal text-text-primary m-0">{formatDate(ultimaVisitaReal)}</p>
                               {sinVisita !== null && sinVisita > 45 && (
                                 <p className="text-[12px] font-medium text-accent-orange mt-0.5 flex items-center gap-1">
                                    Ausente {sinVisita}d
                                 </p>
                               )}
                             </div>
                           ) : (
                             <p className="text-[14px] font-normal text-text-secondary">Primer control pendiente</p>
                           )}
                         </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-text-secondary hover:text-text-primary transition-colors p-2 rounded-[8px] hover:bg-bg-muted">
                           <ChevronRight className="h-[18px] w-[18px]" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Patients;
