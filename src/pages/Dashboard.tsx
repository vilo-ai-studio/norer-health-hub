import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { usePatients } from '@/hooks/usePatients';
import {
  Users, UserPlus, ClipboardList, Activity, Plus,
  MessageSquare, BookOpen, Trophy, MoreHorizontal,
  Clock, Check, Square, ChevronDown, ChevronsLeft,
  ChevronLeft, ChevronRight, ChevronsRight, ArrowUpRight, ArrowDownRight,
  CalendarCheck2, AlertTriangle
} from 'lucide-react';
import api from '@/lib/api';
import type { DashboardMetricas, Alerta } from '@/types';
import { useAuthStore } from '@/store/auth';
import { getBadgeForValuation } from '@/lib/format';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { PatientLoadError } from '@/components/PatientLoadError';

const Dashboard = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: pacientesData = [], isLoading: loadingPacientes, isError, refetch } = usePatients();

  // Queries para métricas, alertas y top clientes
  const { data: metricas } = useQuery({
    queryKey: queryKeys.dashboard.metricas(),
    queryFn: async () => {
      const res = await api.get('/api/dashboard/metricas');
      return res.data?.data || res.data;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const { data: alertas = [] } = useQuery({
    queryKey: queryKeys.dashboard.alertas(),
    queryFn: async () => {
      const res = await api.get('/api/dashboard/alertas');
      return res.data?.data || res.data || [];
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const { data: topClientesRaw } = useQuery({
    queryKey: queryKeys.dashboard.topClientes(),
    queryFn: async () => {
      const res = await api.get('/api/dashboard/top-clientes');
      return res.data?.data || res.data || [];
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Determinar top-clientes (usando el endpoint si tiene datos, o un fallback de pacientesData)
  const topClientes = useMemo(() => {
    if (topClientesRaw && topClientesRaw.length > 0) return topClientesRaw.slice(0, 10);
    return pacientesData
      .map((p: any) => ({
        id: p.id,
        nombre: `${p.nombre} ${p.apellido || ''}`.trim(),
        valoraciones: p._count?.valoraciones ?? p.totalValoraciones ?? p.numeroValoraciones ?? (Array.isArray(p.valoraciones) ? p.valoraciones.length : 0),
      }))
      .filter((p: any) => p.valoraciones > 0)
      .sort((a: any, b: any) => b.valoraciones - a.valoraciones)
      .slice(0, 10);
  }, [topClientesRaw, pacientesData]);

  // ── KPI "Menús pendientes" ────────────────────────────────────────────────
  // Se evalúan TODAS las valoraciones (sin filtrar por fecha) que aún no
  // tienen su menú enviado — acumulado histórico, no solo el día de hoy.
  const ultimosPendientes = useMemo(() => {
    const pendItems: any[] = [];

    pacientesData.forEach((pac: any) => {
      const valArr: any[] = pac.valoraciones || [];

      valArr.forEach((val: any) => {
        if (!val.fecha) return;

        // Enriquecer con plan si aún no está adjunto
        if (!val.plan && pac.planes && Array.isArray(pac.planes)) {
          const planAsociado = pac.planes.find((pl: any) => pl.valoracionId === val.id);
          if (planAsociado) {
            val.plan = planAsociado;
            val.planId = planAsociado.id;
            val.estadoEnvio = planAsociado.estadoEnvio;
          }
        }

        const statusInfo = getBadgeForValuation(val);
        if (statusInfo.text !== 'Enviado') {
          const planData = val.plan;
          const proximaSesion = val.tieneCita
            ? (val.proximaCita || true)
            : (planData?.proximaSesion || null);
          pendItems.push({
            pacienteId: pac.id,
            nombre: `${pac.nombre} ${pac.apellido || ''}`.trim(),
            fecha: val.fecha,
            numeroValoracion: val.numeroValoracion,
            val,
            statusInfo,
            proximaSesion,
          });
        }
      });
    });
    return pendItems.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }, [pacientesData]);

  // Fecha real (parte de fecha, sin hora) del día de hoy en la zona local
  const isFechaHoy = (fechaStr: string) => {
    if (!fechaStr) return false;
    const datePart = fechaStr.includes('T') ? fechaStr.split('T')[0] : fechaStr;
    const todayPart = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
    return datePart === todayPart;
  };

  // La tabla "Últimos Pacientes" muestra solo las consultas del DÍA DE HOY
  // (fecha real de la valoración), no un histórico mezclado de otros días.
  // Dentro del día, se ordena por última modificación (plan tocado más reciente).
  const pacientesRecientes = useMemo(() => pacientesData.flatMap((pac: any) => {
    const val = Array.isArray(pac.valoraciones) ? pac.valoraciones[0] : null;
    if (!val || !isFechaHoy(val.fecha)) return [];
    const planAsociado = val.plan || (Array.isArray(pac.planes)
      ? pac.planes.find((plan: any) => plan.valoracionId === val.id)
      : null);
    const valoracion = {
      ...val,
      plan: planAsociado || null,
      planId: planAsociado?.id || val.planId || null,
      estadoEnvio: planAsociado?.estadoEnvio || val.estadoEnvio || null,
    };
    // Última modificación real: si hay plan, cuenta lo último que se tocó
    // el plan (creación, edición, cambio de estado); si no hay plan aún,
    // cuenta la valoración misma.
    const modifiedAt = planAsociado?.updatedAt || val.updatedAt || valoracion.fecha;
    return [{
      pacienteId: pac.id,
      nombre: `${pac.nombre} ${pac.apellido || ''}`.trim(),
      fecha: valoracion.fecha,
      modifiedAt,
      val: valoracion,
      statusInfo: getBadgeForValuation(valoracion),
      proximaSesion: valoracion.tieneCita
        ? (valoracion.proximaCita || true)
        : (planAsociado?.proximaSesion || null),
    }];
  }).sort((a: any, b: any) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()), [pacientesData]);

  const loading = loadingPacientes && !metricas;

  const userName = user?.nombre?.split(' ')[0] || 'Especialista';

  // Conteos para KPI "Menús pendientes" — derivados de ultimosPendientes (misma fuente que la tabla)
  const planesSinAsignar = ultimosPendientes.filter((i: any) => i.statusInfo?.text === 'Pendiente de menú').length;
  const planesEnProceso = ultimosPendientes.filter((i: any) => i.statusInfo?.text === 'Menú en Proceso').length;
  const planesListos = ultimosPendientes.filter((i: any) => i.statusInfo?.text === 'Menú Listo').length;
  const planesPendientes = ultimosPendientes.length;

  // Alias corto para el resumen
  const r = metricas?.resumen as any;

  // ── Cálculo dinámico de porcentajes ──────────────────────────────────────────
  // % nuevos del mes sobre el total histórico
  const pctNuevosMes = r?.pacientesTotales > 0
    ? ((r.pacientesNuevosMes ?? 0) / r.pacientesTotales * 100).toFixed(1)
    : '0.0';

  // % de expedientes abiertos hoy sobre el mes
  const pctNuevosHoy = r?.pacientesNuevosMes > 0
    ? ((r.pacientesNuevosHoy ?? 0) / r.pacientesNuevosMes * 100).toFixed(1)
    : '0.0';



  // % de consultas de hoy sobre el total del mes
  const pctConsultasHoy = r?.consultasMes > 0
    ? ((r.consultasHoy ?? 0) / r.consultasMes * 100).toFixed(1)
    : '0.0';

  const cards = [
    {
      label: 'Total de Pacientes',
      value: r?.pacientesTotales ?? 0,
      icon: BookOpen,
      badge: {
        text: `↗ ${pctNuevosMes}%`,
        color: parseFloat(pctNuevosMes) > 0 ? 'text-emerald-400' : 'text-[#555]',
      },
      sub: r?.pacientesNuevosHoy > 0
        ? `+${r.pacientesNuevosHoy} nuevo${r.pacientesNuevosHoy > 1 ? 's' : ''} hoy`
        : 'Sin altas hoy',
      subColor: r?.pacientesNuevosHoy > 0 ? 'text-emerald-400' : 'text-[#555]',
    },
    {
      label: 'Nuevos últimos 30 días',
      value: r?.pacientesNuevosMes ?? 0,
      icon: UserPlus,
      badge: {
        text: `${pctNuevosMes}% del total`,
        color: parseFloat(pctNuevosMes) > 0 ? 'text-emerald-400' : 'text-[#555]',
      },
      sub: r?.pacientesNuevosHoy > 0 ? `+${r.pacientesNuevosHoy} hoy` : '0 nuevos hoy',
      subColor: r?.pacientesNuevosHoy > 0 ? 'text-emerald-400' : 'text-[#8a8a8a]',
    },
    {
      label: 'Menús pendientes',
      value: planesPendientes,
      icon: MessageSquare,
      badge: {
        text: planesPendientes > 0 ? `${planesSinAsignar + planesEnProceso + planesListos} por completar` : '¡Todo al día!',
        color: planesPendientes > 0 ? 'text-amber-400' : 'text-emerald-400',
      },
      sub: planesPendientes > 0
        ? `${planesSinAsignar} Pendiente · ${planesEnProceso} En proceso · ${planesListos} Listo`
        : 'Sin menús pendientes',
      subColor: planesPendientes > 0 ? 'text-amber-400' : 'text-emerald-400',
    },
    {
      label: 'Consultas hoy',
      value: r?.consultasHoy ?? 0,
      icon: ClipboardList,
      badge: {
        text: `${pctConsultasHoy}% del mes`,
        color: parseFloat(pctConsultasHoy) > 0 ? 'text-emerald-400' : 'text-[#555]',
      },
      sub: [
        r?.consultasMes != null ? `${r.consultasMes} este mes` : null,
        r?.consultasAnio != null ? `${r.consultasAnio} este año` : null,
      ].filter(Boolean).join(' · ') || '—',
      subColor: 'text-[#8a8a8a]',
    },
  ];

  if (loading && !metricas) return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)]">
      <NutritionLoader text="Iniciando Dashboard..." />
    </div>
  );

  if (isError && pacientesData.length === 0) return <PatientLoadError onRetry={() => refetch()} />;

  return (
    <div
      className="flex flex-col gap-6 animate-fade-in h-full overflow-y-auto overflow-x-hidden lg:overflow-hidden pb-12 lg:pb-0"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {isError && <PatientLoadError onRetry={() => refetch()} />}
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#f0f0f0] m-4 tracking-tight">
            Bienvenido de vuelta, {userName}!
          </h1>
          <p className="text-[14px] font-normal text-[#8a8a8a] mt-1">
            ¡NEW ORDER begins here!
          </p>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <button
            onClick={() => navigate('/pacientes/nuevo')}
            className="w-full md:w-auto flex items-center justify-center gap-2 bg-[#f0f0f0] text-[#0a0a0a] rounded-[8px] px-[16px] py-[10px] text-[13px] font-semibold transition-colors hover:bg-white border border-transparent shadow-sm"
          >
            <Plus className="h-[16px] w-[16px]" /> Registrar nuevo paciente
          </button>
        </div>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] p-5 flex flex-col gap-4">
            {/* Título e ícono */}
            <div className="flex items-center justify-between px-1">
              <span className="text-[14px] font-medium text-[#e0e0e0]">{c.label}</span>
              <div className="p-[5px] rounded-[6px] border border-[#333]">
                <c.icon className="h-[14px] w-[14px] text-[#8a8a8a]" strokeWidth={1.5} />
              </div>
            </div>

            {/* Número | separador | % badge — DISEÑO ORIGINAL */}
            <div className="flex items-center justify-between bg-[#181818] border border-[#2a2a2a] rounded-[12px] px-4 sm:px-5 py-4">
              <p className="text-[28px] sm:text-[32px] font-normal text-[#f0f0f0] m-0 leading-none tracking-tight tabular-nums">
                {c.value}
              </p>
              <div className="flex items-center gap-3 sm:gap-4 h-8">
                <div className="w-[1px] h-full bg-[#2a2a2a]" />
                <span className={`text-[12px] sm:text-[13px] font-normal tracking-wide whitespace-nowrap ${c.badge.color}`}>
                  {c.badge.text}
                </span>
              </div>
            </div>

            {/* Subtexto contextual */}
            <p className={`text-[12px] font-medium m-0 px-1 leading-tight ${c.subColor}`}>
              {c.sub}
            </p>
          </div>
        ))}
      </div>

      {/* SECCIÓN PRINCIPAL: Tablas */}
      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 flex-1 lg:min-h-0 lg:overflow-hidden shrink-0">

        {/* TOP CLIENTES */}
        <div className="lg:col-span-4 bg-[#111111] border border-[#2a2a2a] rounded-[12px] shadow-none flex flex-col min-h-[300px] lg:min-h-0 lg:overflow-hidden">
          <div className="px-5 py-4 flex justify-between items-center border-b border-[#2a2a2a] shrink-0">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-[#f59e0b]" />
              <h2 className="text-[14px] font-medium text-[#f0f0f0] m-0">Top Clientes</h2>
            </div>
            <span className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">por visitas</span>
          </div>

          <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#2a2a2a]">
            <span className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Paciente</span>
            <span className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Consultas</span>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {topClientes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 opacity-50">
                <p className="text-[13px] text-[#8a8a8a] text-center">Sin datos suficientes</p>
              </div>
            ) : (
              <ul className="flex flex-col m-0 p-0">
                {topClientes.map((cliente, idx) => {
                  // Colores de rank para los 3 primeros
                  const rankColor =
                    idx === 0 ? 'text-[#f59e0b]' :
                      idx === 1 ? 'text-[#9ca3af]' :
                        idx === 2 ? 'text-[#92400e]' :
                          'text-[#444]';


                  return (
                    <li
                      key={cliente.id || idx}
                      onClick={() => cliente.id && navigate(`/pacientes/${cliente.id}#historial`)}
                      className="flex items-center gap-3 px-5 py-[13px] border-b border-[#2a2a2a] last:border-0 hover:bg-[#1a1a1a] transition-colors cursor-pointer group"
                    >
                      {/* Rank */}
                      <span className={`text-[13px] font-bold w-5 shrink-0 ${rankColor}`}>
                        {idx < 3 ? ['①', '②', '③'][idx] : `${idx + 1}`}
                      </span>

                      {/* Nombre + badge */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#f0f0f0] m-0 truncate group-hover:text-white transition-colors">
                          {cliente.nombre}
                        </p>
                      </div>

                      {/* Conteo */}
                      <span className="text-[13px] font-bold text-[#f0f0f0] tabular-nums shrink-0">
                        {String(cliente.valoraciones).padStart(2, '0')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ULTIMOS PACIENTES (2/3 Width on Large Screens) */}
        <div className="lg:col-span-8 bg-[#111111] border border-[#2a2a2a] rounded-[12px] shadow-none flex flex-col min-h-[400px] lg:min-h-0 lg:overflow-hidden">
          <div className="px-5 py-4 border-b border-[#2a2a2a] shrink-0">
            <h2 className="text-[14px] font-medium text-[#f0f0f0] m-0">
              Últimos Pacientes
            </h2>
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar w-full">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-[#2a2a2a] whitespace-nowrap">
                  <th className="pl-5 pr-3 py-3 w-12 text-center" style={{ width: '48px' }}>
                    <Square className="w-4 h-4 text-[#444] inline-block" />
                  </th>
                  <th className="px-3 py-3 text-[12px] font-medium text-[#8a8a8a]">Nombre de Paciente</th>
                  <th className="px-3 py-3 text-[12px] font-medium text-[#8a8a8a]">Estatus</th>
                  <th className="px-3 py-3 text-[12px] font-medium text-[#8a8a8a]">Fecha de Consulta</th>
                  <th className="px-3 py-3 text-[12px] font-medium text-[#8a8a8a]">Última modificación</th>
                  <th className="px-3 py-3 text-[12px] font-medium text-[#8a8a8a] text-center">Próxima sesión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {pacientesRecientes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <p className="text-[13px] text-[#8a8a8a] text-center">Aún no hay consultas registradas hoy.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pacientesRecientes.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((item, i) => {
                    const dateStr = item.fecha
                      ? new Date(item.fecha.includes('T') ? item.fecha.split('T')[0] + 'T12:00:00' : item.fecha)
                        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—';
                    const modifiedStr = item.modifiedAt
                      ? new Date(item.modifiedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—';
                    const hasNextSession = !!item.proximaSesion;
                    return (
                      <tr
                        key={`${item.pacienteId}-${item.val.id || i}`}
                        className="hover:bg-[#1a1a1a] transition-colors cursor-pointer group whitespace-nowrap"
                        onClick={() => navigate(`/pacientes/${item.pacienteId}#historial`)}
                      >
                        <td className="pl-5 pr-3 py-[14px] text-center w-12">
                          <Square className="w-4 h-4 text-[#444] inline-block opacity-50 group-hover:opacity-100 transition-opacity" />
                        </td>
                        <td className="px-3 py-[14px]">
                          <span className="text-[13px] font-medium text-[#f0f0f0]">{item.nombre}</span>
                        </td>
                        <td className="px-3 py-[14px]">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium border uppercase tracking-wider ${item.statusInfo.cls}`}>
                            {item.statusInfo.text}
                          </span>
                        </td>
                        <td className="px-3 py-[14px] text-[13px] font-normal text-[#8a8a8a]">
                          {dateStr}
                        </td>
                        <td className="px-3 py-[14px] text-[13px] font-normal text-[#8a8a8a]">
                          {modifiedStr}
                        </td>
                        <td className="px-3 py-[14px] text-center">
                          {hasNextSession ? (
                            <span title={item.proximaSesion} className="inline-flex items-center justify-center">
                              <CalendarCheck2 className="w-4 h-4 text-emerald-400" />
                            </span>
                          ) : (
                            <span title="Sin cita agendada" className="inline-flex items-center justify-center">
                              <AlertTriangle className="w-4 h-4 text-amber-500/60" />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 border-t border-[#2a2a2a] flex flex-col md:flex-row gap-4 items-center justify-between bg-[#111111]">
            <div className="text-[12px] font-medium text-[#8a8a8a]">
              Mostrando {pacientesRecientes.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : '0'} a {Math.min(currentPage * itemsPerPage, pacientesRecientes.length)} Resultados de {pacientesRecientes.length}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <div className="flex items-center gap-3">
                <span className="text-[12px] font-medium text-[#8a8a8a]">Filas por página</span>
                <select
                  className="flex items-center justify-between px-3 py-1.5 bg-[#181818] border border-[#2a2a2a] rounded-[6px] gap-2 hover:border-[#444] outline-none text-[12px] font-medium text-[#f0f0f0] cursor-pointer transition-colors"
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  className="p-1 px-[5px] bg-transparent border border-transparent rounded-[6px] text-[#8a8a8a] hover:bg-[#1a1a1a] transition-colors disabled:opacity-50"
                  disabled={currentPage === 1}
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(max => Math.max(1, max - 1))}
                  className="p-1 px-[5px] bg-transparent border border-transparent rounded-[6px] text-[#8a8a8a] hover:bg-[#1a1a1a] transition-colors disabled:opacity-50"
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[12px] font-medium text-[#f0f0f0] mx-2 select-none">
                  {currentPage} / {Math.max(1, Math.ceil(pacientesRecientes.length / itemsPerPage))}
                </span>
                <button
                  onClick={() => setCurrentPage(min => Math.min(Math.ceil(pacientesRecientes.length / itemsPerPage), min + 1))}
                  className="p-1 px-[5px] bg-transparent border border-transparent rounded-[6px] text-[#8a8a8a] hover:bg-[#1a1a1a] transition-colors"
                  disabled={currentPage >= Math.ceil(pacientesRecientes.length / itemsPerPage)}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(Math.max(1, Math.ceil(pacientesRecientes.length / itemsPerPage)))}
                  className="p-1 px-[5px] bg-transparent border border-transparent rounded-[6px] text-[#8a8a8a] hover:bg-[#1a1a1a] transition-colors"
                  disabled={currentPage >= Math.ceil(pacientesRecientes.length / itemsPerPage)}
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
