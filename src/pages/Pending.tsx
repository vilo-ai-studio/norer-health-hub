import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Activity, Clock, FileText, CheckCircle2 } from 'lucide-react';
import { usePatients } from '@/hooks/usePatients';
import { formatDate, getBadgeForValuation } from '@/lib/format';
import type { Valoracion } from '@/types';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { PatientLoadError } from '@/components/PatientLoadError';

interface PendingItem {
  paciente: {
    id: string;
    nombre: string;
    apellido: string;
    telefono?: string;
  };
  valoracion: Valoracion;
}

const Pending = () => {
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const navigate = useNavigate();
  const { data: p = [], isLoading: loading, isError, refetch } = usePatients();

  const pendingItems = useMemo(() => {
    let items: PendingItem[] = [];
    
    p.forEach((pac: any) => {
      const valArr = pac.valoraciones || [];
      valArr.forEach((val: any) => {
        // Si val no trae el plan pero paciente.planes sí lo trae, lo inyectamos
        if (!val.plan && pac.planes && Array.isArray(pac.planes)) {
          // Buscamos el plan asociado usando valoracionId
          const planAsociado = pac.planes.find((pl: any) => pl.valoracionId === val.id);
          if (planAsociado) {
            val.plan = planAsociado;
            val.planId = planAsociado.id;
            val.estadoEnvio = planAsociado.estadoEnvio;
          }
        }

        const statusInfo = getBadgeForValuation(val);
        
        // Consideramos pendiente si el estado NO es "Enviado"
        if (statusInfo.text !== 'Enviado') {
          items.push({
            paciente: {
              id: pac.id,
              nombre: pac.nombre,
              apellido: pac.apellido || '',
              telefono: pac.telefono
            },
            valoracion: val
          });
        }
      });
    });

    // Ordenaremos para ver las valoraciones más críticas o recientes primero
    items.sort((a, b) => new Date(b.valoracion.fecha).getTime() - new Date(a.valoracion.fecha).getTime());

    // Filtrar por búsqueda
    return items.filter(item => {
      const searchTerm = search.toLowerCase();
      const fullName = `${item.paciente.nombre} ${item.paciente.apellido}`.toLowerCase();
      return fullName.includes(searchTerm) || (item.paciente.telefono && item.paciente.telefono.includes(searchTerm));
    });
  }, [p, search]);

  const totalPages = Math.ceil(pendingItems.length / itemsPerPage);
  const currentItems = pendingItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading && pendingItems.length === 0) return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)]">
      <NutritionLoader text="Cargando Pendientes..." />
    </div>
  );

  if (isError && p.length === 0) return <PatientLoadError onRetry={() => refetch()} />;

  return (
    <div className="space-y-8 animate-fade-in pb-32 max-w-none">
      {isError && <PatientLoadError onRetry={() => refetch()} />}
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pt-4">
        <div>
          <h1 className="text-[26px] font-bold text-text-primary m-0">
            Pacientes Pendientes
          </h1>
          <p className="text-[14px] font-normal text-text-secondary mt-1">
             Pendientes de creación o envío de plan · {pendingItems.length} Valoraciones
          </p>
        </div>
      </div>

      {/* CONTROLS SECTION */}
      <div className="bg-bg-surface p-6 rounded-[12px] border border-border-subtle shadow-none space-y-6 animate-slide-up">
        <div className="flex flex-col lg:flex-row gap-6 items-center justify-between">
          <div className="relative w-full lg:w-[450px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-text-muted" />
            <input
              type="text"
              placeholder="Buscar paciente..."
              className="w-full bg-bg-elevated border border-border-subtle rounded-[8px] pl-12 pr-4 py-[10px] text-[14px] font-normal text-text-primary outline-none focus:border-[#444] transition-all placeholder:text-text-muted"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>

        {/* LIST TABLE SECTION */}
        <div className="overflow-x-auto rounded-[8px] border border-border-subtle bg-bg-surface">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-subtle text-left bg-bg-surface">
                <th className="px-6 py-4 text-[12px] font-medium text-text-muted uppercase">Nombre y Apellido</th>
                <th className="px-6 py-4 text-[12px] font-medium text-text-muted uppercase">Fecha de Consulta</th>
                <th className="px-6 py-4 text-[12px] font-medium text-text-muted uppercase">Status</th>
                <th className="px-6 py-4 text-[12px] font-medium text-text-muted uppercase text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {currentItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-20 text-center">
                    <p className="text-[14px] text-text-secondary">Sin pendientes. Todo al día ✨</p>
                  </td>
                </tr>
              ) : (
                currentItems.map((item, index) => {
                  const { paciente: p, valoracion: val } = item;
                  const statusInfo = getBadgeForValuation(val);
                  
                  const handleClick = () => {
                    navigate(`/pacientes/${p.id}#historial`);
                  };

                  return (
                    <tr 
                      key={`${p.id}-${val.id}-${index}`} 
                      className="group hover:bg-bg-elevated transition-colors cursor-pointer"
                      onClick={handleClick}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-bg-elevated border border-border-subtle text-text-primary flex items-center justify-center font-bold text-[14px]">
                            {p.nombre?.[0] || 'N'}
                          </div>
                          <div>
                            <p className="text-[14px] font-medium text-text-primary m-0">{p.nombre} {p.apellido}</p>
                            <p className="text-[12px] font-normal text-text-secondary mt-0.5 uppercase">ID: {p.id.slice(-6)} · Val #{(val as any).numeroValoracion || '?'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                         <div className="flex items-center gap-3">
                           {val.fecha ? (
                             <p className="text-[14px] font-normal text-text-primary m-0">{formatDate(val.fecha as string)}</p>
                           ) : (
                             <p className="text-[14px] font-normal text-text-secondary">—</p>
                           )}
                         </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border uppercase tracking-wider ${statusInfo.cls}`}>
                          {statusInfo.text}
                        </span>
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

        {/* PAGINATION */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-4">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              className="px-3 py-1.5 text-[13px] font-medium border border-border-subtle rounded-[6px] hover:bg-bg-elevated disabled:opacity-50"
            >
              Anterior
            </button>
            <span className="text-[13px] text-text-secondary font-medium px-4">
              Página {currentPage} de {totalPages}
            </span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => prev + 1)}
              className="px-3 py-1.5 text-[13px] font-medium border border-border-subtle rounded-[6px] hover:bg-bg-elevated disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Pending;
