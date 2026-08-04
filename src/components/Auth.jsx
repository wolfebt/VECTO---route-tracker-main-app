import React, { useState } from 'react';
import { useAuth } from '../hooks/useFirebase';

export default function Auth() {
  const { login } = useAuth();
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setIsLoading(true);
      setError('');
      await login();
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message || 'Failed to sign in with Google. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-[100px] -z-10 mix-blend-screen animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-500/20 rounded-full blur-[100px] -z-10 mix-blend-screen animate-pulse" style={{ animationDelay: '2s' }}></div>
      
      <div className="glass-panel p-10 rounded-2xl max-w-md w-full text-center animate-modal-enter relative overflow-hidden">
        {/* Subtle top highlight */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent opacity-50"></div>
        
        <div className="mb-8 flex flex-col items-center">
          <div className="px-5 py-1.5 rounded-xl border border-cyan-400/60 bg-slate-900/90 shadow-[0_0_20px_rgba(6,182,212,0.4)] mb-3">
            <h1 className="text-4xl font-black vecto-brand-title tracking-wider">
              VECTO
            </h1>
          </div>
          <p className="text-gray-400 font-medium text-sm">Route Tracking & Fleet Management</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}
        
        <button
          onClick={handleLogin}
          disabled={isLoading}
          className="w-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white border border-white/20 font-semibold py-3 px-4 rounded-xl backdrop-blur-md transition-all duration-300 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] group disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
          ) : (
            <div className="bg-white p-1 rounded-full mr-3 group-hover:scale-110 transition-transform">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
            </div>
          )}
          {isLoading ? 'Signing in...' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  );
}
