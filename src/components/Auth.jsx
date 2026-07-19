import React from 'react';
import { useAuth } from '../hooks/useFirebase';

export default function Auth() {
  const { login } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full text-center border border-gray-700">
        <h1 className="text-3xl font-bold text-teal-500 mb-2">Vecto</h1>
        <p className="text-gray-400 mb-6">Route Tracking & Fleet Management</p>
        <button
          onClick={login}
          className="w-full flex items-center justify-center bg-white text-gray-800 font-semibold py-2 px-4 rounded shadow hover:bg-gray-100 transition-colors"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 mr-2" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
