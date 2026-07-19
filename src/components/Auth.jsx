import React from 'react';
import { useAuth } from '../hooks/useFirebase';

export default function Auth() {
  const { login } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-[100px] -z-10 mix-blend-screen animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-500/20 rounded-full blur-[100px] -z-10 mix-blend-screen animate-pulse" style={{ animationDelay: '2s' }}></div>
      
      <div className="glass-panel p-10 rounded-2xl max-w-md w-full text-center animate-modal-enter relative overflow-hidden">
        {/* Subtle top highlight */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent opacity-50"></div>
        
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-accent-400 mb-2 tracking-tight">
            Vecto
          </h1>
          <p className="text-gray-400 font-medium">Route Tracking & Fleet Management</p>
        </div>
        
        <button
          onClick={login}
          className="w-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white border border-white/20 font-semibold py-3 px-4 rounded-xl backdrop-blur-md transition-all duration-300 hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] group"
        >
          <div className="bg-white p-1 rounded-full mr-3 group-hover:scale-110 transition-transform">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          </div>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
