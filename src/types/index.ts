export interface User {
  id: string;
  nombre: string;
  email: string;
  rol?: 'admin' | 'practicante';
  permisos?: Record<string, { read: boolean; write: boolean; delete: boolean }>;
  telefono?: string;
  certificacion?: string;
  profesion?: string;
  universidad?: string;
  cedula?: string;
  firma?: string;
  logotipo?: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  apiUrl: string;
  setAuth: (token: string, user: User) => void;
  updateUser: (user: Partial<User>) => void;
  logout: () => void;
  setApiUrl: (url: string) => void;
}

export interface Paciente {
  id: string;
  nombre: string;
  apellido: string | null;
  telefono: string;
  email?: string;
  fechaNacimiento?: string;
  sexo?: 'M' | 'F';
  estatura?: string | number;
  complexion?: string | null;
  fechaRegistro?: string;
  nivelMembresia?: string;
  suscripcionIdExterno?: string | null;
  suscripcionInicio?: string | null;
  suscripcionFin?: string | null;
  portalActivo?: boolean;
  ejercicio?: Ejercicio; 
  datosEjercicio?: Ejercicio; 
  antecedentes?: Antecedentes; 
  habitos?: ConsumoCalorico; 
  consumoCalorico?: ConsumoCalorico; 
  ultimaValoracion?: Valoracion;
  valoraciones?: Valoracion[];
  talla?: number; 
  peso?: number | string;
  edad?: number;
}

export interface Ejercicio {
  id?: string;
  pacienteId?: string;
  objetivo?: string;
  gymOrigen?: string;
  disciplina?: string;
  horaEntrenamiento?: string | null;
  frecuencia?: string;
  tiempo?: string;
  activo?: boolean;
  disciplinasDetalle?: { disciplina: string; frecuencia: string; tiempo: string; activo: boolean }[];
  detallesAdicionales?: string | null;
  nivelActividad?: string;
  porcentajeSedentario?: number;
  porcentajeLeve?: number;
  porcentajeModerado?: number;
  porcentajeIntenso?: number;
}

export interface Farmaco {
  id: string;
  nombre: string;
  tiempoTomando: string;
  activo: boolean;
}

export interface Antecedentes {
  id?: string;
  pacienteId?: string;
  alimentosNoGustan?: string;
  alimentosGustan?: string;
  alergias?: string;
  patologia?: string;
  cirugias?: string;
  farmacos?: string;
  estrenimiento?: string | null;
  consumoAlcohol?: string;
  tabaco?: string;
  agua?: string;
  cicloMenstrual?: string | null;
  signosYSintomas?: string | null;
  historialProductos?: string;
  recomendacionSuplementos?: string;
  suplementosDetalle?: Suplemento[];
  farmacosDetalle?: Farmaco[];
}

export interface ConsumoCalorico {
  id?: string;
  pacienteId?: string;
  recordatorio24hActivo?: boolean;
  horaDesayuno?: string;
  horaColacion1?: string;
  horaAlmuerzo?: string;
  horaColacion2?: string;
  horaCena?: string;
  ayerDesayuno?: string;
  ayerColacion1?: string;
  ayerAlmuerzo?: string;
  ayerColacion2?: string;
  ayerCena?: string;
  usalmenteDesayuno?: string | null;
  usalmenteColacion1?: string | null;
  usalmenteAlmuerzo?: string | null;
  usalmenteColacion2?: string | null;
  usalmenteCena?: string | null;
}

export interface Suplemento {
  id: string;
  nombre: string;
  indicaciones: string;
  fechaInicio: string;
  fechaFin?: string;       // fecha en que se suspendó (si aplica)
  activo: boolean;
}

export interface Valoracion {
  id: string;
  pacienteId: string;
  fecha: string;
  hora?: string;
  numeracion?: number;
  peso?: number;
  pesoActual?: number | string;
  talla?: number;
  estatura?: number | string;
  imc?: number | string;
  pctGrasa2comp?: number | string;
  bioimpedanciaPctGrasa?: number | string;
  kgGrasa2comp?: number | string;
  kgMasaMagra2comp?: number | string;
  pctGrasaCorporal4comp?: number | string;
  superficieCorporal?: number | string;
  masaGrasaReal?: number | string;
  masaOsea?: number | string;
  masaMuscular?: number | string;
  porcentajeGrasa?: number;
  pliegues?: Record<string, number>;
  perimetros?: Record<string, number>;
  diametros?: Record<string, number>;
  composicion?: Record<string, number>;
  bioimpedancia?: Record<string, number>;
  bioquimicos?: Record<string, number>;
  otrosBioquimicos?: string | null;
  bioquimicosOtrosDetalle?: { id?: string; nombre: string; valor: string }[];
  dinamicaDeportiva?: { activo: boolean; disciplinas: { disciplina: string; frecuencia: string; tiempo: string; activo: boolean }[] };
  signosVitales?: Record<string, any>;
  competencia?: Record<string, string>;
  comentarios?: string;
  suplementacion?: string;
  suplementosDetalle?: Suplemento[];
  temario?: { tema: string; detalle: string }[];
  esqueHidratacion?: string;
  plan?: Plan;
  medicionNumero?: number;
  deficitMusculo?: number;
  superficieCorp?: number;
  pctGrasaCorp?: number;
  indicePonderal?: number;
  medicionesEstado?: Record<string, 'REGISTRADA' | 'NO_APLICA' | 'NO_CAPTURADA' | boolean>;
}

export interface Plan {
  id: string;
  nombre?: string;
  pacienteId: string | null;
  valoracionId?: string | null;
  pdfCustomMeta?: any;
  fechaCreacion?: string;
  tipoPlan: string;
  tipo?: string; 
  calorias: number;
  proteinasPct: number;
  carbohidratosPct: number;
  grasasPct: number;
  proteinasKcal?: number;
  carbohidratosKcal?: number;
  grasasKcal?: number;
  proteinasGr?: number;
  carbohidratosGr?: number;
  grasasGr?: number;
  getSedentario?: number;
  getLeve?: number;
  getModerado?: number;
  getIntenso?: number;
  menus: Menu[];
  suplementosDetalle?: Suplemento[];
  proximaSesion?: string;
  proximaSesionHora?: string;
  notasGenerales?: string;
  notas?: string;
  estado?: 'activo' | 'archivado' | 'pendiente';
  estadoEnvio?: 'pendiente' | 'enviado';
}

export interface Menu {
  id?: string;
  nombre: string;
  orden?: number;
  /** El flujo normal sigue siendo platillos; equivalencias se activa por menú. */
  tipoContenido?: 'platillos' | 'equivalencias';
  /** Snapshot independiente del barrido usado por este menú. */
  barridoEquivalencias?: Record<string, any> | null;
  tiempos: TiempoComida[];
  tiemposComida?: TiempoComida[]; // Soporte para data bruta de backend
}

export interface TiempoComida {
  id?: string;
  barridoTiempoId?: string;
  nombre: string;
  orden?: number;
  nota?: string;
  notaPie?: string;      // Soporte para data bruta de backend
  bebida?: string;       // Bebida del tiempo (ej. "500ml agua con limón")
  suplTiempo?: string;   // Suplemento del tiempo (ej. "1 scoop Whey protein")
  suplNotas?: string;    // Notas libres / suplementos (solo texto en PDF)
  ademas?: string;       // Extra / Acompañamientos
  ingredientes: Ingrediente[];
}

export interface EquivalenciaItem {
  cantidad: number | string;
  grupo: string;
}

/** Alias para compatibilidad con código de stash */
export type EqExtra = EquivalenciaItem;

export interface Ingrediente {
  id?: string;
  descripcion: string;
  cantidad: number | string;
  unidad: string;
  eqCantidad?: number | string;  // legacy – primer grupo
  eqGrupo?: string;              // legacy – primer grupo
  equivalencias?: EquivalenciaItem[]; // multi-grupo
  smaeGrPorEq?: number;          // gramos por 1 eq (ancla SMAE, persiste en BD)
  alimentoSmaeId?: string;       // referencia al catálogo AlimentoSMAE (para resolver datos frescos)
  fijarEq?: boolean;             // true = no auto-escalar (alimentos procesados)
  nota?: string;
  orden?: number;
  platillo?: string;
}

export interface Platillo {
  id: string;
  nombre: string;
  categoria: string;
  ingredientes: Ingrediente[];
  creadoEn: string;
  actualizadoEn: string;
}

export interface DashboardMetricas {
  resumen: {
    pacientesTotales: number;
    pacientesNuevos: number;
    planesNutricionales: number;
    consultasTotales: number;
  };
  kpisClave: {
    tasaRetencion: number;
    conversionMembresia: number;
    riesgoAbandono: number;
    riesgoClinico: number;
    promedioGrasaGral: number;
  };
  tendenciaMaestre: {
    mes: string;
    pacientes: number;
    consultas: number;
    planes: number;
  }[];
  googleCalendarUrl?: string;
  objetivos: {
    nombre: string;
    cantidad: number;
  }[];
}

export interface Alerta {
  pacienteId: string;
  nombre: string;
  telefono: string;
  diasSinVisita: number;
  prioridad: 'Alta' | 'Baja';
  tipoRiesgo?: string;
  fechaPlan?: string;
}
