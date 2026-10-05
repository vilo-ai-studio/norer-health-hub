import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react';
import Logo from '@/components/Logo';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api.post('/api/admin/login', { email, password });
      if (response.data?.success && response.data?.data?.token) {
        const token = response.data.data.token;
        const userData = response.data.data.user;
        
        const user = {
          id: userData?.id || 'super-admin',
          email: userData?.email || email,
          nombre: userData?.nombre || 'Especialista',
          rol: userData?.rol || 'practicante',
          permisos: userData?.permisos || {},
          telefono: userData?.telefono || '',
        };
        
        setAuth(token, user);
        
        // Redirección dinámica según permisos
        if (user.rol === 'admin' || user.permisos?.dashboard?.read !== false) {
          navigate('/dashboard');
        } else if (user.permisos?.pacientes?.read !== false) {
          navigate('/pacientes');
        } else {
          navigate('/configuracion');
        }
      } else {
        setError('Error en la autenticación. Formato no soportado.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Credenciales no válidas.');
    } finally {
      setPassword('');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black relative overflow-hidden p-6 font-sans dark text-white">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/5 rounded-full blur-[150px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 rounded-full blur-[150px]" />
      
      <div className="w-full max-w-[400px] relative z-10 space-y-8 animate-slide-up">
        <div className="flex flex-col items-center">
           <Logo size="md" className="text-white mb-4" />
           <div className="mt-4 text-center space-y-2">
           </div>
        </div>

        <div className="bg-white/[0.02] backdrop-blur-3xl border border-white/10 p-8 rounded-none">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] ml-1 leading-none">ID del Especialista</label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 focus:border-white/30 rounded-none px-4 py-3 text-white text-sm font-black transition-all outline-none placeholder:text-white/10"
                  placeholder="admin@norder.health"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] ml-1 leading-none">Llave de Acceso</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 focus:border-white/30 rounded-none px-4 py-3 text-white text-sm font-black transition-all outline-none pr-12 placeholder:text-white/10 font-mono"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-all p-1 hover:bg-white/5 rounded-none"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 text-white text-[10px] font-black uppercase tracking-[0.1em] bg-destructive/20 p-4 rounded-none border border-destructive/30 animate-fade-in">
                <AlertCircle className="h-4 w-4 text-destructive" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black font-black text-[11px] uppercase tracking-[0.3em] py-4 rounded-none hover:bg-white/90 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/20 border-t-white dark:border-black/20 dark:border-t-black text-white dark:text-black rounded-full animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" /> AUTENTICAR
                </>
              )}
            </button>
          </form>
        </div>

        <div className="flex flex-col items-center gap-4 pt-4">
           <div className="h-[1px] w-8 bg-white/5" />
           <p className="text-[9px] font-black uppercase tracking-[0.4em] text-white/10 leading-none">Norder Health Hub © MMXXVI</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
