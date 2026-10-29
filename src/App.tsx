import React, { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { usePortalAuthStore } from "@/store/portalAuth";
import { useThemeStore } from "@/store/theme";
import Layout from "@/components/Layout";
import { ChatErrorBoundary } from "@/components/norderhealth/ChatErrorBoundary";
import { NutritionLoader } from "@/components/ui/NutritionLoader";

// El diccionario ortográfico es pesado; se carga después del shell principal
// para no bloquear la primera pintura ni inflar el bundle inicial.
const LocalSpellcheck = React.lazy(() => import("@/components/LocalSpellcheck"));
const Login = React.lazy(() => import("@/pages/Login"));
const Dashboard = React.lazy(() => import("@/pages/Dashboard"));
const Patients = React.lazy(() => import("@/pages/Patients"));
const NewPatient = React.lazy(() => import("@/pages/NewPatient"));
const PatientProfile = React.lazy(() => import("@/pages/PatientProfile"));
const EditPatient = React.lazy(() => import("@/pages/EditPatient"));
const NewAssessment = React.lazy(() => import("@/pages/NewAssessment"));
const AssessmentDetail = React.lazy(() => import("@/pages/AssessmentDetail"));
const CreateEditPlan = React.lazy(() => import("@/pages/CreateEditPlan"));
const PlanView = React.lazy(() => import("@/pages/PlanView"));
const Requirements = React.lazy(() => import("@/pages/Requirements"));
const Pending = React.lazy(() => import("@/pages/Pending"));
const Settings = React.lazy(() => import("@/pages/Settings"));
const EquivalenciasSMAE = React.lazy(() => import("@/pages/EquivalenciasSMAE"));
const Platillos = React.lazy(() => import("@/pages/Platillos"));
const NotFound = React.lazy(() => import("@/pages/NotFound"));
const NorderHealthLogin = React.lazy(() => import("@/pages/norderhealth/Login"));
const NorderHealthHome = React.lazy(() => import("@/pages/norderhealth/Home"));
const NorderHealthChat = React.lazy(() => import("@/pages/norderhealth/Chat"));
const NorderHealthPlanDetail = React.lazy(() => import("@/pages/norderhealth/PlanDetail"));
const PaymentSuccess = React.lazy(() => import("@/pages/norderhealth/PaymentSuccess"));
const PaymentError = React.lazy(() => import("@/pages/norderhealth/PaymentError"));
const PortalLayout = React.lazy(() => import("@/components/norderhealth/PortalLayout"));

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-bg-base text-sm text-text-muted">
    <NutritionLoader />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Datos sirven desde cache por 1 minuto — navegación instantánea
      staleTime: 60 * 1000,
      // Cache se mantiene 10 minutos en background
      gcTime: 10 * 60 * 1000,
      // Refresca datos stale al volver a la pestaña (respeta staleTime de 1 min)
      refetchOnWindowFocus: 'always',
      // Solo 1 retry en error para no esperar demasiado
      retry: 1,
      // No refetch al reconectar para evitar doble carga
      refetchOnReconnect: 'always',
    },
  },
});

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const PortalRoute = ({ children }: { children: React.ReactNode }) => {
  const token = usePortalAuthStore((s) => s.token);
  if (!token) return <Navigate to="/norder-health/login" replace />;
  return <>{children}</>;
};

// Protector de rutas por permiso granular
const PermissionGuard = ({ module, children }: { module: string, children: React.ReactNode }) => {
  const { user } = useAuthStore();
  if (!user) return <Navigate to="/login" replace />;
  const isAdmin = user.rol === 'admin' || (user as any).role === 'admin';
  const hasPerm = isAdmin || user.permisos?.[module]?.read !== false;
  
  if (!hasPerm) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => {
  const { theme } = useThemeStore();
  const { user } = useAuthStore();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  // Decidir a dónde mandar al usuario al entrar a la raíz /
  const getDefaultRoute = () => {
    if (!user) return "/login";
    const isAdmin = user.rol === 'admin' || (user as any).role === 'admin';
    if (isAdmin || user.permisos?.dashboard?.read !== false) return "/dashboard";
    if (user.permisos?.pacientes?.read !== false) return "/pacientes";
    if (user.permisos?.pacientes?.read !== false) return "/pacientes";
    if (user.permisos?.smae?.read !== false) return "/equivalencias";
    return "/configuracion";
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <React.Suspense fallback={null}>
          <LocalSpellcheck />
        </React.Suspense>
        <BrowserRouter>
          <React.Suspense fallback={<RouteFallback />}>
            <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to={getDefaultRoute()} replace />} />
              
              <Route path="dashboard" element={<PermissionGuard module="dashboard"><Dashboard /></PermissionGuard>} />
              
              {/* Rutas de Pacientes */}
              <Route path="pacientes" element={<PermissionGuard module="pacientes"><Patients /></PermissionGuard>} />
              <Route path="pacientes/nuevo" element={<PermissionGuard module="pacientes"><NewPatient /></PermissionGuard>} />
              <Route path="pacientes/:id/editar" element={<PermissionGuard module="pacientes"><EditPatient /></PermissionGuard>} />
              <Route path="pacientes/:id" element={<PermissionGuard module="pacientes"><PatientProfile /></PermissionGuard>} />
              <Route path="pacientes/:id/valoracion/nueva" element={<PermissionGuard module="pacientes"><NewAssessment /></PermissionGuard>} />
              <Route path="pacientes/:id/valoraciones/:valoracionId" element={<PermissionGuard module="pacientes"><AssessmentDetail /></PermissionGuard>} />
              <Route path="pacientes/:id/valoraciones/:valoracionId/editar" element={<PermissionGuard module="pacientes"><NewAssessment /></PermissionGuard>} />
              <Route path="pacientes/:id/requerimientos" element={<PermissionGuard module="pacientes"><Requirements /></PermissionGuard>} />
              <Route path="pacientes/:id/planes/nuevo" element={<PermissionGuard module="pacientes"><CreateEditPlan /></PermissionGuard>} />
              <Route path="pacientes/:id/planes/:planId" element={<PermissionGuard module="pacientes"><PlanView /></PermissionGuard>} />
              <Route path="pacientes/:id/planes/:planId/editar" element={<PermissionGuard module="pacientes"><CreateEditPlan /></PermissionGuard>} />
              
              <Route path="pendientes" element={<PermissionGuard module="planes"><Pending /></PermissionGuard>} />
              
              <Route path="configuracion" element={<Settings />} />
              <Route path="equivalencias" element={<PermissionGuard module="smae"><EquivalenciasSMAE /></PermissionGuard>} />
              <Route path="platillos" element={<PermissionGuard module="planes"><Platillos /></PermissionGuard>} />
            </Route>
            {/* Norder Health — Portal paciente (PWA, fuera del CRM) */}
            <Route path="/norder-health/login" element={<NorderHealthLogin />} />
            <Route path="/norder-health/activado" element={<PaymentSuccess />} />
            <Route path="/norder-health/cancelado" element={<PaymentError />} />
            <Route
              path="/norder-health"
              element={
                <PortalRoute>
                  <PortalLayout />
                </PortalRoute>
              }
            >
              <Route index element={<NorderHealthHome />} />
              <Route path="plan" element={<NorderHealthPlanDetail />} />
              <Route
                path="chat"
                element={
                  <ChatErrorBoundary>
                    <NorderHealthChat />
                  </ChatErrorBoundary>
                }
              />
            </Route>

            <Route path="*" element={<NotFound />} />
            </Routes>
          </React.Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
