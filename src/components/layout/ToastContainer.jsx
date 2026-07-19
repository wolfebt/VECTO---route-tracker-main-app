import React from 'react';
import { useToastStore } from '../../store/useToastStore';
import { XCircle, CheckCircle, Info, X, AlertTriangle } from 'lucide-react';

export default function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        let Icon = Info;
        let bgColor = 'bg-gray-800';
        let iconColor = 'text-blue-400';
        let glowClass = 'shadow-[0_0_15px_rgba(96,165,250,0.4)] border-blue-500/50';

        if (toast.type === 'error') {
          Icon = XCircle;
          iconColor = 'text-red-400';
          glowClass = 'shadow-[0_0_15px_rgba(248,113,113,0.4)] border-red-500/50';
        } else if (toast.type === 'success') {
          Icon = CheckCircle;
          iconColor = 'text-green-400';
          glowClass = 'shadow-[0_0_15px_rgba(74,222,128,0.4)] border-green-500/50';
        } else if (toast.type === 'warning') {
          Icon = AlertTriangle;
          iconColor = 'text-yellow-400';
          glowClass = 'shadow-[0_0_15px_rgba(250,204,21,0.4)] border-yellow-500/50';
        }

        return (
          <div
            key={toast.id}
            onClick={() => removeToast(toast.id)}
            className={`${bgColor} border ${glowClass} rounded-lg p-3 flex items-start gap-3 pointer-events-auto cursor-pointer transform transition-all duration-300 w-80 max-w-full`}
          >
            <Icon className={`flex-shrink-0 ${iconColor}`} size={20} />
            <div className="flex-1 text-sm text-gray-200 mt-0.5">
              {toast.message}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-gray-400 hover:text-white flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
