import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Edit2, FileText, Send, Lock, Trash2, Clock, Settings2, Activity } from 'lucide-react';
import api from '@/lib/api';
import type { Plan } from '@/types';
import { formatDate, formatDecimal } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterPlanChange } from '@/lib/invalidation';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { formatMealTimeName } from '@/lib/mealTimes';
import { getMenuTimesForDisplay } from '@/lib/menuEquivalencias';
import { PlanDeliveryDialog } from '@/components/PlanDeliveryDialog';
import { getPlanDeliveryFeedback, type PlanDeliveryChannels } from '@/lib/planDelivery';
import { Phase4Delivery } from './Phase4Delivery';

export const PlanEnvioForm = ({ pacienteId: propPacienteId, planId: propPlanId, onFinish }: { pacienteId?: string, planId?: string, onFinish?: () => void }) => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const pacienteId = propPacienteId;
    const planId = propPlanId;
    const [plan, setPlan] = useState<Plan | null>(null);
    const [loading, setLoading] = useState(true);
    const [pacienteNombre, setPacienteNombre] = useState('');
    const [pacienteContacto, setPacienteContacto] = useState({ email: '', phone: '' });

    useEffect(() => {
        const fetch = async () => {
            try {
                // Cargar plan y paciente en paralelo
                const [planRes, pacRes] = await Promise.all([
                    api.get(`/api/pacientes/${pacienteId}/planes/${planId}`),
                    api.get(`/api/pacientes/${pacienteId}`).catch(() => null),
                ]);
                let serverData = planRes.data?.data || planRes.data;
                if (serverData) {
                    // Debug: ver la estructura cruda de menus del backend
                    console.log('[PlanView] raw menus:', JSON.stringify(serverData.menus?.map((m: any) => ({
                        nombre: m.nombre,
                        tiemposKeys: Object.keys(m),
                        tiemposCount: (m.tiemposComida || m.tiempos || []).length,
                    }))));

                    serverData.menus = serverData.menus?.map((m: any) => {
                        const displayTimes = getMenuTimesForDisplay({
                            ...m,
                            tiempos: m.tiemposComida || m.tiempos || [],
                        });
                        return {
                        ...m,
                        tiempos: displayTimes.map((t: any) => {
                            // Parse metadata encoded in notaPie (fallback until backend adds columns)
                            const rawNote = t.notaPie || t.nota || '';
                            let nota = rawNote;
                            let metaBebida = '';
                            let metaSuplTiempo = '';
                            let metaSuplNotas = '';
                            const metaMatch = rawNote.match(/\n?<!--META:(.*?)-->/);
                            if (metaMatch) {
                                try {
                                    const parsed = JSON.parse(metaMatch[1]);
                                    metaBebida = parsed.bebida || '';
                                    metaSuplTiempo = parsed.suplTiempo || '';
                                    metaSuplNotas = parsed.suplNotas || '';
                                } catch { /* ignore */ }
                                nota = rawNote.replace(/\n?<!--META:.*?-->/, '');
                            }
                            return {
                                ...t,
                                nombre: formatMealTimeName(t.nombre) || 'Sin nombre',
                                nota,
                                bebida: t.bebida || metaBebida,
                                suplTiempo: t.suplTiempo || metaSuplTiempo,
                                suplNotas: t.suplNotas || metaSuplNotas,
                                ingredientes: (t.ingredientes || []).map((i: any) => ({
                                    ...i,
                                    cantidad: parseFloat(i.cantidad) || i.cantidad,
                                    eqCantidad: parseFloat(i.eqCantidad) || i.eqCantidad
                                }))
                            };
                        })
                    };
                    }) || [];

                    // Siempre sincronizar suplementosDetalle desde la valoración enlazada
                    // para que cambios en el toggle de la valoración se reflejen aquí
                    if (serverData.valoracionId) {
                        try {
                            const valRes = await api.get(`/api/pacientes/${pacienteId}/valoraciones/${serverData.valoracionId}`);
                            const valData = valRes.data?.data || valRes.data;
                            if (valData) {
                                // Si la valoración tiene suplementos, usarlos; si envió [] (toggle off), respetar eso
                                serverData.suplementosDetalle = valData.suplementosDetalle ?? serverData.suplementosDetalle ?? [];
                            }
                        } catch { /* No-op: si falla, usar los del plan */ }
                    }

                    setPlan(serverData);
                }
                if (pacRes) {
                    const p = pacRes.data?.data || pacRes.data;
                    if (p) {
                        setPacienteNombre(`${p.nombre || ''} ${p.apellido || ''}`.trim());
                        setPacienteContacto({ email: p.email || '', phone: p.telefono || '' });
                    }
                }
            } catch (err) {
                console.error('Error cargando plan:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [pacienteId, planId]);

    const deliverySectionRef = useRef<HTMLDivElement>(null);
    const handlePdfMetaChange = useCallback((meta: Record<string, unknown>) => {
        setPlan(prev => prev ? { ...prev, pdfCustomMeta: meta } : prev);
    }, []);

    const handlePdf = async () => {
        try {
            await api.put(`/api/planes/${planId}/pdf-meta`, plan?.pdfCustomMeta || {});
            // TODO[backend norder-crm-api]: reemplazar encabezado hardcoded por:
            //   L.N. Eyder Méndez Gamboa
            //   Certificación ISAK Nivel 2
            //   Cédula: 11181890
            //   999 453 7182 / nordermx@gmail.com
            //   VIA "Vida Integral y Asesoría Profesional"
            //   Calle 40 #278 G, Campestre C.P. 97120. Mérida, Yucatán.
            // Fuente: src/lib/pdfHeader.ts
            toast({ title: 'Generando Reporte', description: 'Componiendo estructura maestra en PDF...' });
            // Asegurar nombre paciente antes de armar filename
            let nombreFinal = pacienteNombre;
            if (!nombreFinal && pacienteId) {
                try {
                    const pacRes = await api.get(`/api/pacientes/${pacienteId}`);
                    const p = pacRes.data?.data || pacRes.data;
                    if (p) nombreFinal = `${p.nombre || ''} ${p.apellido || ''}`.trim();
                } catch { /* fallback abajo */ }
            }
            const res = await api.get(`/api/planes/${planId}/pdf`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            const safeName = (nombreFinal || 'Paciente').replace(/\s+/g, '_');
            link.setAttribute('download', `Menu_${safeName}_${format(new Date(), 'dd-MM-yyyy')}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            toast({ title: 'PDF DESCARGADO', description: 'El reporte se ha generado correctamente.' });
        } catch (err) {
            toast({ title: 'Error de Generación', description: 'No se pudo generar el reporte PDF', variant: 'destructive' });
        }
    };

    const [sending, setSending] = useState(false);
    const [showDeliveryDialog, setShowDeliveryDialog] = useState(false);
    const sendingLock = useRef(false);

    const handleEnviar = async (channels: PlanDeliveryChannels) => {
        if (sendingLock.current || sending) return;
        sendingLock.current = true;

        try {
            setSending(true);
            await api.put(`/api/planes/${planId}/pdf-meta`, plan?.pdfCustomMeta || {});
            const { data } = await api.post(`/api/planes/${planId}/enviar`, { canales: channels });
            const resultado = data?.data || data;
            const feedback = getPlanDeliveryFeedback(resultado || {}, channels);
            toast({
                title: feedback.title,
                description: feedback.description,
                variant: feedback.destructive ? 'destructive' : 'default',
            });
            setShowDeliveryDialog(false);
            setPlan((prev) => prev ? { ...prev, estadoEnvio: 'enviado' } as Plan : prev);
            // Invalidar cache para que Dashboard y Pendientes reflejen el envío
            invalidateAfterPlanChange(queryClient, pacienteId);
            // Al terminar de enviar, salir de este plan (no debe quedar en el
            // expediente del paciente) hacia el destino configurado por el caller.
            if (onFinish) onFinish();
        } catch (err: any) {
            toast({
                title: 'Error al enviar',
                description: err.response?.data?.message || 'No se pudo enviar el plan. Verifica la configuración de correo y WhatsApp.',
                variant: 'destructive',
            });
        } finally {
            setSending(false);
            sendingLock.current = false;
        }
    };

    if (loading) return (
        <div className="h-[80vh] flex flex-col items-center justify-center">
            <NutritionLoader text="Sincronizando plan..." />
        </div>
    );

    if (!plan) return (
        <div className="h-[80vh] flex flex-col items-center justify-center gap-6">
            <p className="text-[16px] font-medium text-[#8a8a8a]">Menú no localizado</p>
            <button onClick={() => onFinish ? onFinish() : navigate(`/pacientes/${pacienteId}`)} className="text-[14px] font-medium text-white hover:text-[#c0c0c0] transition-colors underline underline-offset-4">Volver al expediente</button>
        </div>
    );

    return (
        <>
            <div className="space-y-10 animate-fade-in max-w-none pb-24">
                <div className="flex flex-col gap-6 pt-6">
                    {(!onFinish || onFinish) && (
                        <button onClick={() => onFinish ? onFinish() : navigate(`/pacientes/${pacienteId}`)} className="flex items-center gap-2 text-[14px] font-medium text-[#c0c0c0] hover:text-white transition-colors w-fit group">
                            <ArrowLeft className="h-[18px] w-[18px] group-hover:-translate-x-1 transition-transform" /> {onFinish ? 'Finalizar Plan y Salir' : 'Volver al expediente'}
                        </button>
                    )}

                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 animate-slide-up">
                        <div className="space-y-0.5">
                            {/* Nombre del Paciente como título principal */}
                            {pacienteNombre && (
                                <h1 className="text-[26px] font-bold text-white m-0 tracking-tight">
                                    {pacienteNombre}
                                </h1>
                            )}
                            <p className="text-[#8a8a8a] font-medium text-[13px] m-0 uppercase tracking-widest">
                                Menú &mdash; {plan.tipoPlan || plan.tipo}
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row flex-wrap gap-3 w-full sm:w-auto">
                            <button
                                onClick={() => navigate(`/pacientes/${pacienteId}/planes/${planId}/editar${plan.valoracionId ? `?valoracionId=${plan.valoracionId}` : ''}`)}
                                className="flex items-center justify-center gap-2 px-[18px] py-[10px] bg-[#181818] text-white border border-[#2a2a2a] rounded-[8px] text-[14px] font-medium transition-colors hover:bg-[#222] w-full sm:w-auto"
                            >
                                <Edit2 className="h-[18px] w-[18px]" /> Editar
                            </button>
                            <button
                                onClick={() => deliverySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                className="flex items-center justify-center gap-2 px-[18px] py-[10px] bg-[#111111] text-white border border-[#2a2a2a] rounded-[8px] text-[14px] font-medium transition-colors hover:bg-[#181818] w-full sm:w-auto"
                            >
                                <Settings2 className="h-[18px] w-[18px]" /> Preparar envío
                            </button>
                            <button
                                onClick={handlePdf}
                                className="flex items-center justify-center gap-2 px-[18px] py-[10px] bg-[#111111] text-white border border-[#2a2a2a] rounded-[8px] text-[14px] font-medium transition-colors hover:bg-[#181818] w-full sm:w-auto"
                            >
                                <FileText className="h-[18px] w-[18px]" /> Descargar
                            </button>
                            <button
                                onClick={() => setShowDeliveryDialog(true)}
                                disabled={sending}
                                className="flex items-center justify-center gap-2 px-[18px] py-[10px] bg-[#111111] text-white border border-[#2a2a2a] rounded-[8px] text-[14px] font-medium transition-colors hover:bg-[#181818] disabled:opacity-50 w-full sm:w-auto"
                            >
                                {sending ? (
                                    <div className="w-[18px] h-[18px] border-2 border-white/20 border-t-white dark:border-black/20 dark:border-t-black rounded-full animate-spin" />
                                ) : (
                                    <Send className="h-[18px] w-[18px]" />
                                )}
                                {sending ? 'Enviando...' : 'Enviar al paciente'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="bg-[#111111] border border-[#2a2a2a] p-6 rounded-[12px] animate-slide-up">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div className="space-y-1">
                            <p className="text-[12px] font-medium text-[#8a8a8a] m-0">Calorías Diarias</p>
                            <p className="text-[22px] font-bold text-white m-0">{plan.calorias}<span className="text-[14px] font-medium text-[#c0c0c0] ml-1">Kcal</span></p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[12px] font-medium text-[#8a8a8a] m-0">Proteínas</p>
                            <p className="text-[22px] font-bold text-white m-0">{plan.proteinasPct}<span className="text-[14px] font-medium text-[#c0c0c0] ml-1">%</span></p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[12px] font-medium text-[#8a8a8a] m-0">Carbohidratos</p>
                            <p className="text-[22px] font-bold text-white m-0">{plan.carbohidratosPct}<span className="text-[14px] font-medium text-[#c0c0c0] ml-1">%</span></p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[12px] font-medium text-[#8a8a8a] m-0">Lípidos</p>
                            <p className="text-[22px] font-bold text-white m-0">{plan.grasasPct}<span className="text-[14px] font-medium text-[#c0c0c0] ml-1">%</span></p>
                        </div>
                    </div>
                </div>

                {(plan.notasGenerales || plan.notas) && (
                    <div className="bg-[#181818] p-6 rounded-[12px] border border-[#2a2a2a]">
                        <div className="flex items-center gap-2 mb-3 text-[#c0c0c0]">
                            <FileText className="w-[18px] h-[18px] text-white" />
                            <h3 className="text-[16px] font-semibold text-white m-0">Recomendaciones Generales</h3>
                        </div>
                        <p className="text-[14px] font-normal leading-relaxed text-[#c0c0c0] m-0">{plan.notasGenerales || plan.notas}</p>
                    </div>
                )}

                {plan.suplementosDetalle && plan.suplementosDetalle.length > 0 && (
                    <div className="bg-[#181818] p-6 rounded-[12px] border border-[#2a2a2a] animate-slide-up">
                        <div className="flex items-center gap-2 mb-5 text-brand-primary">
                            <Activity className="w-[18px] h-[18px]" />
                            <h3 className="text-[16px] font-bold text-white m-0 tracking-wide uppercase">NORDER SUPS</h3>
                        </div>
                        <div className="overflow-hidden rounded-[8px] border border-[#2a2a2a] bg-[#111]">
                            <table className="w-full border-collapse text-left">
                                <thead>
                                    <tr className="bg-[#1a1a1a] border-b border-[#2a2a2a]">
                                        <th className="px-4 py-3 text-[11px] font-black text-[#555] uppercase tracking-widest w-[30%]">Suplemento</th>
                                        <th className="px-4 py-3 text-[11px] font-black text-[#555] uppercase tracking-widest w-[45%]">Indicaciones</th>
                                        <th className="px-4 py-3 text-[11px] font-black text-[#555] uppercase tracking-widest w-[25%] text-right">Tiempo de uso</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#2a2a2a]">
                                    {[...plan.suplementosDetalle].sort((a, b) => (b.activo ? 1 : 0) - (a.activo ? 1 : 0)).map((sup, idx) => {
                                        const endDate = sup.activo ? new Date() : (sup.fechaFin ? new Date(sup.fechaFin) : new Date());
                                        const diasMs = endDate.getTime() - new Date(sup.fechaInicio).getTime();
                                        const diasTotales = Math.max(1, Math.floor(diasMs / (1000 * 3600 * 24)));
                                        const meses = Math.floor(diasTotales / 30);
                                        const diasExtra = diasTotales % 30;
                                        const tiempoStr = meses > 0
                                            ? `${meses} m${meses > 1 ? 'es' : ''}${diasExtra > 0 ? ` y ${diasExtra} d` : ''}`
                                            : `${diasTotales} d${diasTotales > 1 ? 'ías' : 'ía'}`;

                                        return (
                                            <tr key={idx} className="group hover:bg-[#181818] transition-colors">
                                                <td className="px-4 py-4 align-top">
                                                    <div className="flex items-start gap-2">
                                                        <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${sup.activo ? 'bg-brand-primary' : 'bg-[#555]'}`} />
                                                        <div>
                                                            <span className={`text-[13px] font-bold leading-tight ${sup.activo ? 'text-white' : 'text-[#666] line-through'}`}>{sup.nombre}</span>
                                                            <span className={`ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-[4px] ${sup.activo ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-[#222] text-[#555] border border-[#333]'}`}>
                                                                {sup.activo ? 'activo' : 'suspendido'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 align-top">
                                                    <p className="text-[12px] font-medium text-[#c0c0c0] m-0 leading-relaxed whitespace-pre-line">{sup.indicaciones}</p>
                                                </td>
                                                <td className="px-4 py-4 align-top text-right">
                                                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-brand-primary/10 rounded-[4px] border border-brand-primary/20">
                                                        <Clock className="w-3 h-3 text-brand-primary" />
                                                        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-primary whitespace-nowrap">{tiempoStr}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Menus Grid */}
                <div className="grid lg:grid-cols-2 gap-6">
                    {plan.menus.map((menu, i) => (
                        <div key={i} className="bg-[#111111] border border-[#2a2a2a] p-6 rounded-[12px] flex flex-col h-full hover:border-[#444] transition-colors">
                            <div className="flex items-center gap-3 mb-6 border-b border-[#2a2a2a] pb-4">
                                <div className="w-1.5 h-5 bg-brand-primary rounded-full" />
                                <h3 className="text-[18px] font-semibold text-white m-0">{menu.nombre}</h3>
                            </div>

                            <div className="space-y-6 flex-1">
                                {menu.tiempos.map((t, j) => (
                                    <div key={j} className="group/tiempo p-4 bg-[#181818] rounded-[8px] border border-[#2a2a2a]">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Clock className="w-4 h-4 text-[#8a8a8a]" />
                                            <span className="text-[14px] font-semibold text-white m-0">{t.nombre}</span>
                                        </div>
                                        <div className="space-y-3">
                                            {Array.from(new Set(t.ingredientes.map((i: any) => i.platillo || ''))).map((pName: any, pIndex: number) => (
                                                <div key={pIndex}>
                                                    {pName && (
                                                        <p className="text-[11px] font-bold text-white uppercase tracking-wider mb-2 mt-3 border-b border-[#2a2a2a] pb-1">
                                                            {pName}
                                                        </p>
                                                    )}
                                                    <ul className="space-y-3">
                                                        {t.ingredientes.filter((i: any) => (i.platillo || '') === pName).map((ing: any, k: number) => (
                                                            <li key={k} className="flex flex-col gap-1">
                                                                <div className="flex items-start gap-2">
                                                                    <div className="mt-1.5 min-w-[6px] h-[6px] rounded-full bg-text-muted" />
                                                                    <span className="text-[14px] font-medium text-[#c0c0c0] m-0 leading-tight">
                                                                        {(parseFloat(String(ing.cantidad)) || 0) > 0 && <>{ing.cantidad} {ing.unidad} </>}
                                                                        <span className="text-white">{ing.descripcion}</span>
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-wrap gap-x-4 gap-y-1 ml-[14px]">
                                                                    {(() => {
                                                                        const eqs = ing.equivalencias && ing.equivalencias.length > 0
                                                                            ? ing.equivalencias.filter((e: any) => e.cantidad && parseFloat(String(e.cantidad)) > 0 && e.grupo)
                                                                            : (ing.eqCantidad && parseFloat(String(ing.eqCantidad)) > 0 ? [{ cantidad: ing.eqCantidad, grupo: ing.eqGrupo }] : []);
                                                                        if (eqs.length === 0) return null;
                                                                        return (
                                                                            <p className="text-[12px] font-medium text-[#8a8a8a] m-0">
                                                                                Eq: {eqs.map((e: any) => `${e.cantidad} ${e.grupo}`).join(' + ')}
                                                                            </p>
                                                                        );
                                                                    })()}
                                                                    {ing.nota && (
                                                                        <p className="text-[12px] font-normal italic text-[#8a8a8a] m-0">
                                                                            * {ing.nota}
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Renderizado de Bebida y Suplementación en UI */}
                                        {(t.bebida || t.suplTiempo) && (
                                            <div className="mt-4 space-y-2 p-3 bg-[#0a0a0a] rounded-[6px] border border-[#2a2a2a]">
                                                {t.bebida && (
                                                    <p className="text-[13px] font-medium text-[#c0c0c0] m-0">
                                                        Bebida: <span className="text-white">{t.bebida}</span>
                                                    </p>
                                                )}
                                                {t.suplTiempo && (
                                                    <p className="text-[13px] font-medium text-[#c0c0c0] m-0">
                                                        Suplemento: <span className="text-white">{t.suplTiempo}</span>
                                                        {t.suplNotas && <span className="text-[#8a8a8a] text-[12px] ml-1">({t.suplNotas})</span>}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {t.nota && <p className="text-[13px] font-normal text-[#8a8a8a] mt-4 p-3 bg-[#0a0a0a] rounded-[6px] border border-[#2a2a2a] italic m-0">{t.nota}</p>}
                                    </div>
                                ))}
                            </div>

                            {plan.proximaSesion && plan.menus.length === 1 && (
                                <div className="mt-6 pt-6 border-t border-[#333]">
                                    <div className="flex items-center gap-3 p-4 bg-[#181818] rounded-[8px] border border-[#2a2a2a]">
                                        <Lock className="h-[18px] w-[18px] text-[#c0c0c0]" />
                                        <p className="text-[14px] font-medium text-white m-0">
                                            Siguiente cita: <span className="font-normal text-[#c0c0c0]">{formatDate(plan.proximaSesion)}</span>
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {plan.proximaSesion && plan.menus.length > 1 && (
                    <div className="bg-[#181818] border border-[#2a2a2a] py-4 px-6 rounded-[12px] flex items-center justify-center animate-slide-up">
                        <p className="text-[14px] font-medium text-white m-0">
                            Próxima cita de seguimiento: <span className="font-normal text-[#c0c0c0]">{formatDate(plan.proximaSesion)}</span>
                        </p>
                    </div>
                )}

                <div
                    ref={deliverySectionRef}
                    id="preparar-envio"
                    className="scroll-mt-6 border-t border-[#2a2a2a] pt-10"
                    data-testid="plan-pdf-delivery-panel"
                >
                    <Phase4Delivery
                        pacienteId={pacienteId || ''}
                        planId={planId || ''}
                        onFinish={() => onFinish ? onFinish() : navigate(`/pacientes/${pacienteId}`)}
                        context="plan-detail"
                        onMetaChange={handlePdfMetaChange}
                    />
                </div>
                <PlanDeliveryDialog
                    open={showDeliveryDialog}
                    patientName={pacienteNombre}
                    email={pacienteContacto.email}
                    phone={pacienteContacto.phone}
                    sending={sending}
                    onCancel={() => setShowDeliveryDialog(false)}
                    onConfirm={handleEnviar}
                />
            </div>
        </>
    );
};

export default function PlanView() {
    const { id: pacienteId, planId } = useParams();
    const navigate = useNavigate();
    return <PlanEnvioForm pacienteId={pacienteId} planId={planId} onFinish={() => navigate('/dashboard')} />;
}
